import { db } from "@workspace/db";
import {
  casesTable,
  documentsTable,
  entitiesTable,
  entityMentionsTable,
  timelineEntriesTable,
  financialSignalsTable,
  relationshipsTable,
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
  amountDisplay: string | null;
  normalizedAmount: number | null;
  signalType: string;
  eventSummary: string | null;
  entityName: string | null;
  controlledBy: string | null;
  receivedBy: string | null;
  programName: string | null;
  financialConfidence: number | null;
  documentTitle: string | null;
  inferredSignal?: boolean | null;
}

export interface EarlySignalEntry {
  type: "entity" | "financial" | "timeline";
  label: string;
  confidence: number;
  note?: string;
}

export interface KeyRelationship {
  entityA: string;
  entityB: string;
  relationshipType: string;
  confidence: number;
  docCount?: number;
}

export interface CaseBrief {
  caseId: number;
  caseTitle: string;
  seedIntent: string | null;
  targetMode: string | null;
  targetLabel: string | null;
  compiledAt: string;
  dataQuality: "STRONG" | "MODERATE" | "WEAK" | "EMPTY";
  qualityNote: string;
  autoGraphQuality: string | null;
  caseConfidence: number;

  whatThisCaseIs: string;
  primaryActors: string[];
  primaryOrganizations: string[];

  keyEvidence: RankedDocument[];
  topTimeline: RankedTimelineEvent[];
  topFinancial: RankedFinancialSignal[];

  primaryEntities: RankedEntity[];
  secondaryEntities: RankedEntity[];

  keyRelationships: KeyRelationship[];
  likelyAngles: string[];

  currentState: string;
  knownGaps: string[];
  suggestedNextQueries: string[];
  earlySignals: EarlySignalEntry[];
  caseHealth: "SPARSE" | "DEVELOPING" | "STRONG";

  // T005+T006: Structured investigative intelligence sections
  keyFindings: string[];
  financialRedFlags: string[];
  powerNodes: string[];
  oversightFailures: string[];
  recommendedActions: string[];

  stats: {
    totalDocs: number;
    usableDocs: number;
    totalEntities: number;
    totalTimeline: number;
    totalFinancial: number;
    totalMentions: number;
    totalRelationships: number;
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
  return result;
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
  const [caseRow, docs, entities, mentionStats, timelineEntries, financialSignals, relationships] = await Promise.all([
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
    db.select().from(relationshipsTable).where(eq(relationshipsTable.caseId, caseId)),
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
    // Better dedup: entity + signalType + rounded amount (not just raw string)
    // This catches cases where the same flow appears in different docs with slight formatting diffs
    const roundedAmt = fs.normalizedAmount ? Math.round(Number(fs.normalizedAmount) / 10_000) * 10_000 : 0;
    const entityKey = (fs.entityName || "").toLowerCase().trim().slice(0, 30);
    const typeKey = (fs.signalType || "").toLowerCase().slice(0, 20);
    const key = `${entityKey}|${typeKey}|${roundedAmt}`;
    if (seenFinancial.has(key)) continue;
    seenFinancial.add(key);

    const amount = fs.normalizedAmount ? Number(fs.normalizedAmount) : 0;
    let score = Math.min(amount / 1_000_000, 100);

    const entityLower = (fs.entityName || "").toLowerCase();
    if (entityLower && entityNameSet.has(entityLower)) score += 20;

    const conf = fs.financialConfidence ? Number(fs.financialConfidence) : null;
    if (conf !== null) score += conf * 10;

    // Bonus for confirmed (not inferred) signals — more reliable
    if (!(fs as any).inferredSignal) score += 8;
    // Bonus for complete flow trace (from → to)
    if ((fs as any).controlledBy && (fs as any).receivedBy) score += 6;
    else if ((fs as any).controlledBy || (fs as any).receivedBy) score += 3;
    // Bonus for contextual summary
    if (fs.eventSummary && fs.eventSummary.length > 40) score += 4;
    // Bonus for program-linked signals
    if ((fs as any).programName) score += 2;
    // Non-numeric signals are lower quality
    const isNonNumeric = (fs.signalType || "").startsWith("NON_NUMERIC") || (fs as any).amountDisplay === "NON-NUMERIC";
    if (isNonNumeric) score -= 15;

    scoredFinancial.push({
      id: fs.id,
      amountRaw: fs.amountRaw || "",
      amountDisplay: (fs as any).amountDisplay || null,
      normalizedAmount: fs.normalizedAmount ? Number(fs.normalizedAmount) : null,
      signalType: fs.signalType || "UNKNOWN",
      eventSummary: fs.eventSummary || null,
      entityName: fs.entityName || null,
      controlledBy: (fs as any).controlledBy || null,
      receivedBy: (fs as any).receivedBy || null,
      programName: (fs as any).programName || null,
      financialConfidence: conf,
      documentTitle: fs.documentTitle || null,
      inferredSignal: (fs as any).inferredSignal ?? null,
      _score: score,
    });
  }

  scoredFinancial.sort((a, b) => b._score - a._score);
  // T004: Separate numeric from NON_NUMERIC signals — only numeric signals go into the primary flow trace
  const numericFinancial = scoredFinancial.filter(f =>
    !(f.signalType || "").startsWith("NON_NUMERIC") && f.amountDisplay !== "NON-NUMERIC"
  );
  const earlySignalFinancial = scoredFinancial.filter(f =>
    (f.signalType || "").startsWith("NON_NUMERIC") || f.amountDisplay === "NON-NUMERIC"
  );
  // Primary flow trace: numeric signals only (max 5). Fall back to including early signals if no numeric found.
  const topFinancial = numericFinancial.length > 0
    ? numericFinancial.slice(0, 5).map(({ _score, ...rest }) => rest)
    : earlySignalFinancial.slice(0, 3).map(({ _score, ...rest }) => rest);

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
  const targetMode = (caseRow as any).targetMode as string | null ?? null;

  const whatThisCaseIs = buildWhatThisCaseIs(caseRow.title, seedIntent, primaryEntities, topTimeline, topFinancial, targetMode, keyEvidence);
  const currentState = buildCurrentState(dataQuality, keyEvidence, topTimeline, topFinancial, primaryEntities);
  const knownGaps = buildKnownGaps(usableCount, primaryEntities, topTimeline, topFinancial, targetMode ?? null);
  const suggestedNextQueries = buildSuggestedQueries(caseRow.title, primaryEntities, seedIntent, targetMode ?? null);

  // ── Key Relationships (T004 Dossier 2.0) ─────────────────────────────────
  const entityIdToName = new Map<number, string>();
  for (const e of entities) {
    if (e.id && e.name) entityIdToName.set(e.id, e.name);
  }

  const keyRelationships: KeyRelationship[] = relationships
    .filter(r => r.entityAId && r.entityBId)
    .sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0))
    .slice(0, 8)
    .map(r => ({
      entityA: entityIdToName.get(r.entityAId!) ?? `Entity ${r.entityAId}`,
      entityB: entityIdToName.get(r.entityBId!) ?? `Entity ${r.entityBId}`,
      relationshipType: r.relationshipType || "co_mention",
      confidence: Number(r.confidence ?? 0),
    }));

