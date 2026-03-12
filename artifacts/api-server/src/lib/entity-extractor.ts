import nlp from "compromise";
import fs from "fs";
import path from "path";

export interface ExtractedMention {
  entityName: string;
  entityType: string;
  confidence: number;
  context: string;
  startPos: number;
  endPos: number;
}

// ── Investigative entity classification ───────────────────────────────────────

const ORG_SUFFIXES = [
  "Hotel",
  "Hotels",
  "Authority",
  "Department",
  "Dept",
  "Office",
  "Program",
  "Shelter",
  "Shelters",
  "Housing",
  "Commission",
  "Committee",
  "Bureau",
  "Foundation",
  "Agency",
  "Services",
  "Institute",
  "Center",
  "Corporation",
  "Group",
  "Inc",
  "LLC",
  "Corp",
  "Associates",
  "Coalition",
  "Initiative",
  "Council",
  "Task Force",
  "Partnership",
  "Network",
  "Alliance",
  "Collaborative",
  "Project",
];

const ORG_PREFIXES = [
  "Project",
  "Operation",
  "Program",
];

const GOV_PATTERNS: { pattern: RegExp; type: string; confidence: number }[] = [
  { pattern: /\b(Department of [A-Z][a-zA-Z\s]{2,40}?)(?=[,.\n]|\s+(?:said|has|will|is|was|are|announced))/g, type: "government_agency", confidence: 0.82 },
  { pattern: /\b(Office of [A-Z][a-zA-Z\s]{2,40}?)(?=[,.\n]|\s+(?:said|has|will|is|was|are|announced))/g, type: "government_agency", confidence: 0.80 },
  { pattern: /\b(Bureau of [A-Z][a-zA-Z\s]{2,40}?)(?=[,.\n]|\s+(?:said|has|will|is|was|are|announced))/g, type: "government_agency", confidence: 0.80 },
  { pattern: /\b(City (?:of|Administrative) [A-Z][a-zA-Z\s]{2,30}?)(?=[,.\n]|\s+(?:said|has|will|is|was|are|announced))/g, type: "government_agency", confidence: 0.78 },
  { pattern: /\b(County of [A-Z][a-zA-Z\s]{2,30}?)(?=[,.\n]|\s+(?:said|has|will|is|was))/g, type: "government_agency", confidence: 0.78 },
  { pattern: /\b([A-Z]{2,7})\b/g, type: "government_agency", confidence: 0.52 },
];

// Build suffix-based org detector regex — each word must start with a capital letter
// to avoid greedily matching sentence fragments like "Los Angeles awarded Hotel"
const suffixPattern = new RegExp(
  `\\b([A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+){0,4}\\s+(?:${ORG_SUFFIXES.join("|")}))\\b`,
  "g"
);

// Build prefix-based org detector regex (e.g. "Project Homekey", "Operation X")
const prefixPattern = new RegExp(
  `\\b(?:${ORG_PREFIXES.join("|")})\\s+([A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+)?)\\b`,
  "g"
);

// Multi-word title case phrase (2-5 words, each capitalized, not sentence start)
// Captures things like "Highland Gardens Hotel", "Los Angeles", "John Smith"
const titleCasePhrase = /(?<!\.\s)(?<![A-Z])\b([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){1,4})\b/g;

function classifyTitleCasePhrase(name: string): { type: string; confidence: number } {
  const lower = name.toLowerCase();
  // Has an org suffix
  if (ORG_SUFFIXES.some((s) => lower.endsWith(s.toLowerCase()))) {
    return { type: "organization", confidence: 0.78 };
  }
  // Has a prefix keyword
  if (ORG_PREFIXES.some((p) => lower.startsWith(p.toLowerCase()))) {
    return { type: "organization", confidence: 0.75 };
  }
  // Looks like a full name (FirstName LastName pattern)
  const words = name.split(" ");
  if (words.length === 2 && words.every((w) => /^[A-Z][a-z]+$/.test(w))) {
    return { type: "person", confidence: 0.65 };
  }
  if (words.length === 3 && words.every((w) => /^[A-Z][a-z]+$/.test(w))) {
    return { type: "person", confidence: 0.60 };
  }
  // Multi-word proper noun — could be location or org
  if (words.length >= 2) {
    return { type: "organization", confidence: 0.58 };
  }
  return { type: "organization", confidence: 0.50 };
}

