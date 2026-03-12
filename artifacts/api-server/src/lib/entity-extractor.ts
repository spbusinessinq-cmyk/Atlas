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
]);

// Media/aggregator entities that are sources, not investigative subjects
const MEDIA_SOURCE_BLOCKLIST = new Set([
  "Google News", "Google", "Google LLC",
  "Associated Press", "Reuters", "Bloomberg",
  "News Google", "Google Search",
  "Yahoo News", "Yahoo Finance", "Yahoo",
  "MSN", "MSN News", "Bing News", "Bing",
  "Apple News", "Apple",
  "Facebook", "Twitter", "Instagram", "YouTube",
  "Wikipedia", "Wikimedia",
  "The Associated Press",
  "Dow Jones", "Hearst",
]);

function isValidName(name: string): boolean {
  if (!name || name.length < 3 || name.length > 80) return false;
  const words = name.trim().split(/\s+/);
  // Single-word names with only 1 word and it's in the skip list
  if (words.length === 1 && SKIP_NAMES.has(words[0])) return false;
  // Must have at least one letter
  if (!/[a-zA-Z]/.test(name)) return false;
  // Block media aggregator false positives
  if (MEDIA_SOURCE_BLOCKLIST.has(name)) return false;
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
    mentions.push({
      entityName: name,
      entityType,
      confidence,
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
  normalizedAmount: number | null;
  currency: string;
  signalType: string;
  eventSummary: string;
  entityName: string | null;
}

const MONEY_PATTERN = /(?:(?:US\$|£|€|\$)\s*[\d,]+(?:\.\d+)?\s*(?:million|billion|trillion|thousand|M|B|K|mn|bn)?|[\d,]+(?:\.\d+)?\s*(?:million|billion|trillion|M|B|bn|mn)\s*(?:US\s*)?(?:dollar|pound|euro)?s?)/gi;

const SIGNAL_TYPE_PATTERNS: { regex: RegExp; type: string }[] = [
  { regex: /\b(?:contract(?:ed?|s)?|contracted?)\b/i, type: "CONTRACT" },
  { regex: /\b(?:grant(?:ed?|s)?|grants?)\b/i, type: "GRANT" },
  { regex: /\b(?:fund(?:ed?|ing|s)?|funded)\b/i, type: "FUNDING" },
  { regex: /\b(?:appropriat(?:ed?|ion|ions)?)\b/i, type: "APPROPRIATION" },
  { regex: /\b(?:paid?|payment(?:s)?|pay(?:ing|s)?)\b/i, type: "PAYMENT" },
  { regex: /\b(?:award(?:ed?|s)?|rewarded?)\b/i, type: "AWARD" },
  { regex: /\b(?:receiv(?:ed?|ing|s)?|received)\b/i, type: "PAYMENT" },
];

function normalizeAmount(raw: string): { amount: number | null; currency: string } {
  let currency = "USD";
  if (raw.includes("£")) currency = "GBP";
  if (raw.includes("€")) currency = "EUR";

  const cleaned = raw.replace(/[£€$,\s]/gi, "").toLowerCase();
  const numStr = cleaned.replace(/(?:million|billion|trillion|thousand|m|b|k|mn|bn|dollar|pound|euros?)/gi, "").trim();
  const base = parseFloat(numStr);
  if (isNaN(base)) return { amount: null, currency };

  let multiplier = 1;
  if (/billion|bn/i.test(raw)) multiplier = 1_000_000_000;
  else if (/million|mn|m\b/i.test(raw)) multiplier = 1_000_000;
  else if (/thousand|k\b/i.test(raw)) multiplier = 1_000;

  return { amount: Math.round(base * multiplier * 100) / 100, currency };
}

function getSignalType(context: string): string {
  for (const { regex, type } of SIGNAL_TYPE_PATTERNS) {
    if (regex.test(context)) return type;
  }
  return "FUNDING";
}

export function extractFinancialSignals(text: string): ExtractedFinancialSignal[] {
  if (!text || text.trim().length < 20) return [];

  const signals: ExtractedFinancialSignal[] = [];
  const seen = new Set<string>();
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim().length > 10);

  for (const sentence of sentences) {
    MONEY_PATTERN.lastIndex = 0;
    let match;
    while ((match = MONEY_PATTERN.exec(sentence)) !== null) {
      const amountRaw = match[0].trim();
      if (seen.has(amountRaw)) continue;
      seen.add(amountRaw);

      const { amount, currency } = normalizeAmount(amountRaw);
      if (amount !== null && amount < 1000) continue; // Skip trivial amounts

      const signalType = getSignalType(sentence);
      const summary = sentence.trim().replace(/\s+/g, " ").slice(0, 200);

      // Try to find a nearby proper noun (entity name)
      let entityName: string | null = null;
      const properNounMatch = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\b/.exec(sentence.slice(0, match.index + amountRaw.length));
      if (properNounMatch) entityName = properNounMatch[1];

      signals.push({ amountRaw, normalizedAmount: amount, currency, signalType, eventSummary: summary, entityName });
      if (signals.length >= 20) return signals;
    }
  }

  return signals;
}