  // ── Likely Investigative Angles (T004 Dossier 2.0) ───────────────────────
  const likelyAngles = buildLikelyAngles(
    targetMode,
    seedIntent,
    primaryEntities,
    topTimeline,
    topFinancial,
    keyEvidence
  );

  // ── Case confidence score ────────────────────────────────────────────────
  let caseConfidence = 0;
  if (dataQuality === "STRONG") caseConfidence = 80 + Math.min(20, primaryEntities.length * 4 + Math.min(topTimeline.length, 3) * 2);
  else if (dataQuality === "MODERATE") caseConfidence = 45 + Math.min(30, primaryEntities.length * 6 + Math.min(topTimeline.length, 2) * 3);
  else if (dataQuality === "WEAK") caseConfidence = 15 + Math.min(25, primaryEntities.length * 5 + usableCount * 2);
  caseConfidence = Math.min(99, Math.round(caseConfidence));

  // ── Multi-doc signal fusion: tag inferred signals ──────────────────────
  // If two or more financial signals reference the same entityName/programName,
  // mark the lower-confidence one as inferredSignal=true (synthesized cross-doc).
  const entitySignalCount = new Map<string, number>();
  for (const sig of topFinancial) {
    const key = sig.programName ?? sig.entityName ?? "";
    if (key) entitySignalCount.set(key, (entitySignalCount.get(key) ?? 0) + 1);
  }
  for (const sig of topFinancial) {
    const key = sig.programName ?? sig.entityName ?? "";
    if (key && (entitySignalCount.get(key) ?? 0) >= 2 && sig.inferredSignal === null) {
      (sig as any).inferredSignal = true;
      if (sig.financialConfidence !== null) {
        sig.financialConfidence = Math.max(0.10, sig.financialConfidence - 0.10);
      }
    }
  }

  // ── Early signals (P4): surface non-numeric + low-conf indicators ────────
  const earlySignals = buildEarlySignals(primaryEntities, secondaryEntities, topFinancial, topTimeline, financialSignals);

  // ── Case health ──────────────────────────────────────────────────────────
  const caseHealth: CaseBrief["caseHealth"] =
    dataQuality === "STRONG" ? "STRONG" :
    dataQuality === "MODERATE" ? "DEVELOPING" :
    "SPARSE";

  // ── T005+T006: Structured investigative intelligence sections ─────────────
  const keyFindings = buildKeyFindings(primaryEntities, topFinancial, topTimeline, keyEvidence, relationships, targetMode, seedIntent);
  const financialRedFlags = buildFinancialRedFlags(topFinancial, financialSignals, primaryEntities, keyEvidence);
  const powerNodes = buildPowerNodes(primaryEntities, relationships, entities);
  const oversightFailures = buildOversightFailures(topTimeline, topFinancial, primaryEntities, keyEvidence, targetMode);
  const recommendedActions = buildRecommendedActions(dataQuality, primaryEntities, topTimeline, topFinancial, keyEvidence, targetMode, knownGaps);

  return {
    caseId,
    caseTitle: caseRow.title,
    seedIntent: seedIntent ?? null,
    targetMode,
    targetLabel: (caseRow as any).targetLabel as string | null ?? null,
    compiledAt: new Date().toISOString(),
    dataQuality,
    qualityNote,
    autoGraphQuality: (caseRow as any).autoGraphQuality as string | null ?? null,
    caseConfidence,
    whatThisCaseIs,
    primaryActors: persons,
    primaryOrganizations: orgs,
    keyEvidence,
    topTimeline,
    topFinancial,
    primaryEntities,
    secondaryEntities,
    keyRelationships,
    likelyAngles,
    currentState,
    knownGaps,
    suggestedNextQueries,
    earlySignals,
    caseHealth,
    keyFindings,
    financialRedFlags,
    powerNodes,
    oversightFailures,
    recommendedActions,
    stats: {
      totalDocs: docs.length,
      usableDocs: usableCount,
      totalEntities: entities.length,
      totalTimeline: timelineEntries.length,
      totalFinancial: financialSignals.length,
      totalMentions: mentionStats.reduce((acc, m) => acc + m.mentionCount, 0),
      totalRelationships: relationships.length,
    },
  };
}