// Noise filter — skip these common false positives
const SKIP_NAMES = new Set([
  "The", "This", "That", "These", "Those", "There",
  "Their", "They", "When", "Where", "Which", "While",
  "With", "From", "Into", "Upon", "After", "Before",
  "About", "Under", "Over", "Also", "More", "Just",
  "Have", "Been", "Said", "Says", "Will", "Were",
  "More", "Some", "Many", "Most", "Such", "Each",
  "Both", "Home", "City", "State", "County", "Street",
  "Avenue", "Road", "North", "South", "East", "West",
  "Los", "San", "New", "Old", "First", "Last", "High",
  "Good", "Long", "Big", "Small", "Large", "Little",
  // Generic nouns that are never investigative subjects on their own
  "Members", "Officials", "Residents", "Voters", "Taxpayers",
  "People", "Staff", "Team", "Board", "Panel", "Group",
  "Leader", "Director", "Manager", "Officer", "Official",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "June", "July",
  "August", "September", "October", "November", "December",
  "Today", "Yesterday", "Tomorrow", "Week", "Month", "Year",
  "Update", "Report", "Story", "Article", "Column",
  "News", "Press", "Post", "Times", "Journal",
  "Click", "Watch", "Read", "Listen", "Share",
]);

// Media/aggregator entities that are sources, not investigative subjects
// (also includes wrapper-page injection artifacts from WRAPPER_ENTITY_BLOCKLIST)
const MEDIA_SOURCE_BLOCKLIST = new Set([
  "Google News", "Google", "Google LLC", "Google Search", "News Google",
  "Associated Press", "The Associated Press", "AP", "Reuters", "Bloomberg",
  "Yahoo News", "Yahoo Finance", "Yahoo",
  // Wire / PR services
  "PRNewswire", "PR Newswire", "Business Wire", "BusinessWire", "Newswire",
  "GlobeNewswire", "Globe Newswire", "PR Newswire Association",
  // Wrapper / junk page artifacts
  "JavaScript", "Sign In", "Log In", "Subscribe", "Continue", "Accept",
  "Enable JavaScript", "Cookie", "Cookies", "Privacy Policy",
  "Terms of Service", "More", "Share", "Close", "Skip",
  "Loading", "Please Wait", "Redirect", "Follow",
  "Breaking News", "Editors Note", "Editor's Note", "Advertisement",
  "Sponsored Content", "Paid Post", "Advertorial", "In Partnership",
  "MSN", "MSN News", "Bing News", "Bing",
  "Apple News", "Apple",
  "Facebook", "Twitter", "Instagram", "YouTube", "TikTok", "LinkedIn",
  "Wikipedia", "Wikimedia",
  "Dow Jones", "Hearst", "Gannett", "McClatchy",
  // Generic content fragments
  "Read More", "Full Story", "Click Here", "Learn More", "See More",
  "Related Articles", "Latest News", "Top Stories", "More Stories",
  // Press release noise
  "Contact Information", "Media Contact", "Investor Relations",
  "Forward Looking", "Safe Harbor", "About Us", "Our Mission",
  "Copyright", "All Rights Reserved", "Terms", "Privacy",
  "Question Period", "Power Play", "Every Press", "Press Release",
  "For Immediate Release", "Media Inquiries",
  // Social/UI fragments
  "Sign Up", "Log Out", "Get Started", "Get App", "Download",
  "Newsletter", "Email Alert", "Push Notification",
  "Comments", "Comment Section", "Reply", "Replies",
  // Sports noise (generic)
  "Game Day", "Box Score", "Play By Play", "Play-By-Play",
  "Injury Report", "Practice Report", "Post Game", "Pre Game",
  // Generic standalone things that sneak through NLP
  "National Security", "Public Safety", "Community Development",
  "Economic Development", "Strategic Plan", "Master Plan",
  "Best Practices", "Case Study", "White Paper",
]);

// Sports / entertainment noise that should not surface in investigative cases
const SPORTS_ENTERTAINMENT_BLOCKLIST = new Set([
  // Sports leagues / governing bodies
  "NFL", "NBA", "MLB", "NHL", "FIFA", "UEFA", "MLS", "PGA", "UFC",
  "ESPN", "Fox Sports", "NBC Sports", "CBS Sports", "TNT Sports",
  // Generic sports noise
  "Super Bowl", "World Series", "NBA Finals", "Stanley Cup", "Champions League",
  "Playoffs", "Draft", "Trade Deadline", "Free Agency", "Hall of Fame",
  // Entertainment industry
  "Grammy", "Oscar", "Emmy", "Tony", "Box Office", "Billboard",
  "Hollywood", "Variety", "TMZ", "People Magazine", "Entertainment Weekly",
]);

