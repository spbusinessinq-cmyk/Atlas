import nlp from "compromise";
import fs from "fs";
import path from "path";

export type EntityRole =
  | "PERSON"
  | "ORGANIZATION"
  | "GOVERNMENT_AGENCY"
  | "COURT_JUDGE"
  | "COMMITTEE"
  | "ATTORNEY_COUNSEL"
  | "PROGRAM"
  | "FACILITY"
  | "DOCUMENT_FILING"
  | "VICTIM_WITNESS"
  | "DEFENDANT"
  | "OFFICIAL"
  | "UNKNOWN";

export type TopicRelevance = "HIGH" | "MEDIUM" | "LOW" | "OFF_TOPIC";
export type DocumentZone =
  | "title"
  | "dek"
  | "lead"
  | "body"
  | "tail"
  | "sidebar"
  | "footer"
  | "related"
  | "boilerplate"
  | "unknown";

export type AdmissionRejectReason =
  | "BLOCKLIST"
  | "COMMON_FIRST_NAME"
  | "TITLE_FRAGMENT"
  | "BOILERPLATE_CONTEXT"
  | "TOPIC_MISMATCH"
  | "LOW_CONFIDENCE"
  | "SHORT_FRAGMENT"
  | "ARTIFACT"           // merged-line artifact / stitched name
  | "ARTIFACT_ENTITY"    // fails entity shape validation (too long, quotes, colons, bad format)
  | "NAV_RESIDUE"        // navigation / share-rail residue
  | "CROSS_STORY"        // cross-story / unrelated-article bleed
  | "ZONE_REJECT"        // appeared only in rejected zone (sidebar/footer/related)
  | "WEAK_ZONE_SINGLE";  // serious intent + single doc + not in title/dek/lead

export interface ExtractedMention {
  entityName: string;
  entityType: string;
  confidence: number;
  context: string;
  startPos: number;
  endPos: number;
  role: EntityRole;
  roleConfidence: number;
  topicRelevance: TopicRelevance;
  zone: DocumentZone;
  admitted: boolean;
  rejectReason?: AdmissionRejectReason;
}

// ── Investigative entity classification ───────────────────────────────────────

const ORG_SUFFIXES = [
  "Hotel", "Hotels", "Authority", "Department", "Dept", "Office", "Program",
  "Shelter", "Shelters", "Housing", "Commission", "Committee", "Bureau",
  "Foundation", "Agency", "Services", "Institute", "Center", "Corporation",
  "Group", "Inc", "LLC", "Corp", "Associates", "Coalition", "Initiative",
  "Council", "Task Force", "Partnership", "Network", "Alliance", "Collaborative",
  "Project",
];

const ORG_PREFIXES = ["Project", "Operation", "Program"];

const GOV_PATTERNS: { pattern: RegExp; type: string; confidence: number }[] = [
  { pattern: /\b(Department of [A-Z][a-zA-Z\s]{2,40}?)(?=[,.\n]|\s+(?:said|has|will|is|was|are|announced))/g, type: "government_agency", confidence: 0.82 },
  { pattern: /\b(Office of [A-Z][a-zA-Z\s]{2,40}?)(?=[,.\n]|\s+(?:said|has|will|is|was|are|announced))/g, type: "government_agency", confidence: 0.80 },
  { pattern: /\b(Bureau of [A-Z][a-zA-Z\s]{2,40}?)(?=[,.\n]|\s+(?:said|has|will|is|was|are|announced))/g, type: "government_agency", confidence: 0.80 },
  { pattern: /\b(City (?:of|Administrative) [A-Z][a-zA-Z\s]{2,30}?)(?=[,.\n]|\s+(?:said|has|will|is|was|are|announced))/g, type: "government_agency", confidence: 0.78 },
  { pattern: /\b(County of [A-Z][a-zA-Z\s]{2,30}?)(?=[,.\n]|\s+(?:said|has|will|is|was))/g, type: "government_agency", confidence: 0.78 },
  { pattern: /\b([A-Z]{2,7})\b/g, type: "government_agency", confidence: 0.52 },
];

// Build suffix-based org detector regex
const suffixPattern = new RegExp(
  `\\b([A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+){0,4}\\s+(?:${ORG_SUFFIXES.join("|")}))\\b`,
  "g"
);

// Build prefix-based org detector regex
const prefixPattern = new RegExp(
  `\\b(?:${ORG_PREFIXES.join("|")})\\s+([A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+)?)\\b`,
  "g"
);

// Multi-word title case phrase (2-5 words)
const titleCasePhrase = /(?<!\.\s)(?<![A-Z])\b([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){1,4})\b/g;

function classifyTitleCasePhrase(name: string): { type: string; confidence: number } {
  const lower = name.toLowerCase();
  if (ORG_SUFFIXES.some((s) => lower.endsWith(s.toLowerCase()))) {
    return { type: "organization", confidence: 0.78 };
  }
  if (ORG_PREFIXES.some((p) => lower.startsWith(p.toLowerCase()))) {
    return { type: "organization", confidence: 0.75 };
  }
  const words = name.split(" ");
  if (words.length === 2 && words.every((w) => /^[A-Z][a-z]+$/.test(w))) {
    return { type: "person", confidence: 0.65 };
  }
  if (words.length === 3 && words.every((w) => /^[A-Z][a-z]+$/.test(w))) {
    return { type: "person", confidence: 0.60 };
  }
  if (words.length >= 2) {
    return { type: "organization", confidence: 0.58 };
  }
  return { type: "organization", confidence: 0.50 };
}

// ── Noise / blocklist sets ────────────────────────────────────────────────────

const SKIP_NAMES = new Set([
  "The", "This", "That", "These", "Those", "There", "Their", "They",
  "When", "Where", "Which", "While", "With", "From", "Into", "Upon",
  "After", "Before", "About", "Under", "Over", "Also", "More", "Just",
  "Have", "Been", "Said", "Says", "Will", "Were", "Some", "Many", "Most",
  "Such", "Each", "Both", "Home", "City", "State", "County", "Street",
  "Avenue", "Road", "North", "South", "East", "West", "Los", "San",
  "New", "Old", "First", "Last", "High", "Good", "Long", "Big", "Small",
  "Large", "Little", "Members", "Officials", "Residents", "Voters",
  "Taxpayers", "People", "Staff", "Team", "Board", "Panel", "Group",
  "Leader", "Director", "Manager", "Officer", "Official",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "June", "July",
  "August", "September", "October", "November", "December",
  "Today", "Yesterday", "Tomorrow", "Week", "Month", "Year",
  "Update", "Report", "Story", "Article", "Column",
  "News", "Press", "Post", "Times", "Journal",
  "Click", "Watch", "Read", "Listen", "Share",
  // Social / UI action words
  "Email", "Facebook", "Twitter", "WhatsApp", "Reddit", "LinkedIn",
  "Threads", "Instagram", "YouTube", "TikTok", "Pinterest", "Snapchat",
  "Subscribe", "Unsubscribe", "Follow", "Unfollow", "Donate", "Support",
  "Menu", "Search", "Login", "Logout", "Register", "Account",
  "Opinion", "Obituaries", "Weather", "Horoscope", "Crossword",
  "Newsletter", "Newsletters", "Watch Live", "Live Updates",
  "Copied", "Copied!", "Close", "Skip", "Continue", "Accept",
  "Top Stories", "Latest News", "Advertisement", "Sponsored",
  // Generic title fragments
  "President", "Governor", "Senator", "Mayor", "Secretary", "Chairman",
  "The Studio", "The Pitt", "The Network", "The Board", "The Panel",
]);

