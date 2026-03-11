import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  documentsTable,
  entityMentionsTable,
  casesTable,
  entitiesTable,
  relationshipsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
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

// ── Case Seed Launcher ────────────────────────────────────────────────────────

/**
 * POST /cases/seed
 * Body: { target: string }
 * Creates a new case, fires background pipeline, returns immediately.
 */
router.post("/cases/seed", async (req, res) => {
  const { target } = req.body;
  if (!target?.trim()) return res.status(400).json({ error: "target required" });

  const seedTarget = target.trim();

  const caseRows = await db
    .insert(casesTable)
    .values({
      title: seedTarget,
      status: "active",
      description: `Investigation seeded from target: "${seedTarget}". ATLAS is ingesting sources and building the entity graph...`,
      tags: ["auto-seeded"],
    })
    .returning();

  const theCase = caseRows[0];
  await logEvent("case_created", `Case created via seed launcher: "${seedTarget}"`, { caseId: theCase.id });

  res.status(201).json({ caseId: theCase.id, status: "seeding", title: theCase.title });

  runSeedPipeline(theCase.id, seedTarget).catch((err) =>
    console.error("[ATLAS SEED] Pipeline error:", err)
  );
});

async function runSeedPipeline(caseId: number, target: string): Promise<void> {
  await logEvent("auto_ingest_started", `Auto-ingestion started for target: "${target}"`, { caseId });

  const queryVariations = [
    target,
    `${target} investigation`,
    `${target} contracts`,
    `${target} funding`,
    `${target} program`,
  ];

  const allResults: (WebSearchResult & { _query: string })[] = [];

  for (const query of queryVariations) {
    try {
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
      const resp = await fetch(rssUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ATLASBot/1.0)" },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) continue;
      const xml = await resp.text();
      const items = parseRssItems(xml, query);
      for (const r of items) allResults.push({ ...r, _query: query });
    } catch {
      // Continue with next query variant
    }
  }

  // Deduplicate by URL
  const seenUrls = new Set<string>();
  const uniqueResults: WebSearchResult[] = [];
  for (const r of allResults) {
    if (!seenUrls.has(r.url)) {
      seenUrls.add(r.url);
      uniqueResults.push(r);
    }
  }

  // Sort by relevance to primary target, pick top 3–8
  uniqueResults.sort((a, b) => scoreResult(b, target) - scoreResult(a, target));
  const toIngest = uniqueResults.slice(0, 6);

  const ingestedDocIds: number[] = [];

  for (const result of toIngest) {
    try {
      let rawText = result.snippet || result.title;

      try {
        const articleResp = await fetch(result.url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,*/*",
            "Accept-Language": "en-US,en;q=0.9",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(12000),
        });
        const ct = articleResp.headers.get("content-type") || "";
        if (ct.includes("text/html") || ct.includes("text/plain")) {
          const html = await articleResp.text();
          const extracted = extractArticleText(html, rawText);
          rawText =
            extracted.status === "incomplete"
              ? `[EXTRACTION_INCOMPLETE]\n${extracted.text || rawText}`
              : extracted.text;
        }
      } catch {
        rawText = `[EXTRACTION_INCOMPLETE]\n${result.snippet || result.title}`;
      }

      const docRows = await db
        .insert(documentsTable)
        .values({
          title: result.title,
          source: result.sourceDomain || null,
          sourceUrl: result.url,
          sourceDomain: result.sourceDomain || tryHostname(result.url),
          publishDate: result.publishDate || null,
          caseId,
          ingestMethod: "web",
          rawText,
          previewType: "web-article",
        })
        .returning();

      const doc = docRows[0];
      ingestedDocIds.push(doc.id);

      await logEvent(
        "document_ingested",
        `Document ingested: "${result.title}" from ${result.sourceDomain}`,
        { caseId, documentId: doc.id }
      );

      const textForAnalysis = rawText.replace(/^\[EXTRACTION_INCOMPLETE\]\n/, "");
      const entities = extractEntities(textForAnalysis);

      for (const m of entities) {
        try {
          await db.insert(entityMentionsTable).values({
            documentId: doc.id,
            caseId,
            entityName: m.entityName,
            entityType: m.entityType,
            confidence: m.confidence,
            status: "pending",
            context: m.context,
            startPos: m.startPos,
            endPos: m.endPos,
          });
        } catch {
          // Skip duplicate/constraint errors
        }
      }
    } catch (err) {
      console.error(`[ATLAS SEED] Failed to ingest ${result.url}:`, err);
    }
  }

  // ── Auto-triage ───────────────────────────────────────────────────────────

  const allMentions = await db
    .select()
    .from(entityMentionsTable)
    .where(eq(entityMentionsTable.caseId, caseId));

  // Group by entity name (case-insensitive)
  interface EntryData {
    displayName: string;
    type: string;
    docIds: Set<number>;
    maxConfidence: number;
    mentionIds: number[];
  }
  const entityMap = new Map<string, EntryData>();

  for (const m of allMentions) {
    const key = m.entityName.toLowerCase();
    if (!entityMap.has(key)) {
      entityMap.set(key, {
        displayName: m.entityName,
        type: m.entityType,
        docIds: new Set(),
        maxConfidence: 0,
        mentionIds: [],
      });
    }
    const entry = entityMap.get(key)!;
    if (m.documentId) entry.docIds.add(m.documentId);
    entry.maxConfidence = Math.max(entry.maxConfidence, m.confidence ?? 0);
    entry.mentionIds.push(m.id);
  }

  // Auto-approve: confidence >= 0.85 AND appears in 2+ documents
  const approvedEntityIds = new Map<string, number>(); // key → entity.id

  for (const [key, entry] of entityMap) {
    if (entry.maxConfidence >= 0.85 && entry.docIds.size >= 2) {
      try {
        const entityRows = await db
          .insert(entitiesTable)
          .values({
            name: entry.displayName,
            type: entry.type,
            caseId,
            aliases: [],
          })
          .returning();

        const entityId = entityRows[0].id;
        approvedEntityIds.set(key, entityId);

        // Mark all mentions of this entity as approved
        for (const mentionId of entry.mentionIds) {
          await db
            .update(entityMentionsTable)
            .set({ status: "approved" })
            .where(eq(entityMentionsTable.id, mentionId));
        }

        await logEvent(
          "entity_auto_approved",
          `Entity auto-approved: ${entry.displayName} [${entry.type.replace(/_/g, " ").toUpperCase()}] — confidence ${(entry.maxConfidence * 100).toFixed(0)}%, ${entry.docIds.size} docs`,
          { caseId, entityId }
        );
      } catch {
        // Entity may already exist — skip
      }
    }
  }

  // ── Graph seeding: CO-MENTION edges ──────────────────────────────────────

  if (approvedEntityIds.size >= 2) {
    // Build doc → approved entities map
    const docEntityKeys = new Map<number, string[]>();
    for (const [key, entry] of entityMap) {
      if (!approvedEntityIds.has(key)) continue;
      for (const docId of entry.docIds) {
        if (!docEntityKeys.has(docId)) docEntityKeys.set(docId, []);
        docEntityKeys.get(docId)!.push(key);
      }
    }

    const createdPairs = new Set<string>();
    for (const keys of docEntityKeys.values()) {
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const a = keys[i];
          const b = keys[j];
          const pairKey = [a, b].sort().join("|||");
          if (createdPairs.has(pairKey)) continue;
          createdPairs.add(pairKey);

          const entityAId = approvedEntityIds.get(a);
          const entityBId = approvedEntityIds.get(b);
          if (!entityAId || !entityBId) continue;

          try {
            await db.insert(relationshipsTable).values({
              entityAId,
              entityBId,
              relationshipType: "co_mention",
              caseId,
              confidence: 0.7,
            });
          } catch {
            // Skip duplicates
          }
        }
      }
    }

    if (createdPairs.size > 0) {
      await logEvent(
        "graph_updated",
        `Graph seeded with ${createdPairs.size} CO-MENTION edge${createdPairs.size !== 1 ? "s" : ""} between ${approvedEntityIds.size} auto-approved entities`,
        { caseId }
      );
    }
  }

  // ── Case summary ──────────────────────────────────────────────────────────

  const docsIngested = ingestedDocIds.length;
  const entitiesApproved = approvedEntityIds.size;
  const totalDetected = allMentions.length;

  const entityTypeBreakdown = Array.from(approvedEntityIds.keys())
    .map((k) => entityMap.get(k)?.type)
    .filter(Boolean);
  const typeCounts: Record<string, number> = {};
  for (const t of entityTypeBreakdown) {
    if (t) typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const typeDesc = Object.entries(typeCounts)
    .map(([t, n]) => `${n} ${t.replace(/_/g, " ")}${n !== 1 ? "s" : ""}`)
    .join(", ");

  const summary =
    `Initial investigation seeded from target "${target}". ATLAS ingested ${docsIngested} source${docsIngested !== 1 ? "s" : ""} and detected ${totalDetected} entity signal${totalDetected !== 1 ? "s" : ""}, with ${entitiesApproved} auto-approved for the case graph${typeDesc ? ` (${typeDesc})` : ""}.`;

  await db
    .update(casesTable)
    .set({ description: summary, updatedAt: new Date() })
    .where(eq(casesTable.id, caseId));
}

export default router;
