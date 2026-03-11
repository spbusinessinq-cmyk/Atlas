import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { documentsTable, entityMentionsTable } from "@workspace/db/schema";
import path from "path";
import fs from "fs";
import { parse as parseHtml } from "node-html-parser";
import { extractEntities } from "../lib/entity-extractor";

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

function parseRssItems(xml: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

  for (const match of itemMatches) {
    const item = match[1];

    let title = decodeEntities(stripHtml(extractTag(item, "title")));
    // Google News titles often end with " - Source Name" — strip the suffix
    const dashIdx = title.lastIndexOf(" - ");
    if (dashIdx > 10) title = title.substring(0, dashIdx);

    const url = extractTag(item, "link") || extractTag(item, "guid");
    const pubDate = extractTag(item, "pubDate");
    const rawDesc = extractTag(item, "description");
    const snippet = stripHtml(decodeEntities(rawDesc)).slice(0, 280);

    // <source url="https://example.com">Source Name</source>
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

function extractArticleText(html: string, fallback: string): string {
  try {
    const root = parseHtml(html);
    // Strip non-content elements
    for (const sel of [
      "script", "style", "nav", "header", "footer",
      "aside", "noscript", "iframe", ".ad", ".advertisement",
    ]) {
      root.querySelectorAll(sel).forEach((el) => el.remove());
    }
    // Try article body selectors in priority order
    const selectors = [
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
    ];
    let text = "";
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) {
        text = el.text.replace(/\s+/g, " ").trim();
        if (text.length > 200) break;
      }
    }
    if (!text || text.length < 100) {
      text = root.text.replace(/\s+/g, " ").trim();
    }
    return text.slice(0, 15000);
  } catch {
    return fallback;
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
    const results = parseRssItems(xml);

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
        Accept: "text/html,application/xhtml+xml,application/pdf,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(14000),
    });

    const ct = articleResp.headers.get("content-type") || "";

    if (ct.includes("application/pdf")) {
      // Download PDF and save to uploads
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
      rawText = extractArticleText(html, snippet || title);
    }
  } catch (fetchErr) {
    // Non-fatal — fall back to snippet/title for analysis
    console.warn("Article fetch failed, using snippet:", String(fetchErr).substring(0, 120));
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

  // Auto-run entity analysis on whatever text we have
  const textForAnalysis = rawText || `${title} ${sourceDomain || ""}`;
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

  res.status(201).json({
    document: formatDoc(doc),
    mentionsCreated,
    analysisRan: true,
  });
});

export default router;