// ── Brief text builders ───────────────────────────────────────────────────────

function buildWhatThisCaseIs(
  title: string,
  intent: string | undefined,
  entities: RankedEntity[],
  timeline: RankedTimelineEvent[],
  financial: RankedFinancialSignal[],
  targetMode?: string | null,
  docs?: RankedDocument[]
): string {
  const parts: string[] = [];

  // Mode-specific lead sentence
  const modeLabel: Record<string, string> = {
    person_target: "Individual investigation",
    organization_target: "Organizational investigation",
    government_agency_target: "Government agency investigation",
    place_target: "Location-based investigation",
    program_target: "Program/initiative investigation",
    funding_target: "Funding and contracts investigation",
    event_target: "Event/incident investigation",
    scandal_target: "Misconduct/scandal investigation",
    topic_investigation: "Multi-topic investigation",
    general: "Open investigation",
  };
  const lead = targetMode && modeLabel[targetMode] ? modeLabel[targetMode] : "Investigation";
  parts.push(`${lead}: "${title}".`);

  const persons = entities.filter(e => e.type === "person").slice(0, 3).map(e => e.name);
  const orgs = entities.filter(e => e.type !== "person" && e.type !== "location").slice(0, 3).map(e => e.name);

  if (persons.length > 0 && orgs.length > 0) {
    parts.push(`Key actors: ${persons.join(", ")}. Linked institutions: ${orgs.join(", ")}.`);
  } else if (persons.length > 0) {
    parts.push(`Key individuals: ${persons.join(", ")}.`);
  } else if (orgs.length > 0) {
    parts.push(`Key institutions: ${orgs.join(", ")}.`);
  } else {
    parts.push("No confirmed actors — running in early recovery mode. Proper noun extraction active.");
  }

  // Financial signal with specifics
  if (financial.length > 0) {
    const topAmt = financial[0];
    const amountStr = topAmt.amountDisplay || topAmt.amountRaw;
    const actor = topAmt.receivedBy ? ` → ${topAmt.receivedBy}` : topAmt.entityName ? ` linked to ${topAmt.entityName}` : "";
    const program = topAmt.programName ? ` via ${topAmt.programName}` : "";
    parts.push(`Financial exposure: ${amountStr} — ${topAmt.signalType}${actor}${program}.`);
    if (financial.length > 1) parts.push(`${financial.length - 1} additional financial signal${financial.length > 2 ? "s" : ""} detected.`);
  }

  // Timeline anchor
  if (timeline.length >= 3) {
    const dates = timeline
      .map(t => t.eventDate?.slice(0, 7))
      .filter(Boolean)
      .sort();
    const earliest = dates[0];
    const latest = dates[dates.length - 1];
    if (earliest && latest && earliest !== latest) {
      parts.push(`${timeline.length} date-anchored events span ${earliest} to ${latest}.`);
    } else {
      parts.push(`${timeline.length} date-anchored events extracted.`);
    }
  } else if (timeline.length > 0) {
    parts.push(`${timeline.length} date-anchored event${timeline.length > 1 ? "s" : ""} found.`);
  } else {
    parts.push("No temporal events confirmed.");
  }

  // Document quality signal
  const coreDocs = docs?.filter(d => d.priority === "PRIORITY_A").length ?? 0;
  if (coreDocs >= 3) {
    parts.push(`Strong source base: ${coreDocs} priority-A documents support core findings.`);
  } else if (coreDocs >= 1) {
    parts.push(`${coreDocs} priority-A source${coreDocs > 1 ? "s" : ""} anchor the findings.`);
  }

  return parts.join(" ");
}

function buildCurrentState(
  quality: CaseBrief["dataQuality"],
  docs: RankedDocument[],
  timeline: RankedTimelineEvent[],
  financial: RankedFinancialSignal[],
  entities?: RankedEntity[]
): string {
  if (quality === "EMPTY") return "Case file is empty — no usable intelligence collected yet. Run a web ingest session targeting the subject to begin evidence gathering.";

  const parts: string[] = [];

  // Top document with specific detail
  if (docs.length > 0) {
    const top = docs[0];
    const sourceNote = top.source ? ` (via ${top.source})` : "";
    const breakdownNote = top.scoreBreakdown ? ` [${top.scoreBreakdown}]` : "";
    parts.push(`Highest-value source: "${top.title}"${sourceNote}${breakdownNote}.`);
  }

  // Latest confirmed event
  if (timeline.length > 0) {
    const sorted = [...timeline].sort((a, b) => (b.eventDate > a.eventDate ? 1 : -1));
    const latest = sorted[0];
    if (latest) {
      const cleanTitle = latest.title.replace(/^\[[A-Z_]+\]\s*/, "");
      const dateStr = latest.eventDate ? ` [${latest.eventDate.slice(0, 10)}]` : "";
      parts.push(`Most recent confirmed event: ${cleanTitle}${dateStr}.`);
    }
    if (sorted.length >= 3) {
      const earliest = sorted[sorted.length - 1];
      const span = earliest?.eventDate?.slice(0, 10);
      if (span) parts.push(`Temporal record extends back to ${span}.`);
    }
  }

  // Financial state
  if (financial.length > 0) {
    const top = financial[0];
    const amountStr = top.amountDisplay || top.amountRaw;
    const receiver = top.receivedBy ? ` → ${top.receivedBy}` : top.entityName ? ` linked to ${top.entityName}` : "";
    const program = top.programName ? ` (${top.programName})` : "";
    const confStr = top.financialConfidence !== null ? ` [conf: ${Math.round((top.financialConfidence ?? 0) * 100)}%]` : "";
    parts.push(`Largest financial signal: ${amountStr}${receiver}${program} — ${top.signalType}${confStr}.`);
  }

  // Entity state
  const promotedEntities = entities?.filter(e => e.isPrimary) ?? [];
  if (promotedEntities.length === 0) {
    parts.push("No entities cleared for promotion — manual review or re-ingest recommended.");
  }

  if (quality === "WEAK" && docs.length < 3) {
    parts.push("Evidence base is thin — additional source ingestion required for reliable analysis.");
    parts.push("Early indicators suggest this subject has investigative relevance but confirmation signals are absent.");
  }

  if (quality === "WEAK") {
    if (financial.some(f => f.signalType?.startsWith("NON_NUMERIC"))) {
      parts.push("Non-numeric funding language detected — hard dollar figures not yet confirmed.");
    }
    if (timeline.some(t => t.title?.startsWith("[SOFT]"))) {
      parts.push("Soft temporal signals captured — date references without confirmed action verbs.");
    }
  }

  if (parts.length === 0) return "Evidence gathered. No dominant signal identified in current data set.";
  return parts.join(" ");
}

