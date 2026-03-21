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
  // Standalone generic institutional words (no specificity — junk fragments)
  "Department", "Commission", "Agency", "Office", "Council", "Division",
  "Branch", "Section", "Bureau", "Unit", "Committee", "Authority", "Body",
  "Administration", "Cabinet", "Ministry", "Chamber", "Assembly", "District",
  "Coalition", "Alliance", "Association", "Organization", "Institution",
  "Foundation", "Institute", "Society", "Federation", "Union", "League",
  "Conference", "Forum", "Network", "Initiative", "Partnership", "Task Force",
  // Standalone vague location fragments
  "Region", "Area", "Zone", "Sector", "Territory", "Province", "Parish",
  // Generic political/bureaucratic fragments
  "Legislature", "Legislation", "Regulation", "Policy", "Hearing", "Session",
  "Amendment", "Statute", "Ordinance", "Resolution", "Measure", "Referendum",
  // Generic person-role stubs
  "Spokesperson", "Representative", "Analyst", "Expert", "Source",
  "Investigator", "Auditor", "Whistleblower", "Witness", "Complainant",
  // Article / media artifact stubs
  "Edition", "Section", "Bureau", "Desk", "Wire", "Feed", "Outlet",
  "Publication", "Platform", "Channel", "Broadcast", "Segment", "Podcast",
  // Slogan / marketing language fragments
  "Innovation", "Excellence", "Leadership", "Vision", "Mission", "Values",
  "Opportunity", "Future", "Together", "Forward", "Access", "Equity", "Growth",
  "Accountability", "Transparency", "Integrity", "Trust", "Impact", "Outcome",
  "Progress", "Action", "Change", "Community", "Commitment", "Partnership",
  // Navigation / UI residue
  "Back To", "Back to", "Jump To", "Jump to", "Skip To", "Skip to",
  "See All", "View All", "Show All", "Load More", "See More",
  "Homepage", "Home Page", "Site Map", "Sitemap", "Breadcrumb",
  "Next Page", "Previous Page", "Pagination",
  // Generic section headings treated as entities
  "Analysis", "Investigation", "Explainer", "Context", "Background",
  "Summary", "Overview", "Highlights", "Key Points", "Takeaways",
  // Document artifact single words
  "Footnote", "Endnote", "Appendix", "Exhibit", "Attachment", "Annex",
  // Standalone education/topic acronyms that bleed in without context
  "STEM", "STEAM", "SEL", "DEI", "ESG", "FOIA", "SNAP", "TANF", "CHIP",
  // Sports event names and competition terms
  "Madness", "Playoffs", "Bracket", "Championship", "Finals", "Semifinals",
  "Halftime", "Overtime", "Quarterfinal", "Semifinal", "Wildcard",
  // Entertainment filler
  "Episode", "Season", "Series", "Recap", "Preview", "Trailer", "Finale",
  "Premiere", "Pilot", "Docuseries", "Documentary", "Miniseries",
  // Generic anchor phrases often extracted as entities
  "Funding", "Grant", "Budget", "Spending", "Contract", "Award",
  "Initiative", "Strategy", "Project", "Plan", "Proposal",
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
  "NFL", "NBA", "MLB", "NHL", "FIFA", "UEFA", "MLS", "PGA", "UFC", "NCAA",
  "ESPN", "Fox Sports", "NBC Sports", "CBS Sports", "TNT Sports", "Bleacher Report",
  "Super Bowl", "World Series", "NBA Finals", "Stanley Cup", "Champions League",
  "Playoffs", "Draft", "Trade Deadline", "Free Agency", "Hall of Fame",
  "Grammy", "Oscar", "Emmy", "Tony", "Box Office", "Billboard",
  "Hollywood Reporter", "Variety", "TMZ", "People Magazine", "Entertainment Weekly",
  "Disney", "Pixar", "Warner Bros", "Universal Pictures", "Paramount", "Sony Pictures",
  "Netflix", "HBO", "Hulu", "Amazon Prime", "Apple TV",
  "Hollywood", "Oscars", "Golden Globes", "SAG Awards", "People's Choice",
  "Comic-Con", "Coachella", "Sundance", "Cannes", "SXSW",
  "Sports Illustrated", "The Athletic", "Deadline Hollywood", "The Hollywood Reporter",
]);

// Well-known celebrities and entertainers who should NOT be promoted
// in non-entertainment investigative cases
const CELEBRITY_PERSON_NAMES = new Set([
  // Actors / Film
  "Ryan Gosling", "Chuck Norris", "Tom Hanks", "Brad Pitt", "Angelina Jolie",
  "Jennifer Aniston", "Leonardo DiCaprio", "Meryl Streep", "Denzel Washington",
  "Will Smith", "Jennifer Lopez", "Scarlett Johansson", "Robert Downey",
  "Dwayne Johnson", "Vin Diesel", "Chris Evans", "Chris Hemsworth",
  "Zendaya", "Timothee Chalamet", "Florence Pugh", "Ana de Armas",
  "Cate Blanchett", "Nicole Kidman", "Reese Witherspoon", "Natalie Portman",
  "Emma Stone", "Emma Watson", "Anne Hathaway", "Julia Roberts",
  "George Clooney", "Matt Damon", "Ben Affleck", "Keanu Reeves",
  "Johnny Depp", "Tom Cruise", "Harrison Ford", "Sylvester Stallone",
  "Arnold Schwarzenegger", "Bruce Willis", "Samuel Jackson", "Morgan Freeman",
  "Clint Eastwood", "Robin Williams", "Jim Carrey", "Adam Sandler",
  "Kevin Hart", "Chris Rock", "Dave Chappelle", "Eddie Murphy",
  "Margot Robbie", "Ryan Reynolds", "Blake Lively", "Hugh Jackman",
  "Jake Gyllenhaal", "Andrew Garfield", "Robert Pattinson", "Kristen Stewart",
  "Mila Kunis", "Ashton Kutcher", "Demi Moore", "Bruce Willis",
  "Viola Davis", "Halle Berry", "Angela Bassett", "Lupita Nyong'o",
  "Idris Elba", "Michael B. Jordan", "Chadwick Boseman", "John Boyega",
  "Mark Wahlberg", "Mel Gibson", "Nicolas Cage", "Al Pacino", "Robert De Niro",
  "Jack Nicholson", "Dustin Hoffman", "Gene Hackman", "Anthony Hopkins",
  "Helena Bonham Carter", "Keira Knightley", "Kate Winslet",
  // Reality TV / Social Media
  "Kim Kardashian", "Khloé Kardashian", "Kourtney Kardashian", "Kris Jenner",
  "Kylie Jenner", "Kendall Jenner", "Cardi B", "Nicki Minaj",
  "Paris Hilton", "Lindsay Lohan", "Britney Spears", "Amanda Bynes",
  "Tana Mongeau", "Logan Paul", "Jake Paul", "MrBeast", "PewDiePie",
  "Addison Rae", "Charli D'Amelio", "Dixie D'Amelio", "Emma Chamberlain",
  "Jeffree Star", "James Charles", "David Dobrik", "Shane Dawson",
  // Musicians
  "Taylor Swift", "Beyoncé", "Rihanna", "Ariana Grande", "Billie Eilish",
  "Lady Gaga", "Katy Perry", "Miley Cyrus", "Selena Gomez",
  "Justin Bieber", "Drake", "Kanye West", "Jay-Z", "Eminem",
  "Bruno Mars", "The Weeknd", "Post Malone", "Travis Scott",
  "Ed Sheeran", "Adele", "Harry Styles", "Dua Lipa",
  "Michael Jackson", "Prince", "Elvis Presley", "Madonna",
  "Lizzo", "Olivia Rodrigo", "Doja Cat", "Megan Thee Stallion",
  "Lil Nas X", "Bad Bunny", "J Balvin", "Daddy Yankee",
  "Luke Bryan", "Blake Shelton", "Carrie Underwood", "Miranda Lambert",
  "Garth Brooks", "Kenny Chesney", "Tim McGraw", "Faith Hill",
  "Justin Timberlake", "NSYNC", "Backstreet Boys", "One Direction",
  "Bon Jovi", "Bruce Springsteen", "Billy Joel", "Elton John",
  "Paul McCartney", "Mick Jagger", "Keith Richards",
  // Athletes
  "LeBron James", "Michael Jordan", "Kobe Bryant", "Stephen Curry",
  "Tom Brady", "Aaron Rodgers", "Patrick Mahomes", "Peyton Manning",
  "Tiger Woods", "Phil Mickelson", "Roger Federer", "Rafael Nadal",
  "Novak Djokovic", "Serena Williams", "Simone Biles",
  "Cristiano Ronaldo", "Lionel Messi", "Neymar", "Kylian Mbappé",
  "Floyd Mayweather", "Conor McGregor", "Mike Tyson",
  "Shaquille O'Neal", "Magic Johnson", "Larry Bird",
  "Manny Pacquiao", "Oscar De La Hoya",
  "Kevin Durant", "Giannis Antetokounmpo", "Nikola Jokic",
  "Josh Allen", "Lamar Jackson", "Joe Burrow", "Jalen Hurts",
  "Lebron James", "Russell Westbrook", "Chris Paul",
  "Alex Rodriguez", "Derek Jeter", "Mike Trout", "Shohei Ohtani",
  "Naomi Osaka", "Coco Gauff", "Emma Raducanu",
  "Usain Bolt", "Carl Lewis", "Florence Griffith-Joyner",
  "Michael Phelps", "Mark Spitz", "Ryan Lochte",
  // Media personalities / Podcasters / Influencers
  "Oprah Winfrey", "Ellen DeGeneres", "Jimmy Fallon", "Jimmy Kimmel",
  "Jay Leno", "David Letterman", "Conan O'Brien", "Stephen Colbert",
  "Trevor Noah", "John Oliver", "Bill Maher",
  "Ryan Seacrest", "Simon Cowell", "Gordon Ramsay",
  "Steve Harvey", "Tyra Banks",
  "Joe Rogan", "Howard Stern", "Alex Jones", "Tucker Carlson",
  "Rachel Maddow", "Anderson Cooper", "Don Lemon", "Sean Hannity",
  "Glenn Beck", "Rush Limbaugh", "Mark Levin", "Laura Ingraham",
  "Megyn Kelly", "Greta Van Susteren", "Wolf Blitzer", "Chris Cuomo",
  "Erin Burnett", "Jake Tapper", "Chuck Todd", "George Stephanopoulos",
  "Kelly Ripa", "Regis Philbin", "Kathie Lee Gifford", "Hoda Kotb",
  "Savannah Guthrie", "Lester Holt", "David Muir", "Norah O'Donnell",
  // Tech/Business celebrities (who appear in entertainment contexts — not investigations)
  "Kim Dotcom", "Dan Bilzerian", "Grant Cardone", "Gary Vaynerchuk",
  "Tony Robbins", "Dean Graziosi",
]);

