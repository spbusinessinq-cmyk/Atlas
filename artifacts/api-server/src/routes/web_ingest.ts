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
  "development", "policy", "ordinance", "motion",
  "allocation", "appropriation", "taxpayer",
  "report", "records", "documents", "records",
  "public", "official", "administration",
];

const LIFESTYLE_DOMAINS = [
  "tmz.com", "buzzfeed.com", "people.com", "eonline.com", "usmagazine.com",
  "entertainment", "celebrity", "gossip", "fashion", "lifestyle", "travel",
  "food", "recipe", "wellness", "beauty", "fitness", "sports", "nfl", "nba",
  "mlb", "nhl", "espn.com", "deadspin", "bleacher", "pinterest", "reddit.com",
  "yelp.com", "tripadvisor", "angieslist", "houzz", "realtor.com",
  "zillow.com", "homeaway", "airbnb",
];

// High-quality investigative / public-records domains
const QUALITY_DOMAINS = [
  "latimes.com", "nytimes.com", "washingtonpost.com", "propublica.org",
  "la.gov", "lacounty.gov", "lamayor.org", "lacity.org",
  "lacda.org", "hacla.org",
  "nbcnews.com", "abcnews.go.com", "cbsnews.com", "apnews.com",
  "theatlantic.com", "politico.com", "theintercept.com",
  "documentcloud.org", "courtlistener.com", "pacer.gov",
  "calmatters.org", "laist.com", "kpcc.org", "kcrw.com",
  "civicbeat.org", "voiceofsandiego.org", "sfchronicle.com",
  "mercurynews.com", "sacbee.com", "fresnobee.com",
  "inspector general", "audit", ".gov", ".ca.gov",
];

function scoreResult(result: WebSearchResult, query: string): number {
  let score = 0;
  const titleLower = result.title.toLowerCase();
  const snippetLower = result.snippet.toLowerCase();
  const domainLower = result.sourceDomain.toLowerCase();
  const queryLower = query.toLowerCase();

  // Exact query phrase in title → big boost
  if (titleLower.includes(queryLower)) score += 8;

  // Query words in title
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 3);
  const titleMatches = queryWords.filter((w) => titleLower.includes(w)).length;
  score += titleMatches * 2.5;
  const snippetMatches = queryWords.filter((w) => snippetLower.includes(w)).length;
  score += snippetMatches * 0.8;

  // All query words appear in title → strong signal
  if (queryWords.length >= 2 && titleMatches === queryWords.length) score += 4;

  // Investigative keywords in title or snippet
  for (const kw of INVESTIGATIVE_KEYWORDS) {
    if (titleLower.includes(kw)) score += 1.5;
    else if (snippetLower.includes(kw)) score += 0.5;
  }

  // PDF sources often have primary documents
  if (result.contentType === "pdf") score += 2;

  // Quality domain boost
  for (const good of QUALITY_DOMAINS) {
    if (domainLower.includes(good)) { score += 3; break; }
  }

  // Penalise lifestyle/entertainment domains and keywords
  for (const bad of LIFESTYLE_DOMAINS) {
    if (domainLower.includes(bad) || titleLower.includes(bad)) {
      score -= 10;
      break;
    }
  }

  // Prefer longer, more substantive snippets
  if (result.snippet.length > 200) score += 1;
  else if (result.snippet.length > 100) score += 0.4;

  // Penalize very short snippets (likely wrappers / paywalled)
  if (result.snippet.length < 50) score -= 2;

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