function buildEarlySignals(
  primary: RankedEntity[],
  secondary: RankedEntity[],
  financial: RankedFinancialSignal[],
  timeline: RankedTimelineEvent[],
  allFinancial: typeof financial
): EarlySignalEntry[] {
  const signals: EarlySignalEntry[] = [];

  // Low-confidence entity names from secondary pool
  for (const e of secondary.slice(0, 3)) {
    signals.push({
      type: "entity",
      label: e.name,
      confidence: 0.35,
      note: "Secondary actor — not yet confirmed via multi-doc support",
    });
  }

  // Non-numeric financial signals
  for (const f of allFinancial) {
    const isNonNumeric = f.signalType?.startsWith("NON_NUMERIC") || f.amountDisplay === "NON-NUMERIC";
    if (!isNonNumeric) continue;
    const label = f.programName ?? f.entityName ?? f.eventSummary?.slice(0, 60) ?? "Unknown";
    signals.push({
      type: "financial",
      label,
      confidence: f.financialConfidence ?? 0.25,
      note: "Funding language detected — no hard dollar amount confirmed",
    });
  }

  // Soft timeline events
  for (const t of timeline) {
    if (!t.title?.startsWith("[SOFT]")) continue;
    signals.push({
      type: "timeline",
      label: t.title.replace(/^\[SOFT\]\[?[A-Z_]*\]?\s*/, "").slice(0, 80),
      confidence: 0.30,
      note: "Date reference — no confirmed action verb",
    });
  }

  return signals.slice(0, 6);
}

function buildKnownGaps(
  usableDocs: number,
  entities: RankedEntity[],
  timeline: RankedTimelineEvent[],
  financial: RankedFinancialSignal[],
  targetMode: string | null
): string[] {
  const gaps: string[] = [];

  // Document coverage
  if (usableDocs === 0) {
    gaps.push("No usable documents — run a targeted web ingest session to begin.");
  } else if (usableDocs < 3) {
    gaps.push(`Thin document base (${usableDocs} usable) — ingest additional sources for reliability.`);
  }

  // Entity coverage
  if (entities.length === 0) {
    gaps.push("No entities promoted — all candidates failed admission thresholds. Try more specific queries or check ingest logs.");
  } else {
    const multiDoc = entities.filter(e => e.docSupport >= 2);
    const singleDoc = entities.filter(e => e.docSupport === 1);
    if (multiDoc.length === 0 && entities.length > 0) {
      gaps.push(`${entities.length} entity record${entities.length > 1 ? "s" : ""} — all single-document only. Cross-source confirmation missing.`);
    }
    if (singleDoc.length > 0 && multiDoc.length === 0) {
      gaps.push("No high-confidence entity found across multiple sources — consider expanding query set.");
    }
  }

  // Temporal coverage
  if (timeline.length === 0) {
    gaps.push("No date-anchored events — temporal reconstruction not possible from current sources.");
  } else if (timeline.length < 3) {
    gaps.push(`Sparse timeline (${timeline.length} event${timeline.length > 1 ? "s" : ""}) — insufficient for pattern analysis.`);
  }

  // Financial coverage
  if (financial.length === 0) {
    if (targetMode === "funding_target" || targetMode === "scandal_target") {
      gaps.push("No financial signals — critical gap for this investigation type. Search for specific contract or payment records.");
    } else {
      gaps.push("No financial signals detected — money flow undocumented.");
    }
  } else if (financial.length < 2) {
    gaps.push("Only one financial signal — broader money trail not yet established.");
  }

  // Mode-specific gaps
  if (targetMode === "person_target" && entities.filter(e => e.type === "person").length === 0) {
    gaps.push("Target individual not confirmed in entity records — name may need normalization or disambiguation.");
  }
  if (targetMode === "organization_target" && entities.filter(e => e.type === "organization" || e.type === "government_agency").length === 0) {
    gaps.push("Target organization not confirmed — consider adding official name variants to search queries.");
  }

  return gaps;
}

