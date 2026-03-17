import { db } from "@workspace/db";
import {
  casesTable,
  documentsTable,
  entitiesTable,
  entityMentionsTable,
  timelineEntriesTable,
  financialSignalsTable,
} from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RankedDocument {
  id: number;
  title: string;
  source: string | null;
  score: number;
  scoreBreakdown: string;
  priority: string;
  alignment: string;
  chars: number;
  hasTimeline: boolean;
  hasFinancial: boolean;
  entityCount: number;
}

export interface RankedEntity {
  id: number;
  name: string;
  type: string;
  mentionCount: number;
  docSupport: number;
  avgConfidence: number;
  maxConfidence: number;
  promotionReason: string;
  isPrimary: boolean;
}

export interface RankedTimelineEvent {
  id: number;
  title: string;
  eventDate: string;
  eventType: string;
  priority: number;
}

export interface RankedFinancialSignal {
  id: number;
  amountRaw: string;
  normalizedAmount: number | null;
  signalType: string;
  eventSummary: string | null;
  entityName: string | null;
  documentTitle: string | null;
}

export interface CaseBrief {
  caseId: number;
  caseTitle: string;
  seedIntent: string | null;
  compiledAt: string;
  dataQuality: "STRONG" | "MODERATE" | "WEAK" | "EMPTY";
  qualityNote: string;

  whatThisCaseIs: string;
  primaryActors: string[];
  primaryOrganizations: string[];

  keyEvidence: RankedDocument[];
  topTimeline: RankedTimelineEvent[];
  topFinancial: RankedFinancialSignal[];

  primaryEntities: RankedEntity[];
  secondaryEntities: RankedEntity[];

  currentState: string;
  knownGaps: string[];
  suggestedNextQueries: string[];

  stats: {
    totalDocs: number;
    usableDocs: number;
    totalEntities: number;
    totalTimeline: number;
    totalFinancial: number;
    totalMentions: number;
  };
}

// ── ATLAS-DIAG parser ────────────────────────────────────────────────────────

function parseAtlasDiag(rawText: string | null): Record<string, string> {
  if (!rawText) return {};
  const m = /^\[ATLAS-DIAG:([^\]]+)\]/.exec(rawText || "");
  if (!m) return {};
  const result: Record<string, string> = {};
  for (const part of m[1].split("|")) {
    const idx = part.indexOf("=");
    if (idx > 0) result[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return {};
}

function parseDiagSafe(rawText: string | null): Record<string, string> {
  if (!rawText) return {};
  const m = /^\[ATLAS-DIAG:([^\]]+)\]/.exec(rawText);
  if (!m) return {};
  const result: Record<string, string> = {};
  for (const part of m[1].split("|")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx > 0) {
      result[part.slice(0, eqIdx)] = part.slice(eqIdx + 1);
    }
  }
  return result;
}

function parseSeedDiagDescription(description: string | null): { seedIntent?: string } {
  if (!description) return {};
  const m = /\[SEED_DIAG:([^\]]+)\]/.exec(description);
  if (!m) return {};
  const kv: Record<string, string> = {};
  for (const part of m[1].split("|")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx > 0) kv[part.slice(0, eqIdx)] = part.slice(eqIdx + 1);
  }
  return { seedIntent: kv["intent"] };
}

// ── Event type priority ───────────────────────────────────────────────────────

const EVENT_TYPE_RANK: Record<string, number> = {
  FUNDING_APPROVED: 10,
  CONTRACT_AWARDED: 10,
  LEGAL_ACTION: 9,
  AUDIT: 9,
  INVESTIGATION_STARTED: 8,
  PROGRAM_LAUNCH: 7,
  PROPERTY_ACQUISITION: 7,
  POLICY_CHANGE: 6,
  PROGRAM_EXPANSION: 5,
  EVENT: 1,
};

// ── Core compiler ─────────────────────────────────────────────────────────────