const MEDIA_SOURCE_BLOCKLIST = new Set([
  "Google News", "Google", "Google LLC", "Google Search", "News Google",
  "Associated Press", "The Associated Press", "AP", "Reuters", "Bloomberg",
  "Yahoo News", "Yahoo Finance", "Yahoo",
  "PRNewswire", "PR Newswire", "Business Wire", "BusinessWire", "Newswire",
  "GlobeNewswire", "Globe Newswire", "PR Newswire Association",
  "JavaScript", "Sign In", "Log In", "Subscribe", "Continue", "Accept",
  "Enable JavaScript", "Cookie", "Cookies", "Privacy Policy",
  "Terms of Service", "More", "Share", "Close", "Skip",
  "Loading", "Please Wait", "Redirect", "Follow",
  "Breaking News", "Editors Note", "Editor's Note", "Advertisement",
  "Sponsored Content", "Paid Post", "Advertorial", "In Partnership",
  "MSN", "MSN News", "Bing News", "Bing",
  "Apple News", "Apple",
  "Facebook", "Twitter", "Instagram", "YouTube", "TikTok", "LinkedIn",
  "WhatsApp", "Reddit", "Threads", "Pinterest", "Snapchat",
  "Wikipedia", "Wikimedia",
  "Dow Jones", "Hearst", "Gannett", "McClatchy",
  "Read More", "Full Story", "Click Here", "Learn More", "See More",
  "Related Articles", "Latest News", "Top Stories", "More Stories",
  "Contact Information", "Media Contact", "Investor Relations",
  "Forward Looking", "Safe Harbor", "About Us", "Our Mission",
  "Copyright", "All Rights Reserved", "Terms", "Privacy",
  "Question Period", "Power Play", "Every Press", "Press Release",
  "For Immediate Release", "Media Inquiries",
  "Sign Up", "Log Out", "Get Started", "Get App", "Download",
  "Newsletter", "Email Alert", "Push Notification",
  "Comments", "Comment Section", "Reply", "Replies",
  "Game Day", "Box Score", "Play By Play", "Play-By-Play",
  "Injury Report", "Practice Report", "Post Game", "Pre Game",
  "National Security", "Public Safety", "Community Development",
  "Economic Development", "Strategic Plan", "Master Plan",
  "Best Practices", "Case Study", "White Paper",
  // Share rail fragments
  "Share Via", "Share via", "Copied!", "Close Extra Sharing Options",
  "Email This", "Copy Link", "Print Article", "Save Article",
  "Watch Now", "Listen Now", "Read Now", "Sign In To Continue",
  "Create Account", "Manage Account", "Account Settings",
  // Generic show/segment names that slip through NLP
  "The Daily", "The Weekly", "The Morning", "The Evening",
  "Morning Edition", "Evening Edition", "Weekend Edition",
  "Good Morning", "Good Evening", "Today Show",
]);

const SPORTS_ENTERTAINMENT_BLOCKLIST = new Set([
  "NFL", "NBA", "MLB", "NHL", "FIFA", "UEFA", "MLS", "PGA", "UFC",
  "ESPN", "Fox Sports", "NBC Sports", "CBS Sports", "TNT Sports",
  "Super Bowl", "World Series", "NBA Finals", "Stanley Cup", "Champions League",
  "Playoffs", "Draft", "Trade Deadline", "Free Agency", "Hall of Fame",
  "Grammy", "Oscar", "Emmy", "Tony", "Box Office", "Billboard",
  "Hollywood Reporter", "Variety", "TMZ", "People Magazine", "Entertainment Weekly",
]);

// ── Role classification patterns ─────────────────────────────────────────────

const ROLE_PATTERNS: { pattern: RegExp; role: EntityRole; confidence: number }[] = [
  { pattern: /\b(federal\s+)?judge\b|\bchief\s+judge\b|\bmagistrate\b|\bjustice\b(?!\s+department)/i, role: "COURT_JUDGE", confidence: 0.88 },
  { pattern: /\b(oversight|senate|house|joint|select|standing)?\s*committee\b|\bsubcommittee\b|\btask\s+force\b|\bcommission\b/i, role: "COMMITTEE", confidence: 0.87 },
  { pattern: /\bDOJ\b|\bFBI\b|\bDHS\b|\bHUD\b|\bHHS\b|\bCDC\b|\bFDA\b|\bSEC\b|\bIRS\b|\bNSA\b|\bCIA\b|\bATF\b|\bDEA\b|\bEPA\b|\bHAP\b|\bHACLA\b|\bLACDA\b/i, role: "GOVERNMENT_AGENCY", confidence: 0.93 },
  { pattern: /\b(?:department\s+of|office\s+of|bureau\s+of|inspector\s+general|housing\s+authority|redevelopment\s+agency)\b/i, role: "GOVERNMENT_AGENCY", confidence: 0.86 },
  { pattern: /\b(?:attorney|counsel|lawyer|public\s+defender|prosecutor|district\s+attorney|U\.S\.\s+attorney|solicitor)\b/i, role: "ATTORNEY_COUNSEL", confidence: 0.87 },
  { pattern: /\b(?:grant\s+program|housing\s+program|pilot\s+program|voucher\s+program|initiative|assistance\s+program|rapid\s+rehousing|shelter\s+program)\b/i, role: "PROGRAM", confidence: 0.82 },
  { pattern: /\b(?:shelter|facility|building|campus|clinic|hospital|detention\s+center|housing\s+unit|motel|hotel\s+voucher)\b/i, role: "FACILITY", confidence: 0.80 },
  { pattern: /\b(?:filing|indictment|complaint|affidavit|subpoena|warrant|exhibit|report|audit\s+report|grand\s+jury)\b/i, role: "DOCUMENT_FILING", confidence: 0.83 },
  { pattern: /\b(?:victim|witness|survivor|plaintiff|complainant|accuser|relator)\b/i, role: "VICTIM_WITNESS", confidence: 0.82 },
  { pattern: /\b(?:defendant|suspect|accused|charged|indicted|convicted)\b/i, role: "DEFENDANT", confidence: 0.82 },
  { pattern: /\b(?:secretary|minister|commissioner|administrator|mayor|governor|senator|representative|superintendent|director\s+of)\b/i, role: "OFFICIAL", confidence: 0.76 },
];

function classifyEntityRole(name: string, context: string, entityType: string): { role: EntityRole; roleConfidence: number } {
  if (entityType === "government_agency") return { role: "GOVERNMENT_AGENCY", roleConfidence: 0.90 };

  const ctxL = context.toLowerCase();
  for (const { pattern, role, confidence } of ROLE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(ctxL)) return { role, roleConfidence: confidence };
  }

  if (entityType === "person") return { role: "PERSON", roleConfidence: 0.60 };
  if (entityType === "organization") return { role: "ORGANIZATION", roleConfidence: 0.65 };
  if (entityType === "location") return { role: "FACILITY", roleConfidence: 0.50 };
  return { role: "UNKNOWN", roleConfidence: 0.30 };
}

// ── Artifact / Contamination Detection ────────────────────────────────────────

// Navigation action words that prefix stitched names
const NAV_PREFIX_WORDS = new Set([
  "next", "more", "watch", "listen", "read", "share", "top", "latest", "live",
  "breaking", "related", "also", "see", "get", "sign", "follow", "subscribe",
  "download", "load", "view", "show", "hide", "back", "continue", "skip",
]);

// Navigation / share-rail patterns that appear inline with entity names
const NAV_RESIDUE_RE = /\b(more\s+news|more\s+stories|top\s+stories|breaking\s+news|read\s+more|watch\s+now|listen\s+now|next\s+up|related\s+stories?|related\s+articles?|copy\s+link|share\s+via|subscribe\s+now|sign\s+in\s+to|sign\s+up\s+for|email\s+this|save\s+article|print\s+article|advertisement|sponsored\s+content)\b/i;

/**
 * Detect merged-line artifacts — names like "STEVE BENEN JAMES COMER"
 * where two or more separate proper nouns have been stitched together
 * without natural connectors (and/of/at/etc) or punctuation.
 */
