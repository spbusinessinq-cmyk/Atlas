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
import { extractEntities, computeDocRelevanceScore, normalizeEntityName, resolveToCanonical } from "../lib/entity-extractor";
import { logEvent } from "../lib/log-event";

const router: IRouter = Router();

// ── RSS helpers ───────────────────────────────────────────────────────────────

export interface WebSearchResult {
  title: string;
  url: string;
  rssLink?: string;       // Original Google News redirect URL (for debugging)
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

// Junk title patterns that indicate low-value results
const JUNK_TITLE_PATTERNS = [
  /^top \d+/i, /^best \d+/i, /^\d+ best/i, /^\d+ things/i,
  /^how to /i, /^what is /i, /^things to do/i, /^guide to/i,
  /^everything you need/i, /^here's what/i, /^what you need/i,
  /review:/i, /^watch:/i, /^photos:/i, /^video:/i,
  /^opinion:/i, /^letter:/i, /^column:/i,
];

// Location terms to detect geographic target context
const LA_TERMS = ["los angeles", " la ", "l.a.", "hollywood", "la county", "la city",
  "laist", "lacda", "hacla", "lacity", "lacounty", "lausd", "ladwp", "lapd", "lawa"];

function scoreResult(result: WebSearchResult, query: string): number {
  let score = 0;
  const titleLower = result.title.toLowerCase();
  const snippetLower = result.snippet.toLowerCase();
  const domainLower = result.sourceDomain.toLowerCase();
  const queryLower = query.toLowerCase();

  // ── Junk title detection ────────────────────────────────────────────────────
  for (const pat of JUNK_TITLE_PATTERNS) {
    if (pat.test(result.title)) { score -= 3; break; }
  }

  // ── Exact query phrase in title → big boost ─────────────────────────────────
  if (titleLower.includes(queryLower)) score += 8;

  // ── Query words in title / snippet ──────────────────────────────────────────
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 3);
  const titleMatches = queryWords.filter((w) => titleLower.includes(w)).length;
  score += titleMatches * 2.5;
  const snippetMatches = queryWords.filter((w) => snippetLower.includes(w)).length;
  score += snippetMatches * 0.8;

  // All query words appear in title → strong signal
  if (queryWords.length >= 2 && titleMatches === queryWords.length) score += 4;

  // ── Location-aware boost ────────────────────────────────────────────────────
  const queryIsLA = LA_TERMS.some((t) => queryLower.includes(t));
  if (queryIsLA) {
    // Boost articles that mention the location
    const articleMentionsLA = LA_TERMS.some((t) => titleLower.includes(t) || snippetLower.includes(t));
    if (articleMentionsLA) score += 2;
    // Boost quality LA-specific domains
    const laLocalDomains = ["laist.com", "kpcc.org", "kcrw.com", "la.gov", "lacounty.gov",
      "lacity.org", "lacda.org", "hacla.org", "laist", "latimes.com", "dailynews.com",
      "kcal", "knbc.com", "nbclosangeles.com", "abc7.com"];
    for (const d of laLocalDomains) {
      if (domainLower.includes(d)) { score += 3; break; }
    }
  }

  // ── Investigative keywords ───────────────────────────────────────────────────
  for (const kw of INVESTIGATIVE_KEYWORDS) {
    if (titleLower.includes(kw)) score += 1.5;
    else if (snippetLower.includes(kw)) score += 0.5;
  }

  // ── PDF sources often have primary documents ─────────────────────────────────
  if (result.contentType === "pdf") score += 2;

  // ── Quality domain boost ─────────────────────────────────────────────────────
  for (const good of QUALITY_DOMAINS) {
    if (domainLower.includes(good)) { score += 3; break; }
  }

  // ── Penalise lifestyle/entertainment domains and keywords ─────────────────────
  for (const bad of LIFESTYLE_DOMAINS) {
    if (domainLower.includes(bad) || titleLower.includes(bad)) {
      score -= 10;
      break;
    }
  }

  // ── Snippet length quality signals ───────────────────────────────────────────
  if (result.snippet.length > 200) score += 1;
  else if (result.snippet.length > 100) score += 0.4;

  // Very short snippets → likely paywalled / wrapper
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

    const rawLink = extractTag(item, "link") || extractTag(item, "guid");
    const pubDate = extractTag(item, "pubDate");
    const rawDesc = extractTag(item, "description");
    const snippet = stripHtml(decodeEntities(rawDesc)).slice(0, 280);

