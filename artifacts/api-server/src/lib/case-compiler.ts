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
    const key = fs.amountRaw || "";
    if (seenFinancial.has(key)) continue;
    seenFinancial.add(key);

    const amount = fs.normalizedAmount ? Number(fs.normalizedAmount) : 0;
    let score = Math.min(amount / 1_000_000, 100);

    const entityLower = (fs.entityName || "").toLowerCase();
    if (entityLower && entityNameSet.has(entityLower)) score += 20;

    const conf = fs.financialConfidence ? Number(fs.financialConfidence) : null;
    // Boost score by confidence
    if (conf !== null) score += conf * 10;

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
    parts.push("No named actors confirmed — entity extraction returned no promoted records.");
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
  if (promotedEntities.length === 0 && quality !== "EMPTY") {
    parts.push("No entities cleared for promotion — manual review or re-ingest recommended.");
  }

  if (quality === "WEAK" && docs.length < 3) {
    parts.push("Evidence base is thin — additional source ingestion required for reliable analysis.");
  }

  if (parts.length === 0) return "Evidence gathered. No dominant signal identified in current data set.";
  return parts.join(" ");
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
        queries.push(`"${p.name}" "${o?.name ?? ""}" board OR salary OR conflict`);
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