export function isMergedLineArtifact(name: string): boolean {
  const words = name.trim().split(/\s+/);
  if (words.length < 3) return false;

  // All words must be title-case with no connectors
  const allTitleCase = words.every(w => /^[A-Z][a-zA-Z'-]+$/.test(w));
  if (!allTitleCase) return false;

  // Connectors are OK: of, at, and, the, for, in, by, with, to, a
  const connectors = new Set(["of", "at", "and", "the", "for", "in", "by", "with", "to", "a", "an"]);
  const nonConnectors = words.filter(w => !connectors.has(w.toLowerCase()));

  // If 4+ title-case proper-looking words with no connectors → likely stitched
  if (nonConnectors.length >= 4 && words.every(w => !connectors.has(w.toLowerCase()))) {
    // Extra signal: contains two runs that look like first+last name combos
    // Pattern: [FIRST LAST FIRST LAST] or [FIRST LAST FIRST] with no connectors
    const firstLastPairs = name.match(/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g) || [];
    if (firstLastPairs.length >= 2) return true;
  }

  // Hard check: name contains a nav prefix word as first token
  if (NAV_PREFIX_WORDS.has(words[0].toLowerCase()) && nonConnectors.length >= 2) return true;

  // Check for mixed locality + name pattern: e.g. "Los AngelesRoanoke City"
  // No space between what looks like two separate place names
  if (/[a-z][A-Z]/.test(name)) return true; // CamelCase merge = artifact

  return false;
}

/**
 * Detect cross-story contamination — names that span an article boundary
 * or contain fragments from an unrelated story/headline.
 */
export function isCrossStoryContamination(name: string, context: string): boolean {
  // Name contains nav residue in it
  if (NAV_RESIDUE_RE.test(name)) return true;

  // Name begins with a navigation action word followed by proper noun
  const firstWord = name.trim().split(/\s+/)[0].toLowerCase();
  if (NAV_PREFIX_WORDS.has(firstWord) && name.length > firstWord.length + 1) return true;

  // Context around it contains clear nav/more-stories signal
  const ctxL = context.toLowerCase();
  if (/\b(more news|top stories|read more|watch now|related|also from|breaking)\b/.test(ctxL)) {
    // If the entity itself appears to come right after nav text, it's bleed
    const navPos = ctxL.search(/\b(more news|top stories|read more|watch now)\b/);
    const namePos = context.toLowerCase().indexOf(name.toLowerCase());
    if (navPos >= 0 && namePos > navPos && namePos - navPos < 60) return true;
  }

  return false;
}

/**
 * Detect navigation residue in entity names — things like
 * "MORE NEWS EAU CLAIRE CITY COUNCIL" or "NEXT MIKE CRAPO".
 */
export function isNavigationResidue(name: string): boolean {
  const upper = name.toUpperCase().trim();

  // Exact nav phrases
  const NAV_STARTS = [
    "MORE NEWS", "NEXT ", "READ MORE", "WATCH ", "LISTEN ", "TOP STORIES",
    "RELATED ", "SIGN UP", "SUBSCRIBE", "SHARE ", "VIDEO ", "LIVE UPDATES",
    "IMAGE ANALYSIS", "BREAKING NEWS", "SPONSORED CONTENT", "ADVERTISEMENT",
  ];
  for (const nav of NAV_STARTS) {
    if (upper.startsWith(nav)) return true;
  }

  // Contains known chrome words anywhere
  if (/\b(MORE NEWS|READ MORE|WATCH NOW|LISTEN NOW|COPY LINK|SHARE VIA|ADVERTISEMENT|SPONSORED|LIVE UPDATES|IMAGE ANALYSIS|VIDEO ANALYSIS)\b/i.test(name)) return true;

  // Ends with nav suffix
  if (/\b(MORE|NEXT|SHARE|WATCH|LISTEN|READ|SIGN IN|LOG IN|SUBSCRIBE|DONATE|FOLLOW US)\s*$/i.test(name)) return true;

  // Pure nav single words (standalone)
  if (/^(SHARE|VIDEO|WATCH|NEXT|MORE|FOLLOW|SUBSCRIBE|DONATE|MENU|SEARCH|CLOSE|SKIP)$/i.test(name.trim())) return true;

  return false;
}

// Institution suffix pattern for Condition C promotion
export const INSTITUTION_PATTERN = /\b(Department|Agency|University|Committee|Court|Office|Administration|Council|Authority|Commission|Bureau|Division|Foundation|Institute|Ministry|Board|Program|Service|Center|Centre)\b/i;

/**
 * validateEntityShape — structural guard against garbage extraction.
 * Returns null if valid, or a reason string if invalid.
 */
export function validateEntityShape(name: string, entityType: string): "ARTIFACT_ENTITY" | null {
  const trimmed = name.trim();
  const words = trimmed.split(/\s+/);

  // Hard rules — apply to all types
  if (words.length > 5) return "ARTIFACT_ENTITY";                          // >5 words → stitched garbage
  if (/["'""]/.test(trimmed)) return "ARTIFACT_ENTITY";                    // contains quotes
  if (/[;:]/.test(trimmed)) return "ARTIFACT_ENTITY";                      // contains colon or semicolon
  if (words.length > 3 && trimmed === trimmed.toUpperCase()) return "ARTIFACT_ENTITY"; // ALL CAPS phrase >3 words

  // Person-specific: must have at least 2 words
  if (entityType === "person") {
    if (words.length < 2) return "ARTIFACT_ENTITY";                        // single-word person (no last name)
    // Each word must start with a capital letter (basic name structure)
    const validName = words.every(w => /^[A-Z]/.test(w) || /^(de|van|von|le|la|al|el|ben|binti|bin)$/i.test(w));
    if (!validName) return "ARTIFACT_ENTITY";
  }

  return null;
}

export interface DocContaminationResult {
  score: "low" | "med" | "high";
  signals: string[];
  restrictToLead: boolean;
  boilerplateRatio: number;
}

/**
 * Score a document body for contamination from nav/share/cross-story bleed.
 * High contamination → restrict entity extraction to title/dek/lead only.
 */
export function computeDocContaminationScore(text: string, boilerplateRatio: number): DocContaminationResult {
  const signals: string[] = [];
  let score = 0;

  // Boilerplate ratio from cleanBodyText
  if (boilerplateRatio > 0.45) { score += 3; signals.push("high-boilerplate"); }
  else if (boilerplateRatio > 0.25) { score += 2; signals.push("med-boilerplate"); }
  else if (boilerplateRatio > 0.12) { score += 1; signals.push("some-boilerplate"); }

  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const totalLines = lines.length;

  // Count nav/share line density
  let navLines = 0;
  let moreStoriesLines = 0;
  let timestampLines = 0;
  let promoLines = 0;

  for (const line of lines) {
    const ll = line.toLowerCase();
    if (/\b(more news|more stories|top stories|read more|watch now|listen now|related articles?|related stories?)\b/.test(ll)) {
      moreStoriesLines++;
    }
    if (/\b(share|email|facebook|twitter|whatsapp|copy link|print|subscribe|sign in|log in|follow us)\b/.test(ll) && line.length < 80) {
      navLines++;
    }
    if (/^\d{1,2}:\d{2}\s*(am|pm)/i.test(line) || /^(updated|published|posted)\s+\d/i.test(line)) {
      timestampLines++;
    }
    if (/\b(advertisement|sponsored|promoted|paid\s+content|in\s+partnership)\b/i.test(ll)) {
      promoLines++;
    }
  }

  if (totalLines > 0) {
    const navRatio = navLines / totalLines;
    const moreRatio = moreStoriesLines / totalLines;
    if (navRatio > 0.15) { score += 3; signals.push("heavy-nav-density"); }
    else if (navRatio > 0.08) { score += 1; signals.push("nav-density"); }
    if (moreRatio > 0.05) { score += 2; signals.push("more-stories-bleed"); }
  }

  if (moreStoriesLines >= 3) { score += 2; signals.push("multiple-more-stories"); }
  if (promoLines >= 1) { score += 1; signals.push("promo-content"); }
  if (timestampLines >= 5) { score += 1; signals.push("timestamp-clusters"); }

  // Detect multiple unrelated headline-like fragments (short ALL CAPS or title-case lines)
  const headlineFragments = lines.filter(l =>
    l.length > 15 && l.length < 100 &&
    (/^[A-Z][A-Z\s]+$/.test(l) || /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){2,4}$/.test(l))
  ).length;
  if (headlineFragments >= 6) { score += 2; signals.push("headline-fragments"); }
  else if (headlineFragments >= 3) { score += 1; signals.push("some-headline-fragments"); }

  // Short text with multiple promo/nav signals = almost certainly a wrapper
  if (text.length < 2000 && score >= 3) { score += 2; signals.push("short-noisy"); }

  const level: "low" | "med" | "high" = score >= 6 ? "high" : score >= 3 ? "med" : "low";
  return {
    score: level,
    signals,
    restrictToLead: level === "high",
    boilerplateRatio,
  };
}

// ── Document Zone Extraction ───────────────────────────────────────────────────

interface DocZones {
  titleEnd: number;
  dekEnd: number;
  leadEnd: number;
  bodyEnd: number;
  sidebarStart: number;  // estimated start of sidebar/footer zone
}

function extractDocumentZones(text: string): DocZones {
  const lines = text.split("\n");
  let offset = 0;
  let paraCount = 0;
  let titleEnd = -1;
  let dekEnd = -1;
  let leadEnd = -1;
  let sidebarStart = text.length; // default: no sidebar detected

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 40) {
      paraCount++;
      if (paraCount === 1 && titleEnd === -1) titleEnd = offset + line.length;
      if (paraCount === 2 && dekEnd === -1) dekEnd = offset + line.length;
      if (paraCount === 4) leadEnd = offset + line.length;
    }
    // Heuristic: lines that look like "More stories" / nav aggregation = sidebar zone start
    if (sidebarStart === text.length && /^(more\s+(news|stories|from)|top\s+stories|related\s+(articles?|stories?)|advertisement|sponsored)/i.test(trimmed)) {
      sidebarStart = offset;
    }
    offset += line.length + 1;
  }

  if (titleEnd === -1) titleEnd = Math.min(200, text.length);
  if (dekEnd === -1) dekEnd = Math.min(titleEnd + 300, text.length);
  if (leadEnd === -1) leadEnd = Math.min(Math.floor(text.length * 0.35), text.length);
  const bodyEnd = Math.min(Math.floor(text.length * 0.80), sidebarStart);
  return { titleEnd, dekEnd, leadEnd, bodyEnd, sidebarStart };
}

function getZoneForPosition(pos: number, zones: DocZones): DocumentZone {
  if (pos <= zones.titleEnd) return "title";
  if (pos <= zones.dekEnd) return "dek";
  if (pos <= zones.leadEnd) return "lead";
  if (pos >= zones.sidebarStart) return "sidebar";
  if (pos <= zones.bodyEnd) return "body";
  return "tail";
}

function getZoneConfidenceMultiplier(zone: DocumentZone): number {
  switch (zone) {
    case "title":      return 1.35;
    case "dek":        return 1.25;
    case "lead":       return 1.15;
    case "body":       return 1.00;
    case "tail":       return 0.60;
    case "sidebar":    return 0.20;
    case "footer":     return 0.10;
    case "related":    return 0.10;
    case "boilerplate":return 0.05;
    default:           return 0.50;
  }
}

/** True if the zone is a rejected extraction zone for serious seeds */
function isRejectedZone(zone: DocumentZone): boolean {
  return zone === "sidebar" || zone === "footer" || zone === "related" || zone === "boilerplate";
}

// Common first names — single-occurrence person with only one of these is rejected
const COMMON_FIRST_NAMES = new Set([
  "james", "john", "robert", "michael", "william", "david", "richard", "joseph",
  "thomas", "charles", "christopher", "daniel", "matthew", "anthony", "mark",
  "donald", "steven", "paul", "andrew", "kenneth", "george", "joshua", "kevin",
  "brian", "edward", "ronald", "timothy", "jason", "jeffrey", "ryan", "jacob",
  "gary", "nicholas", "eric", "jonathan", "stephen", "larry", "justin", "scott",
  "brandon", "benjamin", "samuel", "raymond", "gregory", "frank", "alexander",
  "patrick", "jack", "dennis", "jerry", "tyler", "aaron", "henry", "douglas",
  "peter", "adam", "nathan", "zachary", "walter", "kyle", "noah", "alan", "carl",
  "ethan", "jeremy", "harold", "keith", "roger", "gerald", "christian", "terry",
  "sean", "arthur", "austin", "wayne", "joe", "juan", "albert", "dylan", "roy",
  "mary", "patricia", "jennifer", "linda", "barbara", "elizabeth", "susan",
  "jessica", "sarah", "karen", "lisa", "nancy", "betty", "margaret", "sandra",
  "ashley", "dorothy", "kimberly", "emily", "donna", "michelle", "carol",
  "amanda", "melissa", "deborah", "stephanie", "rebecca", "sharon", "laura",
  "cynthia", "kathleen", "amy", "angela", "shirley", "anna", "brenda",
  "pamela", "emma", "nicole", "helen", "samantha", "katherine", "christine",
  "debra", "rachel", "carolyn", "janet", "catherine", "heather", "diane",
  "virginia", "julie", "joyce", "victoria", "olivia", "kelly", "christina",
  "joan", "evelyn", "judith", "megan", "cheryl", "andrea", "hannah",
  "jacqueline", "martha", "gloria", "teresa", "sara", "janice", "ann",
  "alice", "jean", "doris", "julia", "grace", "judy", "abigail", "marie",
  "denise", "amber", "danielle", "brittany", "diana", "natalie", "brittney",
  "ken", "bob", "bill", "jim", "tom", "nick", "mike", "chris", "kate",
  "sue", "dan", "pat", "alex", "matt", "ben", "sam", "max", "emma", "kate",
]);

// ── Seed Intent Classification ─────────────────────────────────────────────────

export type SeedIntent =
  | "policy_government"
  | "finance_funding"
  | "housing_homelessness"
  | "education_university"
  | "crime_corruption"
  | "entertainment_film"
  | "sports"
  | "legal_lawsuit"
  | "general";

/**
 * Classify the seed target into a primary investigative intent.
 * Used to apply topic alignment scoring and suppression rules.
 */
export function classifySeedIntent(target: string): SeedIntent {
  const t = target.toLowerCase();

  if (/\b(lawsuit|sue|legal|court|indictment|appeal|filing|case|trial|charged?|verdict|settl)\b/.test(t))
    return "legal_lawsuit";
  if (/\b(fraud|corrupt|bribery|kickback|embezzl|money.laundering|indictment|audit|oversight|misconduct|probe)\b/.test(t))
    return "crime_corruption";
  if (/\b(shelter|homeless|housing|unhoused|tent|encampment|affordable.housing|voucher)\b/.test(t))
    return "housing_homelessness";
  if (/\b(university|college|campus|student|tuition|enrollment|academia|professor|faculty)\b/.test(t))
    return "education_university";
  if (/\b(fund|grant|budget|appropriation|contract|spending|allocation|subsidy|tax.credit|incentive|invest)\b/.test(t))
    return "finance_funding";
  if (/\b(film|movie|studio|hollywood|box.office|script|director|actor|actress|cinema|production.company)\b/.test(t))
    return "entertainment_film";
  if (/\b(nfl|nba|mlb|nhl|sports?|team|player|coach|season|draft|roster|athletic)\b/.test(t))
    return "sports";
  if (/\b(government|policy|legislation|bill|senator|congress|assembly|mayor|governor|department|agency|office|federal|municipal|state|county)\b/.test(t))
    return "policy_government";

  return "general";
}

// ── Topic Relevance Scoring ────────────────────────────────────────────────────

/**
 * Compute case-topic relevance for an entity mention.
 * Returns HIGH / MEDIUM / LOW / OFF_TOPIC based on context + seed intent.
 */
export function computeTopicRelevance(
  name: string,
  context: string,
  queryTerms: string[],
  seedIntent: SeedIntent
): TopicRelevance {
  const combined = `${name} ${context}`.toLowerCase();
  const queryTermsL = queryTerms.map((t) => t.toLowerCase());
  const queryHits = queryTermsL.filter((t) => t.length > 2 && combined.includes(t)).length;
  const queryRatio = queryTerms.length > 0 ? queryHits / queryTerms.length : 0;

  const isSportsCtx  = /\b(quarterback|touchdown|roster|playoff|salary.cap|draft.pick|game.score|nfl|nba|mlb|nhl|batting|rushing|scoring|standings|bracket)\b/i.test(combined);
  const isEntCtx     = /\b(box.office|opening.weekend|celebrity.gossip|red.carpet|oscar|grammy|emmy|episode.recap|streaming.show|dating|romance|breakup)\b/i.test(combined);
  const isInvCtx     = /\b(contract|fraud|corruption|bribery|kickback|embezzl|indictment|subpoena|audit|investigation|probe|misconduct|grant|fund|budget|procurement|appropriation|settlement|lawsuit)\b/i.test(combined);

  if (seedIntent === "housing_homelessness") {
    const onTopic = /\b(shelter|homeless|housing|unhoused|affordable|voucher|wrap.around|social.services|supportive|navigation.center|motel|encampment|program|department|county|city|fund|contract|grant)\b/i.test(combined);
    if ((isSportsCtx || isEntCtx) && !onTopic) return "OFF_TOPIC";
    if (onTopic && queryRatio >= 0.5) return "HIGH";
    if (onTopic || queryRatio >= 0.3) return "MEDIUM";
    if (isInvCtx) return "MEDIUM";
    return "LOW";
  }
  if (seedIntent === "crime_corruption") {
    const onTopic = /\b(fraud|corrupt|bribery|kickback|embezzl|money.laundering|indictment|misconduct|probe|audit|investigation|DOJ|FBI|attorney|charges|plea|conviction)\b/i.test(combined);
    if (isSportsCtx && !onTopic) return "OFF_TOPIC";
    if (onTopic && queryRatio >= 0.5) return "HIGH";
    if (onTopic || queryRatio >= 0.3) return "MEDIUM";
    return "LOW";
  }
  if (seedIntent === "legal_lawsuit") {
    const onTopic = /\b(lawsuit|court|filing|attorney|plaintiff|defendant|judge|jury|settlement|verdict|charges|complaint|appeal|indictment)\b/i.test(combined);
    if (isSportsCtx && !onTopic) return "OFF_TOPIC";
    if (onTopic && queryRatio >= 0.5) return "HIGH";
    if (onTopic || queryRatio >= 0.3) return "MEDIUM";
    return "LOW";
  }
  if (seedIntent === "education_university") {
    const onTopic = /\b(university|college|campus|student|tuition|faculty|professor|academic|research|program|grant|enrollment|administration|trustee|regent)\b/i.test(combined);
    if (isSportsCtx && !/\b(university|college)\b/i.test(combined)) return "OFF_TOPIC";
    if (onTopic && queryRatio >= 0.5) return "HIGH";
    if (onTopic || queryRatio >= 0.3) return "MEDIUM";
    return "LOW";
  }
  if (seedIntent === "finance_funding") {
    const onTopic = /\b(fund|grant|budget|contract|appropriation|spend|award|procurement|subsidy|incentive|investment|finance|allocation|grantee|awardee)\b/i.test(combined);
    if (isSportsCtx && !onTopic) return "OFF_TOPIC";
    if (onTopic && queryRatio >= 0.5) return "HIGH";
    if (onTopic || queryRatio >= 0.3) return "MEDIUM";
    return "LOW";
  }
  if (seedIntent === "entertainment_film") {
    const isGossip = /\b(celebrity|gossip|dating|breakup|romance|dress|fashion|red.carpet|paparazzi)\b/i.test(combined);
    const onTopic  = /\b(tax.credit|film.incentive|studio|production|fund|subsidy|deal|contract|grant|budget|commission|incentive.program)\b/i.test(combined);
    if (isGossip) return "OFF_TOPIC";
    if (onTopic && queryRatio >= 0.4) return "HIGH";
    if (onTopic || queryRatio >= 0.25) return "MEDIUM";
    return "LOW";
  }
  if (seedIntent === "policy_government") {
    const onTopic = /\b(policy|legislation|bill|government|agency|department|program|contract|fund|oversight|accountability|ordinance|regulation|authority)\b/i.test(combined);
    if (isSportsCtx && !onTopic) return "OFF_TOPIC";
    if (onTopic && queryRatio >= 0.5) return "HIGH";
    if (onTopic || queryRatio >= 0.3) return "MEDIUM";
    return "LOW";
  }
  // General
  if (isSportsCtx && queryRatio < 0.2) return "OFF_TOPIC";
  if (isEntCtx && queryRatio < 0.2) return "OFF_TOPIC";
  if (queryRatio >= 0.6) return "HIGH";
  if (queryRatio >= 0.3 || isInvCtx) return "MEDIUM";
  return "LOW";
}

// ── Entity Admission Firewall ──────────────────────────────────────────────────

// Serious investigative intents — stricter admission rules apply
const SERIOUS_INTENTS = new Set<SeedIntent>([
  "crime_corruption", "legal_lawsuit", "policy_government",
  "housing_homelessness", "finance_funding",
]);

/**
 * Final admission gate — a mention must pass ALL rules to enter triage.
 * Returns { admit: true } or { admit: false, rejectReason }.
 */
export function shouldAdmitMention(
  mention: ExtractedMention,
  seedIntent: SeedIntent,
  queryTerms: string[]
): { admit: boolean; rejectReason?: AdmissionRejectReason } {
  const { entityName, entityType, confidence, topicRelevance, role, context, zone } = mention;
  const nameL = entityName.toLowerCase().trim();
  const words  = nameL.split(/\s+/);
  const isSerious = SERIOUS_INTENTS.has(seedIntent);

  // SHORT_FRAGMENT
  if (entityName.trim().length < 3) return { admit: false, rejectReason: "SHORT_FRAGMENT" };

  // ZONE_REJECT — hard reject from sidebar/footer/related/boilerplate zones
  if (isRejectedZone(zone)) return { admit: false, rejectReason: "ZONE_REJECT" };

  // NAV_RESIDUE — entity name contains navigation residue
  if (isNavigationResidue(entityName))
    return { admit: false, rejectReason: "NAV_RESIDUE" };

  // ARTIFACT_ENTITY — entity fails structural shape validation
  const shapeError = validateEntityShape(entityName, entityType);
  if (shapeError) return { admit: false, rejectReason: shapeError };

  // ARTIFACT — merged-line / stitched names
  if (isMergedLineArtifact(entityName))
    return { admit: false, rejectReason: "ARTIFACT" };

  // CROSS_STORY — cross-article contamination
  if (isCrossStoryContamination(entityName, context))
    return { admit: false, rejectReason: "CROSS_STORY" };

  // BLOCKLIST
  if (MEDIA_SOURCE_BLOCKLIST.has(entityName) || SKIP_NAMES.has(entityName))
    return { admit: false, rejectReason: "BLOCKLIST" };

  // COMMON_FIRST_NAME — single first name person with no title/role context
  if (entityType === "person" && words.length === 1 && COMMON_FIRST_NAMES.has(nameL)) {
    if (role === "UNKNOWN" || role === "PERSON")
      return { admit: false, rejectReason: "COMMON_FIRST_NAME" };
  }

  // TITLE_FRAGMENT
  if (TITLE_FRAGMENT_PATTERNS.some((rx) => rx.test(entityName)))
    return { admit: false, rejectReason: "TITLE_FRAGMENT" };

  // BOILERPLATE_CONTEXT — tail zone with very short context = junk
  if ((zone === "tail" || zone === "sidebar") && context.trim().length < 40 && confidence < 0.60)
    return { admit: false, rejectReason: "BOILERPLATE_CONTEXT" };

  // TOPIC_MISMATCH — OFF_TOPIC entities are never admitted
  if (topicRelevance === "OFF_TOPIC")
    return { admit: false, rejectReason: "TOPIC_MISMATCH" };

  // LOW_CONFIDENCE
  if (confidence < 0.42)
    return { admit: false, rejectReason: "LOW_CONFIDENCE" };

  // For serious intents: entity only in tail with no role-bearing and LOW topic = reject
  if (isSerious && zone === "tail" && topicRelevance === "LOW" && role === "UNKNOWN")
    return { admit: false, rejectReason: "BOILERPLATE_CONTEXT" };

  // For serious intents: LOW topic + UNKNOWN role + low confidence = reject
  if (isSerious && topicRelevance === "LOW" && role === "UNKNOWN" && confidence < 0.68)
    return { admit: false, rejectReason: "LOW_CONFIDENCE" };

  // General: LOW topic relevance + UNKNOWN role + below threshold → suppress
  if (!isSerious && topicRelevance === "LOW" && role === "UNKNOWN" && confidence < 0.62)
    return { admit: false, rejectReason: "LOW_CONFIDENCE" };

  return { admit: true };
}

// ── Body Text Cleaning ─────────────────────────────────────────────────────────

// Lines containing 3+ of these social/nav/share keywords are nav/boilerplate
const SHARE_NAV_KEYWORDS = [
  "share", "email", "facebook", "twitter", "whatsapp", "reddit", "linkedin",
  "threads", "copy", "copied", "print", "subscribe", "sign in", "log in",
  "menu", "search", "newsletter", "close", "skip", "advertisement",
  "sponsored", "opinion", "obituaries", "weather", "watch live", "live updates",
  "listen", "donate", "follow us", "sign up", "create account", "manage account",
  "cookie", "privacy", "terms", "copyright", "all rights reserved",
];

// Full-line boilerplate patterns — lines matching these are stripped
const BOILERPLATE_LINE_PATTERNS = [
  /^(share|email|facebook|x|whatsapp|reddit|linkedin|threads|copied!?)$/i,
  /^close\s*(extra\s*sharing\s*options)?$/i,
  /^(top stories|latest news|breaking news|advertisement|sponsored content)$/i,
  /^(watch live|live updates|listen|subscribe|sign in|log in|menu)$/i,
  /^(opinion|obituaries?|weather|newsletter|newsletters|crossword)$/i,
  /^(read more|learn more|see more|full story|click here|more stories)$/i,
  /^(follow us on|share via|print article|save article|copy link)$/i,
  /^\s*(?:©|copyright)\s+\d{4}/i,
  /^(terms of service|privacy policy|cookie policy|all rights reserved)/i,
  /^(comments?|reply|replies|leave a comment|join the discussion)$/i,
  /^(sign up for|subscribe to|get the|download the)\s+/i,
  /^(\d{1,2}[\/:]\d{1,2}(?:[\/:]\d{2,4})?\s*(?:am|pm)?)\s*$/i, // bare timestamps
  /^[•·▸→|]+\s*$/, // bare bullets/separators
  /^[-—_]{3,}$/, // horizontal rules
  /^[\s\u00a0]*$/, // whitespace-only
];

export interface CleanBodyResult {
  cleaned: string;
  rawChars: number;
  cleanedChars: number;
  removedLines: number;
  boilerplateRatio: number;
}

/**
 * Strip share-rail, nav, social fragment, and boilerplate lines from body text.
 * Returns cleaned text + stats for doc-level quality assessment.
 */
export function cleanBodyText(text: string): CleanBodyResult {
  const rawChars = text.length;
  const lines = text.split(/\r?\n/);
  const keptLines: string[] = [];
  let removedLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Hard boilerplate patterns — strip immediately
    if (BOILERPLATE_LINE_PATTERNS.some((rx) => rx.test(trimmed))) {
      removedLines++;
      continue;
    }

    // Count share/nav keyword density on this line
    const lineL = trimmed.toLowerCase();
    let kwHits = 0;
    for (const kw of SHARE_NAV_KEYWORDS) {
      if (lineL.includes(kw)) kwHits++;
    }
    if (kwHits >= 3) {
      removedLines++;
      continue;
    }

    // Short lines with only action verbs / UI text
    if (trimmed.length <= 25) {
      const isUIText = /^(close|open|back|next|prev|previous|more|less|all|none|ok|cancel|submit|send|save|edit|delete|remove|add|view|show|hide|expand|collapse|toggle|sort|filter|search|reset|clear|load|refresh|reload)$/i.test(trimmed);
      if (isUIText) { removedLines++; continue; }
    }

    keptLines.push(line);
  }

  const cleaned = keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const cleanedChars = cleaned.length;
  const boilerplateRatio = rawChars > 0 ? (rawChars - cleanedChars) / rawChars : 0;

  return { cleaned, rawChars, cleanedChars, removedLines, boilerplateRatio };
}