// Foreign countries and non-investigative geographies that drift into
// unrelated side-stories on domestic investigation cases
const WORLD_GEOGRAPHY_DRIFT_BLOCKLIST = new Set([
  // Foreign countries unlikely to be primary entities in US domestic investigations
  "Iran", "Iraq", "Syria", "Yemen", "Afghanistan", "Libya", "Sudan",
  "North Korea", "Cuba", "Venezuela", "Russia", "Ukraine", "Belarus",
  "Somalia", "Myanmar", "Ethiopia", "Eritrea",
  // These appear in sidebar "world news" links
  "Gaza", "West Bank", "Kashmir", "Taiwan Strait",
  // US states that appear in cross-story drift on city-level investigations
  "Hawaii", "Alaska", "Puerto Rico", "Guam",
  // Generic world/geography fragments appearing in sidebar RSS
  "Middle East", "Sub-Saharan Africa", "Latin America", "Southeast Asia",
  "Eastern Europe", "Central America",
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
  { pattern: /\b(?:inspector\s+general|ig\s+report|special\s+agent\s+in\s+charge|comptroller|auditor\s+general|contracting\s+officer|procurement\s+officer|chief\s+financial\s+officer|cfo|chief\s+compliance\s+officer)\b/i, role: "OFFICIAL", confidence: 0.88 },
  { pattern: /\b(?:secretary|minister|commissioner|administrator|mayor|governor|senator|representative|superintendent|director\s+of|deputy\s+secretary|undersecretary|assistant\s+secretary|deputy\s+director|chief\s+of\s+staff)\b/i, role: "OFFICIAL", confidence: 0.82 },
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

  // Connectors are OK: of, at, and, the, for, in, by, with, to, a
  const connectors = new Set(["of", "at", "and", "the", "for", "in", "by", "with", "to", "a", "an"]);

  if (words.length < 3) {
    // 2-word: only catch obvious camelCase merge or nav-prefix
    if (words.length >= 2) {
      if (/[a-z][A-Z]/.test(name)) return true; // CamelCase merge
      if (NAV_PREFIX_WORDS.has(words[0].toLowerCase())) return true;
    }
    return false;
  }

  // All words must be title-case with no connectors
  const allTitleCase = words.every(w => /^[A-Z][a-zA-Z'-]+$/.test(w));
  if (!allTitleCase) return false;

  const nonConnectors = words.filter(w => !connectors.has(w.toLowerCase()));

  // 3-word all-proper-noun with no connectors AND looks like two name pairs → stitched
  if (nonConnectors.length === 3 && words.length === 3 &&
      words.every(w => !connectors.has(w.toLowerCase()))) {
    // Contains two distinct runs that each look like a name word (3+ chars each)
    const nameLike = nonConnectors.filter(w => w.length >= 3 && /^[A-Z][a-z]+$/.test(w));
    if (nameLike.length === 3) return true; // Three standalone proper nouns = stitched
  }

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
// T007: Dollar/numeric entity name patterns — these are NOT valid entity names
const DOLLAR_ENTITY_PATTERN = /^[\$£€¥]?\s*\d[\d,\.]*\s*(billion|million|thousand|trillion|bn|mn|tr|[BMKT])?\b/i;
const PURE_NUMERIC = /^[\d\s\$£€,%\.\/\-\+]+$/;
const TRUNCATED_NAME = /\.{2,}$|…$/;
const URL_FRAGMENT = /^https?:\/\/|www\.|\.com|\.org|\.gov/i;
const JUNK_PHRASE_STARTERS = /^(said|says|told|stated|added|noted|wrote|reported|according|following|including|regarding|related|based|located|founded|established)/i;

export function validateEntityShape(name: string, entityType: string): "ARTIFACT_ENTITY" | null {
  const trimmed = name.trim();
  const words = trimmed.split(/\s+/);

  // Hard rules — apply to all types
  if (trimmed.length < 2) return "ARTIFACT_ENTITY";                        // too short
  if (words.length > 5) return "ARTIFACT_ENTITY";                          // >5 words → stitched garbage
  if (/["'""]/.test(trimmed)) return "ARTIFACT_ENTITY";                    // contains quotes
  if (/[;:]/.test(trimmed)) return "ARTIFACT_ENTITY";                      // contains colon or semicolon
  if (words.length > 3 && trimmed === trimmed.toUpperCase()) return "ARTIFACT_ENTITY"; // ALL CAPS phrase >3 words
  if (DOLLAR_ENTITY_PATTERN.test(trimmed)) return "ARTIFACT_ENTITY";       // dollar/numeric amount
  if (PURE_NUMERIC.test(trimmed)) return "ARTIFACT_ENTITY";                // pure numbers/symbols
  if (TRUNCATED_NAME.test(trimmed)) return "ARTIFACT_ENTITY";              // truncated mid-name
  if (URL_FRAGMENT.test(trimmed)) return "ARTIFACT_ENTITY";                // URL fragment
  if (JUNK_PHRASE_STARTERS.test(trimmed)) return "ARTIFACT_ENTITY";        // starts like a verb phrase
  if (/^\d{4}$/.test(trimmed)) return "ARTIFACT_ENTITY";                   // bare year
  if (trimmed.length > 60) return "ARTIFACT_ENTITY";                       // excessive length → sentence fragment

  // First-word gate — if the entity starts with a skip word (preposition, article, month, nav word)
  // this catches "With Amy Juravich", "March Madness", "From The", etc.
  if (SKIP_NAMES.has(words[0])) return "ARTIFACT_ENTITY";

  // Person-specific: must have at least 2 words
  if (entityType === "person") {
    if (words.length < 2) return "ARTIFACT_ENTITY";                        // single-word person (no last name)
    // Each word must start with a capital letter (basic name structure)
    const validName = words.every(w => /^[A-Z]/.test(w) || /^(de|van|von|le|la|al|el|ben|binti|bin)$/i.test(w));
    if (!validName) return "ARTIFACT_ENTITY";
    // First word must not be a known preposition/conjunction (catches "With Amy Juravich")
    const PERSON_FIRST_WORD_REJECT = new Set([
      "With", "From", "By", "For", "Of", "In", "On", "At", "To", "And", "Or",
      "But", "The", "A", "An", "About", "After", "Before", "Under", "Over",
      "During", "Since", "Until", "Without", "Against", "Between", "Through",
      "Along", "Around", "Behind", "Beyond", "Despite", "Except", "Into",
      "Among", "Across", "Within", "Upon", "Toward", "Towards",
    ]);
    if (PERSON_FIRST_WORD_REJECT.has(words[0])) return "ARTIFACT_ENTITY";
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

// ── Master Target Mode (Pass 28) ─────────────────────────────────────────────

export type TargetMode =
  | "person_target"
  | "organization_target"
  | "government_agency_target"
  | "place_target"
  | "program_target"
  | "funding_target"
  | "event_target"
  | "scandal_target"
  | "topic_investigation"
  | "general";

export interface TargetClassification {
  mode: TargetMode;
  label: string;           // clean display label
  confidence: number;      // 0.0–1.0
  seedIntent: SeedIntent;  // backward-compat
  intentLabel: string;     // human readable
}

/**
 * Master target classifier — determines what kind of investigative target this is.
 * More granular than classifySeedIntent; replaces it where full classification needed.
 */
export function classifyTarget(target: string): TargetClassification {
  const t = target.trim();
  const tl = t.toLowerCase();

  let mode: TargetMode = "general";
  let confidence = 0.5;

  // ── Scandal / Investigation indicators (highest priority) ─────────────────
  if (/\b(investigation|lawsuit|indictment|audit|corruption|fraud|probe|bribery|embezzl|kickback|misconduct|scandal|subpoena|affidavit|deposition|court|filing|charges|plea|conviction|verdict|whistleblower)\b/i.test(t)) {
    mode = "scandal_target";
    confidence = 0.85;
  }
  // ── Funding / Spending targets ─────────────────────────────────────────────
  else if (/\b(funding|grant|budget|contract|appropriation|spending|procurement|allocation|subsidy|award|reimbursement|invoice|payment|PAC|donation|contribution)\b/i.test(t)) {
    mode = "funding_target";
    confidence = 0.82;
  }
  // ── Government agency patterns ─────────────────────────────────────────────
  else if (/\b(Department of|Agency for|Bureau of|Office of|Administration|Commission|Authority|Federal|National|U\.S\.|USDA|FDA|EPA|FBI|CIA|NSA|DOJ|DHS|HHS|DOD|DEA|ATF|ICE|CBP|FEMA|SBA|CFPB|SEC|FTC|FCC|CISA)\b/i.test(t)) {
    mode = "government_agency_target";
    confidence = 0.88;
  }
  // ── Program / Initiative patterns ─────────────────────────────────────────
  else if (/\b(program|initiative|project|committee|board|council|task force|working group|division|office|center|institute|authority)\b/i.test(tl)) {
    mode = "program_target";
    confidence = 0.75;
  }
  // ── Organization patterns ─────────────────────────────────────────────────
  else if (/\b(inc\.|llc|corp\.|corporation|company|organization|nonprofit|foundation|firm|associates|group|holdings|partners|ventures|trust|PAC|committee)\b/i.test(t)) {
    mode = "organization_target";
    confidence = 0.84;
  }
  // ── Person name patterns: 2-4 capitalized tokens, no org keywords ─────────
  else if (/^[A-Z][a-z]{1,15}(\s+[A-Z]\.?)?(\s+[A-Z][a-z]{1,20}){1,3}$/.test(t) && !/\b(Inc|LLC|Corp|Foundation|Agency|Department|University|School|College|Institute|County|City|State)\b/.test(t)) {
    mode = "person_target";
    confidence = 0.88;
  }
  // ── Place / Location patterns ─────────────────────────────────────────────
  else if (/\b(city|county|state|country|district|region|territory|municipality|township|borough|village|province|nation|republic|kingdom)\b/i.test(tl) || /^[A-Z][a-z]+,?\s+[A-Z]{2}$/.test(t)) {
    mode = "place_target";
    confidence = 0.78;
  }
  // ── Event patterns ────────────────────────────────────────────────────────
  else if (/\b(election|vote|referendum|summit|conference|hearing|trial|raid|attack|disaster|crisis|outbreak|protest|riot|coup)\b/i.test(tl)) {
    mode = "event_target";
    confidence = 0.75;
  }
  // ── Topic investigation (multi-word investigative phrase) ─────────────────
  else if (t.split(/\s+/).length >= 3) {
    mode = "topic_investigation";
    confidence = 0.60;
  }

  // Legacy seedIntent for backward compat
  const seedIntent = classifySeedIntent(t);

  const INTENT_LABELS: Record<SeedIntent, string> = {
    policy_government: "Policy / Government",
    finance_funding: "Finance / Funding",
    housing_homelessness: "Housing / Homelessness",
    education_university: "Education / University",
    crime_corruption: "Crime / Corruption",
    entertainment_film: "Entertainment / Film",
    sports: "Sports",
    legal_lawsuit: "Legal / Lawsuit",
    general: "General Investigation",
  };

  const MODE_LABELS: Record<TargetMode, string> = {
    person_target: "Person of Interest",
    organization_target: "Organization",
    government_agency_target: "Government Agency",
    place_target: "Place / Location",
    program_target: "Program / Initiative",
    funding_target: "Funding / Financial Target",
    event_target: "Event / Incident",
    scandal_target: "Scandal / Investigation",
    topic_investigation: "Topic Investigation",
    general: "General Target",
  };

  return {
    mode,
    label: `${t} [${MODE_LABELS[mode]}]`,
    confidence,
    seedIntent,
    intentLabel: INTENT_LABELS[seedIntent],
  };
}

/**
 * Classify the seed target into a primary investigative intent (legacy, used internally).
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
    const onTopic = /\b(shelter|homeless|housing|unhoused|affordable|voucher|wrap.around|social.services|supportive|navigation.center|motel|encampment|program|department|county|city|fund|contract|grant|landlord|tenant|rent|subsidy|rehousing|transitional|skid.row|bed|services|outreach|case.manager|coordinator)\b/i.test(combined);
    // Hard off-topic signals for this intent
    const isWorldNews = /\b(war|military|conflict|missile|bomb|nuclear|sanctions|troops|regime|coup|terrorist|insurgent|cease.fire|occupation)\b/i.test(combined);
    const isCelebCtx  = /\b(celebrity|actor|actress|film|movie|album|concert|tour|debut|blockbuster|sequel|premiere|award.show|reality.tv|dating|romance)\b/i.test(combined);
    if (isCelebCtx && !onTopic) return "OFF_TOPIC";
    if (isSportsCtx && !onTopic) return "OFF_TOPIC";
    if (isWorldNews && !onTopic) return "OFF_TOPIC";
    if (onTopic && queryRatio >= 0.4) return "HIGH";
    if (onTopic || queryRatio >= 0.25) return "MEDIUM";
    if (isInvCtx && queryRatio >= 0.1) return "MEDIUM";
    if (!onTopic && !isInvCtx) return "LOW";
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
  // General — stronger OFF_TOPIC gate for celebrity/sports/entertainment drift
  if (isSportsCtx && queryRatio < 0.2) return "OFF_TOPIC";
  if (isEntCtx && queryRatio < 0.2) return "OFF_TOPIC";

  // Additional celebrity-context signal: if name is in celebrity set and no investigative context, reject
  const isCelebName = CELEBRITY_PERSON_NAMES.has(name);
  if (isCelebName && !isInvCtx && queryRatio < 0.35) return "OFF_TOPIC";

  // Hard OFF_TOPIC for pure gossip / lifestyle / entertainment contexts with no investigative hook
  const isPureGossip = /\b(relationship|dating|marriage|divorce|baby|pregnant|wedding|engagement|breakup|affair|cheating|paparazzi|red.carpet|fashion|outfit|dress|hairstyle|makeover|plastic.surgery|weight.loss|fitness.journey|celebrity.home|mansion|yacht|vacation|holiday)\b/i.test(combined);
  if (isPureGossip && !isInvCtx && queryRatio < 0.25) return "OFF_TOPIC";

  // Hard OFF_TOPIC for sports stats / game results with no investigative hook
  const isSportsStats = /\b(scored|points|rebounds|assists|yards|touchdowns|batting.average|ERA|home.runs|standings|championship|trophy|medal|world.cup|super.bowl|playoffs|bracket)\b/i.test(combined);
  if (isSportsStats && !isInvCtx && queryRatio < 0.2) return "OFF_TOPIC";

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

  // BLOCKLIST — media noise, navigation residue
  if (MEDIA_SOURCE_BLOCKLIST.has(entityName) || SKIP_NAMES.has(entityName))
    return { admit: false, rejectReason: "BLOCKLIST" };

  // SPORTS / ENTERTAINMENT ORG BLOCKLIST — always blocked unless intent matches
  if (SPORTS_ENTERTAINMENT_BLOCKLIST.has(entityName)) {
    if (seedIntent !== "entertainment_film" && seedIntent !== "sports")
      return { admit: false, rejectReason: "BLOCKLIST" };
  }

  // CELEBRITY PERSON BLOCKLIST — well-known entertainers/athletes blocked in non-entertainment cases
  if (entityType === "person" && CELEBRITY_PERSON_NAMES.has(entityName)) {
    if (seedIntent !== "entertainment_film" && seedIntent !== "sports")
      return { admit: false, rejectReason: "TOPIC_MISMATCH" };
  }

  // WORLD GEOGRAPHY DRIFT — foreign countries/regions that drift into domestic investigation stories
  if (WORLD_GEOGRAPHY_DRIFT_BLOCKLIST.has(entityName) && isSerious)
    return { admit: false, rejectReason: "TOPIC_MISMATCH" };

  // COMMON_FIRST_NAME — single first name person with no title/role context
  if (entityType === "person" && words.length === 1 && COMMON_FIRST_NAMES.has(nameL)) {
    if (role === "UNKNOWN" || role === "PERSON")
      return { admit: false, rejectReason: "COMMON_FIRST_NAME" };
  }

  // TITLE_FRAGMENT
  if (TITLE_FRAGMENT_PATTERNS.some((rx) => rx.test(entityName)))
    return { admit: false, rejectReason: "TITLE_FRAGMENT" };

  // BOILERPLATE_CONTEXT — tail/sidebar with short context = junk (raised thresholds)
  if ((zone === "tail" || zone === "sidebar") && context.trim().length < 80 && confidence < 0.68)
    return { admit: false, rejectReason: "BOILERPLATE_CONTEXT" };

  // TOPIC_MISMATCH — OFF_TOPIC entities are never admitted
  if (topicRelevance === "OFF_TOPIC")
    return { admit: false, rejectReason: "TOPIC_MISMATCH" };

  // LOW_CONFIDENCE — raised threshold for general admission
  if (confidence < 0.48)
    return { admit: false, rejectReason: "LOW_CONFIDENCE" };

  // For serious intents: entity only in tail with no role-bearing and LOW topic = reject
  if (isSerious && zone === "tail" && topicRelevance === "LOW" && role === "UNKNOWN")
    return { admit: false, rejectReason: "BOILERPLATE_CONTEXT" };

  // For serious intents: LOW topic + UNKNOWN role + confidence below raised threshold = reject
  // Raised from 0.72 to 0.80 to reduce noise — entities must be more clearly anchor-aligned
  if (isSerious && topicRelevance === "LOW" && role === "UNKNOWN" && confidence < 0.80)
    return { admit: false, rejectReason: "LOW_CONFIDENCE" };

  // General: LOW topic relevance + UNKNOWN role + below threshold → suppress
  if (!isSerious && topicRelevance === "LOW" && role === "UNKNOWN" && confidence < 0.65)
    return { admit: false, rejectReason: "LOW_CONFIDENCE" };

  // GENERIC_FRAGMENT — single-word entities that are non-specific institutional fragments
  if (words.length === 1 && entityType !== "person") {
    const GENERIC_STANDALONE = new Set([
      "department", "commission", "agency", "office", "council", "division",
      "branch", "bureau", "unit", "authority", "administration", "ministry",
      "chamber", "assembly", "coalition", "institute", "foundation",
      "organization", "association", "federation", "union", "committee",
    ]);
    if (GENERIC_STANDALONE.has(nameL))
      return { admit: false, rejectReason: "BLOCKLIST" };
  }

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
  // Entertainment / celebrity junk
  /^(?:the\s+)?(?:album|single|tour|concert|film|movie|episode|season|series|special|premiere|debut|release|soundtrack)\s*$/i,
  /^(?:award|grammy|oscar|emmy|tony|golden\s+globe|box\s+office|billboard)\s*$/i,
  // Generic "the X" article title fragments
  /^the\s+(?:city|state|county|court|board|department|office|agency|authority|commission|committee|council)\s*$/i,
  // Article section headers that slip through
  /^(?:read\s+also|see\s+also|related|advertisement|sponsored|in\s+other\s+news|earlier\s+today)\s*$/i,
  // Bare location adjectives
  /^(?:federal|state|local|national|regional|municipal|county|city|suburban|urban|rural|coastal|northern|southern|eastern|western)\s*$/i,
  // Generic standalone bureaucratic stubs
  /^(?:department|commission|agency|office|council|division|authority|administration|ministry)\s*$/i,
  // Article-title-style fragments ending in colon / number
  /^.+:\s*$|\d+\s*$|^\d+\s+.+$/,
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

// ── Type correction pass ────────────────────────────────────────────────────
// Entities that sound like orgs/programs/agencies should NOT be labeled person.
// If an entity name contains these structural indicators, force to org type.
const ORG_STRUCTURE_SUFFIXES = /\b(?:LLC|LLP|Inc\.?|Corp\.?|Co\.?|Ltd\.?|PLC|PLLC|LTD|INC|CORP|Partnership|Associates|Group|Holdings|Enterprises|Solutions|Services|Systems|Technologies|Networks|Capital|Ventures|Industries|Properties|Investments|Management|Consulting|Strategies)\b/i;
const ORG_NAME_KEYWORDS = /\b(?:Fund|Foundation|Institute|Authority|Board|Council|Commission|Committee|Agency|Bureau|Department|Program|Initiative|Project|Alliance|Coalition|Association|Federation|Union|League|Network|Center|Centre|Task Force|Working Group|Joint|Office|Division|Branch|Service|Trust|Society|Organization|Org|Club|School|University|College|Bank|Credit Union|Co-op|Cooperative)\b/i;
const GOVT_AGENCY_KEYWORDS = /\b(?:LAHSA|HACLA|LACDA|HUD|DOJ|FBI|DHS|HHS|CDC|EPA|IRS|SEC|CIA|NSA|ATF|DEA|FEMA|OMB|GAO|CBO|CFPB|FDIC|FTC|FCC|ICE|CBP|USCIS|USPS|TSA|FAA|NTSB|OSHA|NRC|NLRB|PBGC|SSA|VA|BLM|NPS|USFS|USFWS|BIA|BOR|BRE)\b/;

function correctEntityType(name: string, rawType: string): string {
  if (rawType === "person") {
    // If name matches org structural patterns, override to organization
    if (ORG_STRUCTURE_SUFFIXES.test(name)) return "organization";
    if (ORG_NAME_KEYWORDS.test(name)) return "organization";
    if (GOVT_AGENCY_KEYWORDS.test(name)) return "government_agency";
    // If name is all uppercase (likely acronym), likely an org
    if (/^[A-Z]{2,6}$/.test(name.trim())) return "government_agency";
  }
  if (rawType === "organization") {
    if (GOVT_AGENCY_KEYWORDS.test(name)) return "government_agency";
  }
  return rawType;
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
    // Apply type correction before any downstream logic
    const correctedType = correctEntityType(name, entityType);
    if (!isValidName(name, correctedType)) return;

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

    const { role, roleConfidence } = classifyEntityRole(name, ctx, correctedType);
    const topicRelevance = computeTopicRelevance(name, ctx, queryTerms, seedIntent);

    const mention: ExtractedMention = {
      entityName: name,
      entityType: correctedType,
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
  softEvent?: boolean;
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

const TIMELINE_EXTRACT_ACTION = /\b(?:approved?|funded?|allocated?|appropriated?|awarded?|contracted?|charged?|investigated?|indicted?|announced?|launched?|signed?|enacted?|ordered?|expanded?|audited?|subpoenaed?|arrested?|convicted?|sentenced?|settled?|dismissed?|reformed?|initiated?|established?|created?|passed?|opened?|founded?|started?|began?|purchased?|acquired?|sued?)\b/i;

export function extractTimelineEvents(text: string): ExtractedTimelineEvent[] {
  if (!text || text.trim().length < 20) return [];

  const events: ExtractedTimelineEvent[] = [];
  const seen = new Set<string>();

  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim().length > 20);

  for (const sentence of sentences) {
    const dateStr = extractDateFromSentence(sentence);
    if (!dateStr) continue;

    // Strict mode: require an investigative action keyword
    if (!TIMELINE_EXTRACT_ACTION.test(sentence)) continue;

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

/**
 * Soft timeline recovery: date + entity/program reference, no action keyword required.
 * Used as fallback when strict extractTimelineEvents returns 0 events.
 */

const SOFT_ENTITY_REF = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/;
const SOFT_PROGRAM_REF = /\b(?:program|project|initiative|fund|agency|department|office|authority|commission|bureau|administration|council)\b/i;

export function extractSoftTimelineEvents(text: string): ExtractedTimelineEvent[] {
  if (!text || text.trim().length < 20) return [];

  const events: ExtractedTimelineEvent[] = [];
  const seen = new Set<string>();
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim().length > 20);

  for (const sentence of sentences) {
    const dateStr = extractDateFromSentence(sentence);
    if (!dateStr) continue;

    // Must reference an entity name OR a program-type word
    const hasEntity = SOFT_ENTITY_REF.test(sentence);
    const hasProgram = SOFT_PROGRAM_REF.test(sentence);
    if (!hasEntity && !hasProgram) continue;

    const eventType = classifyEventType(sentence);
    const summary = sentence.trim().replace(/\s+/g, " ").slice(0, 200);
    const key = `${dateStr.slice(0, 10)}-${summary.slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    events.push({ eventDate: dateStr, eventType, summary, softEvent: true });
    if (events.length >= 8) break;
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
  controlledBy: string | null;
  receivedBy: string | null;
  programName: string | null;
  financialConfidence: number;
}

const MONEY_PATTERN = /(?:(USD|US\$|\$|£|€|GBP|EUR)\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(billion|million|thousand|trillion|bn|mn|tr|[BMKT])\b|(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(billion|million|thousand|trillion|bn|mn|tr|[BMK])\b(?:\s*(?:USD|US dollars?|dollars?))?|(USD|US\$|\$|£|€)\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?)|(USD|US\$|\$|£|€)\s*(\d{3,9}(?:\.\d+)?))/gi;

const FINANCIAL_PROXIMITY_PATTERN = /\b(funding|grant|budget|investment|contract|appropriation|allocation|spending|award(?:ed)?|program\s+fund|invest(?:ed|ment)|financed?|subsidized?|reimburse|settlement|procurement|invoice|payout|disburse|obligated?|encumbered?)\b/i;

const FINANCIAL_AD_COPY_PATTERN = /\b(sale|discount|off|coupon|promo|deal\s+of\s+the\s+day|limited\s+time|buy\s+now|add\s+to\s+cart|checkout|free\s+shipping|starting\s+at|as\s+low\s+as|per\s+month|subscription|plan|retail|price\s+drop|save\s+up\s+to|starting\s+from|season\s+pass|ticket\s+price|admission|box\s+office|gross(?:ing)?|earned|opening\s+weekend|revenue\s+for\s+(?:the\s+)?film|record\s+(?:breaking\s+)?box\s+office)\b/i;

const FINANCIAL_SPORTS_PATTERN = /\b(signing\s+bonus|contract\s+extension\s+for|salary\s+cap\s+hit|years?\s+deal|year\s+contract|nfl|nba|mlb|nhl|mls)\b/i;

const SIGNAL_TYPE_PATTERNS: { regex: RegExp; type: string }[] = [
  { regex: /\b(?:fraud|embezzl|kickback|brib(?:e|ery)|misappropriat|stolen|diverted|siphoned|laundered|phantom|fictitious|overbill|ghost\s+employee)\b/i, type: "FRAUD_MISUSE" },
  { regex: /\b(?:change\s+order|cost\s+overrun|over.budget|cost.overage|budget\s+overrun|change\s+directive)\b/i, type: "COST_OVERRUN" },
  { regex: /\b(?:audit\s+finding|ig\s+report|oig|inspector\s+general|questioned\s+cost|disallow(?:ed?|ance)|unallowable|unsupported\s+cost|audit\s+exception)\b/i, type: "AUDIT_FLAG" },
  { regex: /\b(?:contract(?:ed?|s)?|sole.source|no.bid|procurement|awarded?\s+contract|rfp|rfq|task\s+order|indefinite\s+delivery|idiq)\b/i, type: "CONTRACT" },
  { regex: /\b(?:grant(?:ed?|s)?|subgrant|cooperative\s+agreement|assistance\s+agreement|subaward)\b/i, type: "GRANT" },
  { regex: /\b(?:appropriat(?:ed?|ion|ions)?|budget(?:ed?)?|allocated?|allocation|congressional|legislative|omnibus|continuing\s+resolution)\b/i, type: "APPROPRIATION" },
  { regex: /\b(?:cut|reduc(?:ed?|tion)|eliminated?|rescission|clawback|withh(?:eld?|olding)|frozen|freeze|pulled|recission|sequester)\b/i, type: "CUT_REALLOCATION" },
  { regex: /\b(?:paid?|payment(?:s)?|pay(?:ing|s)?|reimburse|disburs(?:ed?|ement)|expenditure|spent|expended|invoice|invoiced?|billable)\b/i, type: "EXPENDITURE" },
  { regex: /\b(?:fund(?:ed?|ing|s)?|financed?|award(?:ed?|s)?|invest(?:ed?|ment|ing)|subsidized?|capitalized?)\b/i, type: "PROGRAM_FUNDING" },
];

const FUNDING_HARD_GATE = /\b(funded?|grant(?:ed?)?|contract(?:ed?)?|appropriated?|allocated?|awarded?|paid?|payment|budget|procurement|reimburse|disburse|spending|expenditure|invest(?:ment|ed)|subsidized?|sole.source|no.bid|change\s+order|cost\s+overrun|audit\s+finding|questioned\s+cost|disallow|oig|inspector\s+general|task\s+order|invoice|invoiced?|capitalized?|encumbered?|obligated?)\b/i;

const CONTROL_VERB_PATTERN = /\b(?:controlled?\s+by|overseen?\s+by|managed?\s+by|administered?\s+by|directed?\s+by|authorized?\s+by|approved?\s+by|led?\s+by|operated?\s+by)\b/i;
const RECEIVE_VERB_PATTERN = /\b(?:received?\s+by|awarded?\s+to|paid?\s+to|granted?\s+to|contracted?\s+(?:to|with)|given\s+to|allocated?\s+to|disbursed?\s+to|transferred?\s+to)\b/i;
const PROGRAM_INDICATOR = /\b(?:program|project|initiative|fund|grant|contract|appropriation)\b/i;

function normalizeAmount(raw: string): { amount: number | null; currency: string; display: string } {
  let currency = "USD";
  let currencySymbol = "$";
  if (/£|GBP/i.test(raw)) { currency = "GBP"; currencySymbol = "£"; }
  else if (/€|EUR/i.test(raw)) { currency = "EUR"; currencySymbol = "€"; }

  // Extract scale word from original raw string (before stripping spaces) to preserve \b boundaries
  const scaleMatch = /\b(billion|million|thousand|trillion|bn|mn|tr|[bmkt])\b/i.exec(raw);
  // Strip currency symbols, commas, spaces, and scale words to isolate the numeric value
  const numericPart = raw
    .replace(/USD|US\$|GBP|EUR|[$£€,]/gi, "")
    .replace(/\b(?:billion|million|thousand|trillion|bn|mn|tr|[bmkt])\b/gi, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  const base = parseFloat(numericPart);
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

function extractActorNearVerb(sentence: string, verbPattern: RegExp): string | null {
  const m = verbPattern.exec(sentence);
  if (!m) return null;
  const afterVerb = sentence.slice(m.index + m[0].length).trim();
  const nm = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4})\b/.exec(afterVerb);
  return nm ? nm[1] : null;
}

function extractProgramName(sentence: string): string | null {
  const m = /\b(?:the\s+)?([A-Z][A-Za-z\s]{3,40}(?:Program|Project|Initiative|Fund|Act|Grant))\b/.exec(sentence);
  return m ? m[1].trim() : null;
}

// Strong explicit appropriation/award verbs — highest confidence signals
const EXPLICIT_AWARD_GATE = /\b(?:awarded|appropriated|contracted|disbursed|allocated|reimburse[d]?|procured|sole[\s-]source[d]?|no[\s-]bid|grant(?:ed)?)\b/i;
// Directional flow verbs — recipient/payer relationships
const DIRECTED_FLOW_GATE = /\b(?:received|obtained|secured|paid(?:\s+out)?|funneled|channeled|transferred|redirected)\b/i;

function scoreFinancialConfidence(
  sentence: string,
  signalType: string,
  entityName: string | null,
  anchorTokens: string[]
): number {
  let score = 0.0;

  // Funding hard gate present (base requirement)
  if (FUNDING_HARD_GATE.test(sentence)) score += 0.20;

  // Tier-1: explicit appropriation/award language (strongest signal)
  if (EXPLICIT_AWARD_GATE.test(sentence)) score += 0.25;
  // Tier-2: directional flow verbs
  else if (DIRECTED_FLOW_GATE.test(sentence)) score += 0.15;
  // Tier-3: generic funding keyword
  else if (/\b(?:funded?|invested?|subsidized?|financed?)\b/i.test(sentence)) score += 0.08;

  // Named actor in sentence
  if (entityName) score += 0.12;

  // controlledBy or receivedBy verb phrase (explicit relationship)
  if (CONTROL_VERB_PATTERN.test(sentence) && RECEIVE_VERB_PATTERN.test(sentence)) score += 0.12;
  else if (CONTROL_VERB_PATTERN.test(sentence) || RECEIVE_VERB_PATTERN.test(sentence)) score += 0.07;

  // High-severity signal type
  if (signalType === "FRAUD_MISUSE") score += 0.12;
  else if (signalType === "CONTRACT" || signalType === "APPROPRIATION") score += 0.10;
  else if (signalType === "GRANT" || signalType === "CUT_REALLOCATION") score += 0.05;

  // Has program name
  if (PROGRAM_INDICATOR.test(sentence)) score += 0.05;

  // Anchor token overlap — weighted heavily (primary relevance signal)
  if (anchorTokens.length > 0) {
    const lower = sentence.toLowerCase();
    const hits = anchorTokens.filter(t => lower.includes(t)).length;
    if (hits >= 3) score += 0.15;
    else if (hits >= 2) score += 0.10;
    else if (hits === 1) score += 0.05;
    // Penalty: no anchor overlap likely means a side story
    else score -= 0.05;
  }

  return Math.min(1.0, Math.max(0, Math.round(score * 100) / 100));
}

export function extractFinancialSignals(text: string, anchorTokens: string[] = []): ExtractedFinancialSignal[] {
  if (!text || text.trim().length < 20) return [];

  const signals: ExtractedFinancialSignal[] = [];
  const seen = new Set<string>();
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim().length > 10);

  for (const sentence of sentences) {
    // F1: BOTH a monetary amount AND a hard funding keyword must be present
    if (!FUNDING_HARD_GATE.test(sentence)) continue;

    // F4: Kill noise — ad copy, sports, entertainment
    if (FINANCIAL_AD_COPY_PATTERN.test(sentence)) continue;
    if (FINANCIAL_SPORTS_PATTERN.test(sentence)) continue;

    // F4: Additional garbage patterns
    const COMMUNITY_NOISE = /\b(festival|concert|parade|raffle|bake\s+sale|donation\s+drive|fundraiser|gala|auction|charity\s+run|walk\s+for|community\s+event|annual\s+dinner|gofundme|crowdfund)\b/i;
    if (COMMUNITY_NOISE.test(sentence)) continue;

    MONEY_PATTERN.lastIndex = 0;
    let match;
    while ((match = MONEY_PATTERN.exec(sentence)) !== null) {
      const amountRaw = match[0].trim();
      if (!amountRaw || amountRaw.length < 2) continue;

      const { amount, currency, display } = normalizeAmount(amountRaw);
      // Require at least $1,000 minimum to capture line items, change orders, and small contract amounts
      if (amount === null || amount < 1_000) continue;

      const dedupKey = display;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      // F2: 6-type classification
      const signalType = getSignalType(sentence);
      const summary = sentence.trim().replace(/\s+/g, " ").slice(0, 250);

      // F3: Extract WHO controls and WHO receives
      const controlledBy = extractActorNearVerb(sentence, CONTROL_VERB_PATTERN);
      const receivedBy = extractActorNearVerb(sentence, RECEIVE_VERB_PATTERN);
      const programName = extractProgramName(sentence);

      // Primary entity name: prefer receivedBy, then first proper noun
      let entityName: string | null = receivedBy ?? controlledBy ?? null;
      if (!entityName) {
        const properNounMatch = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\b/.exec(sentence);
        if (properNounMatch) entityName = properNounMatch[1];
      }

      // F5: Confidence scoring
      const financialConfidence = scoreFinancialConfidence(sentence, signalType, entityName, anchorTokens);

      signals.push({
        amountRaw,
        amountDisplay: display,
        normalizedAmount: amount,
        currency,
        signalType,
        eventSummary: summary,
        entityName,
        controlledBy,
        receivedBy,
        programName,
        financialConfidence,
      });
      if (signals.length >= 30) return signals;
    }
  }

  return signals;
}

/**
 * Non-numeric signal extraction (P4): detects funding language WITHOUT a dollar amount.
 * Creates NON_NUMERIC_SIGNAL entries — no amount, confidence capped at 0.5.
 * Used to populate intelligence when hard dollar amounts are absent.
 */

const NON_NUMERIC_FUNDING_GATE = /\b(?:funding|budget|program\s+cost|allocated?|allocation|spending|appropriation|grant(?:ed?)?|contract(?:ed?)?|procurement|invest(?:ment|ed)|subsidized?|expenditure|financing|funded?)\b/i;
const NON_NUMERIC_NOISE = /\b(?:click|subscribe|newsletter|sale|discount|promo|coupon|offer|deal|cart|checkout|percent\s+off|sign\s+up|free\s+trial|unlimited|monthly|weekly|per\s+month)\b/i;

export function extractNonNumericSignals(text: string, anchorTokens: string[] = []): ExtractedFinancialSignal[] {
  if (!text || text.trim().length < 20) return [];

  const signals: ExtractedFinancialSignal[] = [];
  const seen = new Set<string>();
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim().length > 10);

  for (const sentence of sentences) {
    if (!NON_NUMERIC_FUNDING_GATE.test(sentence)) continue;
    if (NON_NUMERIC_NOISE.test(sentence)) continue;
    if (FINANCIAL_AD_COPY_PATTERN.test(sentence)) continue;
    if (FINANCIAL_SPORTS_PATTERN.test(sentence)) continue;

    // T003: Require an explicit award or directed-flow verb — kills generic "budget" / "fund" false signals
    // e.g. "The program has a significant budget" is filtered; "The grant was awarded to XYZ" passes
    if (!EXPLICIT_AWARD_GATE.test(sentence) && !DIRECTED_FLOW_GATE.test(sentence)) continue;

    // Must have entity/program context to be useful
    const entityMatch = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/.exec(sentence);
    const hasProgram = SOFT_PROGRAM_REF.test(sentence);
    if (!entityMatch && !hasProgram) continue;

    const signalType = getSignalType(sentence);
    const summary = sentence.trim().replace(/\s+/g, " ").slice(0, 250);
    const entityName = entityMatch ? entityMatch[1] : null;
    const programName = extractProgramName(sentence);

    const dedupKey = `NON_NUMERIC:${summary.slice(0, 80)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    // Confidence: base 0.2 + anchor overlap bonus
    let conf = 0.20;
    if (anchorTokens.length > 0) {
      const lower = sentence.toLowerCase();
      const hits = anchorTokens.filter(t => lower.includes(t)).length;
      if (hits >= 2) conf += 0.20;
      else if (hits === 1) conf += 0.10;
    }
    if (entityName) conf += 0.10;
    conf = Math.min(0.50, Math.round(conf * 100) / 100);

    signals.push({
      amountRaw: "",
      amountDisplay: "NON-NUMERIC",
      normalizedAmount: null,
      currency: "USD",
      signalType: `NON_NUMERIC_${signalType}`,
      eventSummary: summary,
      entityName,
      controlledBy: extractActorNearVerb(sentence, CONTROL_VERB_PATTERN),
      receivedBy: extractActorNearVerb(sentence, RECEIVE_VERB_PATTERN),
      programName,
      financialConfidence: conf,
    });
    if (signals.length >= 5) break;
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
  // Government / primary source (highest trust)
  ".gov", ".ca.gov", "senate.gov", "house.gov", "congress.gov",
  "lacounty.gov", "lacity.gov", "lacontroller.org",
  "pacer.gov", "courtlistener.com", "documentcloud.org", "recap.law",
  // National investigative / wire (high trust)
  "latimes.com", "nytimes.com", "washingtonpost.com", "propublica.org",
  "apnews.com", "reuters.com", "bloomberg.com", "wsj.com",
  "theatlantic.com", "politico.com", "theintercept.com",
  "theguardian.com", "npr.org", "pbs.org",
  // TV / broadcast news
  "nbcnews.com", "cbsnews.com", "abcnews.go.com", "cnn.com",
  // Local CA investigative
  "calmatters.org", "laist.com", "kpcc.org", "kcrw.com",
  "voiceofsandiego.org", "sfchronicle.com", "sacbee.com",
  "abc7.com", "nbcla.com", "ktla.com",
  // Text signals (path-based audit docs)
  "inspector", "audit", "oversight",
];

export interface DocRelevanceResult {
  score: number;
  priority: "PRIORITY_A" | "PRIORITY_B" | "LOW_SIGNAL" | "NOISE";
  tier: "CORE" | "RELEVANT" | "PERIPHERAL" | "OFF_TOPIC" | "CONTAMINATED";
  anchorScore: number;
  titleHit: boolean;
  leadHit: boolean;
  entityOverlap: number;
  modeCompatibility: "compatible" | "partial" | "incompatible";
  seedIntent: SeedIntent;
  topicAlignment: "aligned" | "partial" | "mismatched" | "unknown";
  mismatchReason: string;
  boosts: string[];
  penalties: string[];
}

// ── Case Anchor System ─────────────────────────────────────────────────────────

export interface CaseAnchor {
  rawTarget: string;
  normalizedTarget: string;
  targetMode: TargetMode;
  anchorTokens: string[];
  strongAnchorTokens: string[];
  hardNegativeTokens: string[];
}

const ANCHOR_STOP_WORDS = new Set([
  "the","and","for","are","but","not","you","all","can","had","her","was","one",
  "our","out","day","get","has","him","his","how","man","new","now","old","see",
  "two","way","who","boy","did","its","let","put","say","she","too","use","that",
  "with","have","this","will","your","from","they","know","want","been","good",
  "much","some","time","very","when","come","here","just","like","long","make",
  "many","more","only","over","such","take","than","them","well","were",
]);

export function buildCaseAnchor(target: string, targetMode: TargetMode): CaseAnchor {
  const normalized = target.trim().toLowerCase();
  const rawTokens = normalized
    .split(/[\s\-_,;:&()]+/)
    .map(t => t.replace(/['".,!?]/g, "").trim())
    .filter(t => t.length >= 3 && !ANCHOR_STOP_WORDS.has(t));

  const anchorTokens: string[] = [...new Set(rawTokens)];
  const strongAnchorTokens: string[] = [...new Set(rawTokens.filter(t => t.length >= 5))];

  const modeExtras: string[] = [];
  switch (targetMode) {
    case "person_target":
      if (rawTokens.length >= 2) {
        const last = rawTokens[rawTokens.length - 1];
        if (!strongAnchorTokens.includes(last)) strongAnchorTokens.push(last);
      }
      break;
    case "government_agency_target":
      modeExtras.push("agency", "department", "federal", "office", "bureau");
      break;
    case "funding_target":
      modeExtras.push("grant", "contract", "funding", "award", "budget", "appropriation");
      break;
    case "scandal_target":
      modeExtras.push("investigation", "fraud", "corruption", "probe", "audit", "misconduct");
      break;
    case "organization_target":
      modeExtras.push("organization", "nonprofit", "foundation", "company");
      break;
    case "program_target":
      modeExtras.push("program", "initiative", "project", "division");
      break;
  }
  for (const e of modeExtras) {
    if (!anchorTokens.includes(e)) anchorTokens.push(e);
  }

  const hardNegativeTokens: string[] = [];
  if (targetMode !== "person_target") {
    hardNegativeTokens.push("sports", "game", "player", "celebrity", "gossip", "recipe", "lifestyle");
  }
  if (targetMode !== "event_target" && targetMode !== "scandal_target") {
    hardNegativeTokens.push("horoscope", "fiction", "novel", "album", "concert", "tour");
  }

  return {
    rawTarget: target.trim(),
    normalizedTarget: normalized,
    targetMode,
    anchorTokens: [...new Set(anchorTokens)],
    strongAnchorTokens: [...new Set(strongAnchorTokens)],
    hardNegativeTokens,
  };
}

/**
 * Score a document 0–100 for investigative relevance.
 * seedIntent influences topic alignment scoring and hard suppressors.
 * anchor (optional) adds case-specific anchor token scoring.
 */
export function computeDocRelevanceScore(
  bodyText: string,
  title: string,
  queryTerms: string[],
  sourceDomain = "",
  seedIntent: SeedIntent = "general",
  anchor?: CaseAnchor
): DocRelevanceResult {
  const boosts: string[] = [];
  const penalties: string[] = [];
  let score = 50;
  let mismatchReason = "";

  const titleL = title.toLowerCase();
  const bodyL = bodyText.toLowerCase();
  const domainL = sourceDomain.toLowerCase();

  // ── Case Anchor scoring ───────────────────────────────────────────────────
  let anchorScore = 0;
  let titleHit = false;
  let leadHit = false;
  let entityOverlap = 0;
  let modeCompatibility: DocRelevanceResult["modeCompatibility"] = "partial";

  if (anchor) {
    const leadText = bodyL.slice(0, 600);
    const primaryTokens = anchor.anchorTokens.slice(0, 8); // cap to avoid noise
    const strongTokens = anchor.strongAnchorTokens.slice(0, 6);

    // Title hit: any strong anchor token in title
    titleHit = strongTokens.length > 0
      ? strongTokens.some(t => titleL.includes(t))
      : primaryTokens.some(t => titleL.includes(t));

    // Lead hit: any strong anchor token in first 600 chars
    leadHit = strongTokens.length > 0
      ? strongTokens.some(t => leadText.includes(t))
      : primaryTokens.some(t => leadText.includes(t));

    // Entity overlap: count of anchor tokens found anywhere in body
    const bodyHits = primaryTokens.filter(t => bodyL.includes(t));
    entityOverlap = bodyHits.length;

    // anchorScore: 0–100 based on how well this doc matches the anchor
    const tokenHitRatio = primaryTokens.length > 0 ? entityOverlap / primaryTokens.length : 0;
    anchorScore = Math.round(
      (titleHit ? 35 : 0) +
      (leadHit ? 20 : 0) +
      tokenHitRatio * 35 +
      (entityOverlap >= 2 ? 10 : 0)
    );

    // Mode compatibility
    if (anchor.hardNegativeTokens.some(t => titleL.includes(t) || leadText.includes(t))) {
      modeCompatibility = "incompatible";
    } else if (anchorScore >= 40) {
      modeCompatibility = "compatible";
    } else {
      modeCompatibility = "partial";
    }

    // Apply anchor score to document score
    if (titleHit) { score += 18; boosts.push("anchor-title-hit"); }
    if (leadHit && !titleHit) { score += 10; boosts.push("anchor-lead-hit"); }
    if (entityOverlap >= 3) { score += 8; boosts.push(`anchor-overlap-${entityOverlap}x`); }
    else if (entityOverlap >= 1) { score += 3; }

    // Hard negative: anchor mode-incompatible signals in title
    if (modeCompatibility === "incompatible") {
      score -= 20; penalties.push("anchor-mode-incompatible");
    }

    // If zero anchor tokens hit and this isn't a general query, soft penalty
    if (entityOverlap === 0 && primaryTokens.length >= 2 && anchor.targetMode !== "general") {
      score -= 12; penalties.push("anchor-no-overlap");
    }
  }

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
  // Hard block for clearly off-topic sports / entertainment docs regardless of keyword hits
  // A sports doc that happens to contain a query keyword (e.g. "funding") should still be blocked
  // if it has zero investigative content anchors.
  if (
    isSportsDoc &&
    topicAlignment === "mismatched" &&
    titleInvHits === 0 &&
    !penalties.some(p => p === "hard-mismatch-suppressed")
  ) {
    score = Math.min(score, 14);
    penalties.push("sports-hard-block");
  }
  if (
    isEntertainmentDoc &&
    topicAlignment === "mismatched" &&
    titleInvHits === 0 &&
    !penalties.some(p => p === "hard-mismatch-suppressed")
  ) {
    score = Math.min(score, 14);
    penalties.push("entertainment-hard-block");
  }

  // ── Clamp and bucket ─────────────────────────────────────────────────────
  const finalScore = Math.round(Math.max(0, Math.min(100, score)));
  let priority: DocRelevanceResult["priority"];
  if (finalScore >= 65) priority = "PRIORITY_A";
  else if (finalScore >= 40) priority = "PRIORITY_B";
  else if (finalScore >= 18) priority = "LOW_SIGNAL";
  else priority = "NOISE";

  // ── Tier classification (3.0) ─────────────────────────────────────────────
  let tier: DocRelevanceResult["tier"];
  if (topicAlignment === "mismatched" && modeCompatibility !== "compatible") {
    tier = "OFF_TOPIC";
  } else if (priority === "NOISE") {
    tier = "CONTAMINATED";
  } else if (anchor && anchorScore >= 60 && priority === "PRIORITY_A") {
    tier = "CORE";
  } else if (anchor && anchorScore >= 30 && (priority === "PRIORITY_A" || priority === "PRIORITY_B")) {
    tier = "RELEVANT";
  } else if (priority === "PRIORITY_A" || priority === "PRIORITY_B") {
    tier = "RELEVANT";
  } else if (priority === "LOW_SIGNAL") {
    tier = "PERIPHERAL";
  } else {
    tier = "CONTAMINATED";
  }

  return {
    score: finalScore,
    priority,
    tier,
    anchorScore,
    titleHit,
    leadHit,
    entityOverlap,
    modeCompatibility,
    seedIntent,
    topicAlignment,
    mismatchReason,
    boosts,
    penalties,
  };
}

// ── Anchor-aware timeline + financial filtering ───────────────────────────────

export interface RawTimelineEvent {
  eventDate: string;
  eventType: string;
  summary: string;
  softEvent?: boolean;
}

export interface RawFinancialSignal {
  amountRaw: string;
  amountDisplay?: string;
  normalizedAmount?: number | null;
  currency?: string;
  signalType: string;
  eventSummary?: string | null;
  entityName?: string | null;
  controlledBy?: string | null;
  receivedBy?: string | null;
  programName?: string | null;
  financialConfidence?: number;
  inferredSignal?: boolean;
}

const TIMELINE_ACTION_KEYWORDS = /\b(?:approved?|funded?|allocated?|appropriated?|awarded?|contracted?|charged?|investigated?|indicted?|announced?|launched?|signed?|enacted?|ordered?|expanded?|audited?|subpoenaed?|arrested?|convicted?|sentenced?|settled?|dismissed?|reformed?|initiated?|established?|created?|passed?)\b/i;

/**
 * Filter extracted timeline events using anchor token overlap + action keyword.
 * Rejects events with no anchor token OR no action keyword in their summary.
 */
export function filterTimelineByAnchor(
  events: RawTimelineEvent[],
  anchor: CaseAnchor
): RawTimelineEvent[] {
  const primaryTokens = anchor.anchorTokens.slice(0, 8);
  return events.filter(ev => {
    const text = `${ev.summary} ${ev.eventType}`.toLowerCase();
    // Must have an action keyword (strict mode)
    if (!TIMELINE_ACTION_KEYWORDS.test(ev.summary)) return false;
    // If no anchor tokens, accept any action-keyword event
    if (primaryTokens.length === 0) return true;
    // Accept if any anchor token appears in the event summary
    return primaryTokens.some(t => text.includes(t));
  });
}

/**
 * Filter extracted financial signals using anchor token overlap.
 * Strict mode: requires anchor overlap AND the signal must have context.
 * Signals without any context (no summary, no entity) are rejected.
 */
export function filterFinancialByAnchor(
  signals: RawFinancialSignal[],
  anchor: CaseAnchor
): RawFinancialSignal[] {
  const primaryTokens = anchor.anchorTokens.slice(0, 8);
  return signals.filter(sig => {
    // Reject signals with no context whatsoever
    if (!sig.eventSummary && !sig.entityName) return false;
    // If no anchor tokens, apply financial-only proximity check
    if (primaryTokens.length === 0) return !!sig.eventSummary;
    const text = `${sig.eventSummary ?? ""} ${sig.entityName ?? ""} ${sig.amountRaw}`.toLowerCase();
    // Accept if any anchor token appears
    return primaryTokens.some(t => text.includes(t));
  });
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