// Prioritized selectors — tried in order, first large-body match wins
const ARTICLE_SELECTORS: { sel: string; label: string }[] = [
  // Semantic HTML5
  { sel: "article", label: "article" },
  // Explicit main content
  { sel: "[role=main]", label: "role-main" },
  { sel: "main", label: "main" },
  // Schema.org
  { sel: "[itemprop=articleBody]", label: "itemprop-articleBody" },
  // Common CMS classes
  { sel: ".article-body", label: ".article-body" },
  { sel: ".article__body", label: ".article__body" },
  { sel: ".article__content-body", label: ".article__content-body" },
  { sel: ".ArticleBody-articleBody", label: ".ArticleBody-articleBody" }, // LA Times
  { sel: ".richtext", label: ".richtext" }, // LA Times / syndicated
  { sel: ".post-content", label: ".post-content" },
  { sel: ".entry-content", label: ".entry-content" },
  { sel: ".story-body", label: ".story-body" },
  { sel: ".story-body__inner", label: ".story-body__inner" },
  { sel: ".story-content", label: ".story-content" },
  { sel: ".story-text", label: ".story-text" },
  { sel: ".article-content", label: ".article-content" },
  { sel: ".article-text", label: ".article-text" },
  { sel: ".article-copy", label: ".article-copy" },
  { sel: ".article_body", label: ".article_body" },
  { sel: ".article__content", label: ".article__content" },
  { sel: ".content-body", label: ".content-body" },
  { sel: ".body-content", label: ".body-content" },
  { sel: ".post-body", label: ".post-body" },
  { sel: ".news-article", label: ".news-article" },
  { sel: ".newsArticle", label: ".newsArticle" },
  { sel: "#article", label: "#article" },
  { sel: "#main", label: "#main" },
  // CBS News / CBS interactive
  { sel: ".article__content-body", label: ".article__content-body" },
  { sel: '[data-component="text"]', label: "data-component=text" },
  { sel: ".content__body", label: ".content__body" },
  // Business Wire / PR Newswire
  { sel: ".bw-release-story", label: ".bw-release-story" },
  { sel: ".bw-press-release-story", label: ".bw-press-release-story" },
  { sel: "#release-body", label: "#release-body" },
  { sel: ".release-body", label: ".release-body" },
  { sel: ".prnews-paragraph", label: ".prnews-paragraph" },
  // Generic fallbacks
  { sel: "[data-component=article-body]", label: "data-component=article-body" },
  { sel: ".c-article__body", label: ".c-article__body" },
  { sel: ".a-article-body", label: ".a-article-body" },
  { sel: "#story", label: "#story" },
  { sel: "#content", label: "#content" },
];

// Elements that should always be stripped before extraction
const STRIP_SELECTORS = [
  "script", "style", "nav", "header", "footer",
  "aside", "noscript", "iframe", "figure figcaption",
  ".ad", ".ads", ".advertisement", ".ad-container",
  ".social-share", ".share-buttons", ".share-bar",
  ".related-articles", ".related-links", ".related",
  ".newsletter", ".newsletter-signup",
  ".sidebar", ".widget", ".widget-area",
  ".popup", ".modal", ".overlay",
  ".breadcrumb", ".breadcrumbs",
  ".tags", ".tag-list", ".article-tags",
  ".comments", ".comment-section",
  ".promo", ".teaser-list", ".rec-list",
  "[aria-label='Advertisement']",
  "[data-testid='ad-unit']",
];

// Boilerplate phrases that indicate junk text (not real article content)
const BOILERPLATE_PHRASES = [
  "sign up for our newsletter",
  "subscribe to our newsletter",
  "click here to subscribe",
  "follow us on",
  "share this article",
  "terms of service",
  "privacy policy",
  "all rights reserved",
  "javascript is required",
  "enable javascript",
  "please enable",
  "cookie policy",
  "we use cookies",
  "your subscription",
  "sign in to continue",
  "create a free account",
  "buy a subscription",
];

function countRealParagraphs(text: string): number {
  // A "real" paragraph is >= 80 chars, not pure boilerplate
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => {
      if (p.length < 80) return false;
      const lower = p.toLowerCase();
      if (BOILERPLATE_PHRASES.some((b) => lower.includes(b))) return false;
      return true;
    }).length;
}

function isBoilerplateHeavy(text: string): boolean {
  const lower = text.toLowerCase();
  const boilerplateHits = BOILERPLATE_PHRASES.filter((b) => lower.includes(b)).length;
  return boilerplateHits >= 3;
}

export interface ExtractionResult {
  text: string;
  status: "ok" | "partial" | "failed";
  paragraphCount: number;
  charCount: number;
  selectorUsed: string;
  strategy: "selector" | "paragraph-agg" | "body-text" | "fallback";
}