    // Google News RSS embeds the real article URL in <source url="..."> attribute.
    // Prefer this over the google.com/rss/articles/... redirect token which
    // cannot be followed server-side.
    const srcMatch = item.match(/<source\s+url="([^"]+)"[^>]*>([^<]*)<\/source>/);
    const realSourceUrl = srcMatch ? decodeEntities(srcMatch[1].trim()) : null;
    const sourceDomain = srcMatch
      ? srcMatch[2].trim()
      : rawLink
        ? tryHostname(rawLink)
        : "unknown";

    // Use the real article URL when available; fall back to the RSS link
    const usingRealUrl = !!(realSourceUrl && !realSourceUrl.includes("news.google.com"));
    const url = usingRealUrl ? realSourceUrl! : rawLink;
    // Preserve the original RSS redirect link for debugging purposes
    const rssLink = usingRealUrl ? rawLink : undefined;

    const contentType: "web-article" | "pdf" = (url || "").toLowerCase().includes(".pdf")
      ? "pdf"
      : "web-article";

    if (title && url) {
      results.push({ title, url, rssLink, sourceDomain, snippet, publishDate: pubDate, contentType });
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
  strategy: "json-ld" | "selector" | "paragraph-agg" | "body-text" | "fallback";
}

export function extractArticleText(html: string, fallback: string): ExtractionResult {
  try {
    let text = "";
    let selectorUsed = "none";
    let strategy: ExtractionResult["strategy"] = "fallback";

    // ── Pass 0: JSON-LD structured data ─────────────────────────────────────
    // Most modern news sites (LA Times, CBS News, NBC, AP, etc.) embed their
    // full article body in application/ld+json for SEO. This works even when
    // the page is JS-rendered and the CSS selectors find nothing.
    const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let jMatch: RegExpExecArray | null;
    while ((jMatch = jsonLdRegex.exec(html)) !== null) {
      try {
        const rawJson = jMatch[1].trim();
        const data = JSON.parse(rawJson);
        const items: unknown[] = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (typeof item !== "object" || !item) continue;
          const obj = item as Record<string, unknown>;
          // Look for articleBody first, then description as fallback
          const body = (obj.articleBody ?? obj["article:body"] ?? "") as string;
          const desc = (obj.description ?? "") as string;
          const candidate = body.length > desc.length ? body : desc;
          if (candidate.length > text.length && candidate.length > 300) {
            text = candidate;
            selectorUsed = "json-ld";
            strategy = "selector";
          }
        }
        if (text.length >= 2000) break; // Great extraction, stop early
      } catch {
        // Invalid JSON block — skip
      }
    }

    // ── Parse HTML for CSS-based passes ──────────────────────────────────────
    const root = parseHtml(html);

    // Strip non-content elements first
    for (const sel of STRIP_SELECTORS) {
      try { root.querySelectorAll(sel).forEach((el) => el.remove()); } catch { /* bad selector ok */ }
    }

    // ── Pass 1: Try article body selectors in priority order ─────────────────
    if (text.length < 1000) {
      for (const { sel, label } of ARTICLE_SELECTORS) {
        try {
          const el = root.querySelector(sel);
          if (el) {
            // Extract paragraph blocks from this container first
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
              if (text.length > 3000) break; // Good enough
            }
          }
        } catch { /* bad selector ok */ }
      }
    }

    // ── Pass 2: Global paragraph aggregation ─────────────────────────────────
    if (text.length < 500) {
      const paragraphs = root.querySelectorAll("p");
      const paraTexts = paragraphs
        .map((p) => p.text.replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 60 && !BOILERPLATE_PHRASES.some((b) => t.toLowerCase().includes(b)));
      if (paraTexts.length >= 2) {
        const aggregated = paraTexts.join("\n\n");
        if (aggregated.length > text.length) {
          text = aggregated;
          selectorUsed = "p-aggregate";
          strategy = "paragraph-agg";
        }
      }
    }

    // ── Pass 3: Body text last resort ────────────────────────────────────────
    if (text.length < 200) {
      const bodyEl = root.querySelector("body");
      const bodyText = bodyEl ? bodyEl.text : root.text;
      text = bodyText.replace(/\s+/g, " ").trim();
      selectorUsed = "body";
      strategy = "body-text";
    }

    const truncated = text.slice(0, 20000);
    const paragraphCount = countRealParagraphs(truncated);

    // ── Determine extraction quality ──────────────────────────────────────────
    let status: ExtractionResult["status"];
    const boilerplateHeavy = isBoilerplateHeavy(truncated);

    if (truncated.length >= 600 && paragraphCount >= 2 && !boilerplateHeavy) {
      status = "ok";
    } else if (truncated.length >= 150 && !boilerplateHeavy) {
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
 * Format: [ATLAS-DIAG:status=ok|chars=4523|paras=12|sel=article|strategy=selector|...]\n
 */
function encodeDiagPrefix(
  result: ExtractionResult,
  finalUrl?: string,
  extra?: { rssUrl?: string; srcUrl?: string; entities?: number; analysisRan?: boolean }
): string {
  const parts = [
    `status=${result.status}`,
    `chars=${result.charCount}`,
    `paras=${result.paragraphCount}`,
    `sel=${result.selectorUsed}`,
    `strategy=${result.strategy}`,
  ];
  if (finalUrl) parts.push(`final_url=${encodeURIComponent(finalUrl)}`);
  if (extra?.rssUrl) parts.push(`rss_url=${encodeURIComponent(extra.rssUrl)}`);
  if (extra?.srcUrl) parts.push(`src_url=${encodeURIComponent(extra.srcUrl)}`);
  if (extra?.entities !== undefined) parts.push(`entities=${extra.entities}`);
  if (extra?.analysisRan !== undefined) parts.push(`analysis_ran=${extra.analysisRan ? 1 : 0}`);
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
  rssUrl?: string;
  srcUrl?: string;
  entities?: number;
  analysisRan?: boolean;
} | null {
  const m = rawText.match(/^\[ATLAS-DIAG:([^\]]+)\]/);
  if (!m) return null;
  const kv: Record<string, string> = {};
  m[1].split("|").forEach((pair) => {
    const eqIdx = pair.indexOf("=");
    if (eqIdx > 0) {
      const k = pair.slice(0, eqIdx);
      const v = pair.slice(eqIdx + 1);
      kv[k] = v;
    }
  });
  return {
    status: (kv.status as "ok" | "partial" | "failed" | "wrapper") || "failed",
    chars: parseInt(kv.chars || "0"),
    paras: parseInt(kv.paras || "0"),
    sel: kv.sel || "unknown",
    strategy: kv.strategy || "unknown",
    finalUrl: kv.final_url ? decodeURIComponent(kv.final_url) : undefined,
    rssUrl: kv.rss_url ? decodeURIComponent(kv.rss_url) : undefined,
    srcUrl: kv.src_url ? decodeURIComponent(kv.src_url) : undefined,
    entities: kv.entities !== undefined ? parseInt(kv.entities) : undefined,
    analysisRan: kv.analysis_ran !== undefined ? kv.analysis_ran === "1" : undefined,
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

// Values that should NEVER become entity names (injected by wrapper pages or site boilerplate)
export const WRAPPER_ENTITY_BLOCKLIST = new Set([
  // Google / search wrappers
  "Google News", "Google LLC", "Google", "Google Search", "News Google",
  // JS / auth walls
  "JavaScript", "Sign In", "Log In", "Subscribe", "Continue", "Accept",
  "Enable JavaScript", "Cookie", "Cookies", "Privacy Policy",
  "Terms of Service", "More", "Share", "Close", "Skip",
  "Loading", "Please Wait", "Redirect", "Follow",
  // Generic UI labels
  "Open Original", "Published", "Updated", "Related", "Read More",
  "Newsletter", "Email", "Print", "Download", "Comments",
  // Publication training/sidebar content (ProPublica, newsrooms)
  "Investigative Editor Training Program", "ProPublica Investigative Editor Training Program",
  "Investigative Reporting Workshop", "Training Program", "Fellowship Program",
  "Journalism Fellowship", "Investigative Fellowship",
  // Generic newsroom boilerplate
  "Associated Press", "AP Stylebook", "Reuters Institute", "Nieman Foundation",
  // Generic location labels (too vague to be useful as entities)
  "United States", "US", "USA", "America", "North America",
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

  // ── Seed validation ──────────────────────────────────────────────────────
  if (seedTarget.length < 3) {
    return res.status(400).json({ error: "Seed target too short — provide at least 3 characters." });
  }
  if (seedTarget.length > 300) {
    return res.status(400).json({ error: "Seed target too long — keep it under 300 characters." });
  }
  // Reject obviously nonsensical seeds: no letters at all, pure numbers, single repeated char
  if (!/[a-zA-Z]{2,}/.test(seedTarget)) {
    return res.status(400).json({ error: "Seed target must contain meaningful text." });
  }
  // Reject pure noise tokens (e.g. "aaa", "asdf", "xxxxxxxxxxx")
  const wordLike = seedTarget.replace(/[^a-zA-Z\s]/g, "").trim().split(/\s+/);
  const allWordsShort = wordLike.every(w => w.length < 3);
  if (wordLike.length <= 1 && allWordsShort) {
    return res.status(400).json({ error: "Seed target is too vague to produce a meaningful investigation." });
  }

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

  const queryTerms = target.trim().split(/\s+/).filter(w => w.length > 2);

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
  const okDocIds = new Set<number>();

  let validDocsIngested = 0;
  let okDocs = 0;
  let partialDocs = 0;
  let failedDocs = 0;
  let wrapperDocs = 0;
  let noiseSkipped = 0;
  let priorityADocs = 0;
  let priorityBDocs = 0;
  const promotedEntityNames: string[] = []; // canonical names approved into the graph

  for (const result of toIngest) {
    try {
      let rawText = result.snippet || result.title;
      let docExtractionStatus: "ok" | "partial" | "failed" | "wrapper" = "failed";

      const debugExtra = { rssUrl: result.rssLink, srcUrl: result.url };

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
            const diagPrefix = encodeDiagPrefix(
              { ...extracted, status: "failed" as const, strategy: "fallback" as const },
              finalUrl,
              { ...debugExtra, analysisRan: false }
            );
            rawText = `${diagPrefix}[WRAPPER_BLOCKED]\n${result.snippet || result.title}`;
            docExtractionStatus = "wrapper";
          } else {
            const diagPrefix = encodeDiagPrefix(extracted, finalUrl, debugExtra);
            rawText = diagPrefix + extracted.text;
            docExtractionStatus = extracted.status === "ok" ? "ok" : extracted.status === "partial" ? "partial" : "failed";
          }
        }
      } catch {
        const fallbackExtra = { ...debugExtra, analysisRan: false };
        const diagPrefix = encodeDiagPrefix(
          { text: result.snippet || result.title, status: "failed", paragraphCount: 0, charCount: (result.snippet || result.title).length, selectorUsed: "none", strategy: "fallback" },
          undefined,
          fallbackExtra
        );
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

      // ── Track per-doc extraction stats ──────────────────────────────────
      if (docExtractionStatus === "ok") okDocs++;
      else if (docExtractionStatus === "partial") partialDocs++;
      else if (docExtractionStatus === "wrapper") wrapperDocs++;
      else failedDocs++;

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
      if (docExtractionStatus === "ok") okDocIds.add(doc.id);
      const textForAnalysis = cleanRawText(rawText);

      // ── Relevance scoring ────────────────────────────────────────────────
      const relevance = computeDocRelevanceScore(
        textForAnalysis, result.title, queryTerms, result.sourceDomain
      );
      if (relevance.priority === "PRIORITY_A") priorityADocs++;
      else if (relevance.priority === "PRIORITY_B") priorityBDocs++;

      // Skip entity extraction entirely for NOISE docs — they pollute the case
      if (relevance.priority === "NOISE") {
        noiseSkipped++;
        await logEvent(
          "doc_noise_skipped",
          `NOISE doc skipped (score=${relevance.score}): "${result.title}" — entities not extracted`,
          { caseId, documentId: doc.id }
        );
        // Patch the ATLAS-DIAG block with the relevance score even for noise docs
        const noisePatch = rawText.replace(
          /(\[ATLAS-DIAG:[^\]]+)\]/,
          (_, inner) => `${inner}|score=${relevance.score}|priority=${relevance.priority}|analysis_ran=0]`
        );
        if (noisePatch !== rawText) {
          await db.update(documentsTable).set({ rawText: noisePatch }).where(eq(documentsTable.id, doc.id));
        }
        continue;
      }

      const entities = extractEntities(textForAnalysis);

      let entityCountForDoc = 0;
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
          entityCountForDoc++;
        } catch {
          // Skip duplicate/constraint errors
        }
      }

      // ── Patch rawText to add entity count, analysis_ran, and relevance score ──
      const updatedRawText = rawText.replace(
        /(\[ATLAS-DIAG:[^\]]+)\]/,
        (_, inner) => `${inner}|entities=${entityCountForDoc}|analysis_ran=1|score=${relevance.score}|priority=${relevance.priority}]`
      );
      if (updatedRawText !== rawText) {
        await db.update(documentsTable)
          .set({ rawText: updatedRawText })
          .where(eq(documentsTable.id, doc.id));
        rawText = updatedRawText;
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

  // Load document titles and existing entity names for trust scoring
  const ingestedDocs = await db.select({ id: documentsTable.id, title: documentsTable.title })
    .from(documentsTable).where(eq(documentsTable.caseId, caseId));
  const docTitleMap = new Map(ingestedDocs.map(d => [d.id, (d.title || "").toLowerCase()]));

  // Group by normalized entity name for dedup/merge
  interface EntryData {
    displayName: string;
    type: string;
    docIds: Set<number>;
    maxConfidence: number;
    mentionIds: number[];
    titleHits: number;      // how many doc titles contain this entity name
    moneyCtxHits: number;   // mentions near financial terms
    agencyBonus: boolean;   // is a government/agency type
  }
  const entityMap = new Map<string, EntryData>();

  const MONEY_CONTEXT_RE = /\b(funding|grant|budget|contract|appropriation|allocation|spending|award|procurement|invoice|settlement|payment|payout)\b/i;
  const TARGET_WORDS = new Set(target.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  for (const m of allMentions) {
    // Normalize key for grouping — resolve canonical to merge variants
    const normKey = normalizeEntityName(m.entityName);
    // Try to resolve to an existing canonical key
    const existingKeys = Array.from(entityMap.keys());
    const canonicalKey = existingKeys.find(k => {
      const shorter = normKey.length < k.length ? normKey : k;
      const longer = normKey.length >= k.length ? normKey : k;
      return shorter.length >= 4 && longer.includes(shorter);
    }) ?? normKey;

    if (!entityMap.has(canonicalKey)) {
      entityMap.set(canonicalKey, {
        displayName: m.entityName,
        type: m.entityType,
        docIds: new Set(),
        maxConfidence: 0,
        mentionIds: [],
        titleHits: 0,
        moneyCtxHits: 0,
        agencyBonus: m.entityType === "government_agency",
      });
    }
    const entry = entityMap.get(canonicalKey)!;
    if (m.documentId) {
      entry.docIds.add(m.documentId);
      // Title hit — entity appears in doc title
      const docTitle = docTitleMap.get(m.documentId) || "";
      if (docTitle.includes(normalizeEntityName(m.entityName))) entry.titleHits++;
    }
    if (m.context && MONEY_CONTEXT_RE.test(m.context)) entry.moneyCtxHits++;
    if (m.entityType === "government_agency") entry.agencyBonus = true;
    entry.maxConfidence = Math.max(entry.maxConfidence, m.confidence ?? 0);
    entry.mentionIds.push(m.id);
    // Prefer longer/more descriptive display names
    if (m.entityName.length > entry.displayName.length) entry.displayName = m.entityName;
  }

  // Compute trust score for each entity
  function computeTrustScore(entry: EntryData): number {
    let trust = entry.maxConfidence;
    if (entry.docIds.size >= 3) trust += 0.12;
    else if (entry.docIds.size >= 2) trust += 0.07;
    if (entry.titleHits >= 2) trust += 0.10;
    else if (entry.titleHits >= 1) trust += 0.05;
    if (entry.moneyCtxHits >= 1) trust += 0.06;
    if (entry.agencyBonus) trust += 0.05;
    // Penalize: single-word person with no title hit
    const isPersonSingleWord = entry.type === "person" && !entry.displayName.includes(" ");
    if (isPersonSingleWord) trust -= 0.30;
    // Penalize: entity name is a subset of the query target (too generic)
    const normDisplay = normalizeEntityName(entry.displayName);
    if (TARGET_WORDS.has(normDisplay)) trust -= 0.20;
    return Math.min(0.99, trust);
  }

  // Auto-approve: trust score threshold
  const approvedEntityIds = new Map<string, number>(); // key → entity.id

  async function approveEntity(key: string, entry: EntryData, tier: string) {
    try {
      if (WRAPPER_ENTITY_BLOCKLIST.has(entry.displayName)) return;

      // Check for canonical resolution against already-promoted names
      const canonicalMatch = resolveToCanonical(entry.displayName, promotedEntityNames);
      const finalName = canonicalMatch ?? entry.displayName;

      const entityRows = await db
        .insert(entitiesTable)
        .values({
          name: finalName,
          type: entry.type,
          caseId,
          aliases: canonicalMatch ? [entry.displayName] : [],
        })
        .returning();

      const entityId = entityRows[0].id;
      approvedEntityIds.set(key, entityId);
      promotedEntityNames.push(finalName);

      for (const mentionId of entry.mentionIds) {
        await db.update(entityMentionsTable)
          .set({ status: "approved" })
          .where(eq(entityMentionsTable.id, mentionId));
      }

      const trustPct = (computeTrustScore(entry) * 100).toFixed(0);
      await logEvent(
        "entity_auto_approved",
        `[${tier}] Entity auto-approved: ${finalName} [${entry.type.replace(/_/g, " ").toUpperCase()}] — trust ${trustPct}%, ${entry.docIds.size} docs, title-hits=${entry.titleHits}, money-ctx=${entry.moneyCtxHits}`,
        { caseId, entityId }
      );
    } catch {
      // Entity may already exist — skip
    }
  }

  // Tier 1: high trust, multi-doc (graph-quality)
  for (const [key, entry] of entityMap) {
    const trust = computeTrustScore(entry);
    if (trust >= 0.82 && entry.docIds.size >= 2) {
      await approveEntity(key, entry, "T1");
    }
  }

  // Tier 1b: single-doc but very strong signals (title hit + money context + agency type)
  if (approvedEntityIds.size < 3) {
    for (const [key, entry] of entityMap) {
      if (approvedEntityIds.has(key)) continue;
      const trust = computeTrustScore(entry);
      const strongSingleDoc = entry.titleHits >= 1 && (entry.moneyCtxHits >= 1 || entry.agencyBonus);
      if (trust >= 0.78 && strongSingleDoc) {
        await approveEntity(key, entry, "T1b-STRONG");
      }
    }
  }

  // Tier 2 fallback: if zero entities approved, promote the safest single-doc candidates
  if (approvedEntityIds.size === 0 && validDocsIngested > 0) {
    const PREFERRED_TYPES = ["organization", "government_agency", "facility", "program", "location"];

    const candidates = Array.from(entityMap.entries())
      .filter(([, e]) => computeTrustScore(e) >= 0.65 && !WRAPPER_ENTITY_BLOCKLIST.has(e.displayName))
      .map(([key, entry]) => {
        const hasOkDoc = Array.from(entry.docIds).some((id) => okDocIds.has(id));
        const typeBonus = PREFERRED_TYPES.includes(entry.type) ? 1.5 : 0;
        const okBonus = hasOkDoc ? 2 : 0;
        return { key, entry, priority: computeTrustScore(entry) + typeBonus + okBonus };
      })
      .sort((a, b) => b.priority - a.priority);

    let fallbackCount = 0;
    for (const { key, entry } of candidates) {
      if (fallbackCount >= 3) break;
      await approveEntity(key, entry, "T2-FALLBACK");
      fallbackCount++;
    }

    if (fallbackCount > 0) {
      await logEvent(
        "seed_fallback_triggered",
        `Seed fallback: promoted ${fallbackCount} entity candidate${fallbackCount !== 1 ? "s" : ""} — no high-confidence multi-doc entities qualified`,
        { caseId }
      );
    } else if (allMentions.length > 0) {
      await logEvent(
        "seed_no_promotion",
        `No seed entities promoted — ${allMentions.length} signals detected but none passed trust/blocklist checks`,
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

  // ── Case summary with machine-readable seed diagnostics ──────────────────

  const docsIngested = ingestedDocIds.length;
  const searchResultsConsidered = toIngest.length;
  const searchResultsTotal = uniqueResults.length;
  const entitiesApproved = approvedEntityIds.size;
  const totalDetected = allMentions.length;
  const isFallback = entitiesApproved > 0 &&
    Array.from(approvedEntityIds.keys()).every((k) => {
      const entry = entityMap.get(k);
      return entry && entry.docIds.size < 2;
    });

  // ── Compute build status / analyst trust rating ───────────────────────────
  const usableDocCount = okDocs + partialDocs;
  let buildStatus: string;
  let trustRating: string;
  if (entitiesApproved >= 3 && priorityADocs >= 2 && usableDocCount >= 3) {
    buildStatus = "summarized"; trustRating = "STRONG BUILD";
  } else if (entitiesApproved >= 1 && usableDocCount >= 2) {
    buildStatus = "graphed"; trustRating = "MODERATE BUILD";
  } else if (totalDetected > 0 && usableDocCount >= 1) {
    buildStatus = "analyzed"; trustRating = "DEGRADED BUILD";
  } else if (usableDocCount > 0) {
    buildStatus = "ingested"; trustRating = "LOW CONFIDENCE";
  } else {
    buildStatus = "failed"; trustRating = "EMPTY CASE";
  }

  // ── Generate NEXT QUERIES based on promoted entities ─────────────────────
  const nextQueryBase = promotedEntityNames.slice(0, 3);
  const nextQueryLines = nextQueryBase.length > 0
    ? nextQueryBase.flatMap(name => [
        `${name} contracts`,
        `${name} budget`,
        `${name} grant`,
      ]).slice(0, 6)
    : [`${target} contracts`, `${target} audit`, `${target} grant`];

  // Build human-readable description
  const sourceWord = (n: number) => `${n} source${n !== 1 ? "s" : ""}`;
  const entityWord = (n: number) => `${n} entity${n !== 1 ? " signals" : " signal"}`;

  let statusLine: string;
  if (entitiesApproved > 0) {
    const promotionNote = isFallback ? " via seed fallback" : "";
    statusLine = `ATLAS found ${searchResultsTotal} results, ingested ${sourceWord(docsIngested)}, extracted ${sourceWord(validDocsIngested)} with usable text, detected ${entityWord(totalDetected)}, and auto-promoted ${entitiesApproved} seed ${entitiesApproved !== 1 ? "entities" : "entity"}${promotionNote} to the case graph.`;
    if (noiseSkipped > 0) statusLine += ` ${noiseSkipped} low-relevance document${noiseSkipped !== 1 ? "s" : ""} suppressed from entity extraction.`;
  } else if (totalDetected > 0) {
    statusLine = `ATLAS found ${searchResultsTotal} results, ingested ${sourceWord(docsIngested)}, extracted ${sourceWord(validDocsIngested)} with usable text, and detected ${entityWord(totalDetected)} — none passed quality checks for auto-promotion. Review pending detections to manually approve entities.`;
  } else if (validDocsIngested > 0) {
    statusLine = `ATLAS found ${searchResultsTotal} results and ingested ${sourceWord(docsIngested)}, but no entity signals were extracted from ${sourceWord(validDocsIngested)} with usable text. Try re-analyzing individual documents or adding sources manually.`;
  } else {
    statusLine = `BUILD DEGRADED — ATLAS found ${searchResultsTotal} results but all ${docsIngested} ingested sources were blocked, paywalled, or JS-rendered. No usable article text was recovered. Add sources manually via Web Ingest.`;
  }

  // Encode machine-readable diagnostics block (parsed by the Overview panel)
  const seedTag = [
    `searched=${searchResultsConsidered}`,
    `total=${searchResultsTotal}`,
    `ingested=${docsIngested}`,
    `ok=${okDocs}`,
    `partial=${partialDocs}`,
    `failed=${failedDocs}`,
    `wrapper=${wrapperDocs}`,
    `noise=${noiseSkipped}`,
    `priority_a=${priorityADocs}`,
    `priority_b=${priorityBDocs}`,
    `detected=${totalDetected}`,
    `promoted=${entitiesApproved}`,
    `fallback=${isFallback ? 1 : 0}`,
    `build_status=${buildStatus}`,
    `trust=${encodeURIComponent(trustRating)}`,
    `next_queries=${encodeURIComponent(nextQueryLines.join("||"))}`,
  ].join("|");

  const description = `${statusLine}\n\n[ATLAS-SEED:${seedTag}]`;

  await db
    .update(casesTable)
    .set({ description, updatedAt: new Date() })
    .where(eq(casesTable.id, caseId));

  await logEvent(
    "seed_complete",
    `Seed pipeline complete — ${searchResultsTotal} results → ${docsIngested} ingested → ${validDocsIngested} usable → ${totalDetected} detected → ${entitiesApproved} promoted`,
    { caseId }
  );
}

export default router;