// Terms that indicate the text is about sports/entertainment rather than investigation
const SPORTS_CONTEXT_PATTERN = /\b(quarterback|touchdown|home run|three-pointer|field goal|penalty kick|slam dunk|grand slam|hat trick|free throw|overtime|halftime|roster|draft pick|season record|championship ring|playoff run|trade deadline|salary cap|front office|head coach|general manager as sports|batting average|earned run|yards per game)\b/i;

// Terms that indicate strong investigative relevance — boost entities found near these
const INVESTIGATIVE_CONTEXT_PATTERN = /\b(contract|procurement|corruption|fraud|bribery|kickback|embezzlement|investigation|audit|misconduct|indictment|plea|conviction|settlement|fine|penalty|lobbying|donation|campaign finance|oversight|accountability|subpoena|whistleblower|grant|appropriation|budget|housing|shelter|homeless|development|rezoning|permit|violation|lawsuit|regulatory|compliance|conflict of interest|no.bid|sole.source|shell company|offshore|wire transfer|money laundering)\b/i;

// Returns true if the entity's context is predominantly sports/entertainment noise
function isSportsEntertainmentContext(context: string): boolean {
  const sportsMatches = (context.match(SPORTS_CONTEXT_PATTERN) || []).length;
  const investigativeMatches = (context.match(INVESTIGATIVE_CONTEXT_PATTERN) || []).length;
  return sportsMatches > 0 && investigativeMatches === 0;
}

// Boost factor for entities found near strong investigative terms
function getInvestigativeBoost(context: string): number {
  const matches = (context.match(INVESTIGATIVE_CONTEXT_PATTERN) || []).length;
  if (matches >= 3) return 0.10;
  if (matches >= 1) return 0.05;
  return 0;
}

function isValidName(name: string): boolean {
  if (!name || name.length < 3 || name.length > 80) return false;
  const words = name.trim().split(/\s+/);
  // Single-word names with only 1 word and it's in the skip list
  if (words.length === 1 && SKIP_NAMES.has(words[0])) return false;
  // Must have at least one letter
  if (!/[a-zA-Z]/.test(name)) return false;
  // Block media aggregator false positives
  if (MEDIA_SOURCE_BLOCKLIST.has(name)) return false;
  // Block sports/entertainment noise
  if (SPORTS_ENTERTAINMENT_BLOCKLIST.has(name)) return false;
  return true;
}

// Map compromise tags to our entity types
function mapTagToType(tag: string): string {
  const mapping: Record<string, string> = {
    Person: "person",
    Organization: "organization",
    Place: "location",
    Acronym: "government_agency",
    Government: "government_agency",
  };
  return mapping[tag] || "organization";
}