export function extractArticleText(html: string, fallback: string): ExtractionResult {
  try {
    const root = parseHtml(html);

    // Strip non-content elements first
    for (const sel of STRIP_SELECTORS) {
      try { root.querySelectorAll(sel).forEach((el) => el.remove()); } catch { /* bad selector ok */ }
    }

    let text = "";
    let selectorUsed = "none";
    let strategy: ExtractionResult["strategy"] = "fallback";

    // Pass 1: Try article body selectors in priority order
    for (const { sel, label } of ARTICLE_SELECTORS) {
      try {
        const el = root.querySelector(sel);
        if (el) {
          // Extract paragraph blocks from this container
          const paras = el.querySelectorAll("p");
          let candidate = "";
          if (paras.length >= 2) {
            const paraTexts = paras
              .map((p) => p.text.replace(/\s+/g, " ").trim())
              .filter((t) => t.length > 50);
            candidate = paraTexts.join("\n\n");
          }
          // Fall back to raw element text if paragraph extraction insufficient
          if (candidate.length < 300) {
            candidate = el.text.replace(/\s+/g, " ").trim();
          }
          if (candidate.length > text.length && candidate.length > 250) {
            text = candidate;
            selectorUsed = label;
            strategy = "selector";
            if (text.length > 2000) break; // Good enough
          }
        }
      } catch { /* bad selector ok */ }
    }

    // Pass 2: Global paragraph aggregation if no selector worked well
    if (text.length < 400) {
      const paragraphs = root.querySelectorAll("p");
      const paraTexts = paragraphs
        .map((p) => p.text.replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 60);
      if (paraTexts.length >= 2) {
        const aggregated = paraTexts.join("\n\n");
        if (aggregated.length > text.length) {
          text = aggregated;
          selectorUsed = "p-aggregate";
          strategy = "paragraph-agg";
        }
      }
    }

    // Pass 3: Body text as last resort (noisy but better than nothing)
    if (text.length < 200) {
      const bodyEl = root.querySelector("body");
      const bodyText = bodyEl ? bodyEl.text : root.text;
      text = bodyText.replace(/\s+/g, " ").trim();
      selectorUsed = "body";
      strategy = "body-text";
    }

    const truncated = text.slice(0, 18000);
    const paragraphCount = countRealParagraphs(truncated);

    // Determine extraction status
    let status: ExtractionResult["status"];
    if (truncated.length >= 800 && paragraphCount >= 3 && !isBoilerplateHeavy(truncated)) {
      status = "ok";
    } else if (truncated.length >= 200 && !isBoilerplateHeavy(truncated)) {
      status = "partial";
    } else {
      status = "failed";
    }

    return {
      text: truncated,
      status,
      paragraphCount,
      charCount: truncated.length,
      selectorUsed,
      strategy,
    };
  } catch {
    return {
      text: fallback,
      status: "failed",
      paragraphCount: 0,
      charCount: fallback.length,
      selectorUsed: "none",
      strategy: "fallback",
    };
  }
}

// ── Encode/decode extraction diagnostics in rawText prefix ────────────────────

/**
 * Encodes extraction diagnostics as a compact prefix in the rawText field so
 * the frontend can display them without a DB schema change.
 * Format: [ATLAS-DIAG:status=ok|chars=4523|paras=12|sel=article|strategy=selector]\n
 */
function encodeDiagPrefix(result: ExtractionResult, finalUrl?: string): string {
  const parts = [
    `status=${result.status}`,
    `chars=${result.charCount}`,
    `paras=${result.paragraphCount}`,
    `sel=${result.selectorUsed}`,
    `strategy=${result.strategy}`,
  ];
  if (finalUrl) parts.push(`final_url=${encodeURIComponent(finalUrl)}`);
  return `[ATLAS-DIAG:${parts.join("|")}]\n`;
}

/**
 * Parses diagnostics from the rawText prefix.
 * Returns null if no prefix found.
 */