function buildLikelyAngles(
  targetMode: string | null,
  intent: string | undefined,
  entities: RankedEntity[],
  timeline: RankedTimelineEvent[],
  financial: RankedFinancialSignal[],
  docs: RankedDocument[]
): string[] {
  const angles: string[] = [];
  const hasPerson = entities.some(e => e.type === "person");
  const hasOrg = entities.some(e => e.type !== "person" && e.type !== "location");
  const hasFinancial = financial.length > 0;
  const hasTimeline = timeline.length > 0;
  const hasLegalDocs = docs.some(d => d.alignment === "matched" && (d.hasTimeline || d.hasFinancial));

  // Mode-specific primary angles
  switch (targetMode) {
    case "person_target":
      angles.push("Individual accountability — track decisions, roles, financial ties");
      if (hasFinancial) angles.push("Follow the money — trace payments, donations, contracts tied to this person");
      if (hasOrg) angles.push("Organizational affiliations — board memberships, employment history, conflicts");
      break;
    case "organization_target":
    case "government_agency_target":
      angles.push("Institutional oversight — contract awards, procurement patterns, governance failures");
      if (hasFinancial) angles.push("Budget / spending analysis — compare appropriations to actual expenditures");
      if (hasPerson) angles.push("Leadership accountability — identify decision-makers and their track records");
      break;
    case "funding_target":
      angles.push("Grant/contract trail — who received funds, under what authority, for what purpose");
      angles.push("Performance vs. delivery — did funded programs meet stated objectives?");
      if (hasPerson) angles.push("Beneficiary identification — individuals profiting from public funding");
      break;
    case "scandal_target":
      angles.push("Legal exposure — identify charges, filings, court records, and who faces liability");
      angles.push("Cover-up indicators — timeline gaps, contradictory statements, document destruction");
      if (hasFinancial) angles.push("Financial motive — money flows tied to alleged misconduct");
      break;
    case "program_target":
      angles.push("Program effectiveness — stated vs. actual outcomes, audit findings");
      angles.push("Contracting irregularities — sole-source awards, inflated costs, cronyism");
      break;
    case "place_target":
      angles.push("Local corruption — municipal contracts, zoning decisions, political money");
      if (hasFinancial) angles.push("Public funds allocation — where is public money going and who controls it");
      break;
    default:
      if (intent === "crime_corruption") angles.push("Corruption pattern — map bribery, kickback, or embezzlement networks");
      else if (intent === "finance_funding") angles.push("Financial irregularities — irregular grant awards or contract patterns");
      else if (intent === "housing_homelessness") angles.push("Contract accountability — homeless/shelter program fund mismanagement");
      else angles.push("Evidence aggregation — collect and cross-reference all available records");
  }

  // Universal evidence-based angles
  if (hasTimeline && hasFinancial) angles.push("Chronological money trail — match timeline events to financial signals");
  if (hasLegalDocs) angles.push("Primary source verification — cross-reference legal/official documents");
  if (entities.length >= 4) angles.push("Network mapping — identify clusters and hidden links between entities");
  if (docs.some(d => d.priority === "PRIORITY_A")) angles.push("High-value source follow-up — deepen coverage from top-tier documents");

  return [...new Set(angles)].slice(0, 5);
}

function buildSuggestedQueries(
  title: string,
  entities: RankedEntity[],
  intent: string | undefined,
  targetMode: string | null
): string[] {
  const queries: string[] = [];
  const topPersons = entities.filter(e => e.type === "person").slice(0, 2);
  const topOrgs = entities.filter(e => e.type !== "person" && e.type !== "location").slice(0, 2);

  // Mode-specific primary queries
  switch (targetMode) {
    case "person_target":
      for (const p of topPersons) {
        queries.push(`"${p.name}" investigation OR indictment OR lawsuit OR audit`);
        queries.push(`"${p.name}" contract OR funding OR grant OR payment`);
      }
      for (const o of topOrgs) {
        queries.push(`"${o.name}" "${topPersons[0]?.name ?? title}" records OR contract`);
      }
      break;

    case "funding_target":
    case "government_agency_target":
      for (const o of topOrgs) {
        queries.push(`"${o.name}" contract award OR procurement OR grant OR spending`);
        queries.push(`"${o.name}" inspector general OR audit report OR oversight`);
      }
      for (const p of topPersons) {
        queries.push(`"${p.name}" "conflict of interest" OR award OR contract`);
      }
      break;

    case "scandal_target":
      for (const p of topPersons) {
        queries.push(`"${p.name}" charges OR indicted OR convicted OR plea OR court filing`);
        queries.push(`"${p.name}" whistleblower OR complaint OR affidavit`);
      }
      for (const o of topOrgs) {
        queries.push(`"${o.name}" misconduct OR investigation OR subpoena OR settlement`);
      }
      break;

    case "organization_target":
      for (const o of topOrgs) {
        queries.push(`"${o.name}" contract OR grant OR lobbying OR disclosure`);
        queries.push(`"${o.name}" audit OR lawsuit OR regulatory action`);
      }
      for (const p of topPersons) {
        queries.push(`"${p.name}" "${topOrgs[0]?.name ?? ""}" board OR salary OR conflict`);
      }
      break;

    default:
      for (const p of topPersons) {
        queries.push(`"${p.name}" investigation OR lawsuit OR indictment`);
      }
      for (const o of topOrgs) {
        queries.push(`"${o.name}" contract OR grant OR award OR audit`);
      }
      break;
  }

  // Universal fallback: title keywords + investigative terms
  const titleWords = title
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 4 && !["about", "these", "their", "there", "which", "where"].includes(w));
  if (titleWords.length >= 2 && queries.length < 5) {
    queries.push(`${titleWords.slice(0, 3).join(" ")} audit OR "inspector general" OR oversight`);
  }
  if (intent === "crime_corruption" && queries.length < 5) {
    queries.push(`${titleWords.slice(0, 2).join(" ")} bribery OR kickback OR embezzlement OR fraud`);
  }
  if (intent === "finance_funding" && queries.length < 5) {
    queries.push(`${titleWords.slice(0, 2).join(" ")} "no-bid contract" OR "sole source" OR procurement fraud`);
  }

  return [...new Set(queries)].slice(0, 6);
}

