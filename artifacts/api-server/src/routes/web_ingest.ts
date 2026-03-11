import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { documentsTable, entityMentionsTable } from "@workspace/db/schema";
import path from "path";
import fs from "fs";
import { parse as parseHtml } from "node-html-parser";
import { extractEntities } from "../lib/entity-extractor";
import { logEvent } from "../lib/log-event";

const router: IRouter = Router();

// ── RSS helpers ───────────────────────────────────────────────────────────────

export interface WebSearchResult {
  title: string;
  url: string;
  sourceDomain: string;
  snippet: string;
  publishDate: string;
  contentType: "web-article" | "pdf";
}

function parseCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return parseCdata(m[1]).trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#\d+;/g, "")
    .replace(/&\w+;/g, " ");
}

// ── Relevance scoring for investigative queries ───────────────────────────────

const INVESTIGATIVE_KEYWORDS = [
  "contract", "contracts",
  "budget", "budgets",
  "housing", "hotel", "hotels", "shelter", "shelters",
  "program", "programs",
  "authority", "department", "departments",
  "homeless", "homelessness",
  "funding", "fund", "funds",
  "fraud", "embezzle", "misuse", "corruption",
  "investigation", "audit", "probe",
  "lawsuit", "legal", "court", "charges",
  "nonprofit", "charity", "grant",
  "city", "county", "government", "agency",
];

const LIFESTYLE_DOMAINS = [
  "tmz.com", "buzzfeed.com", "people.com", "eonline.com", "usmagazine.com",
  "entertainment", "celebrity", "gossip", "fashion", "lifestyle", "travel",
  "food", "recipe", "wellness", "beauty", "fitness", "sports", "nfl", "nba",
];

function scoreResult(result: WebSearchResult, query: string): number {
  let score = 0;
  const titleLower = result.title.toLowerCase();
  const snippetLower = result.snippet.toLowerCase();
  const domainLower = result.sourceDomain.toLowerCase();
  const queryLower = query.toLowerCase();

  // Exact query phrase in title → big boost
  if (titleLower.includes(queryLower)) score += 6;

  // Query words in title
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 3);
  for (const word of queryWords) {
    if (titleLower.includes(word)) score += 2;
    if (snippetLower.includes(word)) score += 1;
  }

  // Investigative keywords in title or snippet
  for (const kw of INVESTIGATIVE_KEYWORDS) {
    if (titleLower.includes(kw)) score += 1.5;
    else if (snippetLower.includes(kw)) score += 0.5;
  }

  // PDF sources often have primary documents
  if (result.contentType === "pdf") score += 1;

  // Penalise lifestyle/entertainment domains and keywords
  for (const bad of LIFESTYLE_DOMAINS) {
    if (domainLower.includes(bad) || titleLower.includes(bad)) {
      score -= 8;
      break;
    }
  }

  // Prefer longer, more substantive snippets
  if (result.snippet.length > 150) score += 0.5;

  return score;
}

function parseRssItems(xml: string, query = ""): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

  for (const match of itemMatches) {
    const item = match[1];

    let title = decodeEntities(stripHtml(extractTag(item, "title")));
    const dashIdx = title.lastIndexOf(" - ");
    if (dashIdx > 10) title = title.substring(0, dashIdx);

    const url = extractTag(item, "link") || extractTag(item, "guid");
    const pubDate = extractTag(item, "pubDate");
    const rawDesc = extractTag(item, "description");
    const snippet = stripHtml(decodeEntities(rawDesc)).slice(0, 280);

    const srcMatch = item.match(/<source\s+url="([^"]+)"[^>]*>([^<]*)<\/source>/);
    const sourceDomain = srcMatch
      ? srcMatch[2].trim()
      : url
        ? tryHostname(url)
        : "unknown";

    const contentType: "web-article" | "pdf" = url.toLowerCase().includes(".pdf")
      ? "pdf"
      : "web-article";

    if (title && url) {
      results.push({ title, url, sourceDomain, snippet, publishDate: pubDate, contentType });
    }
  }

  // Score and sort if we have a query
  if (query) {
    results.sort((a, b) => scoreResult(b, query) - scoreResult(a, query));
  }

  return results.slice(0, 20);
}

function tryHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

// ── Article text extraction ────────────────────────────────────────────────────

const ARTICLE_SELECTORS = [
  "article",
  "main",
  "[role=main]",
  ".article-body",
  ".post-content",
  ".entry-content",
  ".story-body",
  ".article-content",
  ".content-body",
  ".post-body",
  "#article",
  "#main",
  ".article__body",
  ".article-text",
  ".news-article",
  ".newsArticle",
  ".body-content",
  ".article_body",
  ".story-content",
  ".story-text",
  ".article-copy",
  "[itemprop=articleBody]",
  "[data-component=article-body]",
];

function extractArticleText(html: string, fallback: string): { text: string; status: "ok" | "incomplete" } {
  try {
    const root = parseHtml(html);

    // Strip non-content elements
    for (const sel of [
      "script", "style", "nav", "header", "footer",
      "aside", "noscript", "iframe", ".ad", ".advertisement",
      ".social-share", ".share-buttons", ".related-articles",
      ".newsletter", ".sidebar", ".widget", ".popup",
    ]) {
      root.querySelectorAll(sel).forEach((el) => el.remove());
    }

    let text = "";

    // Try article body selectors in priority order
    for (const sel of ARTICLE_SELECTORS) {
      const el = root.querySelector(sel);
      if (el) {
        const t = el.text.replace(/\s+/g, " ").trim();
        if (t.length > text.length && t.length > 200) {
          text = t;
          if (text.length > 1000) break;
        }
      }
    }

    // Paragraph aggregation fallback — collect all <p> tags
    if (text.length < 200) {
      const paragraphs = root.querySelectorAll("p");
      const paraTexts = paragraphs
        .map((p) => p.text.replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 40);
      if (paraTexts.length > 0) {
        const aggregated = paraTexts.join("\n\n");
        if (aggregated.length > text.length) text = aggregated;
      }
    }

    // Last resort: body text
    if (text.length < 100) {
      text = root.text.replace(/\s+/g, " ").trim();
    }

    const truncated = text.slice(0, 15000);
    const status = truncated.length < 300 ? "incomplete" : "ok";
    return { text: truncated, status };
  } catch {
    return { text: fallback, status: "incomplete" };
  }
}

