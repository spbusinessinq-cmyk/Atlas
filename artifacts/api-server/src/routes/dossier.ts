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

  const buildCaseSummary = (): string => {
    if (briefText && briefText.length > 80) return briefText;
    const parts: string[] = [];
    parts.push(`Investigation target: ${caseData.title}.`);
    if (topPersons.length > 0) {
      parts.push(`Primary persons of interest: ${topPersons.map(e => e.name).join(", ")}.`);
    }
    if (topOrgs.length > 0) {
      parts.push(`Key institutions identified: ${topOrgs.map(e => e.name).join(", ")}.`);
    }
    if (documents.length > 0) {
      const docSources = [...new Set(documents.map(d => d.source).filter(Boolean))].slice(0, 3);
      parts.push(`${documents.length} source document${documents.length !== 1 ? "s" : ""} ingested${docSources.length > 0 ? " from " + docSources.join(", ") : ""}.`);
    }
    if (financialSignals.length > 0) {
      parts.push(`${financialSignals.length} financial signal${financialSignals.length !== 1 ? "s" : ""} detected across source materials.`);
    }
    if (entities.length === 0) {
      parts.push("No entities confirmed. Ingest additional documents and complete entity review to develop intelligence picture.");
    }
    return parts.join(" ");
  };
  const caseSummary = buildCaseSummary();

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

  // SECTION 5 — Timeline Signals
  const timelineSignals = timeline
    .filter((t) => t.date != null)
    .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())
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
    if (topOrgs[0] && financialSignals.length > 0) {
      parts.push(`${topOrgs[0].name} is implicated in ${financialSignals.length} financial signal${financialSignals.length !== 1 ? "s" : ""} that may indicate misuse, misallocation, or undisclosed flows of public funds.`);
    } else if (topOrgs[0]) {
      parts.push(`${topOrgs[0].name} is a key institutional actor in this investigation.`);
    }
    if (topPersons[0]) {
      parts.push(`${topPersons[0].name} is the primary individual subject with appearances across ${entityDocSupport.get(topPersons[0].id)?.size ?? 0} source${(entityDocSupport.get(topPersons[0].id)?.size ?? 0) !== 1 ? "s" : ""}.`);
    }
    if (seedIntent === "housing_homelessness")
      parts.push("Public accountability for homelessness spending is low — unaudited contracts and opaque service delivery create conditions for waste and fraud.");
    else if (seedIntent === "crime_corruption")
      parts.push("Alleged misconduct at this level can implicate systemic institutional failures rather than individual actors alone.");
    else if (seedIntent === "finance_funding")
      parts.push("Funding flows without adequate disclosure or audit trails represent a structural accountability gap with potential for exploitation.");
    if (parts.length === 0)
      parts.push(`This case targets ${caseData.title}. Continued investigation is warranted to establish the full scope of actors, flows, and decisions involved.`);
    return parts.join(" ");
  };
  const whyItMatters = buildWhyItMatters();

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
      financialSignals,
      investigativeAngles,
      nextQueries,
      knownGaps,
      whyItMatters,
      confidenceNote,
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