// ── T005+T006: Structured investigative intelligence builders ────────────────

function buildKeyFindings(
  primaryEntities: RankedEntity[],
  topFinancial: RankedFinancialSignal[],
  topTimeline: RankedTimelineEvent[],
  keyEvidence: RankedDocument[],
  relationships: { entityAId?: number | null; entityBId?: number | null; relationshipType?: string | null; confidence?: string | number | null }[],
  targetMode: string | null,
  seedIntent: string | undefined
): string[] {
  const findings: string[] = [];

  // Finding 1: Primary actor network
  const topPersons = primaryEntities.filter(e => e.type === "person").slice(0, 2);
  const topOrgs = primaryEntities.filter(e => e.type !== "person").slice(0, 2);
  if (topPersons.length > 0 && topOrgs.length > 0) {
    findings.push(`${topPersons[0].name} holds documented ties to ${topOrgs[0].name} — both appear in multiple independent source documents.`);
  } else if (topPersons.length >= 2) {
    findings.push(`${topPersons[0].name} and ${topPersons[1].name} are co-documented across the evidence set — relationship warrants deeper mapping.`);
  } else if (topOrgs.length > 0) {
    findings.push(`${topOrgs[0].name} is the primary organizational node — ${primaryEntities[0]?.mentionCount ?? 0} mentions across ${primaryEntities[0]?.docSupport ?? 0} source documents.`);
  }

  // Finding 2: High-value financial signal
  const topMoney = topFinancial.filter(f => f.normalizedAmount && f.normalizedAmount > 0).sort((a, b) => (b.normalizedAmount ?? 0) - (a.normalizedAmount ?? 0));
  if (topMoney.length > 0) {
    const f = topMoney[0];
    const amtStr = f.amountDisplay || f.amountRaw;
    const ctrlStr = f.controlledBy ? ` — controlled by ${f.controlledBy}` : "";
    const recvStr = f.receivedBy ? ` → disbursed to ${f.receivedBy}` : "";
    const progStr = f.programName ? ` under ${f.programName}` : "";
    findings.push(`Largest confirmed financial signal: ${amtStr}${progStr}${ctrlStr}${recvStr}. Signal type: ${f.signalType?.replace(/_/g, " ")}.`);
  }

  // Finding 3: Legal/audit timeline event
  const legalEvents = topTimeline.filter(t => ["LEGAL_ACTION", "AUDIT", "INVESTIGATION_STARTED"].includes(t.eventType));
  if (legalEvents.length > 0) {
    const e = legalEvents[0];
    const clean = e.title.replace(/^\[[A-Z_]+\]\s*/, "");
    findings.push(`Legal/oversight event confirmed: "${clean}" [${e.eventDate?.slice(0, 10) ?? "date unknown"}].`);
  }

  // Finding 4: Document quality signal
  const tier1Docs = keyEvidence.filter(d => d.priority === "TIER-1");
  if (tier1Docs.length > 0) {
    const d = tier1Docs[0];
    findings.push(`TIER-1 source document identified: "${d.title}" (${d.entityCount} entities, ${d.hasFinancial ? "financial signals, " : ""}${d.hasTimeline ? "timeline events, " : ""}score: ${Math.round(d.score)}).`);
  }

  // Finding 5: Relationship density signal
  if (relationships.length >= 3) {
    findings.push(`${relationships.length} documented entity relationships extracted — network density suggests organized institutional involvement.`);
  } else if (primaryEntities.length >= 3) {
    findings.push(`${primaryEntities.length} promoted entities with no confirmed relationship links — relationship mapping recommended as next step.`);
  }

  // Finding 6: Multi-doc entity corroboration
  const multiDocEntities = primaryEntities.filter(e => e.docSupport >= 3);
  if (multiDocEntities.length > 0) {
    findings.push(`${multiDocEntities.length} entity/entities confirmed across 3+ independent documents — high corroboration confidence.`);
  }

  return findings.filter(Boolean).slice(0, 6);
}