// ── Context Window Scoring ────────────────────────────────────────────────────

const INVESTIGATIVE_CONTEXT_PATTERN = /\b(contract|procurement|corruption|fraud|bribery|kickback|embezzlement|investigation|audit|misconduct|indictment|plea|conviction|settlement|fine|penalty|lobbying|donation|campaign.finance|oversight|accountability|subpoena|whistleblower|grant|appropriation|budget|housing|shelter|homeless|development|rezoning|permit|violation|lawsuit|regulatory|compliance|conflict.of.interest|no.bid|sole.source|shell.company|offshore|wire.transfer|money.laundering|spending|allocation|program|authority|department|agency|federal|municipal|county|administration|funding|subsidy|tax.credit|incentive|grantee|awardee)\b/i;

const ENTERTAINMENT_NOISE_PATTERN = /\b(season|episode|actor|actress|watch|box.office|trailer|celebrity|red.carpet|concert|award.show|film.premiere|streaming|director as film|producer as film|casting|audition|screen.test|stunt|cameo|cameos|co.star|co-star)\b/i;

const SPORTS_NOISE_PATTERN = /\b(quarterback|touchdown|home.run|three.pointer|field.goal|slam.dunk|grand.slam|hat.trick|free.throw|overtime|halftime|roster|draft.pick|season.record|championship.ring|playoff.run|trade.deadline|salary.cap|head.coach|batting.average|earned.run|yards.per.game|game.score|box.score|play.by.play|injury.report|practice|scrimmage)\b/i;

