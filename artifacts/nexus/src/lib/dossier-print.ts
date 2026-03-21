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
    financialSignals?: Array<{ entityName: string; context: string; amount?: string; confidence?: number }>;
    investigativeAngles?: Array<{ angle: string }>;
    nextQueries?: string[];
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
  const gaps: string[] = [];
  if (persons.length === 0) gaps.push("No individual actors identified — additional sourcing required.");
  if (orgs.length === 0) gaps.push("No organizational entities confirmed — review entity triage queue.");
  if (flows.length === 0) gaps.push("No financial flows detected — documents with budget or contract data recommended.");
  if (timeline.length === 0) gaps.push("No timeline events mapped — chronological sourcing needed.");
  if ((s.entityRelationships ?? []).length === 0) gaps.push("No confirmed entity relationships — link analysis pending.");
  if (s.nextQueries && s.nextQueries.length > 0) {
    s.nextQueries.slice(0, 4).forEach(q => gaps.push(`Expand: ${q}`));
  }

  const css = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 11pt;
      color: #1a1a1a;
      background: #fff;
      line-height: 1.5;
    }
    .page {
      width: 100%;
      min-height: 100vh;
      padding: 1.4in 1.1in;
      page-break-after: always;
      position: relative;
    }
    .page:last-child { page-break-after: auto; }

    /* Cover page */
    .cover {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 100vh;
      padding: 1.4in 1.1in;
    }
    .cover-top { border-bottom: 2px solid #1a1a1a; padding-bottom: 20px; margin-bottom: 40px; }
    .atlas-logo {
      font-family: 'Courier New', monospace;
      font-size: 9pt;
      letter-spacing: 0.35em;
      color: #666;
      text-transform: uppercase;
    }
    .atlas-logo span { color: #c00; font-weight: bold; }
    .cover-title {
      font-size: 28pt;
      font-weight: bold;
      letter-spacing: -0.02em;
      color: #111;
      line-height: 1.15;
      margin: 60px 0 30px;
      max-width: 5.5in;
    }
    .cover-meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px 40px;
      border-top: 1px solid #e0e0e0;
      padding-top: 24px;
      margin-top: 40px;
    }
    .meta-item { }
    .meta-label {
      font-family: 'Courier New', monospace;
      font-size: 7pt;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: #888;
      margin-bottom: 3px;
    }
    .meta-value {
      font-size: 11pt;
      font-weight: 600;
      color: #222;
    }
    .classification-band {
      display: inline-block;
      background: #c00;
      color: #fff;
      font-family: 'Courier New', monospace;
      font-size: 8pt;
      letter-spacing: 0.25em;
      text-transform: uppercase;
      padding: 5px 14px;
      margin-bottom: 16px;
    }
    .cover-footer {
      border-top: 1px solid #e0e0e0;
      padding-top: 16px;
      font-family: 'Courier New', monospace;
      font-size: 7.5pt;
      color: #aaa;
      letter-spacing: 0.15em;
      text-transform: uppercase;
    }

    /* Section pages */
    .section-header {
      border-bottom: 2px solid #1a1a1a;
      margin-bottom: 28px;
      padding-bottom: 10px;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
    }
    .section-number {
      font-family: 'Courier New', monospace;
      font-size: 8pt;
      color: #999;
      letter-spacing: 0.2em;
      margin-bottom: 4px;
    }
    .section-title {
      font-size: 18pt;
      font-weight: bold;
      letter-spacing: -0.01em;
      color: #111;
    }
    .section-case-ref {
      font-family: 'Courier New', monospace;
      font-size: 7.5pt;
      color: #aaa;
      letter-spacing: 0.15em;
    }

    /* Content blocks */
    .summary-text {
      font-size: 11.5pt;
      line-height: 1.7;
      color: #222;
      max-width: 5.5in;
      margin-bottom: 24px;
    }
    .key-finding {
      border-left: 3px solid #c00;
      padding: 12px 16px;
      background: #fafafa;
      margin: 24px 0;
    }
    .key-finding-label {
      font-family: 'Courier New', monospace;
      font-size: 7pt;
      letter-spacing: 0.2em;
      color: #c00;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .key-finding-text { font-size: 11pt; font-weight: 600; color: #111; }

    /* Actor tables */
    .actor-group-label {
      font-family: 'Courier New', monospace;
      font-size: 7.5pt;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: #888;
      margin: 24px 0 10px;
      border-bottom: 1px solid #e8e8e8;
      padding-bottom: 5px;
    }
    .actor-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 7px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .actor-name { font-weight: 600; font-size: 11pt; color: #111; }
    .actor-meta { font-family: 'Courier New', monospace; font-size: 8pt; color: #999; }

    /* Findings */
    .finding-item {
      padding: 10px 0;
      border-bottom: 1px solid #f0f0f0;
      display: flex;
      gap: 12px;
    }
    .finding-bullet { color: #c00; font-size: 14pt; line-height: 1.2; flex-shrink: 0; }
    .finding-text { font-size: 11pt; line-height: 1.5; }

    /* Financial flows */
    .flow-row {
      padding: 12px;
      border: 1px solid #e8e8e8;
      margin-bottom: 10px;
      background: #fafafa;
    }
    .flow-entity { font-weight: 600; font-size: 11pt; }
    .flow-arrow { color: #c00; font-size: 11pt; margin: 0 8px; }
    .flow-context { font-size: 9.5pt; color: #555; margin-top: 5px; line-height: 1.4; }
    .flow-meta {
      font-family: 'Courier New', monospace;
      font-size: 7.5pt;
      color: #999;
      margin-top: 5px;
      letter-spacing: 0.1em;
    }

    /* Evidence / sources */
    .evidence-row {
      padding: 10px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .evidence-title { font-weight: 600; font-size: 10.5pt; color: #111; margin-bottom: 3px; }
    .evidence-source { font-family: 'Courier New', monospace; font-size: 8pt; color: #888; }

    /* Timeline */
    .timeline-row {
      display: flex;
      gap: 24px;
      padding: 9px 0;
      border-bottom: 1px solid #f0f0f0;
      align-items: baseline;
    }
    .timeline-date { font-family: 'Courier New', monospace; font-size: 9pt; color: #c00; flex-shrink: 0; min-width: 1in; }
    .timeline-event { font-size: 10.5pt; color: #222; }

    /* Gaps */
    .gap-row {
      padding: 9px 0 9px 16px;
      border-left: 3px solid #e0e0e0;
      margin-bottom: 8px;
      font-size: 10.5pt;
      color: #444;
    }

    /* Confidence indicator */
    .confidence-row {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
    }
    .confidence-bar {
      width: 80px;
      height: 4px;
      background: #e8e8e8;
      position: relative;
    }
    .confidence-bar-fill { height: 100%; background: #c00; }
    .confidence-label { font-family: 'Courier New', monospace; font-size: 8pt; color: #555; }

    .empty-note {
      font-family: 'Courier New', monospace;
      font-size: 9pt;
      color: #bbb;
      letter-spacing: 0.1em;
      padding: 20px 0;
      text-transform: uppercase;
    }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { padding: 0.9in 1in; }
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
  <div>
    <div class="cover-top">
      <div class="atlas-logo"><span>ATLAS</span> / RSR INVESTIGATIVE INTELLIGENCE</div>
    </div>
    <div class="classification-band">${escapeHtml(classification)}</div>
    <div class="cover-title">${escapeHtml(caseTitle)}</div>
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
        <div class="meta-label">Generated At</div>
        <div class="meta-value">${escapeHtml(timeStr)}</div>
      </div>
      <div class="meta-item" style="grid-column: span 2">
        <div class="meta-label">Intelligence Confidence</div>
        <div class="meta-value" style="font-size:10pt">${escapeHtml(confidence)}</div>
        <div class="confidence-row">
          <div class="confidence-bar"><div class="confidence-bar-fill" style="width:${confidenceBarWidth}%"></div></div>
          <span class="confidence-label">${confidenceBarWidth}%</span>
        </div>
      </div>
    </div>
  </div>
  <div class="cover-footer">
    ATLAS-CORE AUTOMATED INTELLIGENCE REPORT &nbsp;·&nbsp; RSR // ATLAS PLATFORM &nbsp;·&nbsp; FOR AUTHORIZED USE ONLY
  </div>
</div>

<!-- PAGE 2: EXECUTIVE SUMMARY -->
<div class="page">
  <div class="section-number">SECTION 01</div>
  <div class="section-header">
    <div class="section-title">Executive Summary</div>
    <div class="section-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
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
  <div class="section-number">SECTION 02</div>
  <div class="section-header">
    <div class="section-title">Primary Actors</div>
    <div class="section-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
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
  <div class="section-number">SECTION 03</div>
  <div class="section-header">
    <div class="section-title">Key Findings</div>
    <div class="section-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
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
          const parts: string[] = [];
          if (angles.length > 0) {
            parts.push(escapeHtml(angles[0].angle));
          }
          if (flows.length > 0) {
            parts.push(`Financial signals involving ${escapeHtml(flows[0].entityName)} indicate potential resource flows warranting further investigation.`);
          }
          if (persons.length > 0 && orgs.length > 0) {
            parts.push(`${persons.length} individual${persons.length !== 1 ? "s" : ""} and ${orgs.length} organization${orgs.length !== 1 ? "s" : ""} have been confirmed across ${documents.length} source${documents.length !== 1 ? "s" : ""}.`);
          }
          if (parts.length === 0) {
            parts.push(`This case involves ${entities.length} confirmed ${entities.length === 1 ? "entity" : "entities"} across ${documents.length} source document${documents.length !== 1 ? "s" : ""}. Further sourcing is required to establish significance.`);
          }
          return parts.slice(0, 2).join(" ");
        })()}
      </div>
    </div>
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
  <div class="section-number">SECTION 04</div>
  <div class="section-header">
    <div class="section-title">Financial Flows</div>
    <div class="section-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
  </div>
  ${flows.length > 0 ? flows.map(f => `
    <div class="flow-row">
      <div>
        <span class="flow-entity">${escapeHtml(f.entityName)}</span>
        ${f.amount ? `<span class="flow-arrow">·</span><span style="font-weight:600;color:#c00">${escapeHtml(f.amount)}</span>` : ""}
      </div>
      <div class="flow-context">${escapeHtml(f.context)}</div>
      ${f.confidence !== undefined ? `<div class="flow-meta">CONFIDENCE: ${Math.round((f.confidence ?? 0) * 100)}%</div>` : ""}
    </div>
  `).join("") : `<div class="empty-note">No financial signals detected. Ingest documents containing budgets, contracts, or funding agreements.</div>`}
</div>

<!-- PAGE 6: EVIDENCE -->
<div class="page">
  <div class="section-number">SECTION 05</div>
  <div class="section-header">
    <div class="section-title">Source Evidence</div>
    <div class="section-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
  </div>
  ${topDocs.length > 0 ? topDocs.map((d, i) => `
    <div class="evidence-row">
      <div class="evidence-title">${escapeHtml(d.title)}</div>
      <div class="evidence-source">
        ${d.source ? escapeHtml(d.source) + " &nbsp;·&nbsp; " : ""}
        ${d.signalScore !== null && d.signalScore !== undefined ? `Signal: ${Math.round((d.signalScore ?? 0) * 100)}%` : ""}
        &nbsp;·&nbsp; Doc ${i + 1} of ${topDocs.length}
      </div>
    </div>
  `).join("") : `<div class="empty-note">No source documents ingested.</div>`}
</div>

<!-- PAGE 7: TIMELINE -->
<div class="page">
  <div class="section-number">SECTION 06</div>
  <div class="section-header">
    <div class="section-title">Timeline</div>
    <div class="section-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
  </div>
  ${timeline.length > 0 ? timeline.map(t => `
    <div class="timeline-row">
      <span class="timeline-date">${t.date ? escapeHtml(t.date.slice(0, 10)) : "UNDATED"}</span>
      <span class="timeline-event">${escapeHtml(t.title)}</span>
    </div>
  `).join("") : `<div class="empty-note">No timeline events mapped. Ingest chronological source material.</div>`}
</div>

<!-- PAGE 8: INTELLIGENCE GAPS -->
<div class="page">
  <div class="section-number">SECTION 07</div>
  <div class="section-header">
    <div class="section-title">Intelligence Gaps</div>
    <div class="section-case-ref">CASE-${String(caseId).padStart(6, "0")}</div>
  </div>
  <div style="margin-bottom:20px;font-size:10.5pt;color:#555">
    The following areas require additional sourcing or verification before conclusions can be drawn.
  </div>
  ${gaps.length > 0 ? gaps.map(g => `
    <div class="gap-row">${escapeHtml(g)}</div>
  `).join("") : `<div style="font-size:10.5pt;color:#555;padding:12px 0">All major intelligence requirements satisfied at current confidence level.</div>`}
  <div style="margin-top:48px;border-top:1px solid #e0e0e0;padding-top:16px">
    <div style="font-family:'Courier New',monospace;font-size:7.5pt;color:#aaa;letter-spacing:0.15em;text-transform:uppercase">
      ATLAS-CORE AUTOMATED INTELLIGENCE REPORT &nbsp;·&nbsp; GENERATED ${escapeHtml(dateStr.toUpperCase())} AT ${escapeHtml(timeStr)} &nbsp;·&nbsp; CASE-${String(caseId).padStart(6, "0")} &nbsp;·&nbsp; FOR AUTHORIZED USE ONLY
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