function buildFinancialRedFlags(
  topFinancial: RankedFinancialSignal[],
  allFinancial: RankedFinancialSignal[],
  primaryEntities: RankedEntity[],
  keyEvidence: RankedDocument[]
): string[] {
  const flags: string[] = [];

  // Unusually large single payment
  const bigPayments = topFinancial.filter(f => f.normalizedAmount && f.normalizedAmount >= 1_000_000);
  if (bigPayments.length > 0) {
    const b = bigPayments[0];
    const amt = b.amountDisplay || b.amountRaw;
    flags.push(`Large-value transaction detected: ${amt} — ${b.signalType?.replace(/_/g, " ") ?? "type unclassified"} via ${b.programName ?? b.entityName ?? "unknown program"}.`);
  }

  // No-bid / sole-source signal
  const isSoleSource = allFinancial.some(f =>
    f.eventSummary?.toLowerCase().includes("no-bid") ||
    f.eventSummary?.toLowerCase().includes("sole source") ||
    f.eventSummary?.toLowerCase().includes("emergency contract") ||
    f.eventSummary?.toLowerCase().includes("direct award")
  );
  if (isSoleSource) flags.push("Potential no-bid or sole-source contracting language detected — competitive procurement may have been bypassed.");

  // Funding to single recipient
  const byReceiver = new Map<string, number>();
  for (const f of allFinancial) {
    const recv = f.receivedBy ?? f.entityName;
    if (recv && f.normalizedAmount) byReceiver.set(recv, (byReceiver.get(recv) ?? 0) + f.normalizedAmount);
  }
  const topRecv = [...byReceiver.entries()].sort((a, b) => b[1] - a[1]);
  if (topRecv.length > 0 && topRecv[0][1] >= 500_000) {
    const totalInflow = [...byReceiver.values()].reduce((a, b) => a + b, 0);
    const sharePct = totalInflow > 0 ? Math.round((topRecv[0][1] / totalInflow) * 100) : 0;
    if (sharePct >= 40) {
      flags.push(`${topRecv[0][0]} receives an outsized share of documented funding (≥${sharePct}% concentration) — potential dependency or improper favoritism.`);
    }
  }

  // Non-numeric / opaque funding language
  const opaqueCount = allFinancial.filter(f => f.signalType?.startsWith("NON_NUMERIC") || f.amountDisplay === "NON-NUMERIC").length;
  if (opaqueCount >= 2) flags.push(`${opaqueCount} funding references use non-numeric language (e.g. "significant funding," "major investment") — deliberate financial obfuscation possible.`);

  // Inferred cross-doc signals
  const inferredCount = allFinancial.filter(f => f.inferredSignal).length;
  if (inferredCount >= 2) flags.push(`${inferredCount} financial signals are cross-document inferences, not direct quotations — verify primary source documents.`);

  // Audit flag / questioned costs
  const auditFlags = allFinancial.filter(f => f.signalType === "AUDIT_FLAG");
  if (auditFlags.length > 0) {
    const totalQuestioned = auditFlags.reduce((a, f) => a + (f.normalizedAmount ?? 0), 0);
    const amtStr = totalQuestioned > 0 ? ` (${totalQuestioned >= 1_000_000 ? `$${(totalQuestioned / 1_000_000).toFixed(1)}M` : `$${totalQuestioned.toLocaleString()}`} in questioned costs)` : "";
    flags.push(`${auditFlags.length} audit finding${auditFlags.length > 1 ? "s" : ""} detected${amtStr} — inspector general or oversight body has flagged irregular expenditures.`);
  }

  // Cost overruns / change orders
  const overruns = allFinancial.filter(f => f.signalType === "COST_OVERRUN");
  if (overruns.length > 0) {
    const totalOverrun = overruns.reduce((a, f) => a + (f.normalizedAmount ?? 0), 0);
    const amtStr = totalOverrun > 0 ? ` totaling ${totalOverrun >= 1_000_000 ? `$${(totalOverrun / 1_000_000).toFixed(1)}M` : `$${totalOverrun.toLocaleString()}`}` : "";
    flags.push(`${overruns.length} cost overrun or change order${overruns.length > 1 ? "s" : ""} detected${amtStr} — contract scope may have been deliberately understated.`);
  }

  // Fragmented payments to same entity (structured to avoid scrutiny)
  const byEntityCount = new Map<string, number>();
  for (const f of allFinancial) {
    const recv = f.receivedBy ?? f.entityName;
    if (recv && (f.normalizedAmount ?? 0) > 0) byEntityCount.set(recv, (byEntityCount.get(recv) ?? 0) + 1);
  }
  const fragmented = [...byEntityCount.entries()].filter(([, count]) => count >= 3);
  if (fragmented.length > 0) {
    flags.push(`${fragmented[0][0]} appears in ${fragmented[0][1]} separate financial signals — possible structured or fragmented payment pattern.`);
  }

  return flags.filter(Boolean).slice(0, 7);
}

function buildPowerNodes(
  primaryEntities: RankedEntity[],
  relationships: { entityAId?: number | null; entityBId?: number | null; confidence?: string | number | null }[],
  allEntities: { id?: number | null; name: string; type?: string | null }[]
): string[] {
  const nodes: string[] = [];

  // Compute degree centrality for each entity
  const degree = new Map<number, number>();
  for (const r of relationships) {
    if (r.entityAId) degree.set(r.entityAId, (degree.get(r.entityAId) ?? 0) + 1);
    if (r.entityBId) degree.set(r.entityBId, (degree.get(r.entityBId) ?? 0) + 1);
  }

  // Sort entities by degree + mention weight
  const scored = primaryEntities.map(e => ({
    entity: e,
    degree: degree.get(e.id) ?? 0,
    score: (degree.get(e.id) ?? 0) * 2 + e.mentionCount * 0.5 + e.docSupport,
  })).sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 3);

  for (const { entity, degree: deg } of top) {
    const typeLabel = entity.type === "person" ? "Person" : entity.type === "government_agency" ? "Gov. Agency" : entity.type === "organization" ? "Organization" : "Entity";
    const relNote = deg > 0 ? ` — ${deg} documented link${deg > 1 ? "s" : ""}` : "";
    const mentionNote = entity.mentionCount > 1 ? `, ${entity.mentionCount} mentions across ${entity.docSupport} doc${entity.docSupport > 1 ? "s" : ""}` : "";
    nodes.push(`${entity.name} [${typeLabel}]${relNote}${mentionNote}.`);
  }

  // Detect bridging nodes (appear on both sides of relationships)
  const bridgeIds = new Set<number>();
  for (const r of relationships) {
    if (r.entityAId && r.entityBId) {
      bridgeIds.add(r.entityAId);
      bridgeIds.add(r.entityBId);
    }
  }
  const bridges = allEntities.filter(e => e.id && bridgeIds.has(e.id) && !top.find(t => t.entity.id === e.id));
  if (bridges.length > 0) {
    nodes.push(`${bridges.slice(0, 2).map(b => b.name).join(", ")} function as network bridge${bridges.length > 1 ? "s" : ""} — connecting otherwise separate clusters.`);
  }

  if (nodes.length === 0) {
    if (primaryEntities.length > 0) {
      nodes.push(`${primaryEntities[0].name} is the sole promoted entity — additional ingest required to map power network.`);
    } else {
      nodes.push("No power nodes identified — promote entities and map relationships to reveal network structure.");
    }
  }

  return nodes.filter(Boolean).slice(0, 4);
}