/**
 * Score ±120 char context window around an entity mention.
 * Returns [boost (0-0.15), penaltyFactor (0.0-1.0), reason]
 */
function scoreContextWindow(context: string): { boost: number; penaltyFactor: number; reason: string } {
  const invMatches = (context.match(INVESTIGATIVE_CONTEXT_PATTERN) || []).length;
  const entMatches = (context.match(ENTERTAINMENT_NOISE_PATTERN) || []).length;
  const sportsMatches = (context.match(SPORTS_NOISE_PATTERN) || []).length;

  let boost = 0;
  let penaltyFactor = 1.0;
  let reason = "";

  if (invMatches >= 3) { boost = 0.15; reason = "strong-inv-context"; }
  else if (invMatches >= 1) { boost = 0.07; reason = "inv-context"; }

  if (sportsMatches >= 2 && invMatches === 0) { penaltyFactor = 0.45; reason = "sports-noise"; }
  else if (entMatches >= 2 && invMatches === 0) { penaltyFactor = 0.50; reason = "entertainment-noise"; }
  else if ((sportsMatches >= 1 || entMatches >= 1) && invMatches === 0) { penaltyFactor = 0.70; reason = `soft-${sportsMatches ? "sports" : "entertainment"}-noise`; }

  return { boost, penaltyFactor, reason };
}

