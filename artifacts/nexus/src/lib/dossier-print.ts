export interface PrintDossierParams {
  caseId: number;
  caseTitle: string;
  caseStatus: string;
  autoBuildQuality: string | null;
  entities: Array<{ name: string; type: string; docCount?: number }>;
  documents: Array<{ title: string; url?: string | null; source?: string | null; signalScore?: number | null; tier?: string | null }>;
  dossierSections: {
    caseSummary?: string;
    keyEntities?: Array<{ name: string; type: string; docCount: number }>;
    entityRelationships?: Array<{ entityAName: string; entityBName: string; relationType?: string; confidence?: string }>;
    timelineSignals?: Array<{ date?: string; title: string }>;
    financialSignals?: Array<{
      entityName: string;
      amountRaw?: string;
      amountDisplay?: string | null;
      normalizedAmount?: number | null;
      signalType?: string;
      eventSummary?: string | null;
      controlledBy?: string | null;
      receivedBy?: string | null;
      programName?: string | null;
      confidence?: number | null;
      inferred?: boolean;
      context?: string;
      amount?: string;
    }>;
    investigativeAngles?: Array<{ angle: string }>;
    nextQueries?: string[];
    knownGaps?: string[];
    whyItMatters?: string;
    confidenceNote?: string;
    powerStructure?: string;
    riskFlags?: string[];
    recommendedActions?: string[];
    keyFindings?: string[];
    financialRedFlags?: string[];
    powerNodes?: string[];
    oversightFailures?: string[];
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatEntityType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function confidenceLabel(quality: string | null): string {
  switch (quality) {
    case "STRONG":      return "STRONG — HIGH CONFIDENCE";
    case "PROVISIONAL": return "PROVISIONAL — DEVELOPING";
    case "MODERATE":    return "MODERATE — PARTIAL EVIDENCE";
    case "RECOVERED":   return "RECOVERED — LIMITED SOURCING";
    case "WEAK":        return "WEAK — REVIEW RECOMMENDED";
    case "FAILED":      return "INSUFFICIENT — NO USABLE SOURCES";
    default:            return "UNCLASSIFIED";
  }
}

function classificationBadge(quality: string | null): string {
  switch (quality) {
    case "STRONG":
    case "PROVISIONAL":
    case "MODERATE":    return "PROVISIONAL";
    case "WEAK":
    case "RECOVERED":   return "PROVISIONAL — VERIFY";
    default:            return "DRAFT";
  }
}

export function openPrintDossier(params: PrintDossierParams): void {
  const { caseId, caseTitle, caseStatus, autoBuildQuality, entities, documents, dossierSections } = params;
  const s = dossierSections;
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const confidence = confidenceLabel(autoBuildQuality);
  const classification = classificationBadge(autoBuildQuality);

  const persons = entities.filter(e => e.type === "person");
  const orgs = entities.filter(e => e.type === "organization" || e.type === "government_agency" || e.type === "company");
  const otherEntities = entities.filter(e => !["person", "organization", "government_agency", "company"].includes(e.type));

  const topDocs = documents
    .filter(d => d.title)
    .sort((a, b) => (b.signalScore ?? 0) - (a.signalScore ?? 0))
    .slice(0, 10);

  const timeline = (s.timelineSignals ?? [])
    .filter(t => t.title)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  const flows = s.financialSignals ?? [];
  const angles = s.investigativeAngles ?? [];
  // Use server-computed gaps if available, otherwise compute client-side fallback
  const gaps: string[] = s.knownGaps && s.knownGaps.length > 0
    ? s.knownGaps
    : (() => {
        const g: string[] = [];
        if (persons.length === 0) g.push("No individual actors identified — additional sourcing required.");
        if (orgs.length === 0) g.push("No organizational entities confirmed — review entity triage queue.");
        if (flows.length === 0) g.push("No financial flows detected — documents with budget or contract data recommended.");
        if (timeline.length === 0) g.push("No timeline events mapped — chronological sourcing needed.");
        if ((s.entityRelationships ?? []).length === 0) g.push("No confirmed entity relationships — link analysis pending.");
        return g;
      })();

  const css = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 10.5pt;
      color: #111;
      background: #fff;
      line-height: 1.55;
    }

    /* ─── Page shell ─────────────────────────────────────────────────────── */
    .page {
      width: 100%;
      min-height: 100vh;
      padding: 0.9in 1.05in 1in;
      page-break-after: always;
      position: relative;
    }
    .page:last-child { page-break-after: auto; }

    /* ─── Cover page ─────────────────────────────────────────────────────── */
    .cover {
      min-height: 100vh;
      padding: 0;
      page-break-after: always;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    .cover-classification-top {
      background: #9a0000;
      color: #fff;
      font-family: 'Courier New', monospace;
      font-size: 7.5pt;
      letter-spacing: 0.35em;
      text-transform: uppercase;
      text-align: center;
      padding: 8px 0;
      font-weight: 700;
    }
    .cover-body {
      flex: 1;
      padding: 0.7in 1.1in 0.5in;
      display: flex;
      flex-direction: column;
    }
    .cover-header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 3px solid #111;
      padding-bottom: 14px;
      margin-bottom: 0.55in;
    }
    .atlas-wordmark {
      font-family: 'Courier New', monospace;
      font-size: 8pt;
      letter-spacing: 0.4em;
      color: #333;
      text-transform: uppercase;
    }
    .atlas-wordmark strong { color: #9a0000; }
    .cover-case-stamp {
      font-family: 'Courier New', monospace;
      font-size: 7.5pt;
      letter-spacing: 0.2em;
      color: #888;
      text-align: right;
    }
    .cover-title {
      font-size: 30pt;
      font-weight: bold;
      letter-spacing: -0.025em;
      color: #0a0a0a;
      line-height: 1.1;
      margin-bottom: 0.35in;
      max-width: 5.6in;
    }
    .cover-rule { border: none; border-top: 1px solid #ccc; margin: 0 0 0.3in; }
    .cover-meta {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 20px 36px;
    }
    .meta-item {}
    .meta-label {
      font-family: 'Courier New', monospace;
      font-size: 6.5pt;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: #999;
      margin-bottom: 3px;
    }
    .meta-value {
      font-size: 10.5pt;
      font-weight: 700;
      color: #111;
    }
    .cover-summary-block {
      margin-top: 0.35in;
      padding: 16px 20px;
      background: #f7f7f7;
      border-left: 4px solid #9a0000;
    }
    .cover-summary-label {
      font-family: 'Courier New', monospace;
      font-size: 6.5pt;
      letter-spacing: 0.22em;
      color: #9a0000;
      text-transform: uppercase;
      margin-bottom: 6px;
      font-weight: 700;
    }
    .cover-summary-text {
      font-size: 10.5pt;
      color: #222;
      line-height: 1.65;
    }
    .cover-stat-strip {
      display: flex;
      gap: 28px;
      margin-top: 0.3in;
      padding-top: 14px;
      border-top: 1px solid #e0e0e0;
    }
    .cover-stat { text-align: center; }
    .cover-stat-num {
      font-family: 'Courier New', monospace;
      font-size: 20pt;
      font-weight: 700;
      color: #111;
      line-height: 1;
    }
    .cover-stat-label {
      font-family: 'Courier New', monospace;
      font-size: 6.5pt;
      letter-spacing: 0.18em;
      color: #888;
      text-transform: uppercase;
      margin-top: 3px;
    }
    .confidence-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 4px;
    }
    .confidence-bar {
      width: 90px;
      height: 3px;
      background: #ddd;
    }
    .confidence-bar-fill { height: 100%; background: #9a0000; }
    .confidence-label { font-family: 'Courier New', monospace; font-size: 7.5pt; color: #888; }
    .cover-footer-bar {
      background: #111;
      color: #888;
      font-family: 'Courier New', monospace;
      font-size: 6.5pt;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      text-align: center;
      padding: 10px 0;
    }
    .cover-classification-bottom {
      background: #9a0000;
      color: #fff;
      font-family: 'Courier New', monospace;
      font-size: 7.5pt;
      letter-spacing: 0.35em;
      text-transform: uppercase;
      text-align: center;
      padding: 8px 0;
      font-weight: 700;
    }

    /* ─── Section page header bar ────────────────────────────────────────── */
    .page-header-bar {
      display: flex;
      align-items: stretch;
      margin: -0.9in -1.05in 0.38in;
      background: #111;
    }
    .page-header-left {
      flex: 1;
      padding: 10px 1.05in;
    }
    .page-section-num {
      font-family: 'Courier New', monospace;
      font-size: 7pt;
      letter-spacing: 0.28em;
      color: #9a0000;
      text-transform: uppercase;
      margin-bottom: 3px;
    }
    .page-section-title {
      font-family: Georgia, serif;
      font-size: 15pt;
      font-weight: bold;
      color: #fff;
      letter-spacing: -0.01em;
    }
    .page-header-right {
      padding: 10px 1.05in 10px 20px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      justify-content: center;
      border-left: 1px solid #333;
    }
    .page-case-ref {
      font-family: 'Courier New', monospace;
      font-size: 7pt;
      letter-spacing: 0.2em;
      color: #666;
      text-transform: uppercase;
    }

    /* ─── Content blocks ─────────────────────────────────────────────────── */
    .summary-text {
      font-size: 11pt;
      line-height: 1.72;
      color: #1a1a1a;
      margin-bottom: 22px;
      max-width: 5.6in;
    }
    .key-finding {
      border-left: 4px solid #9a0000;
      padding: 11px 16px;
      background: #fdf5f5;
      margin: 20px 0;
    }
    .key-finding-label {
      font-family: 'Courier New', monospace;
      font-size: 6.5pt;
      letter-spacing: 0.22em;
      color: #9a0000;
      text-transform: uppercase;
      margin-bottom: 5px;
      font-weight: 700;
    }
    .key-finding-text { font-size: 10.5pt; font-weight: 600; color: #111; line-height: 1.55; }

    /* ─── Actor / entity rows ─────────────────────────────────────────────── */
    .actor-group-label {
      font-family: 'Courier New', monospace;
      font-size: 7pt;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: #777;
      margin: 22px 0 8px;
      border-bottom: 1px solid #e0e0e0;
      padding-bottom: 5px;
    }
    .actor-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 6px 0;
      border-bottom: 1px solid #f2f2f2;
    }
    .actor-name { font-weight: 700; font-size: 10.5pt; color: #111; }
    .actor-meta { font-family: 'Courier New', monospace; font-size: 7.5pt; color: #999; }

    /* ─── Findings list ──────────────────────────────────────────────────── */
    .finding-item {
      padding: 9px 0;
      border-bottom: 1px solid #f0f0f0;
      display: flex;
      gap: 12px;
      align-items: baseline;
    }
    .finding-num {
      font-family: 'Courier New', monospace;
      font-size: 8pt;
      color: #9a0000;
      font-weight: 700;
      flex-shrink: 0;
      min-width: 22px;
    }
    .finding-bullet { color: #9a0000; font-size: 13pt; line-height: 1.2; flex-shrink: 0; }
    .finding-text { font-size: 10.5pt; line-height: 1.55; color: #222; }

    /* ─── Financial flows table ──────────────────────────────────────────── */
    .flows-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5pt;
      margin-top: 4px;
    }
    .flows-table thead tr {
      background: #111;
    }
    .flows-table th {
      font-family: 'Courier New', monospace;
      font-size: 6.5pt;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: #bbb;
      padding: 7px 10px;
      text-align: left;
      font-weight: 600;
    }
    .flows-table th.amt-col { text-align: right; color: #e07070; }
    .flows-table th.conf-col { text-align: right; }
    .flows-table td {
      padding: 8px 10px;
      vertical-align: top;
      border-bottom: 1px solid #f0f0f0;
    }
    .flows-table tr:nth-child(even) td { background: #fafafa; }
    .flow-type-badge {
      font-family: 'Courier New', monospace;
      font-size: 6.5pt;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #888;
      display: block;
      margin-top: 2px;
    }
    .flow-amount {
      font-family: 'Courier New', monospace;
      font-weight: 700;
      font-size: 11pt;
      color: #9a0000;
      white-space: nowrap;
    }
    .flow-context-cell {
      font-size: 8.5pt;
      color: #555;
      line-height: 1.45;
    }
    .flow-actors {
      font-family: 'Courier New', monospace;
      font-size: 7pt;
      color: #888;
      margin-top: 3px;
      letter-spacing: 0.06em;
    }
    .flow-conf-cell {
      font-family: 'Courier New', monospace;
      font-size: 8pt;
      text-align: right;
      white-space: nowrap;
    }
    .conf-high { color: #1a7a3a; }
    .conf-mid  { color: #8a6200; }
    .conf-low  { color: #9a4000; }

    /* ─── Evidence / sources ─────────────────────────────────────────────── */
    .evidence-row {
      padding: 9px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .evidence-rank {
      font-family: 'Courier New', monospace;
      font-size: 7pt;
      color: #ccc;
      margin-right: 6px;
    }
    .evidence-title { font-weight: 700; font-size: 10pt; color: #111; margin-bottom: 3px; }
    .evidence-source { font-family: 'Courier New', monospace; font-size: 7.5pt; color: #888; }
    .evidence-tier {
      display: inline-block;
      font-family: 'Courier New', monospace;
      font-size: 6pt;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: 1px 5px;
      border: 1px solid #e0e0e0;
      color: #999;
      margin-left: 6px;
    }

    /* ─── Timeline ───────────────────────────────────────────────────────── */
    .timeline-row {
      display: flex;
      gap: 20px;
      padding: 8px 0;
      border-bottom: 1px solid #f0f0f0;
      align-items: baseline;
    }
    .timeline-date {
      font-family: 'Courier New', monospace;
      font-size: 8.5pt;
      color: #9a0000;
      flex-shrink: 0;
      min-width: 1in;
      font-weight: 700;
    }
    .timeline-event { font-size: 10pt; color: #222; line-height: 1.5; }

    /* ─── Intelligence gaps ──────────────────────────────────────────────── */
    .gap-row {
      padding: 9px 0 9px 14px;
      border-left: 3px solid #d0d0d0;
      margin-bottom: 8px;
      font-size: 10pt;
      color: #444;
      line-height: 1.5;
    }
    .gap-row::before {
      content: "IRQ ";
      font-family: 'Courier New', monospace;
      font-size: 7pt;
      color: #aaa;
      letter-spacing: 0.12em;
    }

    /* ─── Flow arrow ─────────────────────────────────────────────────────── */
    .flow-arrow { color: #9a0000; margin: 0 6px; font-size: 11pt; }

    /* ─── Empty state ────────────────────────────────────────────────────── */
    .empty-note {
      font-family: 'Courier New', monospace;
      font-size: 8.5pt;
      color: #bbb;
      letter-spacing: 0.12em;
      padding: 20px 0;
      text-transform: uppercase;
    }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { padding: 0.75in 0.9in 0.85in; }
      .page-header-bar { margin: -0.75in -0.9in 0.35in; }
    }
  `;

  const confidenceBarWidth = {
    STRONG: 95, PROVISIONAL: 70, MODERATE: 55, RECOVERED: 45, WEAK: 30, FAILED: 10
  }[autoBuildQuality ?? ""] ?? 20;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ATLAS Intelligence Report — ${escapeHtml(caseTitle)}</title>
<style>${css}</style>
</head>
<body>

<!-- PAGE 1: COVER -->
<div class="cover">
  <div class="cover-classification-top">${escapeHtml(classification)}</div>
  <div class="cover-body">
    <div class="cover-header-bar">
      <div class="atlas-wordmark"><strong>ATLAS</strong> &nbsp;/&nbsp; RSR INVESTIGATIVE INTELLIGENCE SYSTEM</div>
      <div class="cover-case-stamp">
        CASE-${String(caseId).padStart(6, "0")}<br>
        ${escapeHtml(dateStr.toUpperCase())} &nbsp;${escapeHtml(timeStr)}
      </div>
    </div>
    <div class="cover-title">${escapeHtml(caseTitle)}</div>
    <hr class="cover-rule">
    <div class="cover-meta">
      <div class="meta-item">
        <div class="meta-label">Case Reference</div>
        <div class="meta-value">CASE-${String(caseId).padStart(6, "0")}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Status</div>
        <div class="meta-value">${escapeHtml(caseStatus.toUpperCase())}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Report Date</div>
        <div class="meta-value">${escapeHtml(dateStr)}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Intelligence Confidence</div>
        <div class="meta-value" style="font-size:9.5pt">${escapeHtml(confidence)}</div>
        <div class="confidence-row">
          <div class="confidence-bar"><div class="confidence-bar-fill" style="width:${confidenceBarWidth}%"></div></div>
          <span class="confidence-label">${confidenceBarWidth}%</span>
        </div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Entities Confirmed</div>
        <div class="meta-value">${entities.length}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Source Documents</div>
        <div class="meta-value">${documents.length}</div>
      </div>
    </div>
    ${s.caseSummary ? `
    <div class="cover-summary-block">
      <div class="cover-summary-label">Executive Summary</div>
      <div class="cover-summary-text">${escapeHtml(s.caseSummary.length > 350 ? s.caseSummary.slice(0, 347) + "…" : s.caseSummary)}</div>
    </div>` : ""}
    <div class="cover-stat-strip">
      <div class="cover-stat">
        <div class="cover-stat-num">${persons.length}</div>
        <div class="cover-stat-label">Individuals</div>
      </div>
      <div class="cover-stat">
        <div class="cover-stat-num">${orgs.length}</div>
        <div class="cover-stat-label">Organizations</div>
      </div>
      <div class="cover-stat">
        <div class="cover-stat-num">${timeline.length}</div>
        <div class="cover-stat-label">Timeline Events</div>
      </div>
      <div class="cover-stat">
        <div class="cover-stat-num">${flows.filter(f => (f.normalizedAmount ?? 0) > 0).length}</div>
        <div class="cover-stat-label">Financial Signals</div>
      </div>
      <div class="cover-stat">
        <div class="cover-stat-num">${(s.entityRelationships ?? []).length}</div>
        <div class="cover-stat-label">Relationships</div>
      </div>
    </div>
  </div>
  <div class="cover-footer-bar">
    ATLAS-CORE &nbsp;·&nbsp; AUTOMATED INTELLIGENCE REPORT &nbsp;·&nbsp; RSR PLATFORM &nbsp;·&nbsp; FOR AUTHORIZED USE ONLY
  </div>
  <div class="cover-classification-bottom">${escapeHtml(classification)}</div>
</div>

<!-- PAGE 2: EXECUTIVE SUMMARY -->
<div class="page">
  <div class="page-header-bar">
    <div class="page-header-left">
      <div class="page-section-num">SECTION 01</div>
      <div class="page-section-title">Executive Summary</div>
    </div>
    <div class="page-header-right">
      <div class="page-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
    </div>
  </div>
  ${s.caseSummary ? `
    <div class="summary-text">${escapeHtml(s.caseSummary)}</div>
  ` : `<div class="empty-note">No summary available — generate dossier to populate.</div>`}
  ${angles.length > 0 ? `
    <div class="key-finding">
      <div class="key-finding-label">Primary Investigative Angle</div>
      <div class="key-finding-text">${escapeHtml(angles[0].angle)}</div>
    </div>
  ` : ""}
  <div style="margin-top:32px">
    <div class="actor-group-label">Intelligence Overview</div>
    <div class="actor-row">
      <span class="actor-name">Confirmed Entities</span>
      <span class="actor-meta">${entities.length} total &nbsp;·&nbsp; ${persons.length} persons &nbsp;·&nbsp; ${orgs.length} organizations</span>
    </div>
    <div class="actor-row">
      <span class="actor-name">Source Documents</span>
      <span class="actor-meta">${documents.length} ingested</span>
    </div>
    <div class="actor-row">
      <span class="actor-name">Timeline Events</span>
      <span class="actor-meta">${timeline.length} mapped</span>
    </div>
    <div class="actor-row">
      <span class="actor-name">Financial Signals</span>
      <span class="actor-meta">${flows.length} detected</span>
    </div>
  </div>
</div>

<!-- PAGE 3: PRIMARY ACTORS -->
<div class="page">
  <div class="page-header-bar">
    <div class="page-header-left">
      <div class="page-section-num">SECTION 02</div>
      <div class="page-section-title">Primary Actors</div>
    </div>
    <div class="page-header-right">
      <div class="page-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
    </div>
  </div>
  ${persons.length > 0 ? `
    <div class="actor-group-label">Individuals</div>
    ${persons.map(e => `
      <div class="actor-row">
        <span class="actor-name">${escapeHtml(e.name)}</span>
        <span class="actor-meta">${e.docCount ? `${e.docCount} sources` : "—"}</span>
      </div>
    `).join("")}
  ` : `<div class="empty-note">No individual actors confirmed.</div>`}
  ${orgs.length > 0 ? `
    <div class="actor-group-label">Organizations &amp; Agencies</div>
    ${orgs.map(e => `
      <div class="actor-row">
        <span class="actor-name">${escapeHtml(e.name)}</span>
        <span class="actor-meta">${escapeHtml(formatEntityType(e.type))} &nbsp;·&nbsp; ${e.docCount ? `${e.docCount} sources` : "—"}</span>
      </div>
    `).join("")}
  ` : ""}
  ${otherEntities.length > 0 ? `
    <div class="actor-group-label">Other Entities</div>
    ${otherEntities.map(e => `
      <div class="actor-row">
        <span class="actor-name">${escapeHtml(e.name)}</span>
        <span class="actor-meta">${escapeHtml(formatEntityType(e.type))}</span>
      </div>
    `).join("")}
  ` : ""}
  ${(s.entityRelationships ?? []).length > 0 ? `
    <div class="actor-group-label" style="margin-top:36px">Confirmed Relationships</div>
    ${(s.entityRelationships ?? []).map(r => `
      <div class="actor-row">
        <span><span class="actor-name">${escapeHtml(r.entityAName)}</span>
        <span class="flow-arrow">→</span>
        <span class="actor-name">${escapeHtml(r.entityBName)}</span></span>
        <span class="actor-meta">${r.relationType ? escapeHtml(r.relationType.replace(/_/g, " ")) : "associated"}</span>
      </div>
    `).join("")}
  ` : ""}
</div>

<!-- PAGE 4: KEY FINDINGS + WHY THIS MATTERS -->
<div class="page">
  <div class="page-header-bar">
    <div class="page-header-left">
      <div class="page-section-num">SECTION 03</div>
      <div class="page-section-title">Key Findings</div>
    </div>
    <div class="page-header-right">
      <div class="page-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
    </div>
  </div>
  ${angles.length > 0 ? `
    <div class="actor-group-label">Investigative Angles</div>
    ${angles.map(a => `
      <div class="finding-item">
        <span class="finding-bullet">·</span>
        <span class="finding-text">${escapeHtml(a.angle)}</span>
      </div>
    `).join("")}
  ` : `<div class="empty-note">Generate dossier to synthesize findings.</div>`}

  <!-- WHY THIS MATTERS callout -->
  <div style="margin-top:36px">
    <div class="actor-group-label">Why This Matters</div>
    <div class="key-finding">
      <div class="key-finding-label">Intelligence Significance</div>
      <div class="key-finding-text" style="font-weight:400;font-size:10.5pt;line-height:1.65">
        ${(() => {
          if (s.whyItMatters) return escapeHtml(s.whyItMatters);
          const parts: string[] = [];
          if (angles.length > 0) parts.push(escapeHtml(angles[0].angle));
          if (flows.length > 0) {
            const amt = flows[0].amountDisplay ?? flows[0].amountRaw ?? flows[0].amount ?? "";
            parts.push(`Financial signals${amt ? ` of ${escapeHtml(amt)}` : ""} involving ${escapeHtml(flows[0].entityName)} indicate potential resource flows warranting further investigation.`);
          }
          if (persons.length > 0 && orgs.length > 0) {
            parts.push(`${persons.length} individual${persons.length !== 1 ? "s" : ""} and ${orgs.length} organization${orgs.length !== 1 ? "s" : ""} confirmed across ${documents.length} source${documents.length !== 1 ? "s" : ""}.`);
          }
          if (parts.length === 0) {
            parts.push(`This case involves ${entities.length} confirmed ${entities.length === 1 ? "entity" : "entities"} across ${documents.length} source document${documents.length !== 1 ? "s" : ""}. Further sourcing required to establish significance.`);
          }
          return parts.slice(0, 2).join(" ");
        })()}
      </div>
    </div>
    ${s.confidenceNote ? `
    <div style="margin-top:12px;font-family:'Courier New',monospace;font-size:8pt;color:#888;letter-spacing:0.08em;text-transform:uppercase;border-top:1px solid #e8e8e8;padding-top:8px">
      ${escapeHtml(s.confidenceNote)}
    </div>` : ""}
  </div>

  ${(s.nextQueries ?? []).length > 0 ? `
    <div class="actor-group-label" style="margin-top:24px">Recommended Queries for Expansion</div>
    ${(s.nextQueries ?? []).map(q => `
      <div class="finding-item">
        <span class="finding-bullet" style="color:#888">→</span>
        <span class="finding-text" style="color:#555">${escapeHtml(q)}</span>
      </div>
    `).join("")}
  ` : ""}
</div>

<!-- PAGE 5: FINANCIAL FLOWS -->
<div class="page">
  <div class="page-header-bar">
    <div class="page-header-left">
      <div class="page-section-num">SECTION 04</div>
      <div class="page-section-title">Financial Flows</div>
    </div>
    <div class="page-header-right">
      <div class="page-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
    </div>
  </div>
  ${flows.length > 0 ? `
  <table class="flows-table">
    <thead>
      <tr>
        <th style="width:22%">ENTITY / PROGRAM</th>
        <th style="width:36%">SIGNAL CONTEXT</th>
        <th class="amt-col" style="width:14%">AMOUNT</th>
        <th style="width:14%">TYPE</th>
        <th class="conf-col" style="width:14%">CONF</th>
      </tr>
    </thead>
    <tbody>
      ${flows.map((f) => {
        const displayAmt = f.amountDisplay ?? f.amountRaw ?? f.amount ?? null;
        const summary = f.eventSummary ?? f.context ?? null;
        const sigType = f.signalType ? f.signalType.replace(/^NON_NUMERIC_/, "").replace(/_/g, " ") : "—";
        const conf = f.confidence ?? null;
        const confPct = conf !== null ? Math.round(conf * 100) : null;
        const confClass = confPct === null ? "" : confPct >= 75 ? "conf-high" : confPct >= 50 ? "conf-mid" : "conf-low";
        const hasAmt = displayAmt && displayAmt !== "NON-NUMERIC";
        return `
      <tr>
        <td>
          <strong style="font-size:9.5pt;color:#111">${escapeHtml(f.entityName ?? "—")}</strong>
          ${f.programName ? `<span class="flow-type-badge">${escapeHtml(f.programName.length > 30 ? f.programName.slice(0, 28) + "…" : f.programName)}</span>` : ""}
          ${(f.controlledBy || f.receivedBy) ? `<div class="flow-actors">${f.controlledBy ? `FROM: ${escapeHtml(f.controlledBy)}` : ""}${f.controlledBy && f.receivedBy ? " → " : ""}${f.receivedBy ? `TO: ${escapeHtml(f.receivedBy)}` : ""}</div>` : ""}
        </td>
        <td class="flow-context-cell">${summary ? escapeHtml(summary.slice(0, 160)) + (summary.length > 160 ? "…" : "") : "<em style='color:#bbb'>No summary</em>"}</td>
        <td style="text-align:right">${hasAmt && displayAmt ? `<span class="flow-amount">${escapeHtml(displayAmt)}</span>` : `<span style="color:#ccc;font-family:'Courier New',monospace;font-size:8pt">—</span>`}</td>
        <td><span class="flow-type-badge" style="font-size:7pt">${escapeHtml(sigType.toUpperCase())}</span>${f.inferred ? `<span style="font-family:'Courier New',monospace;font-size:6pt;color:#aaa;display:block;margin-top:2px">INFERRED</span>` : ""}</td>
        <td class="flow-conf-cell ${confClass}">${confPct !== null ? confPct + "%" : "—"}</td>
      </tr>`;
      }).join("")}
    </tbody>
  </table>` : `<div class="empty-note">No financial signals detected. Ingest documents containing budgets, contracts, or funding agreements.</div>`}
</div>

<!-- PAGE 6: EVIDENCE -->
<div class="page">
  <div class="page-header-bar">
    <div class="page-header-left">
      <div class="page-section-num">SECTION 05</div>
      <div class="page-section-title">Source Evidence</div>
    </div>
    <div class="page-header-right">
      <div class="page-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
    </div>
  </div>
  ${topDocs.length > 0 ? topDocs.map((d, i) => `
    <div class="evidence-row">
      <div class="evidence-title">
        <span class="evidence-rank">${String(i + 1).padStart(2, "0")}.</span>${escapeHtml(d.title)}
        ${d.tier ? `<span class="evidence-tier">${escapeHtml(d.tier)}</span>` : ""}
      </div>
      <div class="evidence-source">
        ${d.source ? escapeHtml(d.source) + " &nbsp;·&nbsp; " : ""}
        ${d.signalScore !== null && d.signalScore !== undefined ? `Signal Score: ${Math.round((d.signalScore ?? 0) * 100)}%` : ""}
      </div>
    </div>
  `).join("") : `<div class="empty-note">No source documents ingested.</div>`}
</div>

<!-- PAGE 7: TIMELINE -->
<div class="page">
  <div class="page-header-bar">
    <div class="page-header-left">
      <div class="page-section-num">SECTION 06</div>
      <div class="page-section-title">Timeline</div>
    </div>
    <div class="page-header-right">
      <div class="page-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
    </div>
  </div>
  ${timeline.length > 0 ? timeline.map(t => `
    <div class="timeline-row">
      <span class="timeline-date">${t.date ? escapeHtml(t.date.slice(0, 10)) : "UNDATED"}</span>
      <span class="timeline-event">${escapeHtml(t.title)}</span>
    </div>
  `).join("") : `<div class="empty-note">No timeline events mapped. Ingest chronological source material.</div>`}
</div>

<!-- KEY FINDINGS PAGE (T005/T006) -->
${((s.keyFindings ?? []).length > 0 || (s.financialRedFlags ?? []).length > 0 || (s.powerNodes ?? []).length > 0 || (s.oversightFailures ?? []).length > 0) ? `
<div class="page">
  <div class="page-header-bar">
    <div class="page-header-left">
      <div class="page-section-num">SECTION 07-A</div>
      <div class="page-section-title">Investigative Intelligence</div>
    </div>
    <div class="page-header-right">
      <div class="page-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
    </div>
  </div>

  ${(s.keyFindings ?? []).length > 0 ? `
  <div class="actor-group-label" style="color:#900000">Key Findings</div>
  ${(s.keyFindings ?? []).map((f, i) => `
    <div style="display:flex;gap:14px;padding:10px 0;border-bottom:1px solid #f0f0f0;align-items:baseline">
      <span style="font-family:'Courier New',monospace;color:#900000;font-size:9pt;flex-shrink:0;font-weight:bold">${(i + 1).toString().padStart(2, "0")}</span>
      <span style="font-size:10.5pt;color:#222;line-height:1.6">${escapeHtml(String(f))}</span>
    </div>
  `).join("")}
  <div style="margin-bottom:24px"></div>` : ""}

  ${(s.financialRedFlags ?? []).length > 0 ? `
  <div class="actor-group-label" style="color:#c00000;border-color:#f0c0c0;margin-top:24px">Financial Red Flags</div>
  ${(s.financialRedFlags ?? []).map(flag => `
    <div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #f5e5e5;align-items:baseline">
      <span style="color:#c00000;font-size:11pt;flex-shrink:0">⚑</span>
      <span style="font-size:10.5pt;color:#444;line-height:1.6">${escapeHtml(String(flag))}</span>
    </div>
  `).join("")}
  <div style="margin-bottom:24px"></div>` : ""}

  ${(s.powerNodes ?? []).length > 0 ? `
  <div class="actor-group-label" style="color:#7a5c00;border-color:#e8d8a0;margin-top:24px">Power Nodes</div>
  ${(s.powerNodes ?? []).map(node => `
    <div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #f5f0e5;align-items:baseline">
      <span style="color:#a07000;font-size:11pt;flex-shrink:0">◈</span>
      <span style="font-size:10.5pt;color:#444;line-height:1.6">${escapeHtml(String(node))}</span>
    </div>
  `).join("")}
  <div style="margin-bottom:24px"></div>` : ""}

  ${(s.oversightFailures ?? []).length > 0 ? `
  <div class="actor-group-label" style="color:#8a4500;border-color:#f0d0b0;margin-top:24px">Oversight Failures</div>
  ${(s.oversightFailures ?? []).map(fail => `
    <div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #f5ece0;align-items:baseline">
      <span style="color:#c05000;font-size:11pt;flex-shrink:0">⚠</span>
      <span style="font-size:10.5pt;color:#555;line-height:1.6">${escapeHtml(String(fail))}</span>
    </div>
  `).join("")}` : ""}
</div>` : ""}

<!-- PAGE 8: POWER STRUCTURE + RISK FLAGS -->
<div class="page">
  <div class="page-header-bar">
    <div class="page-header-left">
      <div class="page-section-num">SECTION 07</div>
      <div class="page-section-title">Power Structure &amp; Risk</div>
    </div>
    <div class="page-header-right">
      <div class="page-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
    </div>
  </div>

  ${s.powerStructure ? `
  <div class="actor-group-label">Power Structure Analysis</div>
  <div style="font-size:11pt;line-height:1.7;color:#222;margin-bottom:24px;max-width:5.5in">
    ${escapeHtml(s.powerStructure)}
  </div>` : ""}

  ${(s.riskFlags ?? []).length > 0 ? `
  <div class="actor-group-label" style="color:#c00;border-color:#f0c0c0">Risk Flags</div>
  ${(s.riskFlags ?? []).map(flag => `
    <div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #f5e5e5;align-items:baseline">
      <span style="color:#c00;font-size:11pt;flex-shrink:0">⚠</span>
      <span style="font-size:10.5pt;color:#444">${escapeHtml(flag)}</span>
    </div>
  `).join("")}` : `<div class="empty-note">No risk flags detected at current confidence level.</div>`}

  ${(s.recommendedActions ?? []).length > 0 ? `
  <div class="actor-group-label" style="margin-top:36px">Recommended Actions</div>
  ${(s.recommendedActions ?? []).map((action, i) => `
    <div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #f0f0f0;align-items:baseline">
      <span style="font-family:'Courier New',monospace;color:#888;font-size:9pt;flex-shrink:0">${(i + 1).toString().padStart(2, "0")}</span>
      <span style="font-size:10.5pt;color:#222">${escapeHtml(action)}</span>
    </div>
  `).join("")}` : ""}
</div>

<!-- PAGE 9: INTELLIGENCE GAPS -->
<div class="page">
  <div class="page-header-bar">
    <div class="page-header-left">
      <div class="page-section-num">SECTION 08</div>
      <div class="page-section-title">Intelligence Gaps</div>
    </div>
    <div class="page-header-right">
      <div class="page-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
    </div>
  </div>
  <div style="margin-bottom:20px;font-size:10.5pt;color:#555">
    The following areas require additional sourcing or verification before conclusions can be drawn.
  </div>
  ${gaps.length > 0 ? gaps.map(g => `
    <div class="gap-row">${escapeHtml(g)}</div>
  `).join("") : `<div style="font-size:10.5pt;color:#555;padding:12px 0">All major intelligence requirements satisfied at current confidence level.</div>`}
</div>

<!-- PAGE 10: ENTITY NETWORK MAP (text-based) -->
<div class="page">
  <div class="page-header-bar">
    <div class="page-header-left">
      <div class="page-section-num">SECTION 09</div>
      <div class="page-section-title">Entity Network Map</div>
    </div>
    <div class="page-header-right">
      <div class="page-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
    </div>
  </div>
  <div style="margin-bottom:20px;font-size:10.5pt;color:#555">
    Confirmed entity relationships extracted from ingested source material. Confidence ratings reflect evidence chain strength.
  </div>
  ${(s.entityRelationships ?? []).length > 0 ? `
  <table style="width:100%;border-collapse:collapse;font-size:10pt">
    <thead>
      <tr style="border-bottom:2px solid #1a1a1a">
        <th style="text-align:left;padding:7px 8px;font-family:'Courier New',monospace;font-size:7.5pt;letter-spacing:0.12em;color:#666;font-weight:600">ENTITY A</th>
        <th style="text-align:center;padding:7px 8px;font-family:'Courier New',monospace;font-size:7.5pt;letter-spacing:0.12em;color:#666;font-weight:600">VECTOR</th>
        <th style="text-align:left;padding:7px 8px;font-family:'Courier New',monospace;font-size:7.5pt;letter-spacing:0.12em;color:#666;font-weight:600">ENTITY B</th>
        <th style="text-align:right;padding:7px 8px;font-family:'Courier New',monospace;font-size:7.5pt;letter-spacing:0.12em;color:#666;font-weight:600">CONF</th>
      </tr>
    </thead>
    <tbody>
      ${(s.entityRelationships ?? []).slice(0, 20).map((r, i) => `
      <tr style="border-bottom:1px solid ${i % 2 === 0 ? "#f5f5f5" : "#efefef"};background:${i % 2 === 0 ? "#fff" : "#fafafa"}">
        <td style="padding:7px 8px;font-weight:600;color:#222;font-size:10pt">${escapeHtml(r.entityAName)}</td>
        <td style="padding:7px 8px;text-align:center;font-family:'Courier New',monospace;font-size:8pt;color:#b00000;letter-spacing:0.05em">${escapeHtml((r.relationType ?? "LINKED").replace(/_/g, " ").toUpperCase())}</td>
        <td style="padding:7px 8px;font-weight:600;color:#222;font-size:10pt">${escapeHtml(r.entityBName)}</td>
        <td style="padding:7px 8px;text-align:right;font-family:'Courier New',monospace;font-size:8.5pt;color:#666">${escapeHtml(String(r.confidence ?? "—"))}</td>
      </tr>`).join("")}
    </tbody>
  </table>
  ${(s.entityRelationships ?? []).length > 20 ? `<div style="margin-top:12px;font-family:'Courier New',monospace;font-size:8pt;color:#888">+ ${(s.entityRelationships ?? []).length - 20} ADDITIONAL RELATIONSHIPS — VIEW FULL GRAPH IN ATLAS SYSTEM</div>` : ""}
  ` : `<div class="empty-note">No confirmed entity relationships mapped. Approve entity mentions and build link graph in ATLAS.</div>`}

  ${entities.length > 0 ? `
  <div style="margin-top:36px">
    <div class="actor-group-label">Entity Classification Summary</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:12px">
      <div style="border:1px solid #e0e0e0;padding:14px;background:#fafafa">
        <div style="font-family:'Courier New',monospace;font-size:7pt;color:#888;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:6px">PERSONS</div>
        <div style="font-size:22pt;font-weight:bold;color:#111;line-height:1">${persons.length}</div>
      </div>
      <div style="border:1px solid #e0e0e0;padding:14px;background:#fafafa">
        <div style="font-family:'Courier New',monospace;font-size:7pt;color:#888;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:6px">ORGANIZATIONS</div>
        <div style="font-size:22pt;font-weight:bold;color:#111;line-height:1">${orgs.length}</div>
      </div>
      <div style="border:1px solid #e0e0e0;padding:14px;background:#fafafa">
        <div style="font-family:'Courier New',monospace;font-size:7pt;color:#888;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:6px">OTHER ENTITIES</div>
        <div style="font-size:22pt;font-weight:bold;color:#111;line-height:1">${otherEntities.length}</div>
      </div>
    </div>
  </div>
  ` : ""}
</div>

<!-- PAGE 11: SOURCE CREDIBILITY ASSESSMENT -->
<div class="page">
  <div class="page-header-bar">
    <div class="page-header-left">
      <div class="page-section-num">SECTION 10</div>
      <div class="page-section-title">Source Credibility Assessment</div>
    </div>
    <div class="page-header-right">
      <div class="page-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
    </div>
  </div>
  <div style="margin-bottom:20px;font-size:10.5pt;color:#555">
    Signal quality scores for ingested source documents. Higher scores indicate greater relevance, verifiability, and corroboration.
  </div>
  ${documents.length > 0 ? `
  <table style="width:100%;border-collapse:collapse;font-size:9.5pt">
    <thead>
      <tr style="border-bottom:2px solid #1a1a1a">
        <th style="text-align:left;padding:6px 8px;font-family:'Courier New',monospace;font-size:7pt;color:#666;font-weight:600;letter-spacing:0.12em">#</th>
        <th style="text-align:left;padding:6px 8px;font-family:'Courier New',monospace;font-size:7pt;color:#666;font-weight:600;letter-spacing:0.12em">SOURCE DOCUMENT</th>
        <th style="text-align:left;padding:6px 8px;font-family:'Courier New',monospace;font-size:7pt;color:#666;font-weight:600;letter-spacing:0.12em">ORIGIN</th>
        <th style="text-align:right;padding:6px 8px;font-family:'Courier New',monospace;font-size:7pt;color:#666;font-weight:600;letter-spacing:0.12em">SIGNAL SCORE</th>
        <th style="text-align:center;padding:6px 8px;font-family:'Courier New',monospace;font-size:7pt;color:#666;font-weight:600;letter-spacing:0.12em">TIER</th>
      </tr>
    </thead>
    <tbody>
      ${documents.slice(0, 15).map((d, i) => {
        const score = d.signalScore !== null && d.signalScore !== undefined ? Math.round((d.signalScore ?? 0) * 100) : null;
        const scoreColor = score !== null ? (score >= 70 ? "#006600" : score >= 40 ? "#996600" : "#c00000") : "#aaa";
        return `
      <tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:6px 8px;font-family:'Courier New',monospace;font-size:8pt;color:#aaa">${String(i + 1).padStart(2, "0")}</td>
        <td style="padding:6px 8px;font-weight:500;color:#222;font-size:9pt;max-width:3in;overflow:hidden">${escapeHtml(d.title.slice(0, 70))}${d.title.length > 70 ? "…" : ""}</td>
        <td style="padding:6px 8px;font-family:'Courier New',monospace;font-size:8pt;color:#666">${d.source ? escapeHtml(d.source.slice(0, 25)) : "—"}</td>
        <td style="padding:6px 8px;text-align:right;font-family:'Courier New',monospace;font-weight:700;color:${scoreColor};font-size:9.5pt">${score !== null ? score + "%" : "—"}</td>
        <td style="padding:6px 8px;text-align:center;font-family:'Courier New',monospace;font-size:7.5pt;color:#888">${d.tier ? escapeHtml(d.tier) : "—"}</td>
      </tr>`;
      }).join("")}
    </tbody>
  </table>
  ${documents.length > 15 ? `<div style="margin-top:10px;font-family:'Courier New',monospace;font-size:8pt;color:#888">+ ${documents.length - 15} ADDITIONAL SOURCES IN DOCUMENT VAULT</div>` : ""}
  <div style="margin-top:28px;border-top:1px solid #e0e0e0;padding-top:16px">
    <div class="actor-group-label">Corpus Integrity Summary</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px">
      <div style="border:1px solid #e8e8e8;padding:12px;background:#fafafa">
        <div style="font-family:'Courier New',monospace;font-size:7pt;color:#888;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px">TOTAL SOURCES</div>
        <div style="font-size:18pt;font-weight:bold;color:#111">${documents.length}</div>
      </div>
      <div style="border:1px solid #e8e8e8;padding:12px;background:#fafafa">
        <div style="font-family:'Courier New',monospace;font-size:7pt;color:#888;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px">HIGH SIGNAL</div>
        <div style="font-size:18pt;font-weight:bold;color:#006600">${documents.filter(d => (d.signalScore ?? 0) >= 0.7).length}</div>
      </div>
      <div style="border:1px solid #e8e8e8;padding:12px;background:#fafafa">
        <div style="font-family:'Courier New',monospace;font-size:7pt;color:#888;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px">MEDIUM SIGNAL</div>
        <div style="font-size:18pt;font-weight:bold;color:#996600">${documents.filter(d => (d.signalScore ?? 0) >= 0.4 && (d.signalScore ?? 0) < 0.7).length}</div>
      </div>
      <div style="border:1px solid #e8e8e8;padding:12px;background:#fafafa">
        <div style="font-family:'Courier New',monospace;font-size:7pt;color:#888;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px">LOW / FAILED</div>
        <div style="font-size:18pt;font-weight:bold;color:#c00000">${documents.filter(d => (d.signalScore ?? 0) < 0.4).length}</div>
      </div>
    </div>
  </div>
  ` : `<div class="empty-note">No source documents in vault. Ingest documents to generate credibility assessment.</div>`}
</div>

<!-- PAGE 12: RECOMMENDED ACTIONS & NEXT STEPS -->
<div class="page">
  <div class="page-header-bar">
    <div class="page-header-left">
      <div class="page-section-num">SECTION 11</div>
      <div class="page-section-title">Recommended Actions &amp; Next Steps</div>
    </div>
    <div class="page-header-right">
      <div class="page-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
    </div>
  </div>
  ${(s.recommendedActions ?? []).length > 0 ? `
  <div class="actor-group-label">Analyst Recommended Actions</div>
  ${(s.recommendedActions ?? []).map((action, i) => `
    <div style="display:flex;gap:14px;padding:12px 0;border-bottom:1px solid #f0f0f0;align-items:flex-start">
      <span style="font-family:'Courier New',monospace;color:#b00000;font-size:12pt;font-weight:bold;flex-shrink:0;min-width:24px;line-height:1.4">${(i + 1).toString().padStart(2, "0")}</span>
      <span style="font-size:11pt;color:#222;line-height:1.6">${escapeHtml(action)}</span>
    </div>
  `).join("")}` : `<div class="empty-note">No analyst actions generated at current confidence level.</div>`}

  ${(s.nextQueries ?? []).length > 0 ? `
  <div class="actor-group-label" style="margin-top:40px">Priority Intelligence Requirements</div>
  <div style="font-size:10.5pt;color:#555;margin-bottom:16px">The following queries should be ingested or investigated to advance this case.</div>
  ${(s.nextQueries ?? []).map((q, i) => `
    <div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid #f5f5f5;align-items:baseline">
      <span style="font-family:'Courier New',monospace;color:#888;font-size:9pt;flex-shrink:0">[PIR-${(i + 1).toString().padStart(2, "0")}]</span>
      <span style="font-size:10.5pt;color:#333;font-style:italic">"${escapeHtml(q)}"</span>
    </div>
  `).join("")}` : ""}

  <div style="margin-top:40px;background:#f8f8f8;border:1px solid #e0e0e0;padding:20px">
    <div style="font-family:'Courier New',monospace;font-size:8pt;color:#888;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:10px">ATLAS SYSTEM ASSESSMENT</div>
    <div style="font-size:10.5pt;color:#333;line-height:1.7">
      ${s.confidenceNote ? escapeHtml(s.confidenceNote) : `This report was generated by the ATLAS automated intelligence platform. All findings should be independently verified before operational use. Evidence chains are documented in the source vault. Entity relationships reflect automated analysis and may require analyst review.`}
    </div>
    <div style="margin-top:14px;display:flex;gap:24px;align-items:center">
      <div>
        <div style="font-family:'Courier New',monospace;font-size:7pt;color:#aaa;text-transform:uppercase;letter-spacing:0.15em">BUILD QUALITY</div>
        <div style="font-family:'Courier New',monospace;font-size:9pt;font-weight:bold;color:#222;margin-top:2px">${escapeHtml(autoBuildQuality ?? "UNCLASSIFIED")}</div>
      </div>
      <div>
        <div style="font-family:'Courier New',monospace;font-size:7pt;color:#aaa;text-transform:uppercase;letter-spacing:0.15em">CONFIDENCE</div>
        <div style="font-family:'Courier New',monospace;font-size:9pt;font-weight:bold;color:#222;margin-top:2px">${escapeHtml(confidence)}</div>
      </div>
      <div>
        <div style="font-family:'Courier New',monospace;font-size:7pt;color:#aaa;text-transform:uppercase;letter-spacing:0.15em">GENERATED</div>
        <div style="font-family:'Courier New',monospace;font-size:9pt;font-weight:bold;color:#222;margin-top:2px">${escapeHtml(dateStr)}</div>
      </div>
    </div>
  </div>
</div>

<!-- PAGE 13: CLASSIFICATION & LEGAL NOTICE -->
<div class="page">
  <div class="page-header-bar">
    <div class="page-header-left">
      <div class="page-section-num">SECTION 12</div>
      <div class="page-section-title">Classification &amp; Legal Notice</div>
    </div>
    <div class="page-header-right">
      <div class="page-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
    </div>
  </div>

  <div style="border:2px solid #c00000;padding:20px;margin-bottom:32px;background:#fff8f8">
    <div style="font-family:'Courier New',monospace;font-size:9pt;color:#c00000;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:10px;font-weight:bold">CLASSIFICATION NOTICE</div>
    <div style="font-size:10.5pt;color:#333;line-height:1.7">
      This document is classified <strong>${escapeHtml(classification)}</strong> and is intended solely for authorized personnel with a valid need-to-know for the subject matter. Distribution, reproduction, or disclosure of this document outside authorized channels is prohibited.
    </div>
  </div>

  <div class="actor-group-label">Document Provenance</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:28px">
    ${[
      ["Case Designation", escapeHtml(caseTitle)],
      ["Case Reference", `CASE-${String(caseId).padStart(6, "0")}`],
      ["Classification Level", escapeHtml(classification)],
      ["Confidence Rating", escapeHtml(confidence)],
      ["Report Generated", `${escapeHtml(dateStr)} at ${escapeHtml(timeStr)}`],
      ["Generating System", "ATLAS-CORE AUTOMATED INTELLIGENCE PLATFORM"],
      ["Case Status", escapeHtml(caseStatus.toUpperCase())],
      ["Total Entities", String(entities.length)],
      ["Total Sources", String(documents.length)],
      ["Financial Signals", String(flows.length)],
      ["Timeline Events", String(timeline.length)],
      ["Entity Relationships", String((s.entityRelationships ?? []).length)],
    ].map(([label, value]) => `
      <tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:7px 8px;font-family:'Courier New',monospace;font-size:8pt;color:#888;width:2.5in;letter-spacing:0.08em;text-transform:uppercase">${label}</td>
        <td style="padding:7px 8px;font-size:10pt;color:#222;font-weight:500">${value}</td>
      </tr>
    `).join("")}
  </table>

  <div class="actor-group-label">Legal Disclaimer</div>
  <div style="font-size:10pt;color:#555;line-height:1.8;margin-bottom:24px">
    This report is generated by the ATLAS (Advanced Tracking &amp; Link Analysis System) automated intelligence platform and is provided for investigative and research purposes only. All information contained herein is derived from publicly available sources and automated analysis. No warranty, express or implied, is made regarding the accuracy, completeness, or fitness for any particular purpose of information contained herein.
  </div>
  <div style="font-size:10pt;color:#555;line-height:1.8;margin-bottom:24px">
    Entity mentions, relationship graphs, and financial signal extractions represent automated pattern detection and are not legal findings. All conclusions drawn from this report should be independently verified before use in legal, regulatory, or administrative proceedings.
  </div>
  <div style="font-size:10pt;color:#555;line-height:1.8">
    Recipients are responsible for ensuring compliance with applicable laws regarding the collection, retention, and use of intelligence information. Unauthorized use, reproduction, or distribution of this document may be subject to civil or criminal penalties under applicable law.
  </div>

  <div style="margin-top:48px;border-top:2px solid #1a1a1a;padding-top:20px;display:flex;justify-content:space-between;align-items:flex-end">
    <div>
      <div style="font-family:'Courier New',monospace;font-size:8pt;color:#aaa;letter-spacing:0.15em;text-transform:uppercase">ATLAS-CORE AUTOMATED INTELLIGENCE REPORT</div>
      <div style="font-family:'Courier New',monospace;font-size:7.5pt;color:#ccc;margin-top:4px">GENERATED ${escapeHtml(dateStr.toUpperCase())} AT ${escapeHtml(timeStr)} · FOR AUTHORIZED USE ONLY</div>
    </div>
    <div style="text-align:right">
      <div style="font-family:'Courier New',monospace;font-size:8pt;color:#888;letter-spacing:0.12em">PAGE 13 OF 13</div>
      <div style="font-family:'Courier New',monospace;font-size:8pt;color:#c00000;font-weight:bold;letter-spacing:0.15em;margin-top:2px">${escapeHtml(classification)}</div>
    </div>
  </div>
</div>

</body>
</html>`;

  const printWin = window.open("", "_blank", "width=900,height=1100");
  if (!printWin) {
    alert("Popup blocked — please allow popups and try again.");
    return;
  }
  printWin.document.open();
  printWin.document.write(html);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => {
    printWin.print();
  }, 600);
}