export function parseAtlasDiag(rawText: string): {
  status: "ok" | "partial" | "failed" | "wrapper";
  chars: number;
  paras: number;
  sel: string;
  strategy: string;
  finalUrl?: string;
} | null {
  const m = rawText.match(/^\[ATLAS-DIAG:([^\]]+)\]/);
  if (!m) return null;
  const kv: Record<string, string> = {};
  m[1].split("|").forEach((pair) => {
    const [k, v] = pair.split("=");
    if (k && v !== undefined) kv[k] = v;
  });
  return {
    status: (kv.status as "ok" | "partial" | "failed" | "wrapper") || "failed",
    chars: parseInt(kv.chars || "0"),
    paras: parseInt(kv.paras || "0"),
    sel: kv.sel || "unknown",
    strategy: kv.strategy || "unknown",
    finalUrl: kv.final_url ? decodeURIComponent(kv.final_url) : undefined,
  };
}

/** Strip all known prefixes from rawText to get clean article text */
export function cleanRawText(rawText: string): string {
  return rawText
    .replace(/^\[ATLAS-DIAG:[^\]]+\]\n?/, "")
    .replace(/^\[EXTRACTION_INCOMPLETE\]\n?/, "")
    .replace(/^\[EXTRACTION_FAILED\]\n?/, "")
    .trim();
}

// ── Wrapper / junk content detection ─────────────────────────────────────────

/**
 * Returns true if the fetched content is a wrapper / redirect page with no
 * real article body (Google News, paywalled blank pages, cookie-consent walls, etc.)
 */
function isWrapperOrJunk(html: string, finalUrl: string, extractedText: string): boolean {
  const urlLower = finalUrl.toLowerCase();

  // URL still points to Google after redirect
  if (urlLower.includes("news.google.com")) return true;
  if (urlLower.includes("google.com/search")) return true;
  if (urlLower.includes("accounts.google.com")) return true;

  // Feed / aggregator wrappers
  if (urlLower.includes("feedproxy.google.com")) return true;

  const htmlLower = html.toLowerCase().slice(0, 3000);

  // Definitive Google News wrapper markers
  if (htmlLower.includes("<!doctype html>google") || htmlLower.includes("<title>google news</title>")) return true;
  if (htmlLower.includes("news.google.com/articles") && html.length < 10000) return true;

  // Cookie / consent wall only pages (no real content)
  const cookieOnlyPatterns = [
    /accept.*cookies.*and.*continue/i,
    /before you continue to google/i,
    /we use cookies to/i,
  ];
  if (cookieOnlyPatterns.some((p) => p.test(html)) && html.length < 8000) return true;

  // Extracted text is too short to be a real article
  if (extractedText.trim().length < 120) return true;

  // Extracted text is just navigation / boilerplate
  const junkPhrases = ["google news", "sign in to continue", "subscribe to continue", "enable javascript"];
  const textLower = extractedText.toLowerCase();
  if (junkPhrases.some((p) => textLower.includes(p)) && extractedText.length < 300) return true;

  return false;
}

// ── Entity junk suppression blocklist ────────────────────────────────────────