// ── Entity Validity ────────────────────────────────────────────────────────────

// Title fragments that are never investigative entities on their own
const TITLE_FRAGMENT_PATTERNS = [
  /^(?:the\s+)?(?:president|governor|senator|secretary|mayor|chairman|chairwoman|director|commissioner|minister|chancellor|chief|speaker|attorney\s+general|district\s+attorney)\s*$/i,
  /^(?:the\s+)?(?:studio|network|channel|outlet|platform|publication|newspaper|magazine)\s*$/i,
  /^(?:the\s+)?(?:city|state|county|country|nation|government|administration)\s*$/i,
];

// Show / entertainment segment names that sneak through NLP
const SHOW_SEGMENT_PATTERNS = [
  /\b((?:the\s+)?(?:daily|weekly|morning|evening|nightly|weekend)\s+(?:show|brief|brief|digest|roundup|update|edition|report))\b/i,
  /\b(?:good\s+(?:morning|evening|night)|today\s+show|meet\s+the\s+press|face\s+the\s+nation|state\s+of\s+the\s+union)\b/i,
  /\b(?:inside|behind|outside|above|beyond)\s+[A-Z][a-z]+\b/,
];

function isEntityPrecisionValid(name: string, entityType: string): boolean {
  const lower = name.toLowerCase().trim();
  const words = lower.split(/\s+/);

  // Reject possessives
  if (/['']s\s*$/.test(name)) return false;

  // Reject single common first names (person type only)
  if (entityType === "person" && words.length === 1 && COMMON_FIRST_NAMES.has(lower)) return false;

  // Reject single-word person if it's in skip names
  if (words.length === 1 && SKIP_NAMES.has(name)) return false;

  // Reject title fragments
  if (TITLE_FRAGMENT_PATTERNS.some((rx) => rx.test(name))) return false;

  // Reject show/segment names
  if (SHOW_SEGMENT_PATTERNS.some((rx) => rx.test(name))) return false;

  // Reject generic single-word nouns that aren't names
  const GENERIC_NOUNS = new Set([
    "funding", "budget", "program", "project", "policy", "report", "review",
    "plan", "study", "survey", "analysis", "impact", "result", "outcome",
    "issue", "problem", "solution", "response", "reaction", "action",
    "announcement", "statement", "proposal", "request", "award", "grant",
  ]);
  if (words.length === 1 && GENERIC_NOUNS.has(lower)) return false;

  return true;
}

function isValidName(name: string, entityType = "organization"): boolean {
  if (!name || name.length < 3 || name.length > 80) return false;
  const words = name.trim().split(/\s+/);
  if (words.length === 1 && SKIP_NAMES.has(words[0])) return false;
  if (!/[a-zA-Z]/.test(name)) return false;
  if (MEDIA_SOURCE_BLOCKLIST.has(name)) return false;
  if (SPORTS_ENTERTAINMENT_BLOCKLIST.has(name)) return false;
  if (!isEntityPrecisionValid(name, entityType)) return false;
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

function getContext(text: string, name: string, idx?: number): string {
  const pos = idx !== undefined ? idx : text.indexOf(name);
  if (pos === -1) return name;
  const start = Math.max(0, pos - 120);
  const end = Math.min(text.length, pos + name.length + 120);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

// Run NER on text using compromise.js + rule-based augmentation
export function extractEntities(
  text: string,
  queryTerms: string[] = [],
  seedIntent: SeedIntent = "general",
  restrictToLeadOnly = false   // set true for high-contamination docs
): ExtractedMention[] {
  if (!text || text.trim().length < 10) return [];

  const isSerious = SERIOUS_INTENTS.has(seedIntent);
  const mentions: ExtractedMention[] = [];
  const seen = new Set<string>();
  const zones = extractDocumentZones(text);

  // For contaminated docs: only accept entities in title/dek/lead
  const leadCutoff = restrictToLeadOnly ? zones.leadEnd : text.length;

  function addMention(
    entityName: string,
    entityType: string,
    confidence: number,
    matchIndex?: number
  ) {
    const name = entityName.trim();
    if (!isValidName(name, entityType)) return;

    // Pre-admission artifact checks before dedup
    if (isNavigationResidue(name)) return;
    if (isMergedLineArtifact(name)) return;

    if (seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    const pos = matchIndex ?? text.indexOf(name);
    const ctx = getContext(text, name, matchIndex);

    // Skip if beyond lead cutoff (contamination restriction)
    if (restrictToLeadOnly && pos > leadCutoff) return;

    // Skip cross-story contamination
    if (isCrossStoryContamination(name, ctx)) return;

    const zone = getZoneForPosition(pos, zones);
    const zoneMultiplier = getZoneConfidenceMultiplier(zone);
    const { boost, penaltyFactor } = scoreContextWindow(ctx);
    let adjustedConf = Math.min(0.99, (confidence + boost) * penaltyFactor * zoneMultiplier);

    // Lead-first extraction for serious intents:
    // Heavy penalty for entities that only appear deep in document body (past para 7 heuristic)
    if (isSerious && !restrictToLeadOnly) {
      const deepBodyThreshold = Math.min(zones.leadEnd * 3, zones.bodyEnd);
      if (pos > deepBodyThreshold && (zone === "tail" || zone === "body")) {
        adjustedConf *= 0.55; // strong penalty for deep-body-only mentions
      }
    }

    const { role, roleConfidence } = classifyEntityRole(name, ctx, entityType);
    const topicRelevance = computeTopicRelevance(name, ctx, queryTerms, seedIntent);

    const mention: ExtractedMention = {
      entityName: name,
      entityType,
      confidence: adjustedConf,
      context: ctx,
      startPos: pos,
      endPos: pos + name.length,
      role,
      roleConfidence,
      topicRelevance,
      zone,
      admitted: false,
    };

    const admissionResult = shouldAdmitMention(mention, seedIntent, queryTerms);
    mention.admitted = admissionResult.admit;
    if (!admissionResult.admit) mention.rejectReason = admissionResult.rejectReason;

    mentions.push(mention);
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
      if (words.length < 2) continue;
      const { type, confidence } = classifyTitleCasePhrase(name);
      if (confidence < 0.55) continue;
      addMention(name, type, confidence, match.index);
    }
  }

  return mentions
    .filter((m, i, arr) => arr.findIndex((x) => x.entityName === m.entityName) === i)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 60);
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
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?/gi,
  /\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:,?\s+\d{4})?/gi,
  /\b(?:in|by|since|after|before|during|throughout|from|as\s+of)\s+(?:20|19)\d{2}\b/gi,
  /\b(?:20|19)\d{2}\b/g,
];

