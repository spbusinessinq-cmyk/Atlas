import { Router, type IRouter } from "express";
import { compileCaseBrief } from "../lib/case-compiler";
import { db } from "@workspace/db";
import {
  documentsTable,
  entityMentionsTable,
  casesTable,
  entitiesTable,
  relationshipsTable,
  timelineEntriesTable,
  financialSignalsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { parse as parseHtml } from "node-html-parser";
import {
  extractEntities,
  extractTimelineEvents,
  extractSoftTimelineEvents,
  extractFinancialSignals,
  extractNonNumericSignals,
  computeDocRelevanceScore,
  normalizeEntityName,
  resolveToCanonical,
  classifySeedIntent,
  classifyTarget,
  cleanBodyText,
  computeDocContaminationScore,
  shouldAdmitMention,
  INSTITUTION_PATTERN,
  type SeedIntent,
  type TargetMode,
  type TargetClassification,
  type EntityRole,
  type TopicRelevance,
  type DocumentZone,
  type AdmissionRejectReason,
  type DocContaminationResult,
  buildCaseAnchor,
  filterTimelineByAnchor,
  filterFinancialByAnchor,
  type CaseAnchor,
} from "../lib/entity-extractor";
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
      if (!m.admitted) continue; // Admission firewall
      try {
        const encodedCtx = `[A:r=${m.role}|t=${m.topicRelevance}|z=${m.zone}] ${m.context}`;
        await db.insert(entityMentionsTable).values({
          documentId: doc.id,
          caseId: doc.caseId,
          entityName: m.entityName,
          entityType: m.entityType,
          confidence: m.confidence,
          status: "pending",
          context: encodedCtx,
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

/**
 * Generate 8–12 investigative query variations based on target mode.
 * Returns ordered list — first queries are highest-priority anchors.
 */
function generateInvestigativeQueries(target: string, classification: TargetClassification): string[] {
  const base = target.trim();
  const { mode } = classification;

  const dedup = (arr: string[]): string[] => [...new Set(arr)];

  switch (mode) {
    case "person_target":
      return dedup([
        `"${base}"`,
        `"${base}" investigation`,
        `"${base}" lawsuit`,
        `"${base}" contract`,
        `"${base}" funding`,
        `"${base}" records`,
        `"${base}" donations`,
        `"${base}" payments`,
        `"${base}" PAC`,
        `"${base}" nonprofit`,
        `"${base}" board`,
        `"${base}" indictment`,
        `"${base}" settlement`,
        `"${base}" subpoena`,
      ]);

    case "organization_target":
    case "government_agency_target":
      return dedup([
        `"${base}"`,
        `"${base}" contract`,
        `"${base}" budget`,
        `"${base}" audit`,
        `"${base}" lawsuit`,
        `"${base}" oversight`,
        `"${base}" procurement`,
        `"${base}" funding`,
        `"${base}" grants`,
        `"${base}" scandal`,
        `"${base}" federal investigation`,
        `"${base}" whistleblower`,
        `"${base}" report`,
      ]);

    case "funding_target":
      return dedup([
        `${base} funding`,
        `${base} spending`,
        `${base} contract`,
        `${base} grant`,
        `${base} budget`,
        `${base} appropriation`,
        `${base} audit`,
        `${base} procurement`,
        `${base} misuse`,
        `${base} oversight`,
        `${base} fraud`,
        `${base} payments`,
      ]);

    case "scandal_target":
      return dedup([
        `${base} investigation`,
        `${base} records`,
        `${base} deposition`,
        `${base} affidavit`,
        `${base} indictment`,
        `${base} complaint`,
        `${base} audit`,
        `${base} report`,
        `${base} court filing`,
        `${base} whistleblower`,
        `${base} internal review`,
        `${base} oversight`,
      ]);

    case "program_target":
      return dedup([
        `${base}`,
        `${base} budget`,
        `${base} contracts`,
        `${base} audit`,
        `${base} oversight`,
        `${base} funding`,
        `${base} procurement`,
        `${base} accountability`,
        `${base} report`,
        `${base} grant`,
        `${base} investigation`,
      ]);

    case "place_target":
      return dedup([
        `${base}`,
        `${base} contracts`,
        `${base} budget`,
        `${base} corruption`,
        `${base} audit`,
        `${base} investigation`,
        `${base} funding`,
        `${base} officials`,
        `${base} procurement`,
        `${base} misconduct`,
      ]);

    case "event_target":
      return dedup([
        `${base}`,
        `${base} investigation`,
        `${base} report`,
        `${base} records`,
        `${base} accountability`,
        `${base} documents`,
        `${base} officials`,
        `${base} oversight`,
        `${base} timeline`,
      ]);

    default: {
      // topic_investigation / general — build smart variations from seed intent
      const intentQueries = buildLegacyQueryVariations(base, classification.seedIntent);
      return dedup([
        base,
        `${base} investigation`,
        `${base} contracts`,
        `${base} funding`,
        ...intentQueries,
      ]).slice(0, 10);
    }
  }
}

/** Legacy fallback query builder (used for topic/general) */
function buildLegacyQueryVariations(base: string, intent: SeedIntent): string[] {
  switch (intent) {
    case "housing_homelessness": return [`${base} shelter contracts`, `${base} housing funding`, `${base} program audit`, `${base} accountability`];
    case "finance_funding":      return [`${base} contracts`, `${base} grant award`, `${base} budget allocation`, `${base} procurement`];
    case "education_university": return [`${base} contracts`, `${base} funding`, `${base} audit investigation`, `${base} grant`];
    case "crime_corruption":     return [`${base} investigation`, `${base} indictment`, `${base} fraud audit`, `${base} corruption charges`];
    case "legal_lawsuit":        return [`${base} lawsuit`, `${base} court filing`, `${base} settlement`, `${base} legal action`];
    case "entertainment_film":   return [`${base} tax credit`, `${base} film incentive funding`, `${base} production subsidy`];
    case "policy_government":    return [`${base} contracts`, `${base} oversight audit`, `${base} program funding`, `${base} accountability`];
    default:                     return [`${base} investigation`, `${base} contracts`, `${base} funding`, `${base} program`];
  }
}

async function runSeedPipeline(caseId: number, target: string): Promise<void> {
  await logEvent("auto_ingest_started", `Auto-ingestion started for target: "${target}"`, { caseId });

  // ── Master target classification (Pass 28) ────────────────────────────────
  const targetClassification = classifyTarget(target);
  const seedIntent = targetClassification.seedIntent;
  const targetMode = targetClassification.mode;
  const queryTerms = target.trim().split(/\s+/).filter(w => w.length > 2);

  // ── Case Anchor (Power Pass T001) ────────────────────────────────────────
  const caseAnchor: CaseAnchor = buildCaseAnchor(target, targetMode);

  // Store classification in DB
  await db.update(casesTable)
    .set({
      targetMode,
      targetLabel: target.trim(),
      targetConfidence: targetClassification.confidence,
    })
    .where(eq(casesTable.id, caseId));

  await logEvent(
    "seed_intent_classified",
    `Target mode: ${targetMode} (${(targetClassification.confidence * 100).toFixed(0)}% conf) | Intent: ${seedIntent} | Target: "${target}"`,
    { caseId, targetMode, seedIntent, confidence: targetClassification.confidence }
  );

  // ── Generate 8–12 investigative query variations (Pass 28) ───────────────
  const queryVariations = generateInvestigativeQueries(target, targetClassification);

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
      await logEvent("query_run", `Query: "${query}" → ${items.length} result(s)`, { caseId });
      for (const r of items) allResults.push({ ...r, _query: query });
    } catch {
      // Continue with next query variant
    }
  }

  // Deduplicate by URL and domain (max 3 per domain for diversity with larger query set)
  const seenUrls = new Set<string>();
  const domainCount = new Map<string, number>();
  const uniqueResults: WebSearchResult[] = [];
  for (const r of allResults) {
    if (seenUrls.has(r.url)) continue;
    const domain = tryHostname(r.url);
    const domainHits = domainCount.get(domain) || 0;
    if (domainHits >= 3) continue; // Max 3 results per domain
    seenUrls.add(r.url);
    domainCount.set(domain, domainHits + 1);
    uniqueResults.push(r);
  }

  // Sort by relevance to primary target, pick top 12 (increased from 8)
  uniqueResults.sort((a, b) => scoreResult(b, target) - scoreResult(a, target));

  // Filter out results with very negative scores (clearly off-topic / spam)
  const qualifiedResults = uniqueResults.filter((r) => scoreResult(r, target) >= -2);
  const toIngest = qualifiedResults.slice(0, 12);

  const ingestedDocIds: number[] = [];
  const okDocIds = new Set<number>();
  const docContaminationMap = new Map<number, DocContaminationResult>();

  let validDocsIngested = 0;
  let okDocs = 0;
  let partialDocs = 0;
  let failedDocs = 0;
  let wrapperDocs = 0;
  let noiseSkipped = 0;
  let highContaminationDocs = 0;
  let priorityADocs = 0;
  let priorityBDocs = 0;
  let pipelineRejectedTotal = 0;
  const pipelineRejectReasons: Record<string, number> = {};
  const docPriorities = new Map<number, string>(); // docId → priority
  const docTiers = new Map<number, string>();      // docId → CORE|RELEVANT|PERIPHERAL|OFF_TOPIC|CONTAMINATED
  const promotedEntityNames: string[] = []; // canonical names approved into the graph
  const allIngestedTexts: string[] = [];     // raw text of every admitted doc (for recovery pass)
  let recoveryTriggered = false;
  let recoveryReason = "";
  let starterPromoted = 0; // count before recovery
  let recoveryDocCount = 0;

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
      allIngestedTexts.push(textForAnalysis);

      // ── Contamination scoring ────────────────────────────────────────────
      const cleanResult = cleanBodyText(textForAnalysis);
      const contaminationResult = computeDocContaminationScore(textForAnalysis, cleanResult.boilerplateRatio);
      const extractionMode = contaminationResult.restrictToLead ? "lead_only" : "full";
      docContaminationMap.set(doc.id, contaminationResult);

      // ── Relevance scoring (seed intent + anchor aware) ──────────────────
      const relevance = computeDocRelevanceScore(
        textForAnalysis, result.title, queryTerms, result.sourceDomain, seedIntent, caseAnchor
      );
      if (relevance.priority === "PRIORITY_A") priorityADocs++;
      else if (relevance.priority === "PRIORITY_B") priorityBDocs++;
      docPriorities.set(doc.id, relevance.priority);
      docTiers.set(doc.id, relevance.tier ?? "PERIPHERAL");

      // Log topic alignment advisory for mismatched docs
      if (relevance.topicAlignment === "mismatched" && relevance.mismatchReason) {
        await logEvent(
          "doc_topic_mismatch",
          `Topic mismatch [${relevance.mismatchReason}] for "${result.title}" (score=${relevance.score})`,
          { caseId, documentId: doc.id }
        );
      }

      // Skip entity extraction entirely for NOISE docs — they pollute the case
      if (relevance.priority === "NOISE") {
        noiseSkipped++;
        await logEvent(
          "doc_noise_skipped",
          `NOISE doc skipped (score=${relevance.score}, align=${relevance.topicAlignment}): "${result.title}" — entities not extracted`,
          { caseId, documentId: doc.id }
        );
        // Patch the ATLAS-DIAG block with the relevance score even for noise docs
        const noisePatch = rawText.replace(
          /(\[ATLAS-DIAG:[^\]]+)\]/,
          (_, inner) => `${inner}|score=${relevance.score}|priority=${relevance.priority}|tier=${relevance.tier}|alignment=${relevance.topicAlignment}|anchorScore=${relevance.anchorScore}|titleHit=${relevance.titleHit ? 1 : 0}|leadHit=${relevance.leadHit ? 1 : 0}|contamination=${contaminationResult.score}|extraction_mode=${extractionMode}|analysis_ran=0]`
        );
        if (noisePatch !== rawText) {
          await db.update(documentsTable).set({ rawText: noisePatch }).where(eq(documentsTable.id, doc.id));
        }
        continue;
      }

      // Log contamination warning for high-contamination docs
      if (contaminationResult.score === "high") {
        await logEvent(
          "doc_contamination_high",
          `HIGH contamination in "${result.title}" [signals: ${contaminationResult.signals.join(", ")}] — restricting extraction to title/dek/lead`,
          { caseId, documentId: doc.id }
        );
      }

      const entities = extractEntities(textForAnalysis, queryTerms, seedIntent, contaminationResult.restrictToLead);

      let entityCountForDoc = 0;
      let rejectedByFirewall = 0;
      const rejectReasonCounts: Record<string, number> = {};

      for (const m of entities) {
        if (WRAPPER_ENTITY_BLOCKLIST.has(m.entityName)) continue;
        if (!m.admitted) {
          rejectedByFirewall++;
          const rr = m.rejectReason ?? "UNKNOWN";
          rejectReasonCounts[rr] = (rejectReasonCounts[rr] ?? 0) + 1;
          continue;
        }
        try {
          const encodedCtx = `[A:r=${m.role}|t=${m.topicRelevance}|z=${m.zone}] ${m.context}`;
          await db.insert(entityMentionsTable).values({
            documentId: doc.id,
            caseId,
            entityName: m.entityName,
            entityType: m.entityType,
            confidence: m.confidence,
            status: "pending",
            context: encodedCtx,
            startPos: m.startPos,
            endPos: m.endPos,
          });
          entityCountForDoc++;
        } catch {
          // Skip duplicate/constraint errors
        }
      }

      // Accumulate pipeline-level rejection counts
      pipelineRejectedTotal += rejectedByFirewall;
      for (const [r, n] of Object.entries(rejectReasonCounts)) {
        pipelineRejectReasons[r] = (pipelineRejectReasons[r] ?? 0) + n;
      }

      // ── Auto-extract timeline events (anchor-filtered + soft fallback) ────
      if (relevance.priority !== "NOISE") {
        try {
          const rawTimelineEvents = extractTimelineEvents(textForAnalysis);
          const timelineEvents = filterTimelineByAnchor(rawTimelineEvents, caseAnchor);
          let strictInserted = 0;
          for (const ev of timelineEvents) {
            try {
              await db.insert(timelineEntriesTable).values({
                title: `[${ev.eventType}] ${ev.summary.slice(0, 120)}`,
                description: ev.summary,
                eventDate: ev.eventDate,
                linkedDocumentId: doc.id,
                caseId,
              });
              strictInserted++;
            } catch { /* skip duplicates */ }
          }
          // P3: Soft timeline recovery — if strict returned 0, use softer extraction
          if (strictInserted === 0) {
            const softEvents = extractSoftTimelineEvents(textForAnalysis);
            for (const ev of softEvents) {
              try {
                await db.insert(timelineEntriesTable).values({
                  title: `[SOFT][${ev.eventType}] ${ev.summary.slice(0, 110)}`,
                  description: ev.summary,
                  eventDate: ev.eventDate,
                  linkedDocumentId: doc.id,
                  caseId,
                  softEvent: true,
                });
              } catch { /* skip duplicates */ }
            }
          }
        } catch {
          // don't let timeline extraction crash the pipeline
        }
      }

      // ── Auto-extract financial signals (anchor-filtered, confidence-gated) ──
      if (relevance.priority !== "NOISE") {
        try {
          const rawSignals = extractFinancialSignals(textForAnalysis, caseAnchor.anchorTokens);
          const signals = filterFinancialByAnchor(rawSignals, caseAnchor);
          let financialInserted = 0;
          let financialRejected = 0;
          for (const sig of signals) {
            const conf = (sig as any).financialConfidence ?? 0;
            if (conf < 0.60) { financialRejected++; continue; }
            try {
              await db.insert(financialSignalsTable).values({
                amountRaw: sig.amountRaw,
                amountDisplay: (sig as any).amountDisplay ?? null,
                normalizedAmount: sig.normalizedAmount ?? null,
                currency: sig.currency ?? "USD",
                signalType: sig.signalType,
                eventSummary: sig.eventSummary ?? null,
                entityName: sig.entityName ?? null,
                controlledBy: (sig as any).controlledBy ?? null,
                receivedBy: (sig as any).receivedBy ?? null,
                programName: (sig as any).programName ?? null,
                financialConfidence: conf,
                documentId: doc.id,
                documentTitle: result.title,
                caseId,
              });
              financialInserted++;
            } catch {
              // skip duplicate/constraint errors
            }
          }
          if (financialRejected > 0) {
            console.log(`[ATLAS-FINANCIAL] doc=${doc.id} inserted=${financialInserted} rejected_low_conf=${financialRejected}`);
          }
        } catch {
          // don't let financial extraction crash the pipeline
        }
      }

      // ── Non-numeric signal extraction (runs after numeric pass) ───────────
      if (relevance.priority !== "NOISE") {
        try {
          const nonNumericSignals = extractNonNumericSignals(textForAnalysis, caseAnchor.anchorTokens);
          for (const sig of nonNumericSignals) {
            if ((sig.financialConfidence ?? 0) < 0.25) continue;
            try {
              await db.insert(financialSignalsTable).values({
                caseId,
                linkedDocumentId: doc.id,
                amountRaw: sig.amountRaw,
                amountDisplay: sig.amountDisplay,
                normalizedAmount: sig.normalizedAmount,
                currency: sig.currency ?? "USD",
                signalType: sig.signalType,
                eventSummary: sig.eventSummary,
                entityName: sig.entityName,
                controlledBy: sig.controlledBy,
                receivedBy: sig.receivedBy,
                programName: sig.programName,
                financialConfidence: sig.financialConfidence,
                inferredSignal: false,
              });
            } catch { /* skip duplicates */ }
          }
        } catch {
          // don't crash the pipeline
        }
      }

      // Track contamination counts
      if (contaminationResult.score === "high") highContaminationDocs++;

      // ── Patch rawText to add entity count, analysis_ran, relevance score, alignment, rejected, contamination ──
      const updatedRawText = rawText.replace(
        /(\[ATLAS-DIAG:[^\]]+)\]/,
        (_, inner) => `${inner}|entities=${entityCountForDoc}|rejected=${rejectedByFirewall}|analysis_ran=1|score=${relevance.score}|priority=${relevance.priority}|tier=${relevance.tier}|alignment=${relevance.topicAlignment}|anchorScore=${relevance.anchorScore}|titleHit=${relevance.titleHit ? 1 : 0}|leadHit=${relevance.leadHit ? 1 : 0}|contamination=${contaminationResult.score}|extraction_mode=${extractionMode}]`
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

  // ── Parse role/topic from encoded context prefix ────────────────────────
  function parseMentionMeta(ctx: string | null): { role: EntityRole | null; topic: TopicRelevance | null; zone: DocumentZone | null } {
    if (!ctx) return { role: null, topic: null, zone: null };
    const m = ctx.match(/^\[A:r=([^|]+)\|t=([^|]+)\|z=([^\]]+)\]/);
    if (!m) return { role: null, topic: null, zone: null };
    return {
      role: m[1] as EntityRole,
      topic: m[2] as TopicRelevance,
      zone: m[3] as DocumentZone,
    };
  }

  // ── Entity map constants ─────────────────────────────────────────────────
  const isSerious = ["crime_corruption","legal_lawsuit","policy_government",
    "housing_homelessness","finance_funding"].includes(seedIntent);
  const MAX_PROMOTED_ENTITIES = 5; // hard cap for all seeds

  // Group by normalized entity name for dedup/merge
  interface EntryData {
    displayName: string;
    type: string;
    docIds: Set<number>;
    maxConfidence: number;
    mentionIds: number[];
    titleHits: number;
    moneyCtxHits: number;
    agencyBonus: boolean;
    bestRole: EntityRole | null;
    bestTopic: TopicRelevance | null;
    hasLeadHit: boolean;           // appears in title/dek/lead zone (any)
    titleDekLeadHit: boolean;      // strictly title, dek, or lead (for hard-gate)
    qualityDocHit: boolean;        // appears in a PRIORITY_A or PRIORITY_B doc
    priorityADocHit: boolean;      // appears in at least one PRIORITY_A doc
    coreTierDocHit: boolean;       // appears in at least one CORE-tier doc (anchor-based)
    relevantTierDocHit: boolean;   // appears in at least one RELEVANT-tier doc (anchor-based)
    tailOnlyCount: number;         // mentions only from tail zone
    topicHighCount: number;
    topicMediumCount: number;
    singleDocOnly: boolean;        // only ever seen in one document
    contamDocOnly: boolean;        // only seen in high-contamination docs
  }
  const entityMap = new Map<string, EntryData>();

  const MONEY_CONTEXT_RE = /\b(funding|grant|budget|contract|appropriation|allocation|spending|award|procurement|invoice|settlement|payment|payout)\b/i;
  const TARGET_WORDS = new Set(target.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  // Role priority order — higher index = more investigatively meaningful
  const ROLE_WEIGHT: Record<string, number> = {
    GOVERNMENT_AGENCY: 10, COMMITTEE: 9, COURT_JUDGE: 9, ATTORNEY_COUNSEL: 8,
    OFFICIAL: 7, DEFENDANT: 7, VICTIM_WITNESS: 6, DOCUMENT_FILING: 6,
    PROGRAM: 5, FACILITY: 5, ORGANIZATION: 4, PERSON: 3, UNKNOWN: 0,
  };
  const TOPIC_WEIGHT: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, OFF_TOPIC: -1 };

  for (const m of allMentions) {
    const normKey = normalizeEntityName(m.entityName);
    const existingKeys = Array.from(entityMap.keys());
    const canonicalKey = existingKeys.find(k => {
      const shorter = normKey.length < k.length ? normKey : k;
      const longer  = normKey.length >= k.length ? normKey : k;
      return shorter.length >= 4 && longer.includes(shorter);
    }) ?? normKey;

    const meta = parseMentionMeta(m.context ?? null);

    const isTitleDekLead = meta.zone === "title" || meta.zone === "dek" || meta.zone === "lead";

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
        bestRole: meta.role,
        bestTopic: meta.topic,
        hasLeadHit: isTitleDekLead,
        titleDekLeadHit: isTitleDekLead,
        qualityDocHit: false,
        priorityADocHit: false,
        coreTierDocHit: false,
        relevantTierDocHit: false,
        tailOnlyCount: 0,
        topicHighCount: 0,
        topicMediumCount: 0,
        singleDocOnly: true,
        contamDocOnly: false,
      });
    }
    const entry = entityMap.get(canonicalKey)!;
    if (m.documentId) {
      const prevSize = entry.docIds.size;
      entry.docIds.add(m.documentId);
      if (entry.docIds.size > 1) entry.singleDocOnly = false;
      const docTitle = docTitleMap.get(m.documentId) || "";
      if (docTitle.includes(normalizeEntityName(m.entityName))) entry.titleHits++;
      // Track if this mention came from a quality doc
      const docPri = docPriorities.get(m.documentId);
      if (docPri === "PRIORITY_A" || docPri === "PRIORITY_B") entry.qualityDocHit = true;
      if (docPri === "PRIORITY_A") entry.priorityADocHit = true;
      const docTier = docTiers.get(m.documentId);
      if (docTier === "CORE") entry.coreTierDocHit = true;
      if (docTier === "RELEVANT") entry.relevantTierDocHit = true;
      // Track if all mentions are in high-contamination docs
      const docContam = docContaminationMap.get(m.documentId);
      if (prevSize === 0) entry.contamDocOnly = docContam?.score === "high";
      else if (docContam?.score !== "high") entry.contamDocOnly = false;
    }
    if (m.context && MONEY_CONTEXT_RE.test(m.context)) entry.moneyCtxHits++;
    if (m.entityType === "government_agency") entry.agencyBonus = true;
    entry.maxConfidence = Math.max(entry.maxConfidence, m.confidence ?? 0);
    entry.mentionIds.push(m.id);
    if (m.entityName.length > entry.displayName.length) entry.displayName = m.entityName;

    // Update role — keep highest-weight role seen
    if (meta.role && (ROLE_WEIGHT[meta.role] ?? 0) > (ROLE_WEIGHT[entry.bestRole ?? "UNKNOWN"] ?? 0)) {
      entry.bestRole = meta.role;
    }
    // Update topic — keep best topic seen
    if (meta.topic && (TOPIC_WEIGHT[meta.topic] ?? 0) > (TOPIC_WEIGHT[entry.bestTopic ?? "LOW"] ?? 0)) {
      entry.bestTopic = meta.topic;
    }
    if (isTitleDekLead) { entry.hasLeadHit = true; entry.titleDekLeadHit = true; }
    if (meta.zone === "tail") entry.tailOnlyCount++;
    if (meta.topic === "HIGH") entry.topicHighCount++;
    else if (meta.topic === "MEDIUM") entry.topicMediumCount++;
  }

  // Compute trust score for each entity — role + topicRelevance + quality signals
  function computeTrustScore(entry: EntryData): number {
    let trust = entry.maxConfidence;

    // Multi-doc presence bonus (primary signal for T1_CONFIRMED)
    if (entry.docIds.size >= 3) trust += 0.14;
    else if (entry.docIds.size >= 2) trust += 0.09;

    // Title/dek/lead hit bonuses
    if (entry.titleDekLeadHit) trust += 0.08;
    if (entry.titleHits >= 2) trust += 0.10;
    else if (entry.titleHits >= 1) trust += 0.05;

    // Money/investigative context
    if (entry.moneyCtxHits >= 1) trust += 0.06;

    // Agency / quality source bonus
    if (entry.agencyBonus) trust += 0.06;
    if (entry.priorityADocHit) trust += 0.06;
    else if (entry.qualityDocHit) trust += 0.03;

    // Anchor proximity bonus: entity seen in CORE or RELEVANT anchor-scored doc
    if (entry.coreTierDocHit) trust += 0.12;
    else if (entry.relevantTierDocHit) trust += 0.06;

    // Topic signals
    if (entry.topicHighCount >= 2) trust += 0.09;
    else if (entry.topicHighCount >= 1) trust += 0.05;
    if (entry.topicMediumCount >= 2) trust += 0.04;

    // Role-bearing bonus
    const roleW = ROLE_WEIGHT[entry.bestRole ?? "UNKNOWN"] ?? 0;
    if (roleW >= 9) trust += 0.12;       // court/committee/agency
    else if (roleW >= 7) trust += 0.08;  // official/defendant/attorney
    else if (roleW >= 5) trust += 0.05;  // program/facility/org
    else if (roleW >= 3) trust += 0.02;  // PERSON
    else trust -= 0.12;                  // UNKNOWN role penalty

    // Topic penalty
    if (entry.bestTopic === "LOW") trust -= 0.10;
    if (entry.bestTopic === "OFF_TOPIC") trust -= 0.30;

    // Penalize: single-word person with no title hit
    const isPersonSingleWord = entry.type === "person" && !entry.displayName.includes(" ");
    if (isPersonSingleWord && entry.titleHits === 0) trust -= 0.30;

    // Penalize: entity name is a subset of the query target (too generic)
    const normDisplay = normalizeEntityName(entry.displayName);
    if (TARGET_WORDS.has(normDisplay)) trust -= 0.20;

    // Penalize tail-only mentions
    const totalMentions = entry.mentionIds.length;
    if (totalMentions > 0 && entry.tailOnlyCount === totalMentions) trust -= 0.18;

    // Penalize: only seen in high-contamination docs
    if (entry.contamDocOnly) trust -= 0.22;

    // Penalize: single-doc only for serious seeds
    if (isSerious && entry.singleDocOnly && !entry.titleDekLeadHit) trust -= 0.20;

    return Math.min(0.99, trust);
  }

  // Role weight check helpers
  function isRoleBearing(entry: EntryData): boolean {
    const roleW = ROLE_WEIGHT[entry.bestRole ?? "UNKNOWN"] ?? 0;
    return roleW >= 3; // at least PERSON-level role
  }

  function isStrongRoleBearing(entry: EntryData): boolean {
    const roleW = ROLE_WEIGHT[entry.bestRole ?? "UNKNOWN"] ?? 0;
    return roleW >= 7; // official/defendant/attorney or above
  }

  function isInstitutionRole(entry: EntryData): boolean {
    const roleW = ROLE_WEIGHT[entry.bestRole ?? "UNKNOWN"] ?? 0;
    return roleW >= 5 || entry.type === "government_agency" || entry.type === "organization";
  }

  function hasGoodTopic(entry: EntryData): boolean {
    return entry.bestTopic === "HIGH" || entry.bestTopic === "MEDIUM";
  }

  // ── Promotion tracking ────────────────────────────────────────────────────
  const approvedEntityIds = new Map<string, number>(); // key → entity.id
  let promotedConfirmedCount = 0;  // Condition B (multi-doc)
  let promotedStrongCount = 0;     // Condition A (lead+role)
  let heldCandidates = 0;          // T2_HELD — stays pending for analyst review
  let suppressedNoise = 0;         // hard-suppressed
  let promotionCandidates = 0;     // entities that entered the promotion gate

  // ── Promotion helper functions (Conditions A/B/C) ─────────────────────────
  function meetsConditionA(entry: EntryData): boolean {
    const inLeadZone = entry.titleDekLeadHit || entry.titleHits >= 1;
    const roleBearing = isRoleBearing(entry);
    const topicOk = entry.bestTopic === "HIGH" || entry.bestTopic === "MEDIUM";
    const confOk = entry.maxConfidence >= 0.68;
    return inLeadZone && roleBearing && topicOk && confOk;
  }
  function meetsConditionB(entry: EntryData): boolean {
    const multiDoc = entry.docIds.size >= 2;
    const topicOk = entry.bestTopic === "HIGH" || entry.bestTopic === "MEDIUM";
    const confOk = entry.maxConfidence >= 0.60;
    return multiDoc && topicOk && confOk;
  }
  function meetsConditionC(entry: EntryData): boolean {
    return INSTITUTION_PATTERN.test(entry.displayName);
  }

  async function approveEntity(key: string, entry: EntryData, tier: string) {
    try {
      if (WRAPPER_ENTITY_BLOCKLIST.has(entry.displayName)) return;

      // Hard cap at MAX_PROMOTED_ENTITIES
      if (approvedEntityIds.size >= MAX_PROMOTED_ENTITIES) return;

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

      if (tier === "T1_CONFIRMED") promotedConfirmedCount++;
      else if (tier === "T1_STRONG_SINGLE_DOC") promotedStrongCount++;

      const trustPct = (computeTrustScore(entry) * 100).toFixed(0);
      await logEvent(
        "entity_auto_approved",
        `[${tier}] Entity auto-approved: ${finalName} [${entry.type.replace(/_/g, " ").toUpperCase()}] — trust ${trustPct}%, ${entry.docIds.size} doc(s), title-dek-lead=${entry.titleDekLeadHit}, role=${entry.bestRole}, topic=${entry.bestTopic}`,
        { caseId, entityId }
      );
    } catch {
      // Entity may already exist — skip
    }
  }

  // Count promotion candidates (all entities in map excluding contamDocOnly and blocklisted)
  for (const [, entry] of entityMap) {
    if (!WRAPPER_ENTITY_BLOCKLIST.has(entry.displayName) && !entry.contamDocOnly && entry.bestTopic !== "OFF_TOPIC") {
      promotionCandidates++;
    }
  }

  // ── CONDITION B: Multi-document support (strongest signal — run first) ────
  // Entity appears in 2+ docs, topic ≥ MEDIUM, confidence ≥ 0.60
  for (const [key, entry] of entityMap) {
    if (entry.contamDocOnly) continue;
    if (!meetsConditionB(entry)) continue;
    // Additional quality guard: must not be contam-only and must have at least one role-bearing signal OR institution pattern
    const roleBearing = isRoleBearing(entry);
    const instPattern = meetsConditionC(entry);
    if (roleBearing || instPattern) {
      await approveEntity(key, entry, "T1_CONFIRMED");
    }
  }

  // ── CONDITION A: Lead + Role (single-doc but in title/dek/lead, strong role) ──
  // Only runs if we still have room under MAX_PROMOTED_ENTITIES
  if (approvedEntityIds.size < MAX_PROMOTED_ENTITIES) {
    for (const [key, entry] of entityMap) {
      if (approvedEntityIds.has(key)) continue;
      if (entry.contamDocOnly) continue;
      if (!meetsConditionA(entry)) continue;

      if (isSerious) {
        // Serious seeds: require strong role weight or agency bonus, and priority-A doc
        const strongRole = isStrongRoleBearing(entry) || entry.agencyBonus;
        if (strongRole && entry.priorityADocHit && entry.bestTopic === "HIGH") {
          await approveEntity(key, entry, "T1_STRONG_SINGLE_DOC");
        }
      } else {
        // Non-serious: institution role + quality doc sufficient
        const instRole = isInstitutionRole(entry);
        const qualityDoc = entry.qualityDocHit;
        if ((instRole || (isRoleBearing(entry) && qualityDoc)) && hasGoodTopic(entry)) {
          await approveEntity(key, entry, "T1_STRONG_SINGLE_DOC");
        }
      }
    }
  }

  // ── CONDITION C: Known institution pattern (Condition C standalone) ────────
  // Allow well-known institutions even if they missed lead/multi-doc requirements
  if (approvedEntityIds.size < MAX_PROMOTED_ENTITIES) {
    for (const [key, entry] of entityMap) {
      if (approvedEntityIds.has(key)) continue;
      if (entry.contamDocOnly) continue;
      if (!meetsConditionC(entry)) continue;
      // Must have at least MEDIUM topic and reasonable confidence
      const topicOk = entry.bestTopic === "HIGH" || entry.bestTopic === "MEDIUM";
      const confOk = entry.maxConfidence >= 0.62;
      if (topicOk && confOk && entry.qualityDocHit) {
        await approveEntity(key, entry, "T1_CONFIRMED");
      }
    }
  }

  // ── T2_HELD: plausible — stays pending for analyst review ─────────────────
  for (const [key, entry] of entityMap) {
    if (approvedEntityIds.has(key)) continue;
    const trust = computeTrustScore(entry);
    const roleBearing = isRoleBearing(entry);
    const topicOk = entry.bestTopic !== "OFF_TOPIC";

    // Hard reject: OFF_TOPIC, blocklisted, contam-only, or very low trust
    const shouldSuppress =
      WRAPPER_ENTITY_BLOCKLIST.has(entry.displayName) ||
      !topicOk ||
      entry.contamDocOnly ||
      (!roleBearing && trust < 0.72) ||
      (entry.tailOnlyCount === entry.mentionIds.length && trust < 0.75) ||
      // Hard rule for serious seeds: single-doc + not in title/dek/lead → suppress
      (isSerious && entry.singleDocOnly && !entry.titleDekLeadHit && trust < 0.80);

    if (shouldSuppress) {
      suppressedNoise++;
      for (const mentionId of entry.mentionIds) {
        await db.update(entityMentionsTable)
          .set({ status: "rejected" })
          .where(eq(entityMentionsTable.id, mentionId));
      }
    } else if (trust >= 0.62 && roleBearing) {
      heldCandidates++;
      await logEvent(
        "entity_candidate_held",
        `[T2_HELD] Entity held for review: ${entry.displayName} [${entry.type}] role=${entry.bestRole} topic=${entry.bestTopic} — trust ${(trust * 100).toFixed(0)}%, ${entry.docIds.size} doc(s), singleDoc=${entry.singleDocOnly}, titleDekLead=${entry.titleDekLeadHit}`,
        { caseId }
      );
    } else {
      suppressedNoise++;
      for (const mentionId of entry.mentionIds) {
        await db.update(entityMentionsTable)
          .set({ status: "rejected" })
          .where(eq(entityMentionsTable.id, mentionId));
      }
    }
  }

  // ── Supplemental promote: anchor-proximity boost for thin graphs ─────────
  // If promoted count is <2 and there are ≥2 CORE/RELEVANT docs, loosen threshold
  // for candidates that were seen in those anchor-aligned docs
  const coreTierDocCount = Array.from(docTiers.values()).filter(t => t === "CORE").length;
  const relevantTierDocCount = Array.from(docTiers.values()).filter(t => t === "RELEVANT").length;
  const anchorAlignedDocs = coreTierDocCount + relevantTierDocCount;

  if (approvedEntityIds.size < 2 && anchorAlignedDocs >= 2) {
    const anchorCandidates = Array.from(entityMap.entries())
      .filter(([key, e]) => {
        if (approvedEntityIds.has(key)) return false;
        if (WRAPPER_ENTITY_BLOCKLIST.has(e.displayName)) return false;
        if (e.contamDocOnly) return false;
        if (e.bestTopic === "OFF_TOPIC") return false;
        const anchorDoc = e.coreTierDocHit || e.relevantTierDocHit;
        if (!anchorDoc) return false;
        const trust = computeTrustScore(e);
        return trust >= 0.50 && isRoleBearing(e);
      })
      .map(([key, entry]) => ({
        key, entry,
        score: computeTrustScore(entry)
          + (entry.coreTierDocHit ? 0.20 : 0.08)
          + (entry.titleDekLeadHit ? 0.10 : 0)
      }))
      .sort((a, b) => b.score - a.score);

    let supplementalCount = 0;
    const needed = 2 - approvedEntityIds.size;
    for (const { key, entry } of anchorCandidates) {
      if (supplementalCount >= needed) break;
      await approveEntity(key, entry, "T2_CANDIDATE");
      supplementalCount++;
    }

    if (supplementalCount > 0) {
      await logEvent(
        "entity_anchor_supplemental",
        `Anchor-proximity supplemental: promoted ${supplementalCount} entity(ies) via ${anchorAlignedDocs} anchor-aligned docs (${coreTierDocCount} CORE, ${relevantTierDocCount} RELEVANT)`,
        { caseId }
      );
    }
  }

  // ── Fallback: if zero entities auto-approved, promote top quality candidates ──
  if (approvedEntityIds.size === 0 && validDocsIngested > 0) {
    const PREFERRED_TYPES = ["organization", "government_agency", "facility", "program", "location"];

    const fallbackCandidates = Array.from(entityMap.entries())
      .filter(([, e]) => {
        const trust = computeTrustScore(e);
        return trust >= 0.55
          && !WRAPPER_ENTITY_BLOCKLIST.has(e.displayName)
          && e.bestTopic !== "OFF_TOPIC"
          && !e.contamDocOnly
          && isRoleBearing(e);
      })
      .map(([key, entry]) => {
        const hasOkDoc = Array.from(entry.docIds).some((id) => okDocIds.has(id));
        const typeBonus = PREFERRED_TYPES.includes(entry.type) ? 1.5 : 0;
        const okBonus = hasOkDoc ? 2 : 0;
        return { key, entry, priority: computeTrustScore(entry) + typeBonus + okBonus };
      })
      .sort((a, b) => b.priority - a.priority);

    let fallbackCount = 0;
    for (const { key, entry } of fallbackCandidates) {
      if (fallbackCount >= 4) break;
      await approveEntity(key, entry, "T2_CANDIDATE");
      fallbackCount++;
    }

    if (fallbackCount > 0) {
      await logEvent(
        "seed_fallback_triggered",
        `Seed fallback: promoted ${fallbackCount} T2_CANDIDATE${fallbackCount !== 1 ? "s" : ""} — no T1/T1b entities qualified`,
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

  // ── P3 Entity Recovery Mode: secondary proper noun pass ──────────────────
  // Last resort: if NO entities were promoted at all, scan ingested text for
  // capitalized proper nouns that appear ≥2 times OR near funding/investigation
  // keywords and insert them as entities with recoveryMode=true.
  if (approvedEntityIds.size === 0 && validDocsIngested > 0) {
    const INVEST_NEAR = /\b(?:funding|grant|contract|budget|investigation|probe|audit|fraud|corruption|spending|allocat|appropriat|program|project|initia)\b/i;
    const PROPER_NOUN = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,3})\b/g;
    const RECOVERY_BLOCKLIST = new Set([
      "The", "This", "That", "These", "Those", "There", "Here", "With", "From",
      "When", "Where", "What", "Which", "While", "After", "Before", "During",
      "January","February","March","April","May","June","July","August",
      "September","October","November","December","Monday","Tuesday",
      "Wednesday","Thursday","Friday","Saturday","Sunday",
      "United","States","Federal","National","American","State",
    ]);
    const nounFreq = new Map<string, number>();
    const nounNearFunding = new Set<string>();

    for (const docText of allIngestedTexts) {
      const sentences = docText.split(/(?<=[.!?])\s+|\n+/);
      for (const s of sentences) {
        const nearFunding = INVEST_NEAR.test(s);
        let m: RegExpExecArray | null;
        PROPER_NOUN.lastIndex = 0;
        while ((m = PROPER_NOUN.exec(s)) !== null) {
          const noun = m[1].trim();
          if (RECOVERY_BLOCKLIST.has(noun) || noun.length < 3) continue;
          nounFreq.set(noun, (nounFreq.get(noun) ?? 0) + 1);
          if (nearFunding) nounNearFunding.add(noun);
        }
      }
    }

    const recoveryCandidates = Array.from(nounFreq.entries())
      .filter(([noun, freq]) => {
        if (WRAPPER_ENTITY_BLOCKLIST.has(noun)) return false;
        return freq >= 2 || nounNearFunding.has(noun);
      })
      .sort((a, b) => {
        const aScore = (nounNearFunding.has(a[0]) ? 5 : 0) + a[1];
        const bScore = (nounNearFunding.has(b[0]) ? 5 : 0) + b[1];
        return bScore - aScore;
      })
      .slice(0, 4);

    let recoveryInserted = 0;
    for (const [noun] of recoveryCandidates) {
      try {
        const entityType = INSTITUTION_PATTERN.test(noun) ? "organization" : "person";
        const entityRows = await db.insert(entitiesTable).values({
          name: noun,
          type: entityType,
          caseId,
          recoveryMode: true,
        }).returning();
        approvedEntityIds.set(noun.toLowerCase(), entityRows[0].id);
        promotedEntityNames.push(noun);
        recoveryInserted++;
      } catch { /* skip duplicates */ }
    }

    if (recoveryInserted > 0) {
      await logEvent(
        "entity_recovery_mode",
        `Recovery mode: inserted ${recoveryInserted} proper-noun entity(ies) — no primary conditions met`,
        { caseId }
      );
    }
  }

  // ── Weak-Build Recovery (T005) ────────────────────────────────────────────
  // If serious intent and starter graph is thin, try expanding to more documents

  starterPromoted = approvedEntityIds.size;
  const usableDocsAfterStarter = okDocs + partialDocs;
  const starterQuality = starterPromoted >= 2 && (okDocs + partialDocs) >= 2
    ? "adequate" : starterPromoted >= 1 ? "weak" : "failed";

  const needsRecovery = isSerious &&
    (starterPromoted < 3 || starterQuality === "failed") &&
    ingestedDocIds.length < 12; // safety: don't re-run if already large

  if (needsRecovery) {
    recoveryTriggered = true;
    recoveryReason = starterPromoted < 1
      ? "zero_promoted"
      : starterPromoted < 3
      ? "thin_graph"
      : "weak_quality";

    await logEvent(
      "recovery_triggered",
      `Weak-build recovery triggered (reason=${recoveryReason}, starter_promoted=${starterPromoted}, usable_docs=${usableDocsAfterStarter}) — expanding to additional documents`,
      { caseId }
    );

    // Build recovery-specific query variations — investigation/document focused
    const recoveryQueries: string[] = [];
    const base = target;
    switch (seedIntent) {
      case "crime_corruption":
        recoveryQueries.push(`${base} court records`, `${base} FBI investigation documents`, `${base} DOJ indictment`, `${base} grand jury`, `${base} audit findings`);
        break;
      case "legal_lawsuit":
        recoveryQueries.push(`${base} court filing`, `${base} lawsuit documents`, `${base} legal complaint`, `${base} deposition`, `${base} settlement agreement`);
        break;
      case "housing_homelessness":
        recoveryQueries.push(`${base} audit report`, `${base} oversight hearing`, `${base} contract records`, `${base} inspector general`, `${base} accountability`);
        break;
      case "finance_funding":
        recoveryQueries.push(`${base} grant records`, `${base} contract award`, `${base} procurement`, `${base} spending audit`, `${base} financial disclosures`);
        break;
      case "policy_government":
        recoveryQueries.push(`${base} oversight committee`, `${base} government records`, `${base} accountability report`, `${base} inspector general`, `${base} watchdog`);
        break;
      default:
        recoveryQueries.push(`${base} investigation`, `${base} documents`, `${base} records`, `${base} report`);
    }

    // Fetch additional docs (up to 8 more, cap total at 16)
    const maxRecoveryDocs = Math.min(8, 16 - ingestedDocIds.length);
    const recoveryResults: (WebSearchResult & { _query: string })[] = [];
    const seenRecoveryUrls = new Set<string>(toIngest.map(r => r.url));

    for (const rq of recoveryQueries.slice(0, 4)) {
      try {
        const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(rq)}&hl=en-US&gl=US&ceid=US:en`;
        const resp = await fetch(rssUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; ATLASBot/1.0)" },
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) continue;
        const xml = await resp.text();
        const items = parseRssItems(xml, rq);
        for (const r of items) {
          if (!seenRecoveryUrls.has(r.url)) {
            seenRecoveryUrls.add(r.url);
            recoveryResults.push({ ...r, _query: rq });
          }
        }
      } catch { /* continue */ }
    }

    // Filter and score recovery docs — prefer investigative aligned
    const scoredRecovery = recoveryResults
      .filter(r => scoreResult(r, target) >= 0) // tighter relevance filter
      .sort((a, b) => scoreResult(b, target) - scoreResult(a, target))
      .slice(0, maxRecoveryDocs);

    // Ingest recovery docs
    for (const result of scoredRecovery) {
      try {
        let rawText = result.snippet || result.title;
        let docExtractionStatus: "ok" | "partial" | "failed" | "wrapper" = "failed";

        try {
          const articleResp = await fetch(result.url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
              rawText = `[WRAPPER_BLOCKED]\n${result.snippet || result.title}`;
              docExtractionStatus = "wrapper";
            } else {
              const diagPrefix = encodeDiagPrefix(extracted, finalUrl, { rssUrl: result.rssLink, srcUrl: result.url });
              rawText = diagPrefix + extracted.text;
              docExtractionStatus = extracted.status === "ok" ? "ok" : extracted.status === "partial" ? "partial" : "failed";
            }
          }
        } catch { /* use snippet */ }

        if (docExtractionStatus === "wrapper" || docExtractionStatus === "failed") continue;

        const docRows = await db.insert(documentsTable).values({
          title: result.title,
          source: result.sourceDomain || null,
          sourceUrl: result.url,
          sourceDomain: result.sourceDomain || tryHostname(result.url),
          publishDate: result.publishDate || null,
          caseId,
          ingestMethod: "web",
          rawText,
          previewType: "web-article",
        }).returning();
        const doc = docRows[0];
        ingestedDocIds.push(doc.id);
        recoveryDocCount++;
        if (docExtractionStatus === "ok") { okDocs++; okDocIds.add(doc.id); }
        else partialDocs++;

        const textForAnalysis = cleanRawText(rawText);
        const cleanResult = cleanBodyText(textForAnalysis);
        const contaminationResult = computeDocContaminationScore(textForAnalysis, cleanResult.boilerplateRatio);
        docContaminationMap.set(doc.id, contaminationResult);

        const relevance = computeDocRelevanceScore(textForAnalysis, result.title, queryTerms, result.sourceDomain, seedIntent, caseAnchor);
        docPriorities.set(doc.id, relevance.priority);
        docTiers.set(doc.id, relevance.tier ?? "PERIPHERAL");
        if (relevance.priority === "PRIORITY_A") priorityADocs++;
        else if (relevance.priority === "PRIORITY_B") priorityBDocs++;

        if (relevance.priority === "NOISE") continue;

        const entities = extractEntities(textForAnalysis, queryTerms, seedIntent, contaminationResult.restrictToLead);
        let entityCountForDoc = 0;
        let rejectedByFirewall = 0;
        const rejectReasonCounts: Record<string, number> = {};

        for (const m of entities) {
          if (WRAPPER_ENTITY_BLOCKLIST.has(m.entityName)) continue;
          if (!m.admitted) {
            rejectedByFirewall++;
            const rr = m.rejectReason ?? "UNKNOWN";
            rejectReasonCounts[rr] = (rejectReasonCounts[rr] ?? 0) + 1;
            continue;
          }
          try {
            const encodedCtx = `[A:r=${m.role}|t=${m.topicRelevance}|z=${m.zone}] ${m.context}`;
            await db.insert(entityMentionsTable).values({
              documentId: doc.id,
              caseId,
              entityName: m.entityName,
              entityType: m.entityType,
              confidence: m.confidence,
              status: "pending",
              context: encodedCtx,
              startPos: m.startPos,
              endPos: m.endPos,
            });
            entityCountForDoc++;
          } catch { /* skip duplicate */ }
        }

        pipelineRejectedTotal += rejectedByFirewall;
        for (const [r, n] of Object.entries(rejectReasonCounts)) {
          pipelineRejectReasons[r] = (pipelineRejectReasons[r] ?? 0) + n;
        }

        // ── Auto-extract timeline events (recovery pass, anchor-filtered) ──
        try {
          const rawTimelineEvents = extractTimelineEvents(textForAnalysis);
          const timelineEvents = filterTimelineByAnchor(rawTimelineEvents, caseAnchor);
          for (const ev of timelineEvents) {
            try {
              await db.insert(timelineEntriesTable).values({
                title: `[${ev.eventType}] ${ev.summary.slice(0, 120)}`,
                description: ev.summary,
                eventDate: ev.eventDate,
                linkedDocumentId: doc.id,
                caseId,
              });
            } catch { /* skip duplicates */ }
          }
        } catch { /* don't crash pipeline */ }

        // ── Auto-extract financial signals (recovery pass, confidence-gated) ──
        try {
          const rawSignals = extractFinancialSignals(textForAnalysis, caseAnchor.anchorTokens);
          const signals = filterFinancialByAnchor(rawSignals, caseAnchor);
          for (const sig of signals) {
            const conf = (sig as any).financialConfidence ?? 0;
            if (conf < 0.60) continue;
            try {
              await db.insert(financialSignalsTable).values({
                amountRaw: sig.amountRaw,
                amountDisplay: (sig as any).amountDisplay ?? null,
                normalizedAmount: sig.normalizedAmount ?? null,
                currency: sig.currency ?? "USD",
                signalType: sig.signalType,
                eventSummary: sig.eventSummary ?? null,
                entityName: sig.entityName ?? null,
                controlledBy: (sig as any).controlledBy ?? null,
                receivedBy: (sig as any).receivedBy ?? null,
                programName: (sig as any).programName ?? null,
                financialConfidence: conf,
                documentId: doc.id,
                documentTitle: result.title,
                caseId,
              });
            } catch { /* skip duplicates */ }
          }
        } catch { /* don't crash pipeline */ }

        const updatedRawText = rawText.replace(
          /(\[ATLAS-DIAG:[^\]]+)\]/,
          (_, inner) => `${inner}|entities=${entityCountForDoc}|rejected=${rejectedByFirewall}|analysis_ran=1|score=${relevance.score}|priority=${relevance.priority}|tier=${relevance.tier}|alignment=${relevance.topicAlignment}|anchorScore=${relevance.anchorScore}|titleHit=${relevance.titleHit ? 1 : 0}|leadHit=${relevance.leadHit ? 1 : 0}|contamination=${contaminationResult.score}|extraction_mode=${contaminationResult.restrictToLead ? "lead_only" : "full"}|recovery=1]`
        );
        if (updatedRawText !== rawText) {
          await db.update(documentsTable).set({ rawText: updatedRawText }).where(eq(documentsTable.id, doc.id));
        }
      } catch (err) {
        console.error(`[ATLAS RECOVERY] Failed to ingest ${result.url}:`, err);
      }
    }

    // Re-run promotion gates on newly added mentions
    if (recoveryDocCount > 0) {
      const recoveryMentions = await db.select().from(entityMentionsTable)
        .where(eq(entityMentionsTable.caseId, caseId));
      const newDocIds = new Set(ingestedDocIds.slice(ingestedDocIds.length - recoveryDocCount));
      const newMentions = recoveryMentions.filter(m => m.documentId && newDocIds.has(m.documentId));

      // Merge new mentions into entityMap
      for (const m of newMentions) {
        const normKey = normalizeEntityName(m.entityName);
        const existingKeys = Array.from(entityMap.keys());
        const canonicalKey = existingKeys.find(k => {
          const shorter = normKey.length < k.length ? normKey : k;
          const longer  = normKey.length >= k.length ? normKey : k;
          return shorter.length >= 4 && longer.includes(shorter);
        }) ?? normKey;

        const meta = parseMentionMeta(m.context ?? null);
        const isTitleDekLead = meta.zone === "title" || meta.zone === "dek" || meta.zone === "lead";

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
            bestRole: meta.role,
            bestTopic: meta.topic,
            hasLeadHit: isTitleDekLead,
            titleDekLeadHit: isTitleDekLead,
            qualityDocHit: false,
            priorityADocHit: false,
            coreTierDocHit: false,
            relevantTierDocHit: false,
            tailOnlyCount: 0,
            topicHighCount: 0,
            topicMediumCount: 0,
            singleDocOnly: true,
            contamDocOnly: false,
          });
        }
        const entry = entityMap.get(canonicalKey)!;
        if (m.documentId) {
          entry.docIds.add(m.documentId);
          if (entry.docIds.size > 1) entry.singleDocOnly = false;
          const docPri = docPriorities.get(m.documentId);
          if (docPri === "PRIORITY_A" || docPri === "PRIORITY_B") entry.qualityDocHit = true;
          if (docPri === "PRIORITY_A") entry.priorityADocHit = true;
          const docTierR = docTiers.get(m.documentId);
          if (docTierR === "CORE") entry.coreTierDocHit = true;
          if (docTierR === "RELEVANT") entry.relevantTierDocHit = true;
          const docContam = docContaminationMap.get(m.documentId);
          if (docContam?.score !== "high") entry.contamDocOnly = false;
        }
        if (m.context && MONEY_CONTEXT_RE.test(m.context)) entry.moneyCtxHits++;
        if (m.entityType === "government_agency") entry.agencyBonus = true;
        entry.maxConfidence = Math.max(entry.maxConfidence, m.confidence ?? 0);
        entry.mentionIds.push(m.id);
        if (m.entityName.length > entry.displayName.length) entry.displayName = m.entityName;
        if (meta.role && (ROLE_WEIGHT[meta.role] ?? 0) > (ROLE_WEIGHT[entry.bestRole ?? "UNKNOWN"] ?? 0)) entry.bestRole = meta.role;
        if (meta.topic && (TOPIC_WEIGHT[meta.topic] ?? 0) > (TOPIC_WEIGHT[entry.bestTopic ?? "LOW"] ?? 0)) entry.bestTopic = meta.topic;
        if (isTitleDekLead) { entry.hasLeadHit = true; entry.titleDekLeadHit = true; }
        if (meta.zone === "tail") entry.tailOnlyCount++;
        if (meta.topic === "HIGH") entry.topicHighCount++;
        else if (meta.topic === "MEDIUM") entry.topicMediumCount++;
      }

      // Re-run T1_CONFIRMED on updated entity map (recovery entities may now cross 2-doc threshold)
      for (const [key, entry] of entityMap) {
        if (approvedEntityIds.has(key)) continue;
        const trust = computeTrustScore(entry);
        const roleBearing = isRoleBearing(entry);
        const goodTopic = hasGoodTopic(entry);
        const multiDoc = entry.docIds.size >= 2;
        const hasZoneHit = entry.titleDekLeadHit || entry.titleHits >= 1;
        const qualityDoc = entry.qualityDocHit;
        const notContamOnly = !entry.contamDocOnly;
        if (trust >= 0.81 && multiDoc && hasZoneHit && roleBearing && goodTopic && qualityDoc && notContamOnly) {
          await approveEntity(key, entry, "T1_CONFIRMED");
        }
      }

      // Relaxed T1_STRONG_SINGLE_DOC for recovery pass (slightly lower bar)
      if (approvedEntityIds.size < 3) {
        for (const [key, entry] of entityMap) {
          if (approvedEntityIds.has(key)) continue;
          const trust = computeTrustScore(entry);
          const titleDekLead = entry.titleDekLeadHit || entry.titleHits >= 1;
          const notContamOnly = !entry.contamDocOnly;
          const goodTopic = hasGoodTopic(entry);
          const instRole = isInstitutionRole(entry);
          if (trust >= 0.79 && titleDekLead && instRole && goodTopic && notContamOnly) {
            await approveEntity(key, entry, "T1_STRONG_SINGLE_DOC");
          }
        }
      }

      await logEvent(
        "recovery_complete",
        `Recovery complete — ${recoveryDocCount} additional doc(s) ingested, promoted: ${starterPromoted} → ${approvedEntityIds.size}`,
        { caseId }
      );
    }
  }

  // ── Graph seeding: quality-filtered edges ────────────────────────────────

  let graphFailureReason: string | null = null;
  let strongRelationshipCount = 0;

  if (approvedEntityIds.size >= 2) {
    // Prefer CORE/RELEVANT anchor-tier docs; fall back to PRIORITY_A/B if no tier docs exist
    const hasAnchorTierDocs = Array.from(docTiers.values()).some(t => t === "CORE" || t === "RELEVANT");
    const qualityDocEntityKeys = new Map<number, string[]>();
    const pairDocCount = new Map<string, number>();   // how many docs each pair co-occurs in
    const pairHasTitle = new Map<string, boolean>();  // co-occurs in title/lead of any doc

    for (const [key, entry] of entityMap) {
      if (!approvedEntityIds.has(key)) continue;
      for (const docId of entry.docIds) {
        const docPri = docPriorities.get(docId);
        const docTier = docTiers.get(docId);
        const passAnchor = hasAnchorTierDocs
          ? (docTier === "CORE" || docTier === "RELEVANT")
          : (docPri === "PRIORITY_A" || docPri === "PRIORITY_B");
        if (!passAnchor) continue;
        if (!qualityDocEntityKeys.has(docId)) qualityDocEntityKeys.set(docId, []);
        qualityDocEntityKeys.get(docId)!.push(key);
      }
    }

    // Count co-occurrence frequency per pair
    for (const [, keys] of qualityDocEntityKeys.entries()) {
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const pairKey = [keys[i], keys[j]].sort().join("|||");
          pairDocCount.set(pairKey, (pairDocCount.get(pairKey) ?? 0) + 1);
          // Check if both entities appear in lead zone for this doc
          const eA = entityMap.get(keys[i]);
          const eB = entityMap.get(keys[j]);
          if ((eA?.hasLeadHit || eA?.titleHits) && (eB?.hasLeadHit || eB?.titleHits)) {
            pairHasTitle.set(pairKey, true);
          }
        }
      }
    }

    const createdPairs = new Set<string>();
    for (const [pairKey, docCount] of pairDocCount.entries()) {
      if (createdPairs.has(pairKey)) continue;
      createdPairs.add(pairKey);

      const [a, b] = pairKey.split("|||");
      const entityAId = approvedEntityIds.get(a);
      const entityBId = approvedEntityIds.get(b);
      if (!entityAId || !entityBId) continue;

      // Determine edge type and confidence
      let relType: string;
      let edgeConf: number;
      if (pairHasTitle.get(pairKey)) {
        relType = "title_co_mention";
        edgeConf = 0.88;
      } else if (docCount >= 2) {
        relType = "repeated_association";
        edgeConf = 0.82;
      } else {
        relType = "co_mention";
        edgeConf = 0.70;
      }

      try {
        await db.insert(relationshipsTable).values({
          entityAId,
          entityBId,
          relationshipType: relType,
          caseId,
          confidence: edgeConf,
        });
      } catch {
        // Skip duplicates
      }
    }

    strongRelationshipCount = Array.from(pairDocCount.values()).filter(c => c >= 2).length;

    if (createdPairs.size > 0) {
      await logEvent(
        "graph_updated",
        `Graph seeded with ${createdPairs.size} edge${createdPairs.size !== 1 ? "s" : ""} (quality-filtered, ${strongRelationshipCount} strong) between ${approvedEntityIds.size} entities`,
        { caseId }
      );
    } else if (approvedEntityIds.size >= 2) {
      graphFailureReason = "no_shared_quality_docs";
      await logEvent("graph_no_edges", "Graph empty: entities don't co-appear in anchor-tier docs", { caseId });
    }
  } else if (approvedEntityIds.size === 1) {
    graphFailureReason = "single_entity_only";
  } else if (approvedEntityIds.size === 0) {
    graphFailureReason = "no_entities_promoted";
  }

  // ── P3 Graph Bootstrap: provisional edges for recovery-mode entities ──────
  // If standard graph seeding produced no edges but we have ≥2 approved entities,
  // create provisional co-occurrence edges at 0.45 confidence using any doc.
  if (graphFailureReason === "no_shared_quality_docs" || graphFailureReason === "no_entities_promoted") {
    if (approvedEntityIds.size >= 2) {
      const entityKeys = Array.from(approvedEntityIds.keys());
      let bootstrapEdges = 0;
      for (let i = 0; i < entityKeys.length; i++) {
        for (let j = i + 1; j < entityKeys.length; j++) {
          const entityAId = approvedEntityIds.get(entityKeys[i]);
          const entityBId = approvedEntityIds.get(entityKeys[j]);
          if (!entityAId || !entityBId) continue;
          try {
            await db.insert(relationshipsTable).values({
              entityAId,
              entityBId,
              relationshipType: "provisional_co_mention",
              caseId,
              confidence: 0.45,
            });
            bootstrapEdges++;
          } catch { /* skip duplicates */ }
        }
      }
      if (bootstrapEdges > 0) {
        graphFailureReason = null;
        await logEvent(
          "graph_bootstrap",
          `Graph bootstrap: ${bootstrapEdges} provisional edge(s) at 0.45 conf between ${approvedEntityIds.size} recovery entities`,
          { caseId }
        );
      }
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
  const finalPromoted = approvedEntityIds.size;
  const usableDocCount = okDocs + partialDocs;

  // Compute "docs supporting main entity" (entity with most docIds in promoted set)
  let mainEntityDocSupport = 0;
  for (const [key] of approvedEntityIds) {
    const entry = entityMap.get(key);
    if (entry && entry.docIds.size > mainEntityDocSupport) mainEntityDocSupport = entry.docIds.size;
  }

  // New diagnostic counters from rejection reasons
  const artifactRejectedMentions = (pipelineRejectReasons["ARTIFACT"] ?? 0) + (pipelineRejectReasons["ARTIFACT_ENTITY"] ?? 0);
  const shapeRejectedMentions = pipelineRejectReasons["ARTIFACT_ENTITY"] ?? 0;
  const navRejectedMentions = pipelineRejectReasons["NAV_RESIDUE"] ?? 0;

  let buildStatus: string;
  let trustRating: string;
  let autoBuildQuality: "STRONG" | "PROVISIONAL" | "MODERATE" | "WEAK" | "FAILED" | "RECOVERED";

  if (finalPromoted >= 3 && mainEntityDocSupport >= 2 && !recoveryTriggered) {
    buildStatus = "summarized"; trustRating = "STRONG BUILD"; autoBuildQuality = "STRONG";
  } else if (finalPromoted === 2 && !recoveryTriggered) {
    buildStatus = "graphed"; trustRating = "PROVISIONAL BUILD"; autoBuildQuality = "PROVISIONAL";
  } else if (recoveryTriggered && finalPromoted >= 2) {
    buildStatus = "graphed"; trustRating = "RECOVERED BUILD"; autoBuildQuality = "RECOVERED";
  } else if (finalPromoted >= 1 && usableDocCount >= 2) {
    buildStatus = "graphed"; trustRating = "WEAK BUILD"; autoBuildQuality = "WEAK";
  } else if (totalDetected > 0 && usableDocCount >= 1) {
    buildStatus = "analyzed"; trustRating = "DEGRADED BUILD"; autoBuildQuality = "WEAK";
  } else if (usableDocCount > 0) {
    buildStatus = "ingested"; trustRating = "LOW CONFIDENCE"; autoBuildQuality = "WEAK";
  } else {
    buildStatus = "failed"; trustRating = "EMPTY CASE"; autoBuildQuality = "FAILED";
  }

  // ── Generate NEXT QUERIES based on promoted entities + seed intent ─────────
  const nextQueryBase = promotedEntityNames.slice(0, 3);
  const intentSuffixes: Record<SeedIntent, string[]> = {
    housing_homelessness: ["shelter contracts", "housing funding", "program accountability"],
    finance_funding:      ["contracts", "budget allocation", "grant award"],
    education_university: ["contracts", "funding audit", "grant"],
    crime_corruption:     ["investigation", "indictment", "fraud charges"],
    legal_lawsuit:        ["lawsuit", "court filing", "settlement"],
    entertainment_film:   ["tax credit", "film incentive", "production deal"],
    policy_government:    ["contracts", "oversight audit", "program funding"],
    sports:               ["contract", "investigation", "finance"],
    general:              ["contracts", "audit", "grant"],
  };
  const suffixes = intentSuffixes[seedIntent] ?? intentSuffixes.general;
  const nextQueryLines = nextQueryBase.length > 0
    ? nextQueryBase.flatMap(name => suffixes.map(s => `${name} ${s}`)).slice(0, 6)
    : suffixes.map(s => `${target} ${s}`).slice(0, 6);

  // ── Case Brief Generator 2.0 — structured investigative summary ───────────
  const admittedTotal = totalDetected; // mentions that passed admission firewall
  const rejectedTotal = pipelineRejectedTotal;

  // Collect promoted entity details for brief
  const promotedEntries = Array.from(entityMap.entries())
    .filter(([k]) => approvedEntityIds.has(k))
    .map(([, e]) => e);
  const primaryActors = promotedEntries
    .filter(e => e.type === "person" || e.bestRole === "OFFICIAL" || e.bestRole === "DEFENDANT")
    .map(e => e.displayName).slice(0, 4);
  const primaryInstitutions = promotedEntries
    .filter(e => e.type === "organization" || e.type === "government_agency" ||
      e.bestRole === "GOVERNMENT_AGENCY" || e.bestRole === "COMMITTEE" ||
      e.bestRole === "PROGRAM" || e.bestRole === "FACILITY")
    .map(e => e.displayName).slice(0, 4);

  const intentAngle: Record<SeedIntent, string> = {
    housing_homelessness: "Possible mismanagement, fraud, or accountability gaps in homelessness/shelter funding programs",
    crime_corruption:     "Potential corruption, fraud, bribery, or official misconduct",
    legal_lawsuit:        "Active or pending legal proceedings, settlements, or judicial actions",
    education_university: "Governance, funding, or accountability issues in academic institutions",
    finance_funding:      "Irregular or questionable financial flows, contracts, or grant awards",
    entertainment_film:   "Film financing structures, tax credit claims, or studio funding deals",
    policy_government:    "Policy implementation gaps, program accountability, or government oversight failures",
    sports:               "Contractual, financial, or investigative matters related to sports",
    general:              "Multi-domain investigative signals — manual review recommended to narrow scope",
  };

  const sourceWord = (n: number) => `${n} source${n !== 1 ? "s" : ""}`;

  let briefText: string;
  if (finalPromoted >= 2 && autoBuildQuality !== "FAILED") {
    const actorLine = primaryActors.length > 0
      ? `PRIMARY ACTORS: ${primaryActors.join(", ")}.`
      : "";
    const instLine = primaryInstitutions.length > 0
      ? `PRIMARY INSTITUTIONS: ${primaryInstitutions.join(", ")}.`
      : "";
    const signalLine = priorityADocs > 0
      ? `DOCUMENT SIGNALS: ${priorityADocs} high-priority and ${priorityBDocs} supporting sources identified.`
      : `DOCUMENT SIGNALS: ${priorityBDocs} supporting sources identified.`;
    const angleLine = `LIKELY ANGLE: ${intentAngle[seedIntent]}`;
    const qualityNote = autoBuildQuality === "STRONG"
      ? "ATLAS assembled a viable starter investigation graph from high-confidence aligned sources."
      : autoBuildQuality === "PROVISIONAL"
      ? "PROVISIONAL BUILD — two entities promoted. Additional sourcing recommended before drawing firm conclusions. Review held candidates in triage."
      : autoBuildQuality === "RECOVERED"
      ? `Build recovered via expanded search (${recoveryDocCount} additional sources). Graph quality is provisional — manual review of held entities strongly recommended. ${highContaminationDocs > 0 ? `${highContaminationDocs} high-contamination doc(s) restricted to lead-only extraction.` : ""}`
      : "Auto-build completed. Manual review of held candidates recommended to strengthen the graph.";
    briefText = [
      `WHAT: Seed investigation into "${target}" [${seedIntent.replace(/_/g, " ").toUpperCase()}].`,
      actorLine, instLine, signalLine, angleLine, qualityNote,
    ].filter(Boolean).join(" ");
  } else if (recoveryTriggered && finalPromoted >= 1) {
    briefText = `RECOVERED BUILD — Initial extraction was weak (starter_promoted=${starterPromoted}). Recovery expanded to ${ingestedDocIds.length} docs total and promoted ${finalPromoted} entity. Manual review of held candidates strongly recommended.`;
  } else if (totalDetected > 0) {
    const contamNote = highContaminationDocs > 0 ? ` Note: ${highContaminationDocs} high-contamination doc(s) restricted to lead-only extraction.` : "";
    briefText = `Auto-build completed, but entity confidence remains weak. Manual narrowing recommended. ${totalDetected} entity signals detected from ${sourceWord(usableDocCount)} usable sources — none met auto-promotion thresholds. Use the triage queue to manually approve candidates.${contamNote}`;
  } else if (usableDocCount > 0) {
    briefText = `ATLAS ingested ${sourceWord(usableDocCount)} sources but extracted no entity signals. Documents may be paywalled or content-light. Add sources manually via Web Ingest.`;
  } else {
    briefText = `BUILD FAILED — ATLAS found ${searchResultsTotal} results but all ${docsIngested} ingested sources were blocked or JS-rendered. No usable article text was recovered. Add sources manually via Web Ingest.`;
  }

  // Encode rejection reasons for the ATLAS-SEED block
  const rejectReasonStr = Object.entries(pipelineRejectReasons)
    .map(([r, n]) => `${r}:${n}`).join(",");

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
    `high_contam=${highContaminationDocs}`,
    `priority_a=${priorityADocs}`,
    `priority_b=${priorityBDocs}`,
    `detected=${totalDetected}`,
    `admitted=${admittedTotal}`,
    `rejected_fw=${rejectedTotal}`,
    `reject_reasons=${encodeURIComponent(rejectReasonStr)}`,
    `promoted=${finalPromoted}`,
    `promoted_confirmed=${promotedConfirmedCount}`,
    `promoted_strong=${promotedStrongCount}`,
    `held_candidates=${heldCandidates}`,
    `suppressed_noise=${suppressedNoise}`,
    `promotion_candidates=${promotionCandidates}`,
    `artifact_rejected=${artifactRejectedMentions}`,
    `shape_rejected=${shapeRejectedMentions}`,
    `nav_rejected=${navRejectedMentions}`,
    `main_entity_doc_support=${mainEntityDocSupport}`,
    `seed_intent=${seedIntent}`,
    `fallback=${isFallback ? 1 : 0}`,
    `recovery_triggered=${recoveryTriggered ? 1 : 0}`,
    `recovery_reason=${encodeURIComponent(recoveryReason)}`,
    `starter_promoted=${starterPromoted}`,
    `final_promoted=${finalPromoted}`,
    `recovery_docs=${recoveryDocCount}`,
    `build_status=${buildStatus}`,
    `auto_build_quality=${autoBuildQuality}`,
    `trust=${encodeURIComponent(trustRating)}`,
    `anchor_core_docs=${coreTierDocCount}`,
    `anchor_relevant_docs=${relevantTierDocCount}`,
    `strong_relationships=${strongRelationshipCount}`,
    `graph_failure=${graphFailureReason ?? "none"}`,
    `next_queries=${encodeURIComponent(nextQueryLines.join("||"))}`,
  ].join("|");

  const description = `${briefText}\n\n[ATLAS-SEED:${seedTag}]`;

  await db
    .update(casesTable)
    .set({ description, updatedAt: new Date() })
    .where(eq(casesTable.id, caseId));

  await logEvent(
    "build_quality_assigned",
    `Build quality: ${autoBuildQuality} (${trustRating}) — ${finalPromoted} promoted, ${usableDocCount} usable docs, mainEntityDocSupport=${mainEntityDocSupport}`,
    { caseId }
  );

  // ── Store autoGraphQuality in DB (Pass 28 — T003) ─────────────────────────
  await db.update(casesTable)
    .set({ autoGraphQuality: autoBuildQuality })
    .where(eq(casesTable.id, caseId));

  await logEvent(
    "seed_complete",
    `Seed pipeline complete — ${searchResultsTotal} results → ${docsIngested} ingested → ${validDocsIngested} usable → ${totalDetected} detected → ${entitiesApproved} promoted`,
    { caseId }
  );

  // ── Auto-compile dossier after seed pipeline (Pass 28 — T004) ─────────────
  try {
    await compileCaseBrief(caseId);
    await logEvent("case_compiled", `Dossier auto-compiled post-seed (quality: ${autoBuildQuality})`, { caseId });
  } catch (compileErr) {
    console.error("[ATLAS SEED] Auto-compile failed:", compileErr);
  }
}

export default router;