// Values that should NEVER become entity names (injected by wrapper pages)
export const WRAPPER_ENTITY_BLOCKLIST = new Set([
  "Google News", "Google LLC", "Google", "Google Search", "News Google",
  "JavaScript", "Sign In", "Log In", "Subscribe", "Continue", "Accept",
  "Enable JavaScript", "Cookie", "Cookies", "Privacy Policy",
  "Terms of Service", "More", "Share", "Close", "Skip",
  "Loading", "Please Wait", "Redirect", "Follow",
]);

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
  let extractionStatus: "ok" | "partial" | "failed" | "wrapper" = "failed";
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

    const finalUrl = articleResp.url || url;
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
      extractionStatus = "ok";
      const diagPrefix = encodeDiagPrefix({ text: "", status: "ok", paragraphCount: 0, charCount: 0, selectorUsed: "pdf", strategy: "selector" }, finalUrl);
      rawText = diagPrefix + title;
    } else if (ct.includes("text/html") || ct.includes("text/plain")) {
      const html = await articleResp.text();
      const extracted = extractArticleText(html, snippet || title);

      if (isWrapperOrJunk(html, finalUrl, extracted.text)) {
        const diagPrefix = encodeDiagPrefix({ ...extracted, status: "failed" as const, strategy: "fallback" as const }, finalUrl);
        rawText = `${diagPrefix}[WRAPPER_BLOCKED]\n${snippet || title}`;
        extractionStatus = "wrapper";
      } else {
        const diagPrefix = encodeDiagPrefix(extracted, finalUrl);
        rawText = diagPrefix + extracted.text;
        extractionStatus = extracted.status === "ok" ? "ok" : extracted.status === "partial" ? "partial" : "failed";
      }
    }
  } catch (fetchErr) {
    console.warn("Article fetch failed, using snippet:", String(fetchErr).substring(0, 120));
    const diagPrefix = encodeDiagPrefix({ text: snippet || title, status: "failed", paragraphCount: 0, charCount: (snippet || title).length, selectorUsed: "none", strategy: "fallback" });
    rawText = `${diagPrefix}[FETCH_FAILED]\n${snippet || title}`;
    extractionStatus = "failed";
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
    `Web source ingested: "${title}" from ${sourceDomain || tryHostname(url)} [${extractionStatus.toUpperCase()}]`,
    { caseId: doc.caseId, documentId: doc.id }
  );

  // Skip entity extraction for failed/wrapper extractions
  let mentionsCreated = 0;
  const canAnalyze = extractionStatus === "ok" || extractionStatus === "partial";
  if (canAnalyze) {
    const textForAnalysis = cleanRawText(rawText || `${title} ${sourceDomain || ""}`);
    const entities = extractEntities(textForAnalysis);

    for (const m of entities) {
      if (WRAPPER_ENTITY_BLOCKLIST.has(m.entityName)) continue;
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
  } else {
    await logEvent(
      "extraction_failed",
      `${extractionStatus === "wrapper" ? "Wrapper" : "Failed"} extraction for "${title}" — entity analysis skipped`,
      { caseId: doc.caseId, documentId: doc.id }
    );
  }

  res.status(201).json({
    document: formatDoc(doc),
    mentionsCreated,
    analysisRan: canAnalyze,
    extractionStatus,
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

  // Deduplicate by URL and domain (max 2 per domain for diversity)
  const seenUrls = new Set<string>();
  const domainCount = new Map<string, number>();
  const uniqueResults: WebSearchResult[] = [];
  for (const r of allResults) {
    if (seenUrls.has(r.url)) continue;
    const domain = tryHostname(r.url);
    const domainHits = domainCount.get(domain) || 0;
    if (domainHits >= 2) continue; // Max 2 results per domain
    seenUrls.add(r.url);
    domainCount.set(domain, domainHits + 1);
    uniqueResults.push(r);
  }

  // Sort by relevance to primary target, pick top 8
  uniqueResults.sort((a, b) => scoreResult(b, target) - scoreResult(a, target));

  // Filter out results with very negative scores (clearly off-topic / spam)
  const qualifiedResults = uniqueResults.filter((r) => scoreResult(r, target) >= -2);
  const toIngest = qualifiedResults.slice(0, 8);

  const ingestedDocIds: number[] = [];

  let validDocsIngested = 0;

  for (const result of toIngest) {
    try {
      let rawText = result.snippet || result.title;
      let docExtractionStatus: "ok" | "partial" | "failed" | "wrapper" = "failed";

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
        const finalUrl = articleResp.url || result.url;
        const ct = articleResp.headers.get("content-type") || "";
        if (ct.includes("text/html") || ct.includes("text/plain")) {
          const html = await articleResp.text();
          const extracted = extractArticleText(html, rawText);
          if (isWrapperOrJunk(html, finalUrl, extracted.text)) {
            const diagPrefix = encodeDiagPrefix({ ...extracted, status: "failed" as const, strategy: "fallback" as const }, finalUrl);
            rawText = `${diagPrefix}[WRAPPER_BLOCKED]\n${result.snippet || result.title}`;
            docExtractionStatus = "wrapper";
          } else {
            const diagPrefix = encodeDiagPrefix(extracted, finalUrl);
            rawText = diagPrefix + extracted.text;
            docExtractionStatus = extracted.status === "ok" ? "ok" : extracted.status === "partial" ? "partial" : "failed";
          }
        }
      } catch {
        const diagPrefix = encodeDiagPrefix({ text: result.snippet || result.title, status: "failed", paragraphCount: 0, charCount: (result.snippet || result.title).length, selectorUsed: "none", strategy: "fallback" });
        rawText = `${diagPrefix}[FETCH_FAILED]\n${result.snippet || result.title}`;
        docExtractionStatus = "failed";
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
        `Document ingested: "${result.title}" from ${result.sourceDomain} [${docExtractionStatus.toUpperCase()}]`,
        { caseId, documentId: doc.id }
      );

      // Skip entity extraction for wrapper/failed content
      const canAnalyze = docExtractionStatus === "ok" || docExtractionStatus === "partial";
      if (!canAnalyze) {
        await logEvent(
          "extraction_failed",
          `${docExtractionStatus === "wrapper" ? "Wrapper" : "Failed"} extraction: "${result.title}" — entity extraction skipped`,
          { caseId, documentId: doc.id }
        );
        continue;
      }

      validDocsIngested++;
      const textForAnalysis = cleanRawText(rawText);
      const entities = extractEntities(textForAnalysis);

      for (const m of entities) {
        if (WRAPPER_ENTITY_BLOCKLIST.has(m.entityName)) continue;
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

  async function approveEntity(key: string, entry: { displayName: string; type: string; docIds: Set<number>; maxConfidence: number; mentionIds: number[] }, tier: string) {
    try {
      // Skip blocklisted entities
      if (WRAPPER_ENTITY_BLOCKLIST.has(entry.displayName)) return;

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

      for (const mentionId of entry.mentionIds) {
        await db
          .update(entityMentionsTable)
          .set({ status: "approved" })
          .where(eq(entityMentionsTable.id, mentionId));
      }

      await logEvent(
        "entity_auto_approved",
        `[${tier}] Entity auto-approved: ${entry.displayName} [${entry.type.replace(/_/g, " ").toUpperCase()}] — confidence ${(entry.maxConfidence * 100).toFixed(0)}%, ${entry.docIds.size} docs`,
        { caseId, entityId }
      );
    } catch {
      // Entity may already exist — skip
    }
  }

  // Tier 1: high confidence, multi-doc
  for (const [key, entry] of entityMap) {
    if (entry.maxConfidence >= 0.82 && entry.docIds.size >= 2) {
      await approveEntity(key, entry, "T1");
    }
  }

  // Tier 2 fallback: if zero entities approved, promote top safest single-doc detections
  if (approvedEntityIds.size === 0 && validDocsIngested > 0) {
    // Sort by confidence descending, filter to reasonably confident, non-blocklisted
    const candidates = Array.from(entityMap.entries())
      .filter(([, e]) => e.maxConfidence >= 0.74 && !WRAPPER_ENTITY_BLOCKLIST.has(e.displayName))
      .sort((a, b) => b[1].maxConfidence - a[1].maxConfidence);

    let fallbackCount = 0;
    for (const [key, entry] of candidates) {
      if (fallbackCount >= 5) break;
      await approveEntity(key, entry, "T2-FALLBACK");
      fallbackCount++;
    }

    if (fallbackCount > 0) {
      await logEvent(
        "seed_fallback_triggered",
        `Seed fallback: promoted ${fallbackCount} entity candidate${fallbackCount !== 1 ? "s" : ""} — no high-confidence multi-doc entities found`,
        { caseId }
      );
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
  const failedDocs = docsIngested - validDocsIngested;
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

  const failedNote = failedDocs > 0
    ? ` (${failedDocs} wrapper/redirect page${failedDocs !== 1 ? "s" : ""} skipped)`
    : "";

  const summary =
    `Initial investigation seeded from target "${target}". ATLAS ingested ${validDocsIngested} extractable source${validDocsIngested !== 1 ? "s" : ""}${failedNote} and detected ${totalDetected} entity signal${totalDetected !== 1 ? "s" : ""}, with ${entitiesApproved} auto-approved for the case graph${typeDesc ? ` (${typeDesc})` : ""}.`;

  await db
    .update(casesTable)
    .set({ description: summary, updatedAt: new Date() })
    .where(eq(casesTable.id, caseId));
}

export default router;