function buildOversightFailures(
  topTimeline: RankedTimelineEvent[],
  topFinancial: RankedFinancialSignal[],
  primaryEntities: RankedEntity[],
  keyEvidence: RankedDocument[],
  targetMode: string | null
): string[] {
  const failures: string[] = [];

  // No legal/audit events despite financial signals
  const hasLegal = topTimeline.some(t => ["LEGAL_ACTION", "AUDIT", "INVESTIGATION_STARTED"].includes(t.eventType));
  const hasFinancial = topFinancial.length > 0;
  if (!hasLegal && hasFinancial) {
    failures.push("No audit, legal, or investigative events documented despite financial signals — potential accountability gap.");
  }

  // Long gap between financial signals and any oversight
  const financialDates = topFinancial.map(f => f.documentTitle).filter(Boolean);
  if (hasLegal && hasFinancial) {
    const legalDate = topTimeline.find(t => ["LEGAL_ACTION", "AUDIT", "INVESTIGATION_STARTED"].includes(t.eventType))?.eventDate;
    if (legalDate) {
      failures.push(`Oversight action not initiated until ${legalDate?.slice(0, 10) ?? "unknown date"} — investigate whether early warning signals were ignored.`);
    }
  }

  // Government agency as primary entity with no oversight signal
  const govAgencies = primaryEntities.filter(e => e.type === "government_agency");
  if (govAgencies.length > 0 && !hasLegal) {
    failures.push(`${govAgencies[0].name} is a primary actor with no documented oversight review — missing inspector general or audit reporting.`);
  }

  // Large public funds with low credibility sources
  const govFunds = topFinancial.filter(f => f.normalizedAmount && f.normalizedAmount >= 1_000_000);
  const hasGovSource = keyEvidence.some(d => d.source?.toLowerCase().includes(".gov") || d.title?.toLowerCase().includes("audit") || d.title?.toLowerCase().includes("inspector general"));
  if (govFunds.length > 0 && !hasGovSource) {
    failures.push(`$${(govFunds.reduce((a, f) => a + (f.normalizedAmount ?? 0), 0) / 1_000_000).toFixed(1)}M in public funds documented — no government accountability source (audit/IG report) ingested yet.`);
  }

  // Pattern: rapid funding approvals in timeline
  const fundingApprovals = topTimeline.filter(t => t.eventType === "FUNDING_APPROVED" || t.eventType === "CONTRACT_AWARDED");
  if (fundingApprovals.length >= 3) {
    failures.push(`${fundingApprovals.length} separate funding approvals or contract awards documented — frequency may indicate rubber-stamp oversight.`);
  }

  if (failures.length === 0 && targetMode === "scandal_target") {
    failures.push("Insufficient data to assess oversight failures — ingest inspector general reports, audit findings, or regulatory filings.");
  }

  return failures.filter(Boolean).slice(0, 5);
}

function buildRecommendedActions(
  dataQuality: "STRONG" | "MODERATE" | "WEAK" | "EMPTY",
  primaryEntities: RankedEntity[],
  topTimeline: RankedTimelineEvent[],
  topFinancial: RankedFinancialSignal[],
  keyEvidence: RankedDocument[],
  targetMode: string | null,
  knownGaps: string[]
): string[] {
  const actions: string[] = [];

  if (dataQuality === "EMPTY") {
    actions.push("Run a targeted web ingest session to begin evidence collection.");
    actions.push("Start with official government, court, or news sources for highest-quality signals.");
    return actions;
  }

  // Evidence gaps
  if (knownGaps.some(g => g.includes("Thin document"))) {
    actions.push("Expand document base — ingest 5–10 additional sources before drawing conclusions.");
  }

  // Entity relationship mapping
  const noRelationships = topTimeline.length === 0;
  if (primaryEntities.length >= 2 && noRelationships) {
    actions.push(`Map relationship between ${primaryEntities[0].name} and ${primaryEntities[1].name} — check shared board memberships, contracts, or co-signatures.`);
  }

  // No legal/audit events
  const hasLegal = topTimeline.some(t => ["LEGAL_ACTION", "AUDIT", "INVESTIGATION_STARTED"].includes(t.eventType));
  if (!hasLegal) {
    actions.push("Search for inspector general reports, GAO audits, or PACER court records related to primary entities.");
  }

  // Financial follow-up
  if (topFinancial.length > 0) {
    const topRecv = topFinancial[0].receivedBy ?? topFinancial[0].entityName;
    if (topRecv) {
      actions.push(`Pull public disclosure records for ${topRecv} — verify lobbying filings, 990s, or state contractor databases.`);
    }
  } else {
    actions.push("No financial signals detected — request SAM.gov, FPDS, or USASpending records for primary entities.");
  }

  // FOIA opportunity
  if (primaryEntities.some(e => e.type === "government_agency")) {
    const agency = primaryEntities.find(e => e.type === "government_agency");
    actions.push(`File FOIA/public records request with ${agency?.name ?? "relevant agency"} for contracts, meeting minutes, and internal communications.`);
  }

  // Source credibility upgrade
  const hasGovDocs = keyEvidence.some(d => d.priority === "TIER-1");
  if (!hasGovDocs) {
    actions.push("Upgrade evidence quality — ingest primary-source documents (government filings, court records, official audits).");
  }

  // Timeline reconstruction
  if (topTimeline.length < 3) {
    actions.push("Reconstruct timeline — search for dated contract awards, board meeting minutes, or regulatory actions to anchor the chronology.");
  }

  return [...new Set(actions)].filter(Boolean).slice(0, 6);
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