// Extract plain text from a file — supports PDF and plain text
export async function extractTextFromFile(filePath: string): Promise<string> {
  const absPath = path.resolve(filePath.replace(/^\/uploads\//, "./uploads/"));

  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  const ext = path.extname(absPath).toLowerCase();

  if (ext === ".pdf") {
    try {
      // pdf-parse v2 API: new PDFParse({ data: buffer }).getText()
      const { PDFParse } = await import("pdf-parse");
      const buffer = fs.readFileSync(absPath);
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return result.text || "";
    } catch (err) {
      console.warn("PDF parse error:", err);
      return "";
    }
  }

  if ([".txt", ".md", ".csv"].includes(ext)) {
    return fs.readFileSync(absPath, "utf-8");
  }

  try {
    return fs.readFileSync(absPath, "utf-8");
  } catch {
    return "";
  }
}

// Run NER on text using compromise.js + rule-based augmentation
export function extractEntities(text: string): ExtractedMention[] {
  if (!text || text.trim().length < 10) return [];

  const mentions: ExtractedMention[] = [];
  const seen = new Set<string>();

  function addMention(
    entityName: string,
    entityType: string,
    confidence: number,
    matchIndex?: number
  ) {
    const name = entityName.trim();
    if (!isValidName(name)) return;
    if (seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    const ctx = getContext(text, name, matchIndex);

    // Apply investigative boost: entities near strong investigative signals get higher confidence
    const boost = getInvestigativeBoost(ctx);
    let adjustedConf = Math.min(0.99, confidence + boost);

    // Penalize entities found in sports/entertainment-heavy context with no investigative signal
    if (isSportsEntertainmentContext(ctx)) {
      adjustedConf = adjustedConf * 0.55; // heavy penalty — sink them below promotion thresholds
    }

    mentions.push({
      entityName: name,
      entityType,
      confidence: adjustedConf,
      context: ctx,
      startPos: matchIndex ?? text.indexOf(name),
      endPos: (matchIndex ?? text.indexOf(name)) + name.length,
    });
  }

  // ── Pass 1: compromise NLP ──
  const doc = nlp(text);

  doc.people().forEach((person: ReturnType<typeof nlp>) => {
    const name = person.text().trim();
    addMention(name, "person", 0.82);
  });

  doc.organizations().forEach((org: ReturnType<typeof nlp>) => {
    const name = org.text().trim();
    addMention(name, "organization", 0.74);
  });

  doc.places().forEach((place: ReturnType<typeof nlp>) => {
    const name = place.text().trim();
    addMention(name, "location", 0.70);
  });

  // ── Pass 2: government/agency patterns ──
  for (const { pattern, type, confidence } of GOV_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      const isAcronym = /^[A-Z]{2,7}$/.test(name);
      // Skip very short or ambiguous acronyms unless likely investigative
      if (isAcronym && name.length < 3) continue;
      const actualConf = isAcronym ? Math.min(confidence, 0.56) : confidence;
      addMention(name, type, actualConf, match.index);
    }
  }

  // ── Pass 3: org suffix detection ──
  suffixPattern.lastIndex = 0;
  {
    let match;
    while ((match = suffixPattern.exec(text)) !== null) {
      const name = match[1].trim();
      addMention(name, "organization", 0.80, match.index);
    }
  }

  // ── Pass 4: prefix-based orgs (Project X, Operation Y) ──
  prefixPattern.lastIndex = 0;
  {
    let match;
    while ((match = prefixPattern.exec(text)) !== null) {
      const fullMatch = match[0].trim();
      addMention(fullMatch, "organization", 0.76, match.index);
    }
  }

  // ── Pass 5: title-case multi-word phrases ──
  titleCasePhrase.lastIndex = 0;
  {
    let match;
    while ((match = titleCasePhrase.exec(text)) !== null) {
      const name = match[1].trim();
      if (seen.has(name.toLowerCase())) continue;
      const words = name.split(" ");
      if (words.length < 2) continue; // skip single words
      const { type, confidence } = classifyTitleCasePhrase(name);
      if (confidence < 0.55) continue; // skip low-confidence unknowns
      addMention(name, type, confidence, match.index);
    }
  }

  // Deduplicate and sort by confidence
  return mentions
    .filter((m, i, arr) => arr.findIndex((x) => x.entityName === m.entityName) === i)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 60);
}

function getContext(text: string, name: string, idx?: number): string {
  const pos = idx !== undefined ? idx : text.indexOf(name);
  if (pos === -1) return name;
  const start = Math.max(0, pos - 90);
  const end = Math.min(text.length, pos + name.length + 90);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

// ── Timeline Event Extraction ─────────────────────────────────────────────────

export interface ExtractedTimelineEvent {
  eventDate: string;
  eventType: string;
  summary: string;
}

const EVENT_TYPE_PATTERNS: { regex: RegExp; type: string }[] = [
  { regex: /\b(?:launched?|opening|opened|created|founded|established|started|began|initiated)\b/i, type: "PROGRAM_LAUNCH" },
  { regex: /\b(?:contract\s+(?:awarded?|signed?|approved?|won)|awarded?\s+(?:a\s+)?contract)\b/i, type: "CONTRACT_AWARDED" },
  { regex: /\b(?:fund(?:ing|ed)\s+(?:approved?|granted?|allocated?|received?)|approved?\s+(?:funding|budget))\b/i, type: "FUNDING_APPROVED" },
  { regex: /\b(?:investigat(?:ed?|ing|ion)|probe(?:d|s)?|investigat(?:ing|ion)\s+(?:started?|opened?|launched?))\b/i, type: "INVESTIGATION_STARTED" },
  { regex: /\b(?:audit(?:ed?|ing|s)?|auditor(?:s)?|audit\s+(?:found?|showed?|revealed?))\b/i, type: "AUDIT" },
  { regex: /\b(?:lawsuit|litigation|sued?|complaint\s+filed?|legal\s+action|court\s+(?:ruling|order|decision))\b/i, type: "LEGAL_ACTION" },
  { regex: /\b(?:expand(?:ed?|ing|s)|expansion|program\s+expan(?:d|sion))\b/i, type: "PROGRAM_EXPANSION" },
  { regex: /\b(?:purchased?|acqui(?:red?|sition)|bought|property\s+(?:deal|sale|transaction))\b/i, type: "PROPERTY_ACQUISITION" },
  { regex: /\b(?:polic(?:y|ies)\s+(?:change|changed?|updated?|new|reform)|reform(?:ed?|s)?)\b/i, type: "POLICY_CHANGE" },
];

const DATE_PATTERNS = [
  // Full dates: March 11, 2021 / March 11 / 11 March 2021
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?/gi,
  // Month abbrevs: Jan 5, 2022
  /\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:,?\s+\d{4})?/gi,
  // In YEAR: "In 2022" / "by 2023" / "since 2019"
  /\b(?:in|by|since|after|before|during|throughout|from|as\s+of)\s+(?:20|19)\d{2}\b/gi,
  // Standalone year: "2021" or "(2021)"
  /\b(?:20|19)\d{2}\b/g,
];

function extractDateFromSentence(sentence: string): string | null {
  for (const pat of DATE_PATTERNS) {
    pat.lastIndex = 0;
    const m = pat.exec(sentence);
    if (m) {
      const raw = m[0].trim();
      // Normalize to a sortable string; prefer year-only as fallback
      try {
        const d = new Date(raw.replace(/^(?:in|by|since|after|before|during|from|as of)\s+/i, ""));
        if (!isNaN(d.getTime())) return d.toISOString();
      } catch { /* continue */ }
      // If it's just a year, synthesize Jan 1
      const yearMatch = /\b((?:20|19)\d{2})\b/.exec(raw);
      if (yearMatch) return `${yearMatch[1]}-01-01T00:00:00.000Z`;
      return null;
    }
  }
  return null;
}

function classifyEventType(sentence: string): string {
  for (const { regex, type } of EVENT_TYPE_PATTERNS) {
    if (regex.test(sentence)) return type;
  }
  return "EVENT";
}

export function extractTimelineEvents(text: string): ExtractedTimelineEvent[] {
  if (!text || text.trim().length < 20) return [];

  const events: ExtractedTimelineEvent[] = [];
  const seen = new Set<string>();

  // Split into sentences
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim().length > 20);

  for (const sentence of sentences) {
    const dateStr = extractDateFromSentence(sentence);
    if (!dateStr) continue;

    const eventType = classifyEventType(sentence);

    // Create a clean summary (truncate long sentences)
    const summary = sentence.trim().replace(/\s+/g, " ").slice(0, 200);
    const key = `${dateStr.slice(0, 10)}-${summary.slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    events.push({ eventDate: dateStr, eventType, summary });
    if (events.length >= 15) break; // Cap per document
  }

  return events;
}

// ── Financial Signal Extraction ───────────────────────────────────────────────

export interface ExtractedFinancialSignal {
  amountRaw: string;
  amountDisplay: string;
  normalizedAmount: number | null;
  currency: string;
  signalType: string;
  eventSummary: string;
  entityName: string | null;
}

// Robust money pattern — matches:
//   $2 billion  $1.3B  $400 million  $75M  $250,000  USD 2 billion  £500,000
// Groups: (1) currency symbol/word, (2) number, (3) scale word/letter
const MONEY_PATTERN = /(?:(USD|US\$|\$|£|€|GBP|EUR)\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(billion|million|thousand|trillion|bn|mn|tr|[BMKT])\b|(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(billion|million|thousand|trillion|bn|mn|tr|[BMK])\b(?:\s*(?:USD|US dollars?|dollars?))?|(USD|US\$|\$|£|€)\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?))/gi;

// Keywords that must appear near a financial figure for it to be considered a signal
// Deliberately excludes generic retail/consumer/ad-copy contexts
const FINANCIAL_PROXIMITY_PATTERN = /\b(funding|grant|budget|investment|contract|appropriation|allocation|spending|award(?:ed)?|program\s+fund|invest(?:ed|ment)|financed?|subsidized?|reimburse|settlement|procurement|invoice|payout|disburse|obligated?|encumbered?)\b/i;

// Patterns that indicate ad copy / retail / promo context — these REJECT a financial signal
const FINANCIAL_AD_COPY_PATTERN = /\b(sale|discount|off|coupon|promo|deal\s+of\s+the\s+day|limited\s+time|buy\s+now|add\s+to\s+cart|checkout|free\s+shipping|starting\s+at|as\s+low\s+as|per\s+month|subscription|plan|retail|price\s+drop|save\s+up\s+to|starting\s+from|season\s+pass|ticket\s+price|admission|box\s+office|gross(?:ing)?|earned|opening\s+weekend|revenue\s+for\s+(?:the\s+)?film|record\s+(?:breaking\s+)?box\s+office)\b/i;

// Sports contract fluff — reject unless query explicitly about sports finance
const FINANCIAL_SPORTS_PATTERN = /\b(signing\s+bonus|contract\s+extension\s+for|salary\s+cap\s+hit|years?\s+deal|year\s+contract|nfl|nba|mlb|nhl|mls)\b/i;

const SIGNAL_TYPE_PATTERNS: { regex: RegExp; type: string }[] = [
  { regex: /\b(?:contract(?:ed?|s)?|sole.source|no.bid)\b/i, type: "CONTRACT" },
  { regex: /\b(?:grant(?:ed?|s)?|subgrant)\b/i, type: "GRANT" },
  { regex: /\b(?:fund(?:ed?|ing|s)?|financed?)\b/i, type: "FUNDING" },
  { regex: /\b(?:appropriat(?:ed?|ion|ions)?|budget(?:ed?)?|allocated?|allocation)\b/i, type: "APPROPRIATION" },
  { regex: /\b(?:paid?|payment(?:s)?|pay(?:ing|s)?|reimburse)\b/i, type: "PAYMENT" },
  { regex: /\b(?:award(?:ed?|s)?|won)\b/i, type: "AWARD" },
  { regex: /\b(?:invest(?:ed?|ment|ing)|invested)\b/i, type: "INVESTMENT" },
];

// Parse the raw money match and return normalized value + display string
function normalizeAmount(raw: string): { amount: number | null; currency: string; display: string } {
  let currency = "USD";
  let currencySymbol = "$";
  if (/£|GBP/i.test(raw)) { currency = "GBP"; currencySymbol = "£"; }
  else if (/€|EUR/i.test(raw)) { currency = "EUR"; currencySymbol = "€"; }

  // Strip currency symbols/words and commas, keep digits and decimal
  const numericPart = raw.replace(/USD|US\$|GBP|EUR|[$£€,\s]/gi, "").toLowerCase();
  const scaleMatch = /\b(billion|million|thousand|trillion|bn|mn|tr|[bmkt])\b/i.exec(numericPart);
  const numStr = numericPart.replace(/(?:billion|million|thousand|trillion|bn|mn|tr|[bmkt])/gi, "").trim();
  const base = parseFloat(numStr);
  if (isNaN(base) || base <= 0) return { amount: null, currency, display: raw };

  let multiplier = 1;
  let scaleLabel = "";
  if (scaleMatch) {
    const s = scaleMatch[1].toLowerCase();
    if (s === "billion" || s === "bn" || s === "b") { multiplier = 1_000_000_000; scaleLabel = "B"; }
    else if (s === "million" || s === "mn" || s === "m") { multiplier = 1_000_000; scaleLabel = "M"; }
    else if (s === "thousand" || s === "k" || s === "t") { multiplier = 1_000; scaleLabel = "K"; }
    else if (s === "trillion" || s === "tr") { multiplier = 1_000_000_000_000; scaleLabel = "T"; }
  }

  const amount = Math.round(base * multiplier * 100) / 100;
  // Human display: "$2B" or "$250,000"
  const display = scaleLabel
    ? `${currencySymbol}${base}${scaleLabel}`
    : `${currencySymbol}${amount.toLocaleString()}`;

  return { amount, currency, display };
}

function getSignalType(context: string): string {
  for (const { regex, type } of SIGNAL_TYPE_PATTERNS) {
    if (regex.test(context)) return type;
  }
  return "FUNDING";
}

// ── Document Relevance Scoring ────────────────────────────────────────────────

const DOC_INVESTIGATIVE_TITLE_TERMS = [
  "contract", "contracts", "grant", "grants", "funding", "budget", "audit",
  "probe", "fraud", "corruption", "investigation", "lawsuit", "settlement",
  "allocation", "appropriation", "procurement", "spending", "shelter",
  "homeless", "homelessness", "housing", "nonprofit", "oversight",
  "records", "report", "subpoena", "misconduct", "indictment", "bribery",
  "kickback", "embezzlement", "ordinance", "whistleblower", "accountability",
  "invoice", "payments", "program", "department", "agency", "federal",
  "county", "state", "city", "municipal", "commission",
];

const DOC_PENALTY_TERMS = [
  "sports", "game", "coach", "player", "roster", "draft",
  "playoff", "tournament", "championship", "score", "standings",
  "celebrity", "entertainment", "box office", "red carpet",
  "recipe", "lifestyle", "shopping", "travel", "horoscope",
  "review", "restaurant", "fitness", "wellness", "beauty",
  "sponsored", "advertisement", "newsletter", "subscribe",
];

const DOC_PR_WIRE_TERMS = [
  "press release", "for immediate release", "media contact",
  "safe harbor", "forward-looking", "investor relations",
  "prnewswire", "businesswire", "globenewswire",
];

const DOC_QUALITY_DOMAINS = [
  "latimes.com", "nytimes.com", "washingtonpost.com", "propublica.org",
  ".gov", ".ca.gov", "apnews.com", "reuters.com",
  "nbcnews.com", "cbsnews.com", "abcnews.go.com",
  "theatlantic.com", "politico.com", "theintercept.com",
  "documentcloud.org", "courtlistener.com", "pacer.gov",
  "calmatters.org", "laist.com", "kpcc.org", "kcrw.com",
  "voiceofsandiego.org", "sfchronicle.com", "sacbee.com",
  "inspector", "audit", "oversight",
];

export interface DocRelevanceResult {
  score: number;
  priority: "PRIORITY_A" | "PRIORITY_B" | "LOW_SIGNAL" | "NOISE";
  boosts: string[];
  penalties: string[];
}

/**
 * Score a document 0–100 for investigative relevance.
 * queryTerms should be the space-split words of the original seed target.
 */
export function computeDocRelevanceScore(
  bodyText: string,
  title: string,
  queryTerms: string[],
  sourceDomain = ""
): DocRelevanceResult {
  const boosts: string[] = [];
  const penalties: string[] = [];
  let score = 50; // start neutral

  const titleL = title.toLowerCase();
  const bodyL = bodyText.toLowerCase();
  const domainL = sourceDomain.toLowerCase();

  // ── Query term coverage ───────────────────────────────────────────────────
  const queryWords = queryTerms.map(w => w.toLowerCase()).filter(w => w.length > 2);
  let titleQueryHits = 0;
  let bodyQueryHits = 0;
  for (const w of queryWords) {
    if (titleL.includes(w)) { titleQueryHits++; score += 6; }
    else if (bodyL.includes(w)) { bodyQueryHits++; score += 1.5; }
  }
  if (titleQueryHits > 0) boosts.push(`title-query-${titleQueryHits}x`);
  if (queryWords.length >= 2 && titleQueryHits === queryWords.length) {
    score += 10; boosts.push("full-title-match");
  }

  // ── Investigative keyword density ─────────────────────────────────────────
  let titleInvHits = 0, bodyInvHits = 0;
  for (const term of DOC_INVESTIGATIVE_TITLE_TERMS) {
    if (titleL.includes(term)) { titleInvHits++; score += 3; }
    else if (bodyL.includes(term)) { bodyInvHits++; score += 0.8; }
  }
  if (titleInvHits >= 2) boosts.push(`strong-investigative-title`);
  if (bodyInvHits >= 5) { score += 5; boosts.push("high-inv-density"); }

  // ── Body quality ─────────────────────────────────────────────────────────
  const bodyLen = bodyText.length;
  if (bodyLen >= 1500) { score += 6; boosts.push("long-body"); }
  else if (bodyLen >= 500) { score += 3; boosts.push("medium-body"); }
  else if (bodyLen < 100) { score -= 15; penalties.push("near-empty-body"); }
  else if (bodyLen < 200) { score -= 8; penalties.push("short-body"); }

  // ── Domain quality ────────────────────────────────────────────────────────
  if (domainL) {
    let qualityHit = false;
    for (const d of DOC_QUALITY_DOMAINS) {
      if (domainL.includes(d)) { qualityHit = true; break; }
    }
    if (qualityHit) { score += 8; boosts.push("quality-domain"); }
  }

  // ── PR wire / press release penalty ──────────────────────────────────────
  let prWireHits = 0;
  for (const t of DOC_PR_WIRE_TERMS) {
    if (bodyL.includes(t) || titleL.includes(t)) prWireHits++;
  }
  if (prWireHits >= 2) { score -= 18; penalties.push("pr-wire"); }
  else if (prWireHits === 1) { score -= 8; penalties.push("pr-wire-partial"); }

  // ── Sports / entertainment / fluff penalties ──────────────────────────────
  let penaltyHits = 0;
  for (const t of DOC_PENALTY_TERMS) {
    if (titleL.includes(t)) { score -= 5; penaltyHits++; }
    else if (bodyL.includes(t)) { score -= 1.5; penaltyHits++; }
  }
  if (penaltyHits >= 3) { score -= 8; penalties.push(`fluff-${penaltyHits}x`); }

  // ── Clamp and bucket ─────────────────────────────────────────────────────
  const finalScore = Math.round(Math.max(0, Math.min(100, score)));
  let priority: DocRelevanceResult["priority"];
  if (finalScore >= 65) priority = "PRIORITY_A";
  else if (finalScore >= 40) priority = "PRIORITY_B";
  else if (finalScore >= 18) priority = "LOW_SIGNAL";
  else priority = "NOISE";

  return { score: finalScore, priority, boosts, penalties };
}

// ── Entity Name Normalization ─────────────────────────────────────────────────

// Common org suffix variants to strip for canonical comparison
const ORG_SUFFIX_CLEANUP = [
  /\s*,?\s*Inc\.?$/i, /\s*,?\s*LLC\.?$/i, /\s*,?\s*Corp\.?$/i,
  /\s*,?\s*Co\.?$/i, /\s*,?\s*Ltd\.?$/i, /\s*,?\s*L\.L\.C\.?$/i,
  /\s*,?\s*Incorporated$/i, /\s*,?\s*Corporation$/i, /\s*,?\s*Limited$/i,
];

// Articles to strip from the start
const LEADING_ARTICLE = /^(?:The|A|An)\s+/i;

/**
 * Return a normalized canonical form of an entity name for dedup / merge.
 * Does NOT change the display name — only used for comparison keys.
 */
export function normalizeEntityName(name: string): string {
  let n = name.trim();
  // Strip possessives
  n = n.replace(/['']s\s*$/i, "").trim();
  // Strip leading articles
  n = n.replace(LEADING_ARTICLE, "");
  // Strip common org suffixes
  for (const rx of ORG_SUFFIX_CLEANUP) n = n.replace(rx, "");
  // Collapse internal whitespace
  n = n.replace(/\s+/g, " ").trim();
  return n.toLowerCase();
}

/**
 * Try to match a candidate name to one of the existing canonical names.
 * Returns the existing canonical display name if a match is found, else null.
 */
export function resolveToCanonical(
  candidate: string,
  existingNames: string[]
): string | null {
  const normCandidate = normalizeEntityName(candidate);
  for (const existing of existingNames) {
    const normExisting = normalizeEntityName(existing);
    // Exact match after normalization
    if (normCandidate === normExisting) return existing;
    // One contains the other (acronym expansion or suffix variant)
    if (normExisting.includes(normCandidate) || normCandidate.includes(normExisting)) {
      // Only merge if the shorter one is at least 4 chars (avoid "HCD" matching "CD")
      const shorter = normCandidate.length < normExisting.length ? normCandidate : normExisting;
      if (shorter.length >= 4) return existing;
    }
  }
  return null;
}

export function extractFinancialSignals(text: string): ExtractedFinancialSignal[] {
  if (!text || text.trim().length < 20) return [];

  const signals: ExtractedFinancialSignal[] = [];
  const seen = new Set<string>();
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim().length > 10);

  for (const sentence of sentences) {
    // Only emit signals when a financial keyword is nearby
    if (!FINANCIAL_PROXIMITY_PATTERN.test(sentence)) continue;
    // Reject ad copy / retail / promo contexts
    if (FINANCIAL_AD_COPY_PATTERN.test(sentence)) continue;
    // Reject sports contract fluff
    if (FINANCIAL_SPORTS_PATTERN.test(sentence)) continue;

    MONEY_PATTERN.lastIndex = 0;
    let match;
    while ((match = MONEY_PATTERN.exec(sentence)) !== null) {
      const amountRaw = match[0].trim();
      if (!amountRaw || amountRaw.length < 2) continue;

      const { amount, currency, display } = normalizeAmount(amountRaw);
      if (amount === null || amount < 1000) continue; // Skip trivial or unparseable amounts

      const dedupKey = display;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const signalType = getSignalType(sentence);
      const summary = sentence.trim().replace(/\s+/g, " ").slice(0, 250);

      // Find nearest proper noun in the sentence for entity linkage
      let entityName: string | null = null;
      const properNounMatch = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\b/.exec(sentence);
      if (properNounMatch) entityName = properNounMatch[1];

      signals.push({
        amountRaw,
        amountDisplay: display,
        normalizedAmount: amount,
        currency,
        signalType,
        eventSummary: summary,
        entityName,
      });
      if (signals.length >= 20) return signals;
    }
  }

  return signals;
}
