import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  casesTable,
  entitiesTable,
  relationshipsTable,
  documentsTable,
  timelineEntriesTable,
  entityMentionsTable,
  financialSignalsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { compileCaseBrief } from "../lib/case-compiler";

const router: IRouter = Router();

// ─── Auto-dossier generation endpoint ──────────────────────────────────────
// GET /api/cases/:caseId/dossier
// T001: Entity quality hard cap (max 12, scored)
// T003: Entity intelligence profiles
// T004: Relationship sanity (no junk types)
// T005: Power structure from financial signals
// T006: Flow trace clean mode (confirmed numeric only, sorted largest→smallest)
// T007: Timeline max 8, accountability events only
// T008: Executive summary 4-paragraph intelligence brief
// T011: Fail-safe mode

router.get("/cases/:caseId/dossier", async (req, res) => {
  const caseId = parseInt(req.params.caseId);
  if (isNaN(caseId)) return res.status(400).json({ error: "Invalid case ID" });

  const caseRows = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
  if (caseRows.length === 0) return res.status(404).json({ error: "Case not found" });
  const caseData = caseRows[0];

  const allEntities = await db.select().from(entitiesTable).where(eq(entitiesTable.caseId, caseId));
  const promotedEntityIds = new Set(allEntities.map((e) => e.id));

  const allMentions = allEntities.length > 0
    ? await db.select().from(entityMentionsTable).where(eq(entityMentionsTable.caseId, caseId))
    : [];
  const approvedOnly = allMentions.filter((m) => m.status === "approved");

  const allRelationships = await db.select().from(relationshipsTable).where(eq(relationshipsTable.caseId, caseId));

  const documents = await db.select({
    id: documentsTable.id,
    title: documentsTable.title,
    source: documentsTable.source,
    publishDate: documentsTable.publishDate,
    sourceUrl: documentsTable.sourceUrl,
  }).from(documentsTable).where(eq(documentsTable.caseId, caseId));

  const timeline = await db.select().from(timelineEntriesTable).where(
    eq(timelineEntriesTable.caseId, caseId)
  );

  // ── Parse ATLAS-SEED ────────────────────────────────────────────────────────
  const desc = caseData.description ?? "";
  const seedMatch = desc.match(/\[ATLAS-SEED:([^\]]+)\]/);
  const kv: Record<string, string> = {};
  if (seedMatch) {
    seedMatch[1].split("|").forEach((p: string) => {
      const eqIdx = p.indexOf("=");
      if (eqIdx > 0) kv[p.slice(0, eqIdx)] = p.slice(eqIdx + 1);
    });
  }
  const dec = (v?: string): string => { try { return v ? decodeURIComponent(v) : ""; } catch { return v ?? ""; } };
  // Fallback: detect seed intent from case title/description if not in ATLAS-SEED
  const rawSeedIntent = kv.seed_intent || (() => {
    const probe = (caseData.title + " " + (caseData.description ?? "")).toLowerCase();
    if (/homeless|shelter|lahsa|housing|unhoused|service provider.*fund/i.test(probe)) return "housing_homelessness";
    if (/corrupt|bribe|fraud|kickback|indictment|misconduct|embezzl/i.test(probe)) return "crime_corruption";
    if (/grant|budget|appropriat|spending|contract.*fund|allocation/i.test(probe)) return "finance_funding";
    if (/lawsuit|litigation|court|judgment|plaintiff|defendant|settle/i.test(probe)) return "legal_lawsuit";
    if (/policy|regulation|legislature|bill|ordinance|executive order/i.test(probe)) return "policy_government";
    return "general";
  })();
  const seedIntent = rawSeedIntent;
  const nextQueriesRaw = dec(kv.next_queries);
  const nextQueriesParsed = nextQueriesRaw ? nextQueriesRaw.split("||").filter(Boolean) : [];
  const autoBuildQuality = kv.auto_build_quality || null;
  const briefText = desc.replace(/\[ATLAS-SEED:[^\]]+\]/, "").trim();

  // ── T006: Raw financial signals — numeric only, sorted largest → smallest ───
  const rawFinancialSignals = await db.select().from(financialSignalsTable).where(
    eq(financialSignalsTable.caseId, caseId)
  );

  // Score and rank financial signals
  const scoredRawSignals = rawFinancialSignals.map(fs => {
    let score = 0;
    const conf = fs.financialConfidence ? Number(fs.financialConfidence) : 0;
    const amt  = fs.normalizedAmount ? Number(fs.normalizedAmount) : 0;
    if (!fs.inferredSignal) score += 3;
    score += conf * 2;
    if (amt >= 1_000_000) score += 2;
    else if (amt >= 100_000) score += 1;
    if (fs.entityName) score += 0.5;
    if (fs.controlledBy || fs.receivedBy) score += 0.5;
    if (fs.programName) score += 0.3;
    return { ...fs, _score: score };
  });

  // T006: Only confirmed numeric signals with real amounts, sorted largest → smallest
  const allNumericSignals = scoredRawSignals
    .filter(fs =>
      !(fs.signalType?.startsWith("NON_NUMERIC")) &&
      fs.amountDisplay !== "NON-NUMERIC" &&
      (fs.normalizedAmount ? Number(fs.normalizedAmount) : 0) > 0
    )
    .sort((a, b) => (Number(b.normalizedAmount) || 0) - (Number(a.normalizedAmount) || 0));

  // Deduplicate: same entity + amount → keep highest scored
  const seenAmountEntity = new Set<string>();
  const dedupedSignals = allNumericSignals.filter(fs => {
    const key = `${(fs.entityName ?? "").toLowerCase()}|${fs.normalizedAmount}`;
    if (seenAmountEntity.has(key)) return false;
    seenAmountEntity.add(key);
    return true;
  });

  const financialSignals = dedupedSignals.map(fs => ({
    entityName: fs.entityName ?? null,
    amountRaw: fs.amountRaw,
    amountDisplay: fs.amountDisplay ?? null,
    normalizedAmount: fs.normalizedAmount ? Number(fs.normalizedAmount) : null,
    signalType: fs.signalType,
    eventSummary: fs.eventSummary ?? null,
    controlledBy: fs.controlledBy ?? null,
    receivedBy: fs.receivedBy ?? null,
    programName: fs.programName ?? null,
    confidence: fs.financialConfidence ? Number(fs.financialConfidence) : null,
    inferred: fs.inferredSignal ?? false,
    docId: fs.documentId ?? null,
  }));

  // Fallback: early non-numeric signals if no confirmed numeric
  const earlySignals = financialSignals.length === 0
    ? scoredRawSignals
        .filter(fs => fs.signalType?.startsWith("NON_NUMERIC") && fs.eventSummary)
        .slice(0, 3)
        .map(fs => ({
          entityName: fs.entityName ?? null,
          amountRaw: fs.amountRaw,
          amountDisplay: fs.amountDisplay ?? null,
          normalizedAmount: null,
          signalType: fs.signalType,
          eventSummary: fs.eventSummary ?? null,
          controlledBy: fs.controlledBy ?? null,
          receivedBy: fs.receivedBy ?? null,
          programName: fs.programName ?? null,
          confidence: fs.financialConfidence ? Number(fs.financialConfidence) : null,
          inferred: true,
          docId: fs.documentId ?? null,
        }))
    : [];

  const outputFinancialSignals = financialSignals.length > 0 ? financialSignals : earlySignals;

  // ── T001: Entity quality scoring + cap at 12 ────────────────────────────────
  // Score = financial_linkage×3 + avg_confidence×3 + doc_freq×2 + title_presence×2 + rel_strength×2

  // Doc support per entity
  const entityDocSupport = new Map<number, Set<number>>();
  for (const m of approvedOnly) {
    if (!m.entityId || !m.documentId) continue;
    if (!entityDocSupport.has(m.entityId)) entityDocSupport.set(m.entityId, new Set());
    entityDocSupport.get(m.entityId)!.add(m.documentId);
  }

  // Average confidence per entity from mentions
  const entityMentionConf = new Map<number, number>();
  for (const e of allEntities) {
    const mentsForEntity = approvedOnly.filter(m => m.entityId === e.id);
    if (mentsForEntity.length > 0) {
      const avg = mentsForEntity.reduce((acc, m) => acc + (Number(m.confidence) || 0), 0) / mentsForEntity.length;
      entityMentionConf.set(e.id, avg);
    }
  }

  // Document title words for title presence check
  const docTitleWords = new Set(
    documents.flatMap(d => (d.title ?? "").toLowerCase().split(/\s+/)).filter(w => w.length > 3)
  );

  // Relationship count per entity
  const entityRelCount = new Map<number, number>();
  for (const r of allRelationships) {
    if (promotedEntityIds.has(r.entityAId) && promotedEntityIds.has(r.entityBId)) {
      entityRelCount.set(r.entityAId, (entityRelCount.get(r.entityAId) ?? 0) + 1);
      entityRelCount.set(r.entityBId, (entityRelCount.get(r.entityBId) ?? 0) + 1);
    }
  }

  // Financial linkage set (entity names in signals)
  const financialEntityNames = new Set(
    financialSignals.map(f => f.entityName?.toLowerCase()).filter(Boolean) as string[]
  );

  type EntityRow = typeof allEntities[number];
  const maxDocCount = Math.max(1, ...allEntities.map(e => entityDocSupport.get(e.id)?.size ?? 0));

  function scoreEntityQuality(e: EntityRow): number {
    let score = 0;
    const docCount = entityDocSupport.get(e.id)?.size ?? 0;
    const avgConf = entityMentionConf.get(e.id) ?? 0.5;
    const relCount = entityRelCount.get(e.id) ?? 0;

    // Financial linkage ×3
    if (financialEntityNames.has(e.name.toLowerCase())) score += 3;

    // Avg confidence ×3
    score += avgConf * 3;

    // Doc frequency ×2 (normalized)
    score += (docCount / maxDocCount) * 2;

    // Title presence ×2
    const nameWords = e.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const inTitle = nameWords.some(w => docTitleWords.has(w));
    if (inTitle) score += 2;

    // Relationship strength ×2
    score += Math.min(relCount / 3, 1) * 2;

    return score;
  }

  // T001: Score, sort, cap at 12
  // T002: Entity Promotion Lock — entity must meet at least 1 promotion criterion:
  //   (a) appears in 2+ documents  (b) has direct money linkage  (c) has relationship evidence
  //   (d) is government / agency / contractor / official / program  (e) in title + body
  //   Reject: generic nouns, one-off weak mentions, soft/cultural references
  const GENERIC_ENTITY_NAMES = new Set([
    "people", "person", "community", "residents", "families", "individuals", "group", "groups",
    "women", "men", "children", "youth", "adults", "homeless", "unhoused", "others",
    "city", "county", "state", "nation", "government", "officials", "office", "board",
    "public", "taxpayers", "voters", "citizens", "administration",
  ]);
  const GOV_CONTRACTOR_TYPES = new Set([
    "government_agency", "government_body", "government", "agency", "organization",
    "company", "corporation", "business", "nonprofit", "ngo", "program", "department",
  ]);

  const passesPromotionLock = (e: EntityRow): boolean => {
    const docCount = entityDocSupport.get(e.id)?.size ?? 0;
    const nameLower = e.name.toLowerCase().trim();
    // Reject exact generic names
    if (GENERIC_ENTITY_NAMES.has(nameLower)) return false;
    // Reject very short names (1 word, 3 chars or less)
    if (nameLower.split(/\s+/).length === 1 && nameLower.length <= 3) return false;
    // Criterion A: 2+ documents
    if (docCount >= 2) return true;
    // Criterion B: money linkage
    if (financialEntityNames.has(nameLower)) return true;
    // Criterion C: relationship evidence
    if ((entityRelCount.get(e.id) ?? 0) > 0) return true;
    // Criterion D: gov / agency / contractor type
    if (GOV_CONTRACTOR_TYPES.has(e.type.toLowerCase())) return true;
    // Criterion E: appears in document title
    const nameWords = nameLower.split(/\s+/).filter(w => w.length > 3);
    if (nameWords.length > 0 && nameWords.some(w => docTitleWords.has(w))) return true;
    return false;
  };

  const scoredEntities = allEntities
    .filter(e => passesPromotionLock(e))
    .map(e => ({ ...e, _score: scoreEntityQuality(e) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 12);

  // Use scoredEntities as the canonical entity list for this dossier
  const entities = scoredEntities;
  const entityById = new Map<number, EntityRow>(entities.map((e) => [e.id, e]));
  const entityIdSet = new Set(entities.map(e => e.id));

  // ── T004: Relationship sanity — reject junk, only allow meaningful types ────
  // Canonical relationship types (normalized)
  const CANONICAL_REL_TYPES = new Set([
    "FUNDS", "CONTROLS", "CONTRACTS", "OVERSEES", "ALLOCATES",
    "AWARDS", "EMPLOYS", "MANAGES", "DIRECTS", "OPERATES",
    "RECEIVES_FUNDS", "INSPECTS", "AUDITS", "SUPERVISES",
    "PARTNERS", "SUBCONTRACTS", "REGULATES", "REPORTS_TO",
  ]);

  // Junk patterns in relationship types
  const JUNK_REL_PATTERNS = /\b(with|by|from|of|and|or|the|a|an|co_mention|title_co_mention|cooccurrence|generic|unknown|mentioned|appears|found)\b/i;
  const PREPOSITION_ONLY = /^(with|by|from|of|and|or|in|at|to)\s+/i;

  const cleanRelationships = allRelationships
    .filter(r => entityIdSet.has(r.entityAId) && entityIdSet.has(r.entityBId))
    .filter(r => {
      const relType = (r.relationshipType ?? "").trim();
      if (!relType) return false;
      // Reject junk types
      if (JUNK_REL_PATTERNS.test(relType)) return false;
      if (PREPOSITION_ONLY.test(relType)) return false;
      // Require reasonable confidence
      if ((r.confidence ?? 0) < 0.3) return false;
      return true;
    })
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 10);  // T004: max 10 relationships

  // ── T002: Entity type normalization ─────────────────────────────────────────
  const TYPE_MAP: Record<string, string> = {
    "organization": "CONTRACTOR",
    "company": "CONTRACTOR",
    "corporation": "CONTRACTOR",
    "business": "CONTRACTOR",
    "government_agency": "AGENCY",
    "government_body": "GOVERNMENT",
    "government": "GOVERNMENT",
    "agency": "AGENCY",
    "nonprofit": "NONPROFIT",
    "ngo": "NONPROFIT",
    "charity": "NONPROFIT",
    "program": "PROGRAM",
    "department": "AGENCY",
    "person": "PERSON",
    "individual": "PERSON",
    "location": "LOCATION",
    "place": "LOCATION",
  };

  function normalizeEntityType(raw: string): string {
    return TYPE_MAP[raw.toLowerCase()] ?? raw.toUpperCase().replace(/_/g, " ");
  }

  // ── SECTION 2 — Key Entities ─────────────────────────────────────────────────
  const keyEntities = entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: normalizeEntityType(e.type),
    rawType: e.type,
    aliases: e.aliases ?? [],
    docCount: entityDocSupport.get(e.id)?.size ?? 0,
    qualityScore: Math.round((e as any)._score * 10) / 10,
  })).sort((a, b) => b.qualityScore - a.qualityScore);

  // ── SECTION 3 — Entity Relationships ────────────────────────────────────────
  const entityRelationships = cleanRelationships.map((r) => {
    const eA = entityById.get(r.entityAId);
    const eB = entityById.get(r.entityBId);
    return {
      entityAId: r.entityAId,
      entityBId: r.entityBId,
      entityAName: eA?.name ?? "Unknown",
      entityBName: eB?.name ?? "Unknown",
      relationshipType: r.relationshipType,
      confidence: r.confidence,
    };
  });

  // Top entities for summary building
  const topEntities = keyEntities.slice(0, 5);
  const topPersons = topEntities.filter(e => e.rawType === "person").slice(0, 3);
  const topOrgs = topEntities.filter(e =>
    ["organization", "government_agency", "government_body", "company"].includes(e.rawType)
  ).slice(0, 3);

  // ── SECTION 4 — Document Evidence ───────────────────────────────────────────
  const documentEvidence = documents.map((d) => ({
    id: d.id,
    title: d.title,
    source: d.source,
    date: d.publishDate ?? null,
    url: d.sourceUrl ?? null,
  })).sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date as string).getTime() - new Date(a.date as string).getTime();
  });

  // ── SECTION 5 — Timeline Signals (T005: strict accountability allowlist) ─────
  // T005: Only hard accountability events pass — no soft "EVENT" or "PROGRAM_LAUNCH" catchalls
  const ACCOUNTABILITY_EVENT_TYPES = new Set([
    "CONTRACT_AWARDED", "CONTRACT", "AUDIT", "AUDIT_FLAG", "AUDIT_FINDING",
    "APPROPRIATION", "HEARING", "ENFORCEMENT", "ENFORCEMENT_ACTION",
    "PROGRAM_CHANGE", "VIOLATION", "INDICTMENT",
    "SETTLEMENT", "REGULATORY_ACTION", "BUDGET_ACTION", "GRANT_AWARD",
    "FRAUD_FLAG", "WHISTLEBLOWER", "INVESTIGATION", "CONVICTION",
    "FILING", "FRAUD_MISUSE", "INSPECTION", "SUSPENSION", "DEBARMENT",
    "REFERRAL", "COMPLAINT", "SUBPOENA", "ARREST", "CHARGE",
    "AGENCY_CHANGE", "LEADERSHIP_CHANGE", "OVERSIGHT_ACTION",
    "BUDGET", "DISBURSEMENT",
    // Removed: "EVENT", "GOVERNMENT_ACTION", "POLITICAL_ACTION", "PROGRAM_MILESTONE", "PROGRAM_LAUNCH"
    // — too permissive, admitted soft media filler
  ]);
  const ACCOUNTABILITY_KEYWORDS = /\b(contract|audit|grant|fund|appropriat|legislat|budget|hearing|enforcement|program|indict|settl|compliance|investigation|fraud|oversight|inspection|debarment|conviction|award|procurement|disburs|allocat|regulator)\b/i;
  const JUNK_KEYWORDS = /\b(episode|season|recap|trailer|premiere|documentary|film|movie|concert|game|match|tournament|playoff|bracket|watch|stream|preview|sports|celebrity|entertainment)\b/i;

  const timelineSignals = timeline
    .filter((t) => {
      if (!t.date) return false;
      if (t.eventType && t.eventType.trim()) {
        const et = t.eventType.trim().toUpperCase();
        if (!ACCOUNTABILITY_EVENT_TYPES.has(et)) return false;
      }
      const text = `${t.title ?? ""} ${t.description ?? ""}`;
      if (JUNK_KEYWORDS.test(text)) return false;
      if (t.eventType && !ACCOUNTABILITY_KEYWORDS.test(text)) {
        if (!ACCOUNTABILITY_EVENT_TYPES.has(t.eventType.trim().toUpperCase())) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())
    .slice(0, 8)  // T007: Hard cap at 8 events
    .map((t) => ({
      date: t.date,
      title: t.title,
      description: t.description,
      eventType: t.eventType,
    }));

  // ── T011: Fail-safe mode check ───────────────────────────────────────────────
  const hasRealEntities = entities.length > 0;
  const hasRealFinancials = financialSignals.length > 0;
  const insufficientData = !hasRealEntities && !hasRealFinancials;

  // ── T008: Executive Summary — 4-paragraph intelligence brief ─────────────────
  // T001: Minimum Output Rule — even RAW cases get the full 7-section shell
  const buildMinimumOutputStructure = (): string => {
    const parts: string[] = [];
    const frame = seedIntent === "housing_homelessness"
      ? "public accountability investigation into homelessness spending and shelter program oversight"
      : seedIntent === "crime_corruption"
      ? "misconduct and corruption investigation"
      : seedIntent === "finance_funding"
      ? "financial oversight investigation tracking public funding flows"
      : seedIntent === "policy_government"
      ? "government program oversight investigation"
      : "intelligence investigation";
    parts.push(`CASE FRAMING: This file constitutes a ${frame} targeting ${caseData.title}. ${documents.length} source document${documents.length !== 1 ? "s" : ""} ingested. Entity analysis not yet complete.`);
    parts.push(`KEY ENTITIES: NOT YET CONFIRMED — entity triage required. Ingest primary-source documents (government records, audits, official filings) to identify principal actors.`);
    parts.push(`CONFIRMED RELATIONSHIPS: RELATIONSHIP EVIDENCE INSUFFICIENT — no entity network established. Build actor map to surface control chains and financial connections.`);
    parts.push(`FINANCIAL SIGNALS: NO VERIFIED FLOW IDENTIFIED — no confirmed financial signals extracted. Ingest budget documents, contract records, or audit findings to establish the money trail.`);
    parts.push(`INVESTIGATIVE TIMELINE: NOT YET CONFIRMED — no accountability events extracted. Ingest dated source materials with appropriation, contract, or audit context.`);
    parts.push(`MAIN ACCOUNTABILITY CONCERN: Under assessment — entity and financial mapping required before the primary oversight gap can be characterized.`);
    const intentActions: Record<string, string[]> = {
      housing_homelessness: [
        "Obtain LAHSA or county homelessness agency fiscal year budget PDF.",
        "Identify shelter and service provider vendors receiving public contracts.",
        "Confirm which agency holds award authority for homelessness service contracts.",
        "Request HUD compliance documentation via state public records law.",
        "Compare official program outcome data against reported spending levels.",
      ],
      finance_funding: [
        "Obtain fiscal year budget PDF for primary funding agency.",
        "Identify recipient vendors and confirm award authority.",
        "Compare audit findings against public claims by agency leadership.",
        "Cross-reference grant recipients against lobbying and campaign finance disclosures.",
        "Verify board or legislative approval date for primary appropriation.",
      ],
      crime_corruption: [
        "Identify whistleblowers or complainants in public court records.",
        "Obtain grand jury filings or indictment documents if available.",
        "Map timeline of decisions against known complaint reports.",
        "Identify financial benefit flowing to implicated parties.",
        "Check for parallel civil or administrative proceedings.",
      ],
    };
    const defaultActions = [
      "Ingest primary-source documents (government filings, audits, court records).",
      "Identify key institutional actors and their decision-making authority.",
      "Obtain financial records for primary entities via FOIA or public records request.",
      "Map confirmed actors to funding flows and program decisions.",
      "Cross-reference public disclosures against media reporting.",
    ];
    const actions = intentActions[seedIntent] ?? defaultActions;
    parts.push(`RECOMMENDED NEXT ACTIONS:\n${actions.map((a, i) => `  ${i + 1}. ${a}`).join("\n")}`);
    return parts.join("\n\n");
  };

  const buildCaseSummary = (): string => {
    if (insufficientData) {
      return buildMinimumOutputStructure();
    }

    const isSeedFormat = briefText.startsWith("WHAT:") || briefText.startsWith("ATLAS:") || briefText.startsWith("[ATLAS") || briefText.startsWith("Seed investigation") || briefText.startsWith("Controlled test");
    if (briefText && briefText.length > 120 && !isSeedFormat) return briefText;

    const intentLabel: Record<string, string> = {
      housing_homelessness: "public accountability investigation into homelessness spending and shelter program oversight",
      crime_corruption: "misconduct and corruption investigation targeting potential fraud, financial abuse, or ethical violations",
      finance_funding: "financial oversight investigation tracking public funding flows and appropriation integrity",
      legal_lawsuit: "litigation intelligence file examining court filings, legal exposure, and named parties",
      policy_government: "government program oversight investigation focused on policy implementation and accountability",
      education_university: "education sector accountability investigation tracking institutional spending and governance",
      entertainment_film: "film industry finance investigation examining tax credits, production subsidies, and studio deals",
      general: "open intelligence investigation",
    };
    const frame = intentLabel[seedIntent] || "open intelligence investigation";

    // P1: What the case is
    const p1 = `This file constitutes a ${frame} targeting ${caseData.title}.`;

    // P2: Key entities + money
    const p2Parts: string[] = [];
    if (topPersons.length > 0 && topOrgs.length > 0) {
      p2Parts.push(`${topPersons.map(e => e.name).join(" and ")} and ${topOrgs.map(e => e.name).join(" and ")} are the primary subjects of record.`);
    } else if (topPersons.length > 0) {
      p2Parts.push(`${topPersons.map(e => e.name).join(" and ")} are the principal persons of interest.`);
    } else if (topOrgs.length > 0) {
      p2Parts.push(`${topOrgs.map(e => e.name).join(" and ")} are the central institutional actors.`);
    }
    if (financialSignals.length > 0) {
      const topSig = financialSignals[0];
      const totalAmt = financialSignals.reduce((acc, f) => acc + (f.normalizedAmount ?? 0), 0);
      const totalFmt = totalAmt >= 1e9 ? `$${(totalAmt/1e9).toFixed(2)}B` : totalAmt >= 1e6 ? `$${(totalAmt/1e6).toFixed(2)}M` : totalAmt >= 1e3 ? `$${(totalAmt/1e3).toFixed(1)}K` : null;
      // T007: Use clean resolved roles — prefer controlledBy → receivedBy chain, never raw entityName alone
      const topActor = topSig.controlledBy ?? topSig.receivedBy ?? topSig.entityName;
      if (topSig.amountDisplay && topActor) {
        const actorChain = topSig.controlledBy && topSig.receivedBy
          ? `${topSig.controlledBy} → ${topSig.receivedBy}`
          : topActor;
        p2Parts.push(`${financialSignals.length} confirmed financial signal${financialSignals.length !== 1 ? "s" : ""} extracted — lead signal: ${topSig.amountDisplay} (${actorChain})${totalFmt && financialSignals.length > 1 ? `. Total tracked: ${totalFmt}` : ""}.`);
      } else if (totalFmt) {
        p2Parts.push(`${financialSignals.length} quantified financial signal${financialSignals.length !== 1 ? "s" : ""} detected totaling ${totalFmt}.`);
      }
    }
    const p2 = p2Parts.join(" ");

    // P3: Main issue / risk
    const p3Parts: string[] = [];
    if (seedIntent === "housing_homelessness") {
      p3Parts.push("Homelessness service contracts frequently lack competitive bidding requirements and outcome metrics — conditions favorable to waste, fraud, and political favoritism.");
    } else if (seedIntent === "crime_corruption") {
      p3Parts.push("Alleged misconduct at an institutional level implicates systemic failures of oversight, not merely individual bad actors.");
    } else if (seedIntent === "finance_funding") {
      p3Parts.push("Public grant and contract flows without adequate transparency mechanisms represent a recurring accountability gap.");
    } else if (seedIntent === "legal_lawsuit") {
      p3Parts.push("Civil or criminal proceedings create a public record that surfaces relationships and financial flows otherwise hidden from view.");
    } else if (seedIntent === "policy_government") {
      p3Parts.push("Policy decisions at this level redirect significant public resources — identifying who benefits and who controls the decision chain is essential.");
    } else if (cleanRelationships.length > 0 || financialSignals.length > 0) {
      p3Parts.push("The intersection of confirmed relationships and financial signals warrants continued investigative scrutiny.");
    } else {
      p3Parts.push(`Evidence development is ongoing. Continued investigation is warranted to establish the full scope of actors, flows, and decisions.`);
    }
    const p3 = p3Parts.join(" ");

    // P4: Confidence level
    const confirmedCount = keyEntities.filter(e => e.docCount >= 3).length;
    let confidenceLevel = "PROVISIONAL";
    if (confirmedCount >= 2 && documents.length >= 4) confidenceLevel = "MODERATE";
    if (confirmedCount >= 3 && documents.length >= 6 && financialSignals.length > 0) confidenceLevel = "STRONG";
    if (entities.length === 0) confidenceLevel = "INSUFFICIENT";
    const p4 = `Intelligence confidence: ${confidenceLevel}. ${entities.length} confirmed entity/entities across ${documents.length} source document${documents.length !== 1 ? "s" : ""}. ${financialSignals.length} quantified financial signal${financialSignals.length !== 1 ? "s" : ""}. ${timelineSignals.length} accountability timeline event${timelineSignals.length !== 1 ? "s" : ""}.`;

    return [p1, p2, p3, p4].filter(Boolean).join("\n\n");
  };
  const caseSummary = buildCaseSummary();

  // ── T003: Entity Intelligence Profiles ──────────────────────────────────────
  function buildEntityProfile(e: EntityRow & { _score: number }) {
    const docCount = entityDocSupport.get(e.id)?.size ?? 0;
    const eName = e.name;
    const eType = normalizeEntityType(e.type);
    const entityMents = approvedOnly.filter(m => m.entityId === e.id);
    const entityFinancials = financialSignals.filter(
      f => f.entityName?.toLowerCase() === eName.toLowerCase()
    );
    const entityRels = cleanRelationships.filter(
      r => r.entityAId === e.id || r.entityBId === e.id
    );
    const relatedEntityNames = entityRels.map(r =>
      r.entityAId === e.id ? entityById.get(r.entityBId)?.name : entityById.get(r.entityAId)?.name
    ).filter(Boolean);

    // Evidence strength
    let evidenceStrength: "STRONG" | "MODERATE" | "LIMITED" = "LIMITED";
    if (docCount >= 3 && entityMents.length >= 3) evidenceStrength = "STRONG";
    else if (docCount >= 2 || entityMents.length >= 2) evidenceStrength = "MODERATE";

    // What this entity is
    const typeDescriptions: Record<string, string> = {
      PERSON: "An individual identified as a principal subject of interest in this investigation.",
      AGENCY: "A government agency with regulatory, oversight, or enforcement authority.",
      GOVERNMENT: "A government body or authority with legislative or executive power.",
      CONTRACTOR: `A private-sector organization operating in a contractual capacity. ${entityFinancials.length > 0 ? `Financial signals link ${eName} to contract activity in this case.` : ""}`,
      NONPROFIT: "A nonprofit or charitable organization with potential involvement in public funding flows.",
      PROGRAM: "A government or institutional program receiving or disbursing public funds.",
      LOCATION: "A geographic or jurisdictional entity relevant to the investigation area.",
    };
    const whatItIs = typeDescriptions[eType] ?? `An entity of type ${eType} identified in this investigation.`;

    // Role in case
    let roleInCase = "";
    if (entityFinancials.length > 0) {
      const topF = entityFinancials[0];
      roleInCase = `${eName} is linked to ${entityFinancials.length} financial signal${entityFinancials.length !== 1 ? "s" : ""} in this case`;
      if (topF.amountDisplay) roleInCase += `, including a lead signal of ${topF.amountDisplay}`;
      if (topF.signalType) roleInCase += ` (type: ${topF.signalType.replace(/_/g, " ").toLowerCase()})`;
      roleInCase += ".";
    } else if (entityRels.length > 0) {
      roleInCase = `${eName} is connected to ${entityRels.length} confirmed relationship${entityRels.length !== 1 ? "s" : ""} in the entity network${relatedEntityNames.length > 0 ? `, including links to ${relatedEntityNames.slice(0, 2).join(" and ")}` : ""}.`;
    } else if (docCount > 0) {
      roleInCase = `${eName} appears in ${docCount} source document${docCount !== 1 ? "s" : ""} but has no confirmed financial or relationship connections yet.`;
    } else {
      roleInCase = `${eName} was extracted from document content and is pending further corroboration.`;
    }

    // Why it matters
    let whyItMatters = "";
    if (eType === "AGENCY" || eType === "GOVERNMENT") {
      whyItMatters = `As a ${eType.toLowerCase()}, ${eName} carries oversight and accountability obligations. Any failure to exercise those obligations — or any appearance of political interference — is investigatively significant.`;
    } else if (eType === "CONTRACTOR" && entityFinancials.length > 0) {
      const totalAmt = entityFinancials.reduce((acc, f) => acc + (f.normalizedAmount ?? 0), 0);
      const fmtTotal = totalAmt >= 1e6 ? `$${(totalAmt/1e6).toFixed(2)}M` : totalAmt >= 1e3 ? `$${(totalAmt/1e3).toFixed(1)}K` : null;
      whyItMatters = `${eName} is a private-sector actor linked to${fmtTotal ? ` ${fmtTotal} in` : ""} public contract activity. Without independent verification of deliverables and competitive bidding, these flows represent an accountability risk.`;
    } else if (eType === "PERSON") {
      whyItMatters = `${eName} is an individual subject whose decision-making authority — and any potential conflicts of interest — are central to establishing accountability in this case.`;
    } else if (eType === "PROGRAM") {
      whyItMatters = `${eName} is a program channel through which public funds flow. Documenting the allocation chain and verifying outcomes is essential.`;
    } else {
      whyItMatters = `${eName} requires additional source corroboration to establish investigative significance. Cross-referencing public records is recommended.`;
    }

    // Open questions
    const openQuestions: string[] = [];
    if (docCount < 2) openQuestions.push(`Confirm ${eName} across additional independent sources.`);
    if (entityFinancials.length === 0 && (eType === "CONTRACTOR" || eType === "AGENCY")) {
      openQuestions.push(`Identify financial flows connected to ${eName} — FOIA contract or grant records.`);
    }
    if (entityRels.length === 0) {
      openQuestions.push(`Map ${eName}'s relationships to other actors in this investigation.`);
    }
    if (eType === "PERSON") {
      openQuestions.push(`Establish ${eName}'s decision-making authority and any disclosed or undisclosed conflicts of interest.`);
    }
    if (openQuestions.length === 0) {
      openQuestions.push(`Verify ${eName}'s role against primary source documents and official disclosures.`);
    }

    return {
      entityId: e.id,
      entityName: eName,
      entityType: eType,
      whatItIs,
      roleInCase,
      whyItMatters,
      evidenceStrength,
      openQuestions: openQuestions.slice(0, 3),
    };
  }

  const entityProfiles = entities.map(e => buildEntityProfile(e));

  // ── T005: Power Structure from financial signals ──────────────────────────────
  const buildPowerStructure = (): string => {
    if (entities.length === 0) return "No confirmed entities — power structure cannot be assessed.";

    const parts: string[] = [];

    // Build flow chains from financial signals
    const flowChains: string[] = [];
    for (const f of financialSignals.slice(0, 5)) {
      const from = f.controlledBy ?? f.entityName;
      const to = f.receivedBy;
      const prog = f.programName;
      const amt = f.amountDisplay;

      if (from && to && amt) {
        flowChains.push(`${from} → ${prog ? `${prog} → ` : ""}${to}: ${amt}`);
      } else if (from && amt) {
        flowChains.push(`${from}${prog ? ` → ${prog}` : ""}: ${amt} (recipient unconfirmed)`);
      } else if (to && amt) {
        flowChains.push(`Unknown source → ${to}: ${amt}`);
      }
    }

    if (flowChains.length > 0) {
      parts.push("CONFIRMED FINANCIAL CONTROL CHAINS:");
      flowChains.forEach(chain => parts.push(`  ${chain}`));
    }

    // Entity control relationships
    const controlRels = cleanRelationships.filter(r =>
      ["CONTROLS", "FUNDS", "OVERSEES", "MANAGES", "SUPERVISES", "ALLOCATES", "DIRECTS"].includes(
        (r.relationshipType ?? "").toUpperCase()
      )
    );
    if (controlRels.length > 0) {
      if (parts.length > 0) parts.push("");
      parts.push("CONFIRMED CONTROL RELATIONSHIPS:");
      controlRels.slice(0, 3).forEach(r => {
        const eA = entityById.get(r.entityAId);
        const eB = entityById.get(r.entityBId);
        if (eA && eB) {
          parts.push(`  ${eA.name} → ${r.relationshipType?.replace(/_/g, " ")} → ${eB.name}`);
        }
      });
    }

    if (parts.length === 0) {
      const topOrg = entities.find(e => ["organization", "government_agency"].includes(e.type));
      if (topOrg) {
        return `${topOrg.name} is the primary institutional actor. Control chain and financial structure remain to be confirmed — build the entity graph and ingest contract/grant records to establish the power structure.`;
      }
      return `${entities.length} entity/entities confirmed. Control chain and financial structure remain to be mapped.`;
    }

    return parts.join("\n");
  };
  const powerStructure = buildPowerStructure();

  // ── SECTION 7 — Investigative Angles ────────────────────────────────────────
  const buildInvestigativeAngles = (): Array<{ angle: string }> => {
    if (insufficientData) return [];
    const angles: string[] = [];
    const topPerson  = topPersons[0]?.name;
    const topOrg     = topOrgs[0]?.name;
    const topEntity  = topEntities[0]?.name ?? caseData.title;
    const hasFinance = financialSignals.length > 0;
    const hasMoney   = approvedOnly.some(m => /\b(million|billion|contract|grant|award|fund|budget|appropriation|payment)\b/i.test(m.context ?? ""));

    if (seedIntent === "housing_homelessness") {
      if (topOrg)    angles.push(`Trace the contract award trail for ${topOrg} — who authorized payments and under what program authority.`);
      if (topPerson) angles.push(`Map ${topPerson}'s decision-making authority over shelter funding allocations.`);
      angles.push(`Cross-reference vendor contracts against service delivery outcomes in ${caseData.title} area.`);
      angles.push(`Identify whether emergency funding bypassed competitive bidding requirements.`);
      angles.push(`Check federal HUD compliance status for programs receiving local appropriations.`);
      if (!hasFinance) angles.push(`Financial signals are absent — request FOIA for contract awards, invoices, and disbursement records.`);
    } else if (seedIntent === "crime_corruption") {
      if (topPerson) angles.push(`Establish ${topPerson}'s role in the alleged misconduct chain and who had authority to act.`);
      if (topOrg)    angles.push(`Determine whether ${topOrg} had prior misconduct history or pending investigations.`);
      angles.push(`Map timeline of decisions against known complaint or whistleblower reports.`);
      angles.push(`Identify financial benefit flowing to implicated parties during the period of alleged misconduct.`);
      angles.push(`Check for parallel civil or administrative proceedings alongside criminal exposure.`);
    } else if (seedIntent === "finance_funding") {
      if (topOrg)    angles.push(`Audit ${topOrg}'s reported financial flows against publicly available disclosures.`);
      if (topPerson) angles.push(`Identify any undisclosed conflicts of interest involving ${topPerson} and grant recipients.`);
      angles.push(`Cross-reference award recipients against donor records, lobbying disclosures, or political contributions.`);
      if (hasMoney)  angles.push(`Follow identified financial signals to determine ultimate recipient and program authority.`);
      angles.push(`Check for sole-source or emergency contract awards that bypassed standard procurement.`);
    } else {
      angles.push(`Map the decision chain from ${topEntity} to the accountability point.`);
      angles.push(`Follow financial flows connected to the primary subjects.`);
      angles.push(`Cross-reference public records, FOIA disclosures, and litigation filings.`);
      angles.push(`Identify contradictory statements across sources and timeline inconsistencies.`);
      if (topPerson) angles.push(`Establish ${topPerson}'s role and known associates.`);
    }
    return angles.slice(0, 6).map(angle => ({ angle }));
  };
  const investigativeAngles = buildInvestigativeAngles();

  // ── SECTION 8 — Auto Query Expansion ────────────────────────────────────────
  const entityNames = keyEntities.slice(0, 3).map((e) => e.name);
  const intentSuffixes: Record<string, string[]> = {
    crime_corruption:     ["corruption investigation", "fraud charges", "indictment", "misconduct probe"],
    legal_lawsuit:        ["lawsuit filing", "settlement records", "court docket", "legal complaint"],
    policy_government:    ["government contract", "committee oversight", "inspector general report", "budget audit"],
    housing_homelessness: ["shelter contract", "housing funding audit", "service provider accountability", "FOIA homelessness spending"],
    finance_funding:      ["grant records", "FOIA award disclosure", "budget allocation", "audit findings"],
    general:              ["public records", "accountability investigation", "oversight report", "financial disclosure"],
  };
  const suffixes = intentSuffixes[seedIntent] || intentSuffixes.general;
  const generatedQueries: string[] = [];
  for (const name of entityNames) {
    for (const suffix of suffixes.slice(0, 2)) {
      generatedQueries.push(`"${name}" ${suffix}`);
    }
  }
  const nextQueries = [
    ...nextQueriesParsed,
    ...generatedQueries.filter((q) => !nextQueriesParsed.includes(q)),
  ].slice(0, 8);

  // ── SECTION 9 — Known Intelligence Gaps ─────────────────────────────────────
  const knownGaps: string[] = [];
  if (entities.length === 0)
    knownGaps.push("No confirmed entities — entity triage not completed or no admissible candidates found.");
  if (entities.length > 0 && entities.length < 3)
    knownGaps.push(`Only ${entities.length} confirmed entity/entities. Additional sourcing required for a complete actor map.`);
  if (financialSignals.length === 0)
    knownGaps.push("No confirmed financial signals. Ingest budget reports, contract disclosures, or audit findings to establish the money trail.");
  if (timelineSignals.length === 0)
    knownGaps.push("No accountability timeline events extracted. Ingest dated source materials with contract, audit, or enforcement context.");
  if (cleanRelationships.length === 0 && entities.length >= 2)
    knownGaps.push("No entity relationships mapped. Build graph to surface associations between confirmed actors.");
  if (documents.length < 3)
    knownGaps.push(`Only ${documents.length} source document${documents.length !== 1 ? "s" : ""} ingested. Expand source coverage for stronger evidentiary basis.`);
  const hasStrongConfirmation = keyEntities.some(e => e.docCount >= 3);
  if (!hasStrongConfirmation && entities.length > 0)
    knownGaps.push("No entity confirmed across 3+ sources. Intelligence confidence remains DEVELOPING — additional corroboration required.");

  // ── SECTION 10 — Confidence Note ────────────────────────────────────────────
  const confirmedCount = keyEntities.filter(e => e.docCount >= 3).length;
  const developingCount = keyEntities.filter(e => e.docCount >= 1 && e.docCount < 3).length;
  let overallConfidence = "PROVISIONAL";
  if (confirmedCount >= 2 && documents.length >= 4) overallConfidence = "MODERATE";
  if (confirmedCount >= 3 && documents.length >= 6 && financialSignals.length > 0) overallConfidence = "STRONG";
  if (entities.length === 0) overallConfidence = "INSUFFICIENT";
  const confidenceNote = `${overallConfidence}: ${confirmedCount} entity/entities confirmed across 3+ sources, ${developingCount} developing. ${documents.length} source documents. ${financialSignals.length} confirmed financial signal${financialSignals.length !== 1 ? "s" : ""}. ${knownGaps.length} intelligence gap${knownGaps.length !== 1 ? "s" : ""} identified.`;

  // ── SECTION 11 — Why This Matters ───────────────────────────────────────────
  const buildWhyItMatters = (): string => {
    if (insufficientData) return "Insufficient data to assess public significance. Complete entity triage and financial ingestion.";
    const parts: string[] = [];
    const bigMoney = financialSignals.find(f => f.normalizedAmount && f.normalizedAmount >= 1_000_000);
    const anyMoney = financialSignals[0];
    if (bigMoney && bigMoney.entityName) {
      const amt = bigMoney.amountDisplay ?? bigMoney.amountRaw;
      parts.push(`${bigMoney.entityName} is associated with ${amt} in confirmed financial signals — at this scale, misallocation or undisclosed flows represent a significant public accountability concern.`);
    } else if (topOrgs[0] && financialSignals.length > 0) {
      const amt = anyMoney?.amountDisplay ?? anyMoney?.amountRaw ?? "undisclosed amounts";
      parts.push(`${topOrgs[0].name} is implicated in financial signals involving ${amt}. Without independent audit, the flow of these funds cannot be verified.`);
    } else if (topOrgs[0]) {
      parts.push(`${topOrgs[0].name} is a central institutional actor in this investigation.`);
    }
    if (topPersons[0]) {
      const docCount = entityDocSupport.get((allEntities.find(e => e.name === topPersons[0].name)?.id ?? -1))?.size ?? 0;
      if (docCount >= 3) {
        parts.push(`${topPersons[0].name} appears across ${docCount} independent sources — this cross-document corroboration elevates their investigative significance.`);
      } else if (docCount > 0) {
        parts.push(`${topPersons[0].name} is the primary individual subject of interest in this case.`);
      }
    }
    if (seedIntent === "housing_homelessness")
      parts.push("Homelessness service contracts frequently lack competitive bidding requirements and outcome metrics — conditions favorable to waste, fraud, and political favoritism.");
    else if (seedIntent === "crime_corruption")
      parts.push("Alleged misconduct at an institutional level implicates systemic failures of oversight, not merely individual bad actors.");
    else if (seedIntent === "finance_funding")
      parts.push("Public grant and contract flows without adequate transparency mechanisms represent a recurring accountability gap.");
    else if (seedIntent === "legal_lawsuit")
      parts.push("Civil or criminal proceedings create a public record that often surfaces relationships and financial flows otherwise hidden from view.");
    else if (seedIntent === "policy_government")
      parts.push("Policy decisions at this level can redirect significant public resources — identifying who benefits and who controls the decision chain is essential.");
    else if (cleanRelationships.length > 0 || financialSignals.length > 0)
      parts.push("The intersection of confirmed relationships and financial signals in this case warrants continued investigative scrutiny.");
    if (parts.length === 0)
      parts.push(`This case targets ${caseData.title}. Evidence development is ongoing — continued investigation is warranted.`);
    return parts.join(" ");
  };
  const whyItMatters = buildWhyItMatters();

  // ── Risk Flags ───────────────────────────────────────────────────────────────
  const riskFlags: string[] = [];
  if (financialSignals.some(f => !f.inferred && (f.normalizedAmount ?? 0) >= 1_000_000))
    riskFlags.push("HIGH-VALUE financial signal detected (≥$1M) — priority verification required.");
  if (financialSignals.some(f => f.signalType === "CONTRACT" || f.signalType === "CONTRACT_AWARDED"))
    riskFlags.push("Contract award signal present — check for sole-source authorization or bid waiver.");
  if (cleanRelationships.some(r => r.confidence && r.confidence < 0.4))
    riskFlags.push("Low-confidence relationship detected — corroboration from additional sources required.");
  if (documents.some(d => !d.source))
    riskFlags.push("Undated or unattributed source documents in evidence set — verify provenance.");
  if (timelineSignals.length > 0 && financialSignals.length > 0)
    riskFlags.push("Timeline and financial signals present — cross-reference dates to identify suspicious timing patterns.");
  if (entities.length > 0 && cleanRelationships.length === 0)
    riskFlags.push("Entities confirmed but no relationships mapped — link analysis gap.");

  // ── T007: Recommended Actions — specific, data-driven per case state ─────────
  const buildRecommendedActions = (): string[] => {
    const actions: string[] = [];

    // Actions from confirmed financial signals
    const topFinSignal = financialSignals[0];
    const topFinEntity = topFinSignal?.controlledBy ?? topFinSignal?.receivedBy ?? topFinSignal?.entityName;
    if (financialSignals.length > 0 && topFinEntity) {
      actions.push(`Obtain fiscal year budget PDF for ${topFinEntity} — confirm appropriation authority and disbursement chain.`);
      const unnamedRecipients = financialSignals.filter(f => !f.controlledBy && !f.receivedBy && !f.entityName);
      if (unnamedRecipients.length > 0)
        actions.push(`Identify recipient vendor for ${unnamedRecipients.length} unattributed financial signal${unnamedRecipients.length !== 1 ? "s" : ""} — file FOIA for contract award documentation.`);
    }

    // Actions from confirmed entities
    const topContractor = keyEntities.find(e =>
      ["CONTRACTOR", "NONPROFIT"].includes(normalizeEntityType(e.rawType))
    );
    const topAgency = keyEntities.find(e =>
      ["AGENCY", "GOVERNMENT"].includes(normalizeEntityType(e.rawType))
    );
    const topPerson = keyEntities.find(e => normalizeEntityType(e.rawType) === "PERSON");

    if (topAgency && financialSignals.length > 0)
      actions.push(`Confirm ${topAgency.name}'s award authority for contracts in this case — verify board or legislative approval date.`);
    if (topContractor)
      actions.push(`Map ${topContractor.name}'s contract recurrence across cases — check SAM.gov, FPDS, and USASpending for prior awards.`);
    if (topPerson)
      actions.push(`Trace ${topPerson.name}'s decision-making role — court filings, professional licenses, and corporate registration records.`);

    // Audit comparison
    const hasAuditSignal = financialSignals.some(f =>
      f.signalType?.includes("AUDIT") || (f.eventSummary ?? "").toLowerCase().includes("audit")
    );
    if (hasAuditSignal)
      actions.push("Compare audit findings against public claims by agency leadership — identify discrepancies in reported outcomes vs. confirmed expenditures.");

    // Gap-based actions
    if (cleanRelationships.length === 0 && entities.length >= 2)
      actions.push(`Build entity link map — ${entities.length} confirmed actors have no established relationships. Identify control chains and shared affiliations.`);
    if (timelineSignals.length === 0)
      actions.push("Reconstruct accountability timeline — ingest dated appropriation records, contract awards, and audit reports to establish event chronology.");
    if (documents.length < 4)
      actions.push(`Expand source coverage (current: ${documents.length} document${documents.length !== 1 ? "s" : ""}) — ingest official PDFs, .gov records, board agendas, or inspector general reports.`);

    // Intent-specific actions
    if (seedIntent === "housing_homelessness") {
      if (!topContractor) actions.push("Identify shelter and service provider vendors receiving public contracts — check county contracting portal and LAHSA disclosures.");
      actions.push("Request HUD compliance documentation and shelter provider contracts via state public records law.");
      actions.push("Compare official program outcome data against reported spending levels — identify service delivery gaps.");
    } else if (seedIntent === "crime_corruption") {
      actions.push("Identify whistleblowers or complainants referenced in public court records or grand jury proceedings.");
      if (!topPerson) actions.push("Identify the primary individual holding decision-making authority — trace organizational chart and appointment records.");
    } else if (seedIntent === "finance_funding") {
      actions.push("Cross-reference grant recipients against campaign finance disclosures and lobbying registrations.");
      actions.push("Verify whether primary appropriations bypassed competitive bidding — check for sole-source or emergency contract authorizations.");
    }

    // Fallback if we have nothing
    if (actions.length === 0) {
      actions.push("Ingest primary-source documents: government filings, audits, court records, official PDFs.");
      actions.push("Identify key institutional actors and map their decision-making authority.");
      actions.push("Obtain financial records for primary entities via FOIA or public records request.");
      actions.push("Cross-reference public disclosures against media reporting for factual conflicts.");
      actions.push("Check for inspector general reports, GAO audits, or PACER court records.");
    }

    return actions.slice(0, 5);
  };

  // ── T006: Main Accountability Concern Engine ─────────────────────────────────
  const buildMainAccountabilityConcern = (): string => {
    if (insufficientData) {
      return "UNDER ASSESSMENT — entity and financial mapping required before the primary oversight gap can be characterized. Ingest primary-source documents to advance case.";
    }
    const parts: string[] = [];
    const topOrg = topOrgs[0];
    const topPerson = topPersons[0];
    const topSig = financialSignals[0];

    // What the case is really about
    if (seedIntent === "housing_homelessness") {
      if (topSig && topOrg) {
        const amt = topSig.amountDisplay ?? "significant public funds";
        const actor = topSig.controlledBy ?? topSig.receivedBy ?? topOrg.name;
        parts.push(`This case concerns the allocation and oversight of ${amt} in public homelessness funding controlled by or flowing through ${actor}.`);
      } else if (topOrg) {
        parts.push(`This case concerns ${topOrg.name}'s role in the administration and oversight of public homelessness funding.`);
      } else {
        parts.push(`This case concerns the administration of public homelessness funding in the Los Angeles region.`);
      }
      // Where the possible failure is
      const noCompetitiveBid = (approvedOnly.some(m => /competi|bid|sole.source|no.bid/i.test(m.context ?? "")) ||
        allMentions.some(m => /competi|bid|sole.source|no.bid/i.test(m.context ?? "")));
      if (noCompetitiveBid) {
        parts.push(`The primary accountability gap is contract award authority — evidence suggests funds may have been allocated without competitive bidding requirements or adequate program outcome tracking.`);
      } else if (financialSignals.length > 0 && cleanRelationships.length === 0) {
        parts.push(`The primary accountability gap is the absence of a confirmed control chain — financial signals are present but the decision path from appropriation to recipient has not been verified.`);
      } else {
        parts.push(`The primary accountability gap is oversight: no confirmed audit trail or independent verification of how funds reached service providers and what outcomes were achieved.`);
      }
    } else if (seedIntent === "crime_corruption") {
      if (topPerson) {
        parts.push(`This case concerns alleged misconduct by or around ${topPerson.name} and the institutional failures that may have enabled it.`);
      } else if (topOrg) {
        parts.push(`This case concerns alleged institutional misconduct at ${topOrg.name} and the oversight failures that allowed it to persist.`);
      } else {
        parts.push(`This case concerns alleged misconduct and potential corruption in the subject institution.`);
      }
      parts.push(`The accountability gap is whether internal oversight mechanisms functioned as designed — or whether the conduct was suppressed, ignored, or facilitated by institutional actors.`);
    } else if (seedIntent === "finance_funding") {
      if (topSig && topOrg) {
        const amt = topSig.amountDisplay ?? "public funds";
        parts.push(`This case concerns the flow and oversight of ${amt} through ${topOrg.name}. The accountability gap is whether these funds reached intended recipients and whether procurement was competitive and transparent.`);
      } else if (topOrg) {
        parts.push(`This case concerns the financial oversight and accountability obligations of ${topOrg.name} in connection with public funding flows.`);
      } else {
        parts.push(`This case concerns public funding flows where the recipient, award authority, and program outcomes have not been independently confirmed.`);
      }
    } else {
      // General
      if (topOrg && topSig) {
        const amt = topSig.amountDisplay ?? "public funds";
        parts.push(`This case concerns the accountability of ${topOrg.name} in connection with ${amt} in confirmed financial signals. The oversight gap is unverified: who authorized disbursements, whether procurement was competitive, and whether outcomes match reported spending.`);
      } else if (topOrg) {
        parts.push(`This case concerns the oversight obligations and decision-making authority of ${topOrg.name}. The accountability question is who controls the decision chain and whether that authority was exercised properly.`);
      } else {
        parts.push(`Case framing is underway. Confirmed entities and financial signals are required to characterize the primary accountability concern.`);
      }
    }

    // Why it deserves investigation
    if (financialSignals.length > 0) {
      const totalAmt = financialSignals.reduce((acc, f) => acc + (f.normalizedAmount ?? 0), 0);
      if (totalAmt >= 1_000_000) {
        const fmtTotal = totalAmt >= 1e9 ? `$${(totalAmt/1e9).toFixed(2)}B` : `$${(totalAmt/1e6).toFixed(2)}M`;
        parts.push(`At ${fmtTotal} in confirmed financial signals, the scale of public exposure justifies independent audit and continued investigative development.`);
      } else {
        parts.push(`Confirmed financial signals are present. Independent verification of flows, recipients, and outcomes is required before this case can be assessed as resolved.`);
      }
    } else if (entities.length >= 3) {
      parts.push(`Three or more confirmed actors are present. Establishing the control and decision chain between them is the priority investigative action.`);
    } else {
      parts.push(`Additional source ingestion is required to characterize the full scope of accountability exposure.`);
    }

    return parts.join(" ");
  };
  const mainAccountabilityConcern = buildMainAccountabilityConcern();

  // ── T008: Case Quality Score ──────────────────────────────────────────────────
  // Score 0-100 across 5 dimensions, classify RAW / DEVELOPING / COMPILED / OPERATOR-READY
  const computeCaseQualityScore = () => {
    // 1. Entity quality (0-20): count + cross-doc coverage
    const qualifiedEntities = keyEntities.filter(e => e.docCount >= 1);
    const crossDocEntities = keyEntities.filter(e => e.docCount >= 2);
    const entityScore = Math.min(20,
      qualifiedEntities.length * 3 +
      crossDocEntities.length * 3 +
      (topOrgs.length > 0 ? 2 : 0) +
      (topPersons.length > 0 ? 2 : 0)
    );

    // 2. Relationship quality (0-20): count + type quality
    const canonicalRelCount = cleanRelationships.filter(r => {
      const t = (r.relationshipType ?? "").toUpperCase();
      return CANONICAL_REL_TYPES.has(t);
    }).length;
    const relationshipScore = Math.min(20,
      cleanRelationships.length * 4 +
      canonicalRelCount * 2
    );

    // 3. Money quality (0-25): numeric signals + entity attribution + high value
    const namedSignals = financialSignals.filter(f => f.entityName || f.controlledBy || f.receivedBy);
    const bigSignals = financialSignals.filter(f => (f.normalizedAmount ?? 0) >= 1_000_000);
    const moneyScore = Math.min(25,
      financialSignals.length * 5 +
      namedSignals.length * 3 +
      bigSignals.length * 2
    );

    // 4. Timeline quality (0-15): accountability events only
    const timelineScore = Math.min(15, timelineSignals.length * 5);

    // 5. Source quality (0-20): document count + diversity + official sources
    const govSources = documents.filter(d =>
      /\.gov|inspector.general|OIG|audit|GAO|county|board.of.supervisors|official/i.test(
        (d.source ?? "") + (d.title ?? "")
      )
    ).length;
    const mediaCount = documents.length - govSources;
    const sourceScore = Math.min(20,
      documents.length * 2 +
      govSources * 4 +
      (mediaCount >= 2 ? 2 : 0)
    );

    const total = entityScore + relationshipScore + moneyScore + timelineScore + sourceScore;

    let label: "RAW" | "DEVELOPING" | "COMPILED" | "OPERATOR-READY";
    if (total < 20) label = "RAW";
    else if (total < 45) label = "DEVELOPING";
    else if (total < 70) label = "COMPILED";
    else label = "OPERATOR-READY";

    return {
      total,
      label,
      breakdown: {
        entityScore,
        relationshipScore,
        moneyScore,
        timelineScore,
        sourceScore,
      },
    };
  };
  const caseQuality = computeCaseQualityScore();

  // Pull new intelligence fields from compiled brief
  let keyFindings: string[] = [];
  let financialRedFlags: string[] = [];
  let powerNodes: string[] = [];
  let oversightFailures: string[] = [];
  let briefRecommendedActions: string[] = [];
  try {
    const brief = await compileCaseBrief(caseId);
    keyFindings = brief.keyFindings ?? [];
    financialRedFlags = brief.financialRedFlags ?? [];
    powerNodes = brief.powerNodes ?? [];
    oversightFailures = brief.oversightFailures ?? [];
    briefRecommendedActions = brief.recommendedActions ?? [];
  } catch { /* use empty arrays */ }

  // ── Money Ledger ─────────────────────────────────────────────────────────────
  const fmtDollar = (n: number): string => {
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${n.toLocaleString()}`;
  };
  const allNumericForLedger = financialSignals.filter(f => (f.normalizedAmount ?? 0) > 0);
  const totalExtracted = allNumericForLedger.reduce((acc, f) => acc + (f.normalizedAmount ?? 0), 0);
  const uniqueEntitiesLedger = [...new Set(allNumericForLedger.map(f => f.entityName).filter(Boolean))];
  const uniqueDocsLedger = [...new Set(allNumericForLedger.map(f => f.docId).filter(Boolean))];
  const allocationCount = allNumericForLedger.filter(f => f.signalType === "ALLOCATION").length;
  const isBudgetCase = allocationCount > 0 && allocationCount >= allNumericForLedger.length * 0.5;

  const moneyLedger = {
    totalExtracted,
    totalDisplay: totalExtracted > 0 ? fmtDollar(totalExtracted) : null,
    signalCount: allNumericForLedger.length,
    uniqueEntityCount: uniqueEntitiesLedger.length,
    uniqueDocCount: uniqueDocsLedger.length,
    isBudgetCase,
    budgetParseFailure: false,
    rows: allNumericForLedger
      .sort((a, b) => (b.normalizedAmount ?? 0) - (a.normalizedAmount ?? 0))
      .slice(0, 30)
      .map(f => ({
        entityName: f.entityName ?? null,
        programName: f.programName ?? null,
        controlledBy: f.controlledBy ?? null,
        amountDisplay: f.amountDisplay ?? fmtDollar(f.normalizedAmount ?? 0),
        normalizedAmount: f.normalizedAmount ?? 0,
        signalType: f.signalType,
        eventSummary: f.eventSummary ?? null,
        documentTitle: (rawFinancialSignals.find(r => r.normalizedAmount === f.normalizedAmount && r.entityName === f.entityName)?.documentTitle ?? null),
        docId: f.docId ?? null,
        confidence: f.confidence ?? null,
      })),
  };

  const recommendedActions = buildRecommendedActions();

  return res.json({
    caseId,
    caseTitle: caseData.title,
    seedIntent,
    autoBuildQuality,
    insufficientData,
    generatedAt: new Date().toISOString(),
    // T008: Case quality score — RAW / DEVELOPING / COMPILED / OPERATOR-READY
    caseQualityScore: caseQuality.total,
    caseQualityLabel: caseQuality.label,
    caseQualityBreakdown: caseQuality.breakdown,
    sections: {
      caseSummary,
      // T006: Main Accountability Concern — dedicated field
      mainAccountabilityConcern,
      keyEntities,
      // T003: explicit sentinel when no relationships
      entityRelationships: cleanRelationships.length === 0 && entities.length >= 2
        ? [{ _sentinel: "RELATIONSHIP EVIDENCE INSUFFICIENT", entityAId: null, entityBId: null, entityAName: null, entityBName: null, relationshipType: null, confidence: null }]
        : entityRelationships,
      entityProfiles,
      documentEvidence,
      timelineSignals: timelineSignals.length === 0
        ? []
        : timelineSignals,
      financialSignals: outputFinancialSignals,
      moneyLedger,
      investigativeAngles,
      nextQueries,
      knownGaps,
      whyItMatters,
      confidenceNote,
      powerStructure,
      riskFlags,
      // T007: T007-specific data-driven actions take priority;
      //       brief actions only supplement if case has real data and no T007 actions generated
      recommendedActions: recommendedActions.length > 0 ? recommendedActions
        : briefRecommendedActions.length > 0 ? briefRecommendedActions
        : [],
      keyFindings,
      financialRedFlags,
      powerNodes,
      oversightFailures,
    },
    meta: {
      entityCount: entities.length,
      documentCount: documents.length,
      timelineCount: timelineSignals.length,
      financialSignalCount: financialSignals.length,
      relationshipCount: cleanRelationships.length,
      overallConfidence,
      cappedAt12: allEntities.length > 12,
    },
  });
});

export default router;
