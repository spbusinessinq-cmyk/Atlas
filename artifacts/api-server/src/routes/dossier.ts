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
// Generates a structured 8-section investigation dossier from case data.
// Only promoted (approved) entities appear in the output.

router.get("/cases/:caseId/dossier", async (req, res) => {
  const caseId = parseInt(req.params.caseId);
  if (isNaN(caseId)) return res.status(400).json({ error: "Invalid case ID" });

  const caseRows = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
  if (caseRows.length === 0) return res.status(404).json({ error: "Case not found" });
  const caseData = caseRows[0];

  const entities = await db.select().from(entitiesTable).where(eq(entitiesTable.caseId, caseId));
  const promotedEntityIds = new Set(entities.map((e) => e.id));

  const approvedMentions = entities.length > 0
    ? await db.select().from(entityMentionsTable).where(eq(entityMentionsTable.caseId, caseId))
    : [];
  const approvedOnly = approvedMentions.filter((m) => m.status === "approved");

  const allRelationships = await db.select().from(relationshipsTable).where(eq(relationshipsTable.caseId, caseId));
  const cleanRelationships = allRelationships.filter(
    (r) => promotedEntityIds.has(r.entityAId) && promotedEntityIds.has(r.entityBId)
  );

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

  // Parse ATLAS-SEED for intent + next queries
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
  const seedIntent = kv.seed_intent || "general";
  const nextQueriesRaw = dec(kv.next_queries);
  const nextQueriesParsed = nextQueriesRaw ? nextQueriesRaw.split("||").filter(Boolean) : [];
  const autoBuildQuality = kv.auto_build_quality || null;
  const briefText = desc.replace(/\[ATLAS-SEED:[^\]]+\]/, "").trim();

  // Entity map by id
  type EntityRow = typeof entities[number];
  const entityById = new Map<number, EntityRow>(entities.map((e) => [e.id, e]));

  // Doc support per entity
  const entityDocSupport = new Map<number, Set<number>>();
  for (const m of approvedOnly) {
    if (!m.entityId || !m.documentId) continue;
    if (!entityDocSupport.has(m.entityId)) entityDocSupport.set(m.entityId, new Set());
    entityDocSupport.get(m.entityId)!.add(m.documentId);
  }

  // SECTION 1 — Case Summary (intelligence-grade prose)
  const topEntities = [...entities]
    .map(e => ({ ...e, docCount: entityDocSupport.get(e.id)?.size ?? 0 }))
    .sort((a, b) => b.docCount - a.docCount)
    .slice(0, 5);

  const topPersons = topEntities.filter(e => e.type === "person").slice(0, 3);
  const topOrgs    = topEntities.filter(e => e.type === "organization" || e.type === "government_agency").slice(0, 3);

  // caseSummary is built after financialSignals is computed — see below

  // SECTION 2 — Key Entities
  const keyEntities = entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    aliases: e.aliases ?? [],
    docCount: entityDocSupport.get(e.id)?.size ?? 0,
  })).sort((a, b) => b.docCount - a.docCount);

  // SECTION 3 — Entity Relationships
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
  }).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  // SECTION 4 — Document Evidence
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

  // SECTION 5 — Timeline Signals (filtered to accountability-relevant events only)
  // Only include events tied to contracts, audits, appropriations, enforcement, hearings, or program milestones.
  // TV episode summaries, documentary recaps, soft historical references, and generic events are excluded.
  const ACCOUNTABILITY_EVENT_TYPES = new Set([
    "CONTRACT_AWARDED", "CONTRACT", "AUDIT", "AUDIT_FLAG", "AUDIT_FINDING",
    "APPROPRIATION", "HEARING", "ENFORCEMENT", "ENFORCEMENT_ACTION",
    "PROGRAM_MILESTONE", "PROGRAM_CHANGE", "VIOLATION", "INDICTMENT",
    "SETTLEMENT", "REGULATORY_ACTION", "BUDGET_ACTION", "GRANT_AWARD",
    "FRAUD_FLAG", "WHISTLEBLOWER", "INVESTIGATION", "CONVICTION",
    "FILING", "FRAUD_MISUSE", "INSPECTION", "SUSPENSION", "DEBARMENT",
    "REFERRAL", "COMPLAINT", "SUBPOENA", "ARREST", "CHARGE",
    "AGENCY_CHANGE", "LEADERSHIP_CHANGE", "OVERSIGHT_ACTION",
    "GOVERNMENT_ACTION", "POLITICAL_ACTION", "BUDGET", "DISBURSEMENT",
  ]);

  const timelineSignals = timeline
    .filter((t) => {
      if (!t.date) return false;
      // If event type is known, only allow accountability types
      if (t.eventType && t.eventType.trim()) {
        return ACCOUNTABILITY_EVENT_TYPES.has(t.eventType.trim().toUpperCase());
      }
      // No event type — apply keyword filter on title/description
      const text = `${t.title ?? ""} ${t.description ?? ""}`.toLowerCase();
      const ACCOUNTABILITY_KEYWORDS = /\b(contract|audit|grant|fund|appropriat|legislat|budget|hearing|enforcement|program|indict|settl|compliance|investigation|fraud|oversight|inspection|debarment|conviction|indictment|award|procurement|disburs|allocat|regulator)\b/;
      const JUNK_KEYWORDS = /\b(episode|season|recap|trailer|premiere|documentary|film|movie|concert|game|match|tournament|playoff|bracket|watch|stream|preview)\b/i;
      return ACCOUNTABILITY_KEYWORDS.test(text) && !JUNK_KEYWORDS.test(text);
    })
    .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())
    .slice(0, 12)  // Hard cap at 12 events for dossier clarity
    .map((t) => ({
      date: t.date,
      title: t.title,
      description: t.description,
      eventType: t.eventType,
    }));

  // SECTION 6 — Financial Signals (from financialSignalsTable — structured, ranked)
  const rawFinancialSignals = await db.select().from(financialSignalsTable).where(
    eq(financialSignalsTable.caseId, caseId)
  );
  // Score and rank: prioritize confirmed (not inferred), high confidence, large amounts
  const scoredFinancial = rawFinancialSignals.map(fs => {
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
  }).sort((a, b) => b._score - a._score);
  const financialSignals = scoredFinancial.map(fs => ({
    entityName: fs.entityName ?? "Unknown",
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
  // Also keep mention-context financial signals for angles computation
  const MONEY_RE = /\b(funding|grant|budget|contract|appropriation|allocation|spending|award|procurement|payment|donation|settlement|payout|contribution)\b/i;
  const mentionFinancials = approvedOnly.filter(m => MONEY_RE.test(m.context ?? ""));

  // SECTION 1 — Case Summary (built here after financialSignals is available)
  const buildCaseSummary = (): string => {
    // Only use briefText if it's already prose (not the ATLAS seed format)
    const isSeedFormat = briefText.startsWith("WHAT:") || briefText.startsWith("ATLAS:") || briefText.startsWith("[ATLAS") || briefText.startsWith("Seed investigation");
    if (briefText && briefText.length > 80 && !isSeedFormat) return briefText;

    const intentLabel: Record<string, string> = {
      housing_homelessness: "a public accountability investigation into homelessness spending and shelter program oversight",
      crime_corruption: "a misconduct and corruption investigation targeting potential fraud, financial abuse, or ethical violations",
      finance_funding: "a financial oversight investigation tracking public funding flows and appropriation integrity",
      legal_lawsuit: "a litigation intelligence file examining court filings, legal exposure, and named parties",
      policy_government: "a government program oversight investigation focused on policy implementation and accountability",
      education_university: "an education sector accountability investigation tracking institutional spending and governance",
      entertainment_film: "a film industry finance investigation examining tax credits, production subsidies, and studio deals",
      general: "an open intelligence investigation",
    };
    const frame = intentLabel[seedIntent] || "an open intelligence investigation";

    // Actor clause
    let actorClause = "";
    if (topPersons.length > 0 && topOrgs.length > 0) {
      actorClause = `The investigation identifies ${topPersons.map(e => e.name).join(" and ")} as principal persons of interest, with ${topOrgs.map(e => e.name).join(" and ")} as key institutional actors.`;
    } else if (topPersons.length > 0) {
      actorClause = `The investigation identifies ${topPersons.map(e => e.name).join(" and ")} as principal persons of interest.`;
    } else if (topOrgs.length > 0) {
      actorClause = `The investigation centers on ${topOrgs.map(e => e.name).join(" and ")} as primary institutional actors.`;
    }

    // Financial clause — numeric signals only
    const numericSigs = financialSignals.filter(f => !(f.signalType?.startsWith("NON_NUMERIC")) && f.amountDisplay !== "NON-NUMERIC");
    let financialClause = "";
    if (numericSigs.length > 0) {
      const topSignal = numericSigs[0];
      const amt = topSignal.amountDisplay ?? topSignal.amountRaw ?? null;
      if (amt && topSignal.entityName) {
        financialClause = `Financial intelligence indicates ${amt} linked to ${topSignal.entityName}`;
        if (numericSigs.length > 1) financialClause += `, with ${numericSigs.length} total monetary signals extracted`;
        financialClause += ".";
      } else {
        financialClause = `${numericSigs.length} quantified financial signal${numericSigs.length !== 1 ? "s" : ""} extracted from source materials.`;
      }
    } else if (financialSignals.length > 0) {
      financialClause = `${financialSignals.length} non-quantified financial reference${financialSignals.length !== 1 ? "s" : ""} detected — awaiting numeric confirmation.`;
    }

    // Evidence clause
    let evidenceClause = "";
    if (documents.length > 0) {
      const docSources = [...new Set(documents.map(d => d.source).filter(Boolean))].slice(0, 2);
      const sourceStr = docSources.length > 0 ? `, drawn from ${docSources.join(" and ")}` : "";
      evidenceClause = `The dossier rests on ${documents.length} ingested document${documents.length !== 1 ? "s" : ""}${sourceStr}`;
      if (timeline.length > 0) evidenceClause += `, anchored by a ${timeline.length}-event chronological record`;
      evidenceClause += ".";
    }

    // Intelligence grade
    let gradeClause = "";
    if (entities.length === 0) {
      gradeClause = "Intelligence grade: UNVERIFIED — no confirmed entities. Complete ingestion and entity triage to build the network picture.";
    } else if (entities.length >= 5 && documents.length >= 5) {
      gradeClause = `Intelligence grade: DEVELOPING — ${entities.length} confirmed entities mapped across ${documents.length} document${documents.length !== 1 ? "s" : ""}.`;
    } else {
      gradeClause = "Intelligence grade: PRELIMINARY — additional ingest required to corroborate current signals.";
    }

    return [
      `This file constitutes ${frame} targeting ${caseData.title}.`,
      actorClause,
      financialClause,
      evidenceClause,
      gradeClause,
    ].filter(Boolean).join(" ");
  };
  const caseSummary = buildCaseSummary();

  // SECTION 7 — Investigative Angles (entity-specific, not generic templates)
  const buildInvestigativeAngles = (): Array<{ angle: string }> => {
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
    } else if (seedIntent === "legal_lawsuit") {
      if (topPerson) angles.push(`Establish ${topPerson}'s legal standing and exposure in the proceeding.`);
      if (topOrg)    angles.push(`Determine ${topOrg}'s prior litigation history and settlement pattern.`);
      angles.push(`Identify who is funding the legal defense and whether there is indemnification.`);
      angles.push(`Map precedent cases and likely appellate trajectory.`);
    } else if (seedIntent === "policy_government") {
      if (topOrg)    angles.push(`Analyze ${topOrg}'s stated mandate vs. actual program outcomes.`);
      if (topPerson) angles.push(`Identify ${topPerson}'s role in policy implementation and accountability chain.`);
      angles.push(`Map lobbying activity and donor influence behind the policy.`);
      angles.push(`Cross-reference budget allocations against stated programmatic goals.`);
      angles.push(`Check oversight committee records for inaction or suppressed findings.`);
    } else {
      angles.push(`Map the decision chain from ${topEntity} to accountability point.`);
      angles.push(`Follow financial flows connected to the primary subjects.`);
      angles.push(`Cross-reference public records, FOIA disclosures, and litigation filings.`);
      angles.push(`Identify contradictory statements across sources and timeline inconsistencies.`);
      if (topPerson) angles.push(`Establish ${topPerson}'s role and known associates.`);
    }
    return angles.slice(0, 6).map(angle => ({ angle }));
  };
  const investigativeAngles = buildInvestigativeAngles();

  // SECTION 8 — Auto Query Expansion (entity-driven)
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

  // SECTION 9 — Known Intelligence Gaps
  const knownGaps: string[] = [];
  if (entities.length === 0)
    knownGaps.push("No confirmed entities — entity triage not completed or no admissible candidates found.");
  if (entities.length > 0 && entities.length < 3)
    knownGaps.push(`Only ${entities.length} confirmed entity/entities. Additional sourcing required for a complete actor map.`);
  if (financialSignals.length === 0)
    knownGaps.push("No financial signals detected. Ingest budget reports, contract disclosures, or audit findings to establish money trail.");
  if (timeline.length === 0)
    knownGaps.push("No timeline events extracted. Ingest dated source materials to reconstruct event chronology.");
  if (cleanRelationships.length === 0 && entities.length >= 2)
    knownGaps.push("No entity relationships mapped. Build graph to surface associations between confirmed actors.");
  if (documents.length < 3)
    knownGaps.push(`Only ${documents.length} source document${documents.length !== 1 ? "s" : ""} ingested. Expand source coverage for stronger evidentiary basis.`);
  const hasStrongConfirmation = keyEntities.some(e => e.docCount >= 3);
  if (!hasStrongConfirmation && entities.length > 0)
    knownGaps.push("No entity is confirmed across 3+ sources. Intelligence confidence remains DEVELOPING — additional corroboration required.");

  // SECTION 10 — Confidence Note
  const confirmedCount = keyEntities.filter(e => e.docCount >= 3).length;
  const developingCount = keyEntities.filter(e => e.docCount >= 1 && e.docCount < 3).length;
  let overallConfidence = "PROVISIONAL";
  if (confirmedCount >= 2 && documents.length >= 4) overallConfidence = "MODERATE";
  if (confirmedCount >= 3 && documents.length >= 6 && financialSignals.length > 0) overallConfidence = "STRONG";
  if (entities.length === 0) overallConfidence = "INSUFFICIENT";
  const confidenceNote = `${overallConfidence}: ${confirmedCount} entity/entities confirmed across 3+ sources, ${developingCount} developing. ${documents.length} source documents. ${financialSignals.length} financial signal${financialSignals.length !== 1 ? "s" : ""}. ${knownGaps.length} intelligence gap${knownGaps.length !== 1 ? "s" : ""} identified.`;

  // SECTION 11 — Why This Matters (narrative)
  const buildWhyItMatters = (): string => {
    const parts: string[] = [];

    // Lead with most critical data point
    const bigMoney = financialSignals.find(f => f.normalizedAmount && f.normalizedAmount >= 1_000_000);
    const anyMoney = financialSignals[0];

    if (bigMoney && bigMoney.entityName) {
      const amt = bigMoney.amountDisplay ?? bigMoney.amountRaw;
      parts.push(`${bigMoney.entityName} is associated with ${amt} in financial signals — at this scale, misallocation or undisclosed flows represent a significant public accountability concern.`);
    } else if (topOrgs[0] && financialSignals.length > 0) {
      const amt = anyMoney?.amountDisplay ?? anyMoney?.amountRaw ?? "undisclosed amounts";
      parts.push(`${topOrgs[0].name} is implicated in financial signals involving ${amt}. Without independent audit, the flow of these funds cannot be verified.`);
    } else if (topOrgs[0]) {
      parts.push(`${topOrgs[0].name} is a central institutional actor in this investigation.`);
    }

    if (topPersons[0]) {
      const docCount = entityDocSupport.get(topPersons[0].id)?.size ?? 0;
      if (docCount >= 3) {
        parts.push(`${topPersons[0].name} appears across ${docCount} independent sources — this cross-document corroboration elevates their investigative significance.`);
      } else if (docCount > 0) {
        parts.push(`${topPersons[0].name} is the primary individual subject of interest in this case.`);
      }
    }

    // Intent-specific framing
    if (seedIntent === "housing_homelessness")
      parts.push("Homelessness service contracts frequently lack competitive bidding requirements and outcome metrics — conditions favorable to waste, fraud, and political favoritism.");
    else if (seedIntent === "crime_corruption")
      parts.push("Alleged misconduct at an institutional level implicates systemic failures of oversight, not merely individual bad actors.");
    else if (seedIntent === "finance_funding")
      parts.push("Public grant and contract flows without adequate transparency mechanisms represent a recurring accountability gap — tracing these flows is the core of this investigation.");
    else if (seedIntent === "legal_lawsuit")
      parts.push("Civil or criminal proceedings create a public record that often surfaces relationships and financial flows otherwise hidden from view.");
    else if (seedIntent === "policy_government")
      parts.push("Policy decisions at this level can redirect significant public resources — identifying who benefits and who controls the decision chain is essential.");
    else if (cleanRelationships.length > 0 || financialSignals.length > 0)
      parts.push("The intersection of confirmed relationships and financial signals in this case warrants continued investigative scrutiny.");

    if (parts.length === 0)
      parts.push(`This case targets ${caseData.title}. Evidence development is ongoing — continued investigation is warranted to establish the full scope of actors, flows, and decisions involved.`);

    return parts.join(" ");
  };
  const whyItMatters = buildWhyItMatters();

  // ─── POWER STRUCTURE ───────────────────────────────────────────────────────
  const buildPowerStructure = (): string => {
    const parts: string[] = [];
    if (entities.length === 0) return "No confirmed entities — power structure cannot be assessed until entity triage is complete.";

    const persons = entities.filter(e => ["person", "individual"].includes(e.type.toLowerCase()));
    const orgs = entities.filter(e => ["organization", "government_agency", "government_body", "company", "legal_entity"].includes(e.type.toLowerCase()));
    const topPerson = persons[0];
    const topOrg = orgs[0];

    if (topPerson && topOrg) {
      const rel = cleanRelationships.find(r =>
        (r.entityAId === topPerson.id && r.entityBId === topOrg.id) ||
        (r.entityAId === topOrg.id && r.entityBId === topPerson.id)
      );
      if (rel) {
        parts.push(`${topPerson.name} is linked to ${topOrg.name} via a confirmed ${rel.relationshipType?.replace(/_/g, " ") ?? "association"}.`);
      } else {
        parts.push(`${topPerson.name} and ${topOrg.name} appear in the same case context but no direct relationship has been confirmed.`);
      }
    }

    if (cleanRelationships.length > 0) {
      const highConf = cleanRelationships.filter(r => (r.confidence ?? 0) >= 0.75);
      if (highConf.length > 0) {
        parts.push(`${highConf.length} high-confidence relationship${highConf.length !== 1 ? "s" : ""} mapped in the entity graph.`);
      }
    }

    if (financialSignals.length > 0) {
      const controlled = financialSignals.filter(f => f.controlledBy);
      if (controlled.length > 0) {
        parts.push(`Control relationships over financial flows identified: ${controlled.slice(0, 2).map(f => f.controlledBy).filter(Boolean).join(", ")}.`);
      }
    }

    if (parts.length === 0) {
      parts.push(`${entities.length} entity/entities confirmed. Relationship mapping pending — build the entity graph to surface control chains.`);
    }
    return parts.join(" ");
  };
  const powerStructure = buildPowerStructure();

  // ─── RISK FLAGS ─────────────────────────────────────────────────────────────
  const riskFlags: string[] = [];
  if (financialSignals.some(f => !f.inferred && (f.normalizedAmount ?? 0) >= 1_000_000)) {
    riskFlags.push("HIGH-VALUE financial signal detected (≥$1M) — priority verification required.");
  }
  if (financialSignals.some(f => f.signalType === "contract_award" || f.signalType === "procurement")) {
    riskFlags.push("Contract award or procurement signal present — check for sole-source authorization or bid waiver.");
  }
  if (cleanRelationships.some(r => r.confidence && r.confidence < 0.4)) {
    riskFlags.push("Low-confidence relationship detected — corroboration from additional sources required before inclusion.");
  }
  if (documents.some(d => !d.source)) {
    riskFlags.push("Undated or unattributed source documents in evidence set — verify provenance before relying on content.");
  }
  const dupNames = entities.filter((e, i) =>
    entities.findIndex(x => x.name.toLowerCase() === e.name.toLowerCase()) !== i
  );
  if (dupNames.length > 0) {
    riskFlags.push("Possible duplicate entity entries detected — review entity registry for consolidation.");
  }
  if (timeline.length > 0 && financialSignals.length > 0) {
    riskFlags.push("Timeline and financial signals present — cross-reference dates to identify suspicious timing patterns.");
  }
  if (entities.length > 0 && cleanRelationships.length === 0) {
    riskFlags.push("Entities confirmed but no relationships mapped — link analysis gap; run graph build to surface associations.");
  }

  // ─── RECOMMENDED ACTIONS ────────────────────────────────────────────────────
  const buildRecommendedActions = (): string[] => {
    const actions: string[] = [];
    if (financialSignals.length > 0) {
      actions.push(`File FOIA request for contract/grant records tied to: ${financialSignals.slice(0, 2).map(f => f.entityName).join(", ")}.`);
    }
    if (cleanRelationships.length === 0 && entities.length >= 2) {
      actions.push("Build entity relationship graph — identify associations, control chains, and shared affiliations.");
    }
    if (timeline.length === 0) {
      actions.push("Ingest dated press releases, regulatory filings, or court records to reconstruct event chronology.");
    }
    if (documents.length < 5) {
      actions.push(`Expand source coverage — current ${documents.length} document(s) insufficient for strong evidentiary base. Target government databases, litigation records, and news archives.`);
    }
    const topPerson = entities.find(e => e.type.toLowerCase() === "person");
    if (topPerson) {
      actions.push(`Run background check and public records search on ${topPerson.name} — court filings, professional licenses, corporate registrations.`);
    }
    const topOrg = entities.find(e => ["organization", "government_agency", "government_body"].includes(e.type.toLowerCase()));
    if (topOrg) {
      actions.push(`Review ${topOrg.name}'s audit history, inspector general reports, and any OIG referrals.`);
    }
    if (seedIntent === "housing_homelessness") {
      actions.push("Request HUD compliance documentation and shelter provider contracts via state public records law.");
    } else if (seedIntent === "crime_corruption") {
      actions.push("Identify whistleblowers or complainants referenced in public court records or grand jury proceedings.");
    } else if (seedIntent === "finance_funding") {
      actions.push("Cross-reference grant recipients against campaign finance disclosures and lobbying registrations.");
    }
    return actions.slice(0, 6);
  };
  const recommendedActions = buildRecommendedActions();

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

  // T004: Only expose numeric financial signals in the dossier output
  // A signal is numeric only if it has a real normalized amount > 0 AND is not flagged as NON_NUMERIC
  const numericFinancialSignals = financialSignals.filter(
    f => !(f.signalType?.startsWith("NON_NUMERIC"))
      && f.amountDisplay !== "NON-NUMERIC"
      && (f.normalizedAmount ?? 0) > 0
  );
  // Fall back to showing early signals only if NO numeric signals exist at all
  const outputFinancialSignals = numericFinancialSignals.length > 0
    ? numericFinancialSignals
    : financialSignals.filter(f => (f.signalType?.startsWith("NON_NUMERIC") || f.amountDisplay === "NON-NUMERIC") && f.eventSummary).slice(0, 3);

  return res.json({
    caseId,
    caseTitle: caseData.title,
    seedIntent,
    autoBuildQuality,
    generatedAt: new Date().toISOString(),
    sections: {
      caseSummary,
      keyEntities,
      entityRelationships,
      documentEvidence,
      timelineSignals,
      financialSignals: outputFinancialSignals,
      investigativeAngles,
      nextQueries,
      knownGaps,
      whyItMatters,
      confidenceNote,
      powerStructure,
      riskFlags,
      recommendedActions: briefRecommendedActions.length > 0 ? briefRecommendedActions : recommendedActions,
      keyFindings,
      financialRedFlags,
      powerNodes,
      oversightFailures,
    },
    meta: {
      entityCount: entities.length,
      documentCount: documents.length,
      timelineCount: timeline.length,
      financialSignalCount: financialSignals.length,
      relationshipCount: cleanRelationships.length,
      overallConfidence,
    },
  });
});

export default router;