// ── formatDoc helper ──────────────────────────────────────────────────────────

function formatDoc(d: typeof documentsTable.$inferSelect) {
  return {
    id: d.id,
    title: d.title,
    filePath: d.filePath ?? null,
    source: d.source ?? null,
    publishDate: d.publishDate ?? null,
    uploadedAt: d.uploadedAt.toISOString(),
    caseId: d.caseId ?? null,
    sourceUrl: d.sourceUrl ?? null,
    sourceDomain: d.sourceDomain ?? null,
    ingestMethod: d.ingestMethod ?? "upload",
    rawText: d.rawText ?? null,
    previewType: d.previewType ?? "file",
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /web-search
 * Body: { query: string }
 * Returns: { query, results, provider, count }
 */
router.post("/web-search", async (req, res) => {
  const { query } = req.body;
  if (!query?.trim()) return res.status(400).json({ error: "query required" });

  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query.trim())}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const resp = await fetch(rssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ATLASBot/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) throw new Error(`RSS feed returned HTTP ${resp.status}`);

    const xml = await resp.text();
    const results = parseRssItems(xml, query.trim());

    res.json({ query: query.trim(), results, provider: "google-news-rss", count: results.length });
  } catch (err) {
    console.error("Web search error:", err);
    res.status(502).json({ error: "Search failed", message: String(err) });
  }
});

/**
 * POST /web-ingest
 * Body: { title, url, sourceDomain, snippet, publishDate, caseId }
 * Returns: { document, mentionsCreated, analysisRan }
 */
router.post("/web-ingest", async (req, res) => {
  const { title, url, sourceDomain, snippet, publishDate, caseId } = req.body;
  if (!url || !title) return res.status(400).json({ error: "url and title required" });

  let rawText: string = snippet || title;
  let filePath: string | null = null;
  let previewType = "web-article";

  // Attempt to fetch full article content
  try {
    const articleResp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/pdf,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(14000),
    });

    const ct = articleResp.headers.get("content-type") || "";

    if (ct.includes("application/pdf")) {
      const buffer = await articleResp.arrayBuffer();
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filename = `${Date.now()}-web.pdf`;
      const absPath = path.resolve(uploadDir, filename);
      fs.writeFileSync(absPath, Buffer.from(buffer));
      filePath = `/uploads/${filename}`;
      previewType = "file";
    } else if (ct.includes("text/html") || ct.includes("text/plain")) {
      const html = await articleResp.text();
      const extracted = extractArticleText(html, snippet || title);

      if (extracted.status === "incomplete") {
        // Prefix with EXTRACTION_INCOMPLETE so the viewer can show the warning
        rawText = `[EXTRACTION_INCOMPLETE]\n${extracted.text || snippet || title}`;
      } else {
        rawText = extracted.text;
      }
    }
  } catch (fetchErr) {
    // Non-fatal — mark as incomplete and fall back to snippet
    console.warn("Article fetch failed, using snippet:", String(fetchErr).substring(0, 120));
    rawText = `[EXTRACTION_INCOMPLETE]\n${snippet || title}`;
  }

  // Create document record in vault
  const rows = await db
    .insert(documentsTable)
    .values({
      title,
      filePath,
      source: sourceDomain || null,
      publishDate: publishDate || null,
      caseId: caseId ? parseInt(String(caseId)) : undefined,
      sourceUrl: url,
      sourceDomain: sourceDomain || tryHostname(url),
      ingestMethod: "web",
      rawText,
      previewType,
    })
    .returning();

  const doc = rows[0];

  await logEvent(
    "web_source_ingested",
    `Web source ingested: "${title}" from ${sourceDomain || tryHostname(url)}`,
    { caseId: doc.caseId, documentId: doc.id }
  );

  // Auto-run entity analysis on whatever text we have
  const textForAnalysis = (rawText || `${title} ${sourceDomain || ""}`).replace(/^\[EXTRACTION_INCOMPLETE\]\n/, "");
  const extracted = extractEntities(textForAnalysis);
  let mentionsCreated = 0;

  for (const m of extracted) {
    try {
      await db.insert(entityMentionsTable).values({
        documentId: doc.id,
        caseId: doc.caseId,
        entityName: m.entityName,
        entityType: m.entityType,
        confidence: m.confidence,
        status: "pending",
        context: m.context,
        startPos: m.startPos,
        endPos: m.endPos,
      });
      mentionsCreated++;
    } catch {
      // Skip duplicate/constraint errors
    }
  }

  if (mentionsCreated > 0) {
    await logEvent(
      "analysis_completed",
      `Auto-analysis on "${title}": ${mentionsCreated} entity detection${mentionsCreated !== 1 ? "s" : ""} generated`,
      { caseId: doc.caseId, documentId: doc.id }
    );
  }

  res.status(201).json({
    document: formatDoc(doc),
    mentionsCreated,
    analysisRan: true,
  });
});

export default router;