export async function compileCaseBrief(caseId: number): Promise<CaseBrief> {
  // Load all data in parallel
  const [caseRow, docs, entities, mentionStats, timelineEntries, financialSignals] = await Promise.all([
    db.select().from(casesTable).where(eq(casesTable.id, caseId)).then(r => r[0]),
    db.select().from(documentsTable).where(eq(documentsTable.caseId, caseId)),
    db.select().from(entitiesTable).where(eq(entitiesTable.caseId, caseId)),
    db
      .select({
        entityName: entityMentionsTable.entityName,
        mentionCount: sql<number>`cast(count(*) as int)`,
        docCount: sql<number>`cast(count(distinct ${entityMentionsTable.documentId}) as int)`,
        avgConf: sql<number>`cast(avg(${entityMentionsTable.confidence}) as float)`,
        maxConf: sql<number>`cast(max(${entityMentionsTable.confidence}) as float)`,
      })
      .from(entityMentionsTable)
      .where(eq(entityMentionsTable.caseId, caseId))
      .groupBy(entityMentionsTable.entityName),
    db.select().from(timelineEntriesTable).where(eq(timelineEntriesTable.caseId, caseId)),
    db.select().from(financialSignalsTable).where(eq(financialSignalsTable.caseId, caseId)),
  ]);

  if (!caseRow) throw new Error(`Case ${caseId} not found`);

  const { seedIntent } = parseSeedDiagDescription(caseRow.description);

  // Build lookup maps
  const mentionMap = new Map(mentionStats.map(m => [m.entityName, m]));

  // Doc-level aggregates: timeline and financial signal counts per doc
  const docTimelineCount = new Map<number, number>();
  for (const te of timelineEntries) {
    if (te.linkedDocumentId) {
      docTimelineCount.set(te.linkedDocumentId, (docTimelineCount.get(te.linkedDocumentId) ?? 0) + 1);
    }
  }
  const docFinancialCount = new Map<number, number>();
  for (const fs of financialSignals) {
    if (fs.documentId) {
      docFinancialCount.set(fs.documentId, (docFinancialCount.get(fs.documentId) ?? 0) + 1);
    }
  }

  // ── Score documents (A1) ────────────────────────────────────────────────────

  const scoredDocs: RankedDocument[] = [];
  let usableCount = 0;

  for (const doc of docs) {
    const diag = parseDiagSafe(doc.rawText);

    const status = diag["status"] ?? "unknown";
    if (status === "failed" || status === "wrapper") continue;
    if ((doc.rawText?.length ?? 0) < 100) continue;

    usableCount++;

    const diagScore = parseInt(diag["score"] ?? "0", 10) || 0;
    const priority = diag["priority"] ?? "PRIORITY_B";
    const alignment = diag["alignment"] ?? "unknown";
    const chars = parseInt(diag["chars"] ?? "0", 10) || 0;
    const entityCount = parseInt(diag["entities"] ?? "0", 10) || 0;

    let composite = diagScore;
    if (priority === "PRIORITY_A") composite += 15;
    else if (priority === "PRIORITY_B") composite += 5;
    if (alignment === "matched") composite += 10;
    else if (alignment === "partial") composite += 4;
    if (chars > 5000) composite += 8;
    else if (chars > 2000) composite += 4;

    const hasTimeline = (docTimelineCount.get(doc.id) ?? 0) > 0;
    const hasFinancial = (docFinancialCount.get(doc.id) ?? 0) > 0;
    if (hasTimeline) composite += 12;
    if (hasFinancial) composite += 14;
    if (entityCount >= 5) composite += 6;
    else if (entityCount >= 2) composite += 3;

    const breakdownParts: string[] = [];
    if (diagScore > 0) breakdownParts.push(`relevance=${diagScore}`);
    if (priority === "PRIORITY_A") breakdownParts.push("priority=A");
    if (alignment === "matched") breakdownParts.push("aligned");
    if (hasTimeline) breakdownParts.push("has_timeline");
    if (hasFinancial) breakdownParts.push("has_financial");

    scoredDocs.push({
      id: doc.id,
      title: doc.title || "(untitled)",
      source: doc.sourceDomain || doc.source || null,
      score: composite,
      scoreBreakdown: breakdownParts.join(" · "),
      priority,
      alignment,
      chars,
      hasTimeline,
      hasFinancial,
      entityCount,
    });
  }

  scoredDocs.sort((a, b) => b.score - a.score);
  const keyEvidence = scoredDocs.slice(0, 5);

  // ── Rank entities (A2) ──────────────────────────────────────────────────────
  // Primary source: mentionStats (entity-mention aggregates by name, which are
  // always populated if the pipeline ran).  entitiesTable is used only for type
  // enrichment via a case-insensitive name lookup.

  // Build a name→type lookup from entitiesTable (normalised lower)
  const entityTypeMap = new Map<string, string>();
  const entityIdMap = new Map<string, number>();
  for (const e of entities) {
    if (!e.name) continue;
    const key = e.name.toLowerCase().trim();
    entityTypeMap.set(key, e.type || "unknown");
    entityIdMap.set(key, e.id);
  }

  // Common single-word non-entity words that slip through NER
  const JUNK_SINGLE_WORDS = new Set([
    "intel","outdated","news","more","skip","content","share","read","next","back","home",
    "image","photo","video","media","click","here","link","source","data","info","analysis",
    "report","update","latest","breaking","continue","extended","forecast","satellite",
    "navigation","menu","footer","header","sidebar","advertisement","sponsored",
    "subscribe","follow","support","contact","about","privacy","terms",
  ]);

  // Boilerplate / junk name filter
  const isJunkName = (name: string): boolean => {
    if (name.length > 60) return true;
    if (name.length < 3) return true;
    if (/[\u{1F300}-\u{1FFFF}]/u.test(name)) return true; // emoji
    if (/https?:\/\//.test(name)) return true;
    if (/^\d+$/.test(name)) return true;
    if ((name.match(/[A-Z]/g) || []).length > 15) return true; // ALL-CAPS noise
    const words = name.split(/\s+/);
    if (words.length > 6) return true;
    // Single common non-entity words
    if (words.length <= 2 && words.every(w => JUNK_SINGLE_WORDS.has(w.toLowerCase()))) return true;
    return false;
  };

  const ORG_WORDS = /\b(agency|administration|office|department|bureau|foundation|inc|corp|llc|ltd|group|institute|association|committee|commission|authority|ministry|council|union|party|government|court|senate|congress|parliament|university|college|hospital|bank|fund|company|firm|organization)\b/i;
  const PERSON_TITLES = /\b(mr|mrs|ms|dr|sen|rep|gov|sec|gen|col|maj|cpt|sgt|atty|judge|justice|president|vice president|chancellor|minister|mayor|sheriff|detective|agent|director)\b\.?/i;

  const inferEntityType = (name: string, knownType: string): string => {
    if (knownType !== "unknown") return knownType;
    const lower = name.toLowerCase();
    if (ORG_WORDS.test(lower)) return "organization";
    if (PERSON_TITLES.test(lower)) return "person";
    const words = name.trim().split(/\s+/);
    // 2-word pattern where each word is Title-cased and ≤15 chars → likely a person
    if (words.length === 2 && words.every(w => /^[A-Z][a-z]/.test(w) && w.length <= 15)) return "person";
    if (words.length === 1 && /^[A-Z]/.test(words[0]) && words[0].length <= 20) return "location";
    return "organization";
  };

  const rankedEntities: RankedEntity[] = [];
  let syntheticId = -1;

  for (const stats of mentionStats) {
    if (!stats.entityName || isJunkName(stats.entityName)) continue;

    const mentionCount = stats.mentionCount ?? 0;
    const docSupport = stats.docCount ?? 0;
    const avgConf = stats.avgConf ?? 0;
    const maxConf = stats.maxConf ?? avgConf;

    const key = stats.entityName.toLowerCase().trim();
    const rawType = entityTypeMap.get(key) || "unknown";
    const entityType = inferEntityType(stats.entityName, rawType);
    const entityId = entityIdMap.get(key) ?? syntheticId--;

    const reasonParts: string[] = [];
    if (docSupport >= 3) reasonParts.push(`${docSupport}-doc support`);
    else if (docSupport === 2) reasonParts.push("multi-doc");
    else reasonParts.push("single-doc");
    if (mentionCount > 1) reasonParts.push(`${mentionCount} mentions`);
    if (avgConf >= 0.75) reasonParts.push("high conf");
    else if (avgConf >= 0.60) reasonParts.push("med conf");

    rankedEntities.push({
      id: entityId,
      name: stats.entityName,
      type: entityType,
      mentionCount,
      docSupport,
      avgConfidence: Math.round(avgConf * 100) / 100,
      maxConfidence: Math.round(maxConf * 100) / 100,
      promotionReason: reasonParts.join(", "),
      isPrimary: docSupport >= 2 || mentionCount >= 3,
    });
  }
  rankedEntities.sort((a, b) => {
    const scoreA = a.mentionCount * 2 + a.docSupport * 4 + a.avgConfidence * 8;
    const scoreB = b.mentionCount * 2 + b.docSupport * 4 + b.avgConfidence * 8;
    return scoreB - scoreA;
  });

  const primaryEntities = rankedEntities.filter(e => e.isPrimary).slice(0, 6);
  const secondaryEntities = rankedEntities.filter(e => !e.isPrimary).slice(0, 4);

  // ── Prioritize timeline (A3) ────────────────────────────────────────────────

  const entityNameSet = new Set(rankedEntities.map(e => e.name.toLowerCase()));
  const seenTimeline = new Set<string>();
  const scoredTimeline: Array<RankedTimelineEvent & { _score: number }> = [];
  const NOW = new Date();

  for (const te of timelineEntries) {
    if (!te.eventDate) continue;
    // Discard events with future dates (pipeline noise from forecast/UI text)
    const evDate = new Date(te.eventDate);
    if (evDate > NOW) continue;

    const titleLower = (te.title || "").toLowerCase();
    const key = `${te.eventDate?.toString().slice(0, 10) ?? ""}:${titleLower.slice(0, 60)}`;
    if (seenTimeline.has(key)) continue;
    seenTimeline.add(key);

    const rawTitle = te.title || "";
    const eventTypeMatch = /^\[([A-Z_]+)\]/.exec(rawTitle);
    const eventType = eventTypeMatch?.[1] ?? "EVENT";
    const typePriority = EVENT_TYPE_RANK[eventType] ?? 1;

    let score = typePriority * 10;
    let hasEntityMention = false;
    for (const name of entityNameSet) {
      if (titleLower.includes(name)) { hasEntityMention = true; break; }
    }
    if (hasEntityMention) score += 8;

    scoredTimeline.push({
      id: te.id,
      title: rawTitle,
      eventDate: te.eventDate ? new Date(te.eventDate).toISOString() : "",
      eventType,
      priority: typePriority,
      _score: score,
    });
  }

  scoredTimeline.sort((a, b) => b._score - a._score || (a.eventDate < b.eventDate ? -1 : 1));
  const topTimeline = scoredTimeline.slice(0, 8).map(({ _score, ...rest }) => rest);

  // ── Prioritize financial signals (A4) ───────────────────────────────────────

  const seenFinancial = new Set<string>();
  const scoredFinancial: Array<RankedFinancialSignal & { _score: number }> = [];

  for (const fs of financialSignals) {
    const key = fs.amountRaw || "";
    if (seenFinancial.has(key)) continue;
    seenFinancial.add(key);

    const amount = fs.normalizedAmount ? Number(fs.normalizedAmount) : 0;
    let score = Math.min(amount / 1_000_000, 100);

    const entityLower = (fs.entityName || "").toLowerCase();
    if (entityLower && entityNameSet.has(entityLower)) score += 20;

    scoredFinancial.push({
      id: fs.id,
      amountRaw: fs.amountRaw || "",
      normalizedAmount: fs.normalizedAmount ? Number(fs.normalizedAmount) : null,
      signalType: fs.signalType || "UNKNOWN",
      eventSummary: fs.eventSummary || null,
      entityName: fs.entityName || null,
      documentTitle: fs.documentTitle || null,
      _score: score,
    });
  }

  scoredFinancial.sort((a, b) => b._score - a._score);
  const topFinancial = scoredFinancial.slice(0, 5).map(({ _score, ...rest }) => rest);

  // ── Data quality assessment ──────────────────────────────────────────────────

  let dataQuality: CaseBrief["dataQuality"] = "EMPTY";
  let qualityNote = "";

  if (usableCount === 0) {
    dataQuality = "EMPTY";
    qualityNote = "No usable documents — case cannot be compiled.";
  } else if (primaryEntities.length >= 2 && keyEvidence.length >= 3 && topTimeline.length >= 2) {
    dataQuality = "STRONG";
    qualityNote = `Strong evidence base — ${usableCount} usable docs, ${primaryEntities.length} primary entities, ${topTimeline.length} timeline events.`;
  } else if (primaryEntities.length >= 1 && keyEvidence.length >= 2) {
    dataQuality = "MODERATE";
    qualityNote = `Moderate evidence — ${usableCount} usable docs, entity support limited to ${primaryEntities.length} primary actor${primaryEntities.length !== 1 ? "s" : ""}.`;
  } else {
    dataQuality = "WEAK";
    qualityNote = `Weak evidence — insufficient entity coverage or document quality. Consider re-ingesting with more specific queries.`;
  }

  // ── Brief generation (A5) ───────────────────────────────────────────────────

  const persons = primaryEntities.filter(e => e.type === "person").map(e => e.name);
  const orgs = primaryEntities.filter(e => e.type !== "person").map(e => e.name);

  const whatThisCaseIs = buildWhatThisCaseIs(caseRow.title, seedIntent, primaryEntities, topTimeline, topFinancial);
  const currentState = buildCurrentState(dataQuality, keyEvidence, topTimeline, topFinancial);
  const knownGaps = buildKnownGaps(usableCount, primaryEntities, topTimeline, topFinancial);
  const suggestedNextQueries = buildSuggestedQueries(caseRow.title, primaryEntities, seedIntent);

  return {
    caseId,
    caseTitle: caseRow.title,
    seedIntent: seedIntent ?? null,
    compiledAt: new Date().toISOString(),
    dataQuality,
    qualityNote,
    whatThisCaseIs,
    primaryActors: persons,
    primaryOrganizations: orgs,
    keyEvidence,
    topTimeline,
    topFinancial,
    primaryEntities,
    secondaryEntities,
    currentState,
    knownGaps,
    suggestedNextQueries,
    stats: {
      totalDocs: docs.length,
      usableDocs: usableCount,
      totalEntities: entities.length,
      totalTimeline: timelineEntries.length,
      totalFinancial: financialSignals.length,
      totalMentions: mentionStats.reduce((acc, m) => acc + m.mentionCount, 0),
    },
  };
}

// ── Brief text builders ───────────────────────────────────────────────────────

function buildWhatThisCaseIs(
  title: string,
  intent: string | undefined,
  entities: RankedEntity[],
  timeline: RankedTimelineEvent[],
  financial: RankedFinancialSignal[]
): string {
  const parts: string[] = [];
  parts.push(`Case subject: "${title}".`);

  if (intent && intent !== "general") {
    parts.push(`Classified as ${intent.toUpperCase()} intelligence.`);
  }

  const persons = entities.filter(e => e.type === "person").slice(0, 3).map(e => e.name);
  const orgs = entities.filter(e => e.type !== "person").slice(0, 2).map(e => e.name);

  if (persons.length > 0) {
    parts.push(`Key individuals identified: ${persons.join(", ")}.`);
  }
  if (orgs.length > 0) {
    parts.push(`Linked organizations: ${orgs.join(", ")}.`);
  }
  if (timeline.length > 0) {
    parts.push(`${timeline.length} date-anchored events extracted.`);
  } else {
    parts.push("No date-anchored events found.");
  }
  if (financial.length > 0) {
    const topAmt = financial[0];
    parts.push(`Financial activity detected — largest signal: ${topAmt.amountRaw} (${topAmt.signalType}).`);
  } else {
    parts.push("No financial signals detected.");
  }

  return parts.join(" ");
}

function buildCurrentState(
  quality: CaseBrief["dataQuality"],
  docs: RankedDocument[],
  timeline: RankedTimelineEvent[],
  financial: RankedFinancialSignal[]
): string {
  if (quality === "EMPTY") return "No usable intelligence. Case file is empty.";

  const parts: string[] = [];
  if (docs.length > 0) {
    const top = docs[0];
    parts.push(`Highest-scoring source: "${top.title}" (score: ${top.score}, ${top.alignment}).`);
  }
  if (timeline.length > 0) {
    const latest = [...timeline].sort((a, b) => (b.eventDate > a.eventDate ? 1 : -1))[0];
    if (latest) parts.push(`Most recent event: ${latest.title.replace(/^\[[A-Z_]+\]\s*/, "")}.`);
  }
  if (financial.length > 0) {
    parts.push(`Largest financial exposure: ${financial[0].amountRaw} (${financial[0].signalType}).`);
  }

  if (parts.length === 0) return "Evidence gathered. No dominant signal identified.";
  return parts.join(" ");
}

function buildKnownGaps(
  usableDocs: number,
  entities: RankedEntity[],
  timeline: RankedTimelineEvent[],
  financial: RankedFinancialSignal[]
): string[] {
  const gaps: string[] = [];
  if (usableDocs < 3) gaps.push("Insufficient document coverage — fewer than 3 usable sources.");
  if (entities.length === 0) gaps.push("No entities promoted — entity admission threshold not met.");
  else if (entities.filter(e => e.docSupport >= 2).length === 0) {
    gaps.push("All entities single-document only — cross-document confirmation absent.");
  }
  if (timeline.length === 0) gaps.push("No date-anchored events found — temporal trace unavailable.");
  else if (timeline.length < 3) gaps.push("Timeline sparse — fewer than 3 events found.");
  if (financial.length === 0) gaps.push("No financial signals detected — money flow unknown.");
  return gaps;
}

function buildSuggestedQueries(
  title: string,
  entities: RankedEntity[],
  intent: string | undefined
): string[] {
  const queries: string[] = [];
  const topPersons = entities.filter(e => e.type === "person").slice(0, 2);
  const topOrgs = entities.filter(e => e.type !== "person").slice(0, 2);

  for (const p of topPersons) {
    queries.push(`"${p.name}" lawsuit OR investigation OR indictment`);
    if (intent === "financial_crime" || intent === "corruption") {
      queries.push(`"${p.name}" campaign finance OR donations OR funding`);
    }
  }
  for (const o of topOrgs) {
    queries.push(`"${o.name}" contract OR grant OR award`);
  }

  const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  if (titleWords.length > 0) {
    queries.push(`${titleWords.slice(0, 3).join(" ")} audit OR inspector general`);
  }

  return queries.slice(0, 5);
}

// ── Persist compiled brief ────────────────────────────────────────────────────

export async function saveCaseBrief(caseId: number, brief: CaseBrief): Promise<void> {
  await db
    .update(casesTable)
    .set({
      compiledBrief: JSON.stringify(brief),
      compiledAt: new Date(),
    })
    .where(eq(casesTable.id, caseId));
}

export async function loadCaseBrief(caseId: number): Promise<CaseBrief | null> {
  const row = await db
    .select({ compiledBrief: casesTable.compiledBrief, compiledAt: casesTable.compiledAt })
    .from(casesTable)
    .where(eq(casesTable.id, caseId))
    .then(r => r[0]);
  if (!row?.compiledBrief) return null;
  try {
    return JSON.parse(row.compiledBrief) as CaseBrief;
  } catch {
    return null;
  }
}