function extractDateFromSentence(sentence: string): string | null {
  for (const pat of DATE_PATTERNS) {
    pat.lastIndex = 0;
    const m = pat.exec(sentence);
    if (m) {
      const raw = m[0].trim();
      try {
        const d = new Date(raw.replace(/^(?:in|by|since|after|before|during|from|as of)\s+/i, ""));
        if (!isNaN(d.getTime())) return d.toISOString();
      } catch { /* continue */ }
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

  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim().length > 20);

  for (const sentence of sentences) {
    const dateStr = extractDateFromSentence(sentence);
    if (!dateStr) continue;

    const eventType = classifyEventType(sentence);
    const summary = sentence.trim().replace(/\s+/g, " ").slice(0, 200);
    const key = `${dateStr.slice(0, 10)}-${summary.slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    events.push({ eventDate: dateStr, eventType, summary });
    if (events.length >= 15) break;
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

const MONEY_PATTERN = /(?:(USD|US\$|\$|£|€|GBP|EUR)\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(billion|million|thousand|trillion|bn|mn|tr|[BMKT])\b|(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(billion|million|thousand|trillion|bn|mn|tr|[BMK])\b(?:\s*(?:USD|US dollars?|dollars?))?|(USD|US\$|\$|£|€)\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?))/gi;

const FINANCIAL_PROXIMITY_PATTERN = /\b(funding|grant|budget|investment|contract|appropriation|allocation|spending|award(?:ed)?|program\s+fund|invest(?:ed|ment)|financed?|subsidized?|reimburse|settlement|procurement|invoice|payout|disburse|obligated?|encumbered?)\b/i;

const FINANCIAL_AD_COPY_PATTERN = /\b(sale|discount|off|coupon|promo|deal\s+of\s+the\s+day|limited\s+time|buy\s+now|add\s+to\s+cart|checkout|free\s+shipping|starting\s+at|as\s+low\s+as|per\s+month|subscription|plan|retail|price\s+drop|save\s+up\s+to|starting\s+from|season\s+pass|ticket\s+price|admission|box\s+office|gross(?:ing)?|earned|opening\s+weekend|revenue\s+for\s+(?:the\s+)?film|record\s+(?:breaking\s+)?box\s+office)\b/i;

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

function normalizeAmount(raw: string): { amount: number | null; currency: string; display: string } {
  let currency = "USD";
  let currencySymbol = "$";
  if (/£|GBP/i.test(raw)) { currency = "GBP"; currencySymbol = "£"; }
  else if (/€|EUR/i.test(raw)) { currency = "EUR"; currencySymbol = "€"; }

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

export function extractFinancialSignals(text: string): ExtractedFinancialSignal[] {
  if (!text || text.trim().length < 20) return [];

  const signals: ExtractedFinancialSignal[] = [];
  const seen = new Set<string>();
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim().length > 10);

  for (const sentence of sentences) {
    if (!FINANCIAL_PROXIMITY_PATTERN.test(sentence)) continue;
    if (FINANCIAL_AD_COPY_PATTERN.test(sentence)) continue;
    if (FINANCIAL_SPORTS_PATTERN.test(sentence)) continue;

    MONEY_PATTERN.lastIndex = 0;
    let match;
    while ((match = MONEY_PATTERN.exec(sentence)) !== null) {
      const amountRaw = match[0].trim();
      if (!amountRaw || amountRaw.length < 2) continue;

      const { amount, currency, display } = normalizeAmount(amountRaw);
      if (amount === null || amount < 1000) continue;

      const dedupKey = display;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const signalType = getSignalType(sentence);
      const summary = sentence.trim().replace(/\s+/g, " ").slice(0, 250);

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

// ── Document Relevance Scoring 2.0 ────────────────────────────────────────────

const DOC_INVESTIGATIVE_TITLE_TERMS = [
  "contract", "contracts", "grant", "grants", "funding", "budget", "audit",
  "probe", "fraud", "corruption", "investigation", "lawsuit", "settlement",
  "allocation", "appropriation", "procurement", "spending", "shelter",
  "homeless", "homelessness", "housing", "nonprofit", "oversight",
  "records", "report", "subpoena", "misconduct", "indictment", "bribery",
  "kickback", "embezzlement", "ordinance", "whistleblower", "accountability",
  "invoice", "payments", "program", "department", "agency", "federal",
  "county", "state", "city", "municipal", "commission", "subsidy",
  "tax credit", "incentive", "grantee", "awardee", "investigation",
];

const DOC_PENALTY_TERMS = [
  "sports", "game", "coach", "player", "roster", "draft",
  "playoff", "tournament", "championship", "score", "standings",
  "celebrity", "entertainment", "box office", "red carpet",
  "recipe", "lifestyle", "shopping", "travel", "horoscope",
  "review", "restaurant", "fitness", "wellness", "beauty",
  "sponsored", "advertisement", "newsletter", "subscribe",
  "season finale", "episode", "actor", "actress", "streaming",
  "film review", "album", "concert", "tour dates",
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
  seedIntent: SeedIntent;
  topicAlignment: "aligned" | "partial" | "mismatched" | "unknown";
  mismatchReason: string;
  boosts: string[];
  penalties: string[];
}

/**
 * Score a document 0–100 for investigative relevance.
 * seedIntent influences topic alignment scoring and hard suppressors.
 */
export function computeDocRelevanceScore(
  bodyText: string,
  title: string,
  queryTerms: string[],
  sourceDomain = "",
  seedIntent: SeedIntent = "general"
): DocRelevanceResult {
  const boosts: string[] = [];
  const penalties: string[] = [];
  let score = 50;
  let mismatchReason = "";

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
  if (titleInvHits >= 2) boosts.push("strong-investigative-title");
  if (bodyInvHits >= 5) { score += 5; boosts.push("high-inv-density"); }

  // ── Body quality ─────────────────────────────────────────────────────────
  const bodyLen = bodyText.length;
  if (bodyLen >= 1500) { score += 6; boosts.push("long-body"); }
  else if (bodyLen >= 500) { score += 3; boosts.push("medium-body"); }
  else if (bodyLen < 100) { score -= 15; penalties.push("near-empty-body"); }
  else if (bodyLen < 200) { score -= 8; penalties.push("short-body"); }

  // ── Boilerplate penalty ────────────────────────────────────────────────────
  const { boilerplateRatio } = cleanBodyText(bodyText);
  if (boilerplateRatio > 0.5) { score -= 15; penalties.push(`boilerplate-${Math.round(boilerplateRatio * 100)}pct`); }
  else if (boilerplateRatio > 0.3) { score -= 7; penalties.push("partial-boilerplate"); }

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

  // ── Seed intent topic alignment ────────────────────────────────────────────
  // Check sports doc vs non-sports seed
  const isSportsDoc = /\b(quarterback|touchdown|roster|playoff|salary.cap|draft.pick|batting.average|rushing.yards|game.score|nfl.nba.mlb|sports.scores?|standings|bracket)\b/i.test(bodyL + " " + titleL);
  const isEntertainmentDoc = /\b(box.office|opening.weekend|film.review|celebrity.gossip|red.carpet|oscar|grammy|emmy|episode.recap|streaming.show)\b/i.test(bodyL + " " + titleL);

  let topicAlignment: DocRelevanceResult["topicAlignment"] = "unknown";

  if (seedIntent === "housing_homelessness") {
    if (/\b(shelter|homeless|housing|unhoused|tent.city|affordable.housing|voucher|wrap.around|support.services|social.services)\b/i.test(bodyL + " " + titleL)) {
      topicAlignment = "aligned"; score += 10; boosts.push("housing-aligned");
    } else if (isSportsDoc) {
      topicAlignment = "mismatched"; score -= 25; mismatchReason = "sports-in-housing-query";
      penalties.push("sports-mismatch");
    } else if (isEntertainmentDoc) {
      topicAlignment = "mismatched"; score -= 20; mismatchReason = "entertainment-in-housing-query";
      penalties.push("entertainment-mismatch");
    } else { topicAlignment = "partial"; }
  } else if (seedIntent === "education_university") {
    if (/\b(university|college|campus|tuition|enrollment|academic|faculty|student|professor|research.program|grant.for)\b/i.test(bodyL + " " + titleL)) {
      topicAlignment = "aligned"; score += 8; boosts.push("edu-aligned");
    } else if (isSportsDoc && !/\b(university|college)\b/i.test(titleL)) {
      topicAlignment = "mismatched"; score -= 22; mismatchReason = "sports-in-edu-query";
      penalties.push("sports-mismatch");
    } else { topicAlignment = "partial"; }
  } else if (seedIntent === "entertainment_film") {
    if (/\b(tax.credit|film.incentive|studio.fund|production.grant|film.budget|subsidy|incentive.program|film.commission|movie.deal|studio.deal)\b/i.test(bodyL + " " + titleL)) {
      topicAlignment = "aligned"; score += 10; boosts.push("film-finance-aligned");
    } else if (/\b(celebrity.gossip|red.carpet|dress|fashion|relationship|dating|breakup|romance|divorce)\b/i.test(bodyL + " " + titleL)) {
      topicAlignment = "mismatched"; score -= 20; mismatchReason = "celeb-gossip-in-film-funding-query";
      penalties.push("gossip-mismatch");
    } else { topicAlignment = "partial"; }
  } else if (seedIntent === "finance_funding" || seedIntent === "policy_government") {
    if (isSportsDoc) {
      topicAlignment = "mismatched"; score -= 22; mismatchReason = `sports-in-${seedIntent}-query`;
      penalties.push("sports-mismatch");
    } else if (isEntertainmentDoc) {
      topicAlignment = "mismatched"; score -= 18; mismatchReason = `entertainment-in-${seedIntent}-query`;
      penalties.push("entertainment-mismatch");
    } else if (/\b(fund|grant|budget|contract|spend|appropriat|award|procurement|subsidy|incentive)\b/i.test(bodyL + " " + titleL)) {
      topicAlignment = "aligned"; score += 8; boosts.push("finance-aligned");
    } else { topicAlignment = "partial"; }
  } else if (seedIntent === "legal_lawsuit") {
    if (/\b(lawsuit|sued?|court|filing|complaint|indictment|appeal|verdict|settlement|attorney|plaintiff|defendant|judge|jury)\b/i.test(bodyL + " " + titleL)) {
      topicAlignment = "aligned"; score += 8; boosts.push("legal-aligned");
    } else if (isSportsDoc) {
      topicAlignment = "mismatched"; score -= 15; mismatchReason = "sports-in-legal-query";
      penalties.push("sports-mismatch");
    } else { topicAlignment = "partial"; }
  } else if (seedIntent === "crime_corruption") {
    if (/\b(fraud|corrupt|bribery|kickback|embezzl|money.laundering|indictment|misconduct|probe|audit.finding|inspector.general)\b/i.test(bodyL + " " + titleL)) {
      topicAlignment = "aligned"; score += 10; boosts.push("corruption-aligned");
    } else if (isSportsDoc) {
      topicAlignment = "mismatched"; score -= 20; mismatchReason = "sports-in-corruption-query";
      penalties.push("sports-mismatch");
    } else { topicAlignment = "partial"; }
  } else if (seedIntent === "sports") {
    // Sports seed — penalize finance-only docs with no sports context
    topicAlignment = isSportsDoc ? "aligned" : "partial";
    if (isSportsDoc) boosts.push("sports-aligned");
  } else {
    // General — no hard mismatch, just soft penalties
    if (isSportsDoc && penaltyHits >= 2) { topicAlignment = "mismatched"; mismatchReason = "sports-general"; }
    else if (isEntertainmentDoc && penaltyHits >= 2) { topicAlignment = "mismatched"; mismatchReason = "entertainment-general"; }
    else { topicAlignment = "partial"; }
  }

  // ── Hard NOISE suppressors ────────────────────────────────────────────────
  // If already mismatched and no seed term hits, force NOISE
  if (topicAlignment === "mismatched" && titleQueryHits === 0 && bodyQueryHits < 2) {
    score = Math.min(score, 15);
    penalties.push("hard-mismatch-suppressed");
  }

  // ── Clamp and bucket ─────────────────────────────────────────────────────
  const finalScore = Math.round(Math.max(0, Math.min(100, score)));
  let priority: DocRelevanceResult["priority"];
  if (finalScore >= 65) priority = "PRIORITY_A";
  else if (finalScore >= 40) priority = "PRIORITY_B";
  else if (finalScore >= 18) priority = "LOW_SIGNAL";
  else priority = "NOISE";

  return { score: finalScore, priority, seedIntent, topicAlignment, mismatchReason, boosts, penalties };
}

// ── Entity Name Normalization & Canonicalization ──────────────────────────────

const ORG_SUFFIX_CLEANUP = [
  /\s*,?\s*Inc\.?$/i, /\s*,?\s*LLC\.?$/i, /\s*,?\s*Corp\.?$/i,
  /\s*,?\s*Co\.?$/i, /\s*,?\s*Ltd\.?$/i, /\s*,?\s*L\.L\.C\.?$/i,
  /\s*,?\s*Incorporated$/i, /\s*,?\s*Corporation$/i, /\s*,?\s*Limited$/i,
];

// Department/office variant normalization
const ORG_VARIANT_CLEANUP: [RegExp, string][] = [
  [/\bDept\b\.?/gi, "Department"],
  [/\bSvcs\b\.?/gi, "Services"],
  [/\bAuth\b\.?/gi, "Authority"],
  [/\bComm\b\.?/gi, "Commission"],
  [/\bAdmin\b\.?/gi, "Administration"],
];

const LEADING_ARTICLE = /^(?:The|A|An)\s+/i;

export function normalizeEntityName(name: string): string {
  let n = name.trim();
  // Strip possessives
  n = n.replace(/['']s\s*$/i, "").trim();
  // Strip leading articles
  n = n.replace(LEADING_ARTICLE, "");
  // Normalize common department abbreviations
  for (const [rx, replacement] of ORG_VARIANT_CLEANUP) {
    n = n.replace(rx, replacement);
  }
  // Strip common org suffixes
  for (const rx of ORG_SUFFIX_CLEANUP) n = n.replace(rx, "");
  // Collapse internal whitespace
  n = n.replace(/\s+/g, " ").trim();
  return n.toLowerCase();
}

/**
 * Compute token overlap ratio between two normalized name strings.
 * Returns 0.0–1.0 where 1.0 = full overlap.
 */
function tokenOverlap(a: string, b: string): number {
  const tokA = new Set(a.split(/\s+/).filter(w => w.length > 2));
  const tokB = new Set(b.split(/\s+/).filter(w => w.length > 2));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let shared = 0;
  for (const t of tokA) { if (tokB.has(t)) shared++; }
  return shared / Math.max(tokA.size, tokB.size);
}

/**
 * Try to match a candidate name to an existing canonical name.
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
      const shorter = normCandidate.length < normExisting.length ? normCandidate : normExisting;
      if (shorter.length >= 4) return existing;
    }
    // High token overlap (≥ 60%)
    const overlap = tokenOverlap(normCandidate, normExisting);
    if (overlap >= 0.60 && normCandidate.length >= 8 && normExisting.length >= 8) {
      return existing;
    }
  }
  return null;
}
