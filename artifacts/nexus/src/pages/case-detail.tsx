import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import {
  useGetCaseSummary,
  useListEntityMentions,
  Entity,
  Relationship,
  Document,
  TimelineEntry,
  Note,
  MoneyFlow,
} from "@workspace/api-client-react";
import {
  LayoutGrid,
  GitBranch,
  Database,
  Files,
  Clock,
  TrendingUp,
  Terminal,
  ArrowLeft,
  AlertTriangle,
  ScanLine,
  CheckCircle2,
  Upload,
  ChevronRight,
  Search,
  Globe,
  BookOpen,
  Copy,
  ExternalLink,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { openPrintDossier } from "@/lib/dossier-print";

import GraphCanvas, { LinkIntelPanel, EntityIntelPanel, SuggestedEdge } from "./case-tabs/graph-view";
import EntitiesTab from "./case-tabs/entities-tab";
import DocumentsTab, { DocumentInspector, DocumentViewer } from "./case-tabs/documents-tab";
import TimelineTab from "./case-tabs/timeline-tab";
import NotesTab from "./case-tabs/notes-tab";
import WebIngestTab from "./case-tabs/web-ingest-tab";

const SECTIONS = [
  { id: "overview", label: "OVERVIEW", icon: LayoutGrid },
  { id: "dossier", label: "DOSSIER", icon: BookOpen },
  { id: "graph", label: "LINK ANALYSIS", icon: GitBranch },
  { id: "entities", label: "ENTITY REGISTRY", icon: Database },
  { id: "documents", label: "DOCUMENT VAULT", icon: Files },
  { id: "web-ingest", label: "WEB INGEST", icon: Globe },
  { id: "timeline", label: "TEMPORAL TRACE", icon: Clock },
  { id: "flows", label: "FLOW TRACE", icon: TrendingUp },
  { id: "notes", label: "ANALYST", icon: Terminal },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const STATUS_COLORS = {
  open: "text-blue-400",
  active: "text-red-500",
  closed: "text-neutral-500",
  archived: "text-amber-500",
};
const STATUS_DOT = {
  open: "bg-blue-500",
  active: "bg-red-500 animate-pulse",
  closed: "bg-neutral-600",
  archived: "bg-amber-500",
};

export default function CaseDetail() {
  const { id } = useParams();
  const caseId = parseInt(id || "0", 10);
  const { data: summary, isLoading } = useGetCaseSummary(caseId);
  const [activeSection, setActiveSection] = useState<SectionId>("graph");
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [selectedRelId, setSelectedRelId] = useState<number | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [viewingDocId, setViewingDocId] = useState<number | null>(null);
  const [expansionQuery, setExpansionQuery] = useState<string | null>(null);
  const [showSuggested, setShowSuggested] = useState(true);
  const [hiddenEntityIds, setHiddenEntityIds] = useState<Set<number>>(new Set());

  const { data: approvedMentions = [] } = useListEntityMentions({
    caseId,
    status: "approved",
  });

  const handleSectionChange = useCallback((section: SectionId) => {
    setActiveSection(section);
    if (section !== "graph") {
      setSelectedEntityId(null);
      setSelectedRelId(null);
    }
    if (section !== "documents") {
      setSelectedDocId(null);
      setViewingDocId(null);
    }
  }, []);

  const handleEntitySelect = useCallback((id: number | null) => {
    setSelectedEntityId(id);
    setSelectedRelId(null);
  }, []);

  const handleRelSelect = useCallback((id: number | null) => {
    setSelectedRelId(id);
    setSelectedEntityId(null);
  }, []);

  // Auto-open a document that was requested via sessionStorage (e.g. from global vault page)
  useEffect(() => {
    if (!summary) return;
    const pending = sessionStorage.getItem("atlas_pending_doc");
    if (!pending) return;
    const docId = parseInt(pending, 10);
    if (!docId) return;
    sessionStorage.removeItem("atlas_pending_doc");
    const doc = summary.documents.find((d) => d.id === docId);
    if (doc) {
      setActiveSection("documents");
      setViewingDocId(docId);
      setSelectedDocId(docId);
    }
  }, [summary]);

  // Auto-prefill WEB INGEST from expansion suggestion (triggered via entity dossier page)
  useEffect(() => {
    if (!summary) return;
    const query = sessionStorage.getItem("atlas_expansion_query");
    if (!query) return;
    sessionStorage.removeItem("atlas_expansion_query");
    setExpansionQuery(query);
    setActiveSection("web-ingest");
  }, [summary]);

  if (isLoading)
    return (
      <div className="p-8 text-red-500 font-mono animate-pulse text-xs uppercase tracking-widest">
        DECRYPTING FILE...
      </div>
    );
  if (!summary)
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6">
        <div className="border border-amber-500/25 bg-amber-500/[0.03] px-8 py-8 max-w-md w-full mx-4 text-center space-y-4">
          <div className="font-mono text-[10px] text-amber-500 uppercase tracking-[0.25em] mb-2">ATLAS // FILE ACCESS ERROR</div>
          <div className="font-mono text-[22px] font-bold text-white uppercase tracking-tight">CASE NOT FOUND</div>
          <div className="font-mono text-[9px] text-neutral-600 leading-relaxed">
            FILE ID {caseId ? `CASE-${String(caseId).padStart(6,"0")}` : "UNKNOWN"} DOES NOT EXIST OR HAS BEEN PURGED FROM THE SYSTEM.
          </div>
          <div className="flex flex-col gap-2 mt-4">
            <a href="/" className="w-full py-2 border border-red-500/40 bg-red-500/[0.05] text-red-400 font-mono text-[9px] uppercase tracking-widest hover:bg-red-500/[0.10] transition-colors flex items-center justify-center gap-2">
              ← RETURN TO DOSSIER REGISTRY
            </a>
            <a href="/triage" className="w-full py-2 border border-amber-500/20 text-amber-600 font-mono text-[9px] uppercase tracking-widest hover:bg-amber-500/[0.05] transition-colors flex items-center justify-center gap-2">
              OPEN TRIAGE QUEUE
            </a>
          </div>
        </div>
      </div>
    );

  const {
    case: caseData,
    entities,
    documents,
    timeline,
    notes,
    relationships,
    moneyFlows,
    financialSignals,
    pendingMentions,
  } = summary as typeof summary & { financialSignals?: any[] };

  const selectedEntity = entities.find((e) => e.id === selectedEntityId) || null;
  const selectedRel = relationships.find((r) => r.id === selectedRelId) || null;
  const selectedDoc = documents.find((d) => d.id === selectedDocId) || null;
  const viewingDoc = documents.find((d) => d.id === viewingDocId) || null;


  const statusColor =
    STATUS_COLORS[caseData.status as keyof typeof STATUS_COLORS] ?? STATUS_COLORS.open;
  const statusDot =
    STATUS_DOT[caseData.status as keyof typeof STATUS_DOT] ?? STATUS_DOT.open;

  return (
    <CaseDetailInner
      caseId={caseId}
      caseData={caseData}
      entities={entities}
      hiddenEntityIds={hiddenEntityIds}
      documents={documents}
      timeline={timeline}
      notes={notes}
      relationships={relationships}
      moneyFlows={moneyFlows}
      financialSignals={financialSignals ?? []}
      pendingMentions={pendingMentions as number}
      approvedMentions={approvedMentions}
      activeSection={activeSection}
      selectedEntityId={selectedEntityId}
      selectedRelId={selectedRelId}
      selectedDocId={selectedDocId}
      viewingDocId={viewingDocId}
      selectedEntity={selectedEntity}
      selectedRel={selectedRel}
      selectedDoc={selectedDoc}
      viewingDoc={viewingDoc}
      statusColor={statusColor}
      statusDot={statusDot}
      showSuggested={showSuggested}
      onToggleSuggested={setShowSuggested}
      onRemoveFromGraph={(id) => setHiddenEntityIds(prev => { const next = new Set(prev); next.add(id); return next; })}
      onSectionChange={handleSectionChange}
      onEntitySelect={handleEntitySelect}
      onRelSelect={handleRelSelect}
      onDocSelect={(doc) => setSelectedDocId(doc ? doc.id : null)}
      onViewDoc={(doc) => { setViewingDocId(doc ? doc.id : null); if (doc) setSelectedDocId(doc.id); }}
      onEntityClose={() => setSelectedEntityId(null)}
      onRelClose={() => setSelectedRelId(null)}
      onDocClose={() => setSelectedDocId(null)}
      onOpenWebIngest={(query) => {
        setExpansionQuery(query);
        handleSectionChange("web-ingest");
      }}
      expansionQuery={expansionQuery}
    />
  );
}

// ─── Workflow Pipeline Strip ──────────────────────────────────────────────────

type StepStatus = "done" | "active" | "pending";
interface WorkflowStep { id: string; label: string; status: StepStatus }

function WorkflowStrip({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div className="atlas-workflow-strip flex-shrink-0">
      {steps.map((step, i) => (
        <React.Fragment key={step.id}>
          <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-0.5 font-mono text-[7.5px] uppercase tracking-[0.14em] whitespace-nowrap",
            step.status === "done"    && "text-green-600/70",
            step.status === "active"  && "text-cyan-400",
            step.status === "pending" && "text-neutral-800",
          )}>
            {step.status === "done" && (
              <CheckCircle2 className="w-2 h-2 flex-shrink-0" />
            )}
            {step.status === "active" && (
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0 animate-pulse" style={{ boxShadow: "0 0 4px rgba(34,211,238,0.6)" }} />
            )}
            {step.status === "pending" && (
              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.1)" }} />
            )}
            {step.label}
          </div>
          {i < steps.length - 1 && (
            <span className="font-mono text-[7px] flex-shrink-0" style={{ color: "rgba(255,255,255,0.08)" }}>›</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Inner Component ──────────────────────────────────────────────────────────

function CaseDetailInner({
  caseId,
  caseData,
  entities,
  hiddenEntityIds,
  documents,
  timeline,
  notes,
  relationships,
  moneyFlows,
  financialSignals,
  pendingMentions,
  approvedMentions,
  activeSection,
  selectedEntityId,
  selectedRelId,
  selectedDocId,
  viewingDocId,
  selectedEntity,
  selectedRel,
  selectedDoc,
  viewingDoc,
  statusColor,
  statusDot,
  showSuggested,
  onToggleSuggested,
  onRemoveFromGraph,
  onSectionChange,
  onEntitySelect,
  onRelSelect,
  onDocSelect,
  onViewDoc,
  onEntityClose,
  onRelClose,
  onDocClose,
  onOpenWebIngest,
  expansionQuery,
}: {
  caseId: number;
  caseData: { id: number; title: string; description?: string | null; tags?: string[] | null; status: string; createdAt: string };
  entities: Entity[];
  hiddenEntityIds: Set<number>;
  documents: Document[];
  timeline: TimelineEntry[];
  notes: Note[];
  relationships: Relationship[];
  moneyFlows: MoneyFlow[];
  financialSignals: any[];
  pendingMentions: number;
  approvedMentions: { id: number; documentId: number; entityName: string; entityType: string; confidence: number; status: string }[];
  activeSection: SectionId;
  selectedEntityId: number | null;
  selectedRelId: number | null;
  selectedDocId: number | null;
  viewingDocId: number | null;
  selectedEntity: Entity | null;
  selectedRel: Relationship | null;
  selectedDoc: Document | null;
  viewingDoc: Document | null;
  statusColor: string;
  statusDot: string;
  showSuggested: boolean;
  onToggleSuggested: (v: boolean) => void;
  onRemoveFromGraph: (entityId: number) => void;
  onSectionChange: (s: SectionId) => void;
  onEntitySelect: (id: number | null) => void;
  onRelSelect: (id: number | null) => void;
  onDocSelect: (doc: Document | null) => void;
  onViewDoc: (doc: Document | null) => void;
  onEntityClose: () => void;
  onRelClose: () => void;
  onDocClose: () => void;
  onOpenWebIngest: (query: string) => void;
  expansionQuery: string | null;
}) {
  // Client-side graph visibility filter
  const visibleEntities = useMemo(
    () => entities.filter((e) => !hiddenEntityIds.has(e.id)),
    [entities, hiddenEntityIds]
  );

  const suggestedEdges = useMemo((): SuggestedEdge[] => {
    if (approvedMentions.length < 2 || entities.length < 2) return [];

    const byDoc: Record<number, string[]> = {};
    approvedMentions.forEach((m) => {
      if (!byDoc[m.documentId]) byDoc[m.documentId] = [];
      if (!byDoc[m.documentId].includes(m.entityName)) {
        byDoc[m.documentId].push(m.entityName);
      }
    });

    const confirmedPairs = new Set(
      relationships.map(
        (r) => `${Math.min(r.entityAId, r.entityBId)}-${Math.max(r.entityAId, r.entityBId)}`
      )
    );

    // Aggregate by entity pair across all docs to compute a score
    const pairData = new Map<string, { entityAId: number; entityBId: number; docCount: number; docTitle?: string }>();

    Object.entries(byDoc).forEach(([docIdStr, entityNames]) => {
      const docId = parseInt(docIdStr);
      const docTitle = documents.find((d) => d.id === docId)?.title;

      const entityIds = entityNames
        .map((name) =>
          entities.find((e) => e.name.toLowerCase() === name.toLowerCase())?.id
        )
        .filter((id): id is number => id !== undefined);

      for (let i = 0; i < entityIds.length; i++) {
        for (let j = i + 1; j < entityIds.length; j++) {
          const a = entityIds[i];
          const b = entityIds[j];
          const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
          if (!confirmedPairs.has(key)) {
            const existing = pairData.get(key);
            if (existing) {
              existing.docCount++;
            } else {
              pairData.set(key, { entityAId: a, entityBId: b, docCount: 1, docTitle });
            }
          }
        }
      }
    });

    // Type compatibility bonus: graduated values based on investigative relevance
    // Institutional cross-links (person↔agency, org↔agency) are highest value
    const typeCompatibilityBonus = (typeA: string, typeB: string): number => {
      const sorted = [typeA, typeB].sort().join("|");
      // Tier 1 — core investigative pairs (person linked to institution)
      if (sorted === "government_agency|person") return 2.0;
      if (sorted === "company|person") return 1.5;
      if (sorted === "organization|person") return 1.5;
      // Tier 2 — institutional pairs (two organizations)
      if (sorted === "company|government_agency") return 1.5;
      if (sorted === "government_agency|organization") return 1.0;
      if (sorted === "company|organization") return 1.0;
      // Tier 3 — same-type pairs (lower value without institutional anchor)
      if (sorted === "person|person") return -0.5; // slight penalty — person-person needs doc support
      if (sorted === "organization|organization") return 0.5;
      if (sorted === "company|company") return 0.5;
      return 0;
    };

    return Array.from(pairData.values()).map((p) => {
      const eA = entities.find((e) => e.id === p.entityAId);
      const eB = entities.find((e) => e.id === p.entityBId);
      const typeBonus = eA && eB ? typeCompatibilityBonus(eA.type, eB.type) : 0;
      const effectiveScore = p.docCount + typeBonus;
      return {
        entityAId: p.entityAId,
        entityBId: p.entityBId,
        documentTitle: p.docTitle,
        sharedDocCount: p.docCount,
        score: effectiveScore >= 3.5 ? "HIGH" : effectiveScore >= 2 ? "MEDIUM" : "LOW",
      };
    }).filter((e) => {
      // Suppress LOW pairs with only 1 shared doc for person-person (too noisy)
      const eA = entities.find(en => en.id === e.entityAId);
      const eB = entities.find(en => en.id === e.entityBId);
      if (e.score === "LOW" && e.sharedDocCount <= 1) {
        // Keep institutional links even at LOW, suppress person-person
        if (eA?.type === "person" && eB?.type === "person") return false;
      }
      return e.sharedDocCount >= 1;
    }).sort((a, b) => {
      const scoreOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return (scoreOrder[a.score ?? "LOW"] ?? 2) - (scoreOrder[b.score ?? "LOW"] ?? 2);
    });
  }, [approvedMentions, relationships, entities, documents]);

  const workflowSteps = useMemo((): WorkflowStep[] => {
    const hasDocuments = documents.length > 0;
    const hasAnalysis = (approvedMentions.length + pendingMentions) > 0;
    const hasPending = pendingMentions > 0;
    const hasEntities = entities.length > 0;
    const hasLinks = relationships.length > 0;
    const hasReview = notes.length > 0 || hasLinks;

    return [
      {
        id: "ingest",
        label: "INGEST",
        status: hasDocuments ? "done" : "active",
      },
      {
        id: "analyze",
        label: "ANALYZE",
        status: (hasAnalysis || hasEntities) ? "done" : hasDocuments ? "active" : "pending",
      },
      {
        id: "approve",
        label: "APPROVE",
        status: hasEntities ? "done" : hasPending ? "active" : "pending",
      },
      {
        id: "map",
        label: "MAP",
        status: hasLinks ? "done" : hasEntities ? "active" : "pending",
      },
      {
        id: "review",
        label: "REVIEW",
        status: hasReview ? "active" : "pending",
      },
    ];
  }, [documents, approvedMentions, pendingMentions, entities, relationships, notes]);

  const nextAction = useMemo(() => {
    if (documents.length === 0) {
      return {
        message: "Search the web or upload source documents to begin the investigation.",
        cta: "SEARCH THE WEB",
        navigate: "web-ingest" as SectionId,
        icon: Search,
        color: "border-cyan-500/20 bg-cyan-500/5 text-cyan-400",
      };
    }
    if (pendingMentions > 0) {
      return {
        message: `${pendingMentions} detected ${pendingMentions === 1 ? "entity" : "entities"} awaiting approval. Approve to populate the investigation graph.`,
        cta: "REVIEW DETECTIONS",
        navigate: "documents" as SectionId,
        icon: AlertTriangle,
        color: "border-orange-500/25 bg-orange-500/5 text-orange-400",
      };
    }
    if (entities.length === 0 && documents.length > 0) {
      return {
        message: "Analyze documents to extract entities and references.",
        cta: "ANALYZE DOCUMENTS",
        navigate: "documents" as SectionId,
        icon: ScanLine,
        color: "border-cyan-500/20 bg-cyan-500/5 text-cyan-400",
      };
    }
    if (entities.length > 0 && suggestedEdges.length > 0 && relationships.length === 0) {
      const highCount = suggestedEdges.filter((e) => e.score === "HIGH").length;
      const msg = highCount > 0
        ? `${highCount} high-confidence co-mention association${highCount !== 1 ? "s" : ""} detected. Review suggested links.`
        : `${suggestedEdges.length} co-mention association${suggestedEdges.length !== 1 ? "s" : ""} detected. Inspect entities and begin building confirmed relationships.`;
      return {
        message: msg,
        cta: "REVIEW CO-MENTIONS",
        navigate: "graph" as SectionId,
        icon: GitBranch,
        color: "border-cyan-500/20 bg-cyan-500/5 text-cyan-400",
      };
    }
    if (entities.length > 0 && relationships.length === 0 && notes.length === 0) {
      return {
        message: "Review graph nodes and begin building links or analyst notes.",
        cta: "OPEN LINK ANALYSIS",
        navigate: "graph" as SectionId,
        icon: GitBranch,
        color: "border-cyan-500/20 bg-cyan-500/5 text-cyan-400",
      };
    }
    if (entities.length > 0 && documents.length > 0) {
      return {
        message: `${entities.length} entities confirmed across ${documents.length} source${documents.length !== 1 ? "s" : ""}. Generate the intelligence dossier to produce a final report.`,
        cta: "GENERATE DOSSIER",
        navigate: "overview" as SectionId,
        icon: BookOpen,
        color: "border-violet-500/20 bg-violet-500/5 text-violet-400",
      };
    }
    return null;
  }, [documents, pendingMentions, entities, relationships, notes, suggestedEdges]);

  const centerLabel = viewingDoc
    ? `VIEWING: ${viewingDoc.title}`
    : SECTIONS.find((s) => s.id === activeSection)?.label;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ──────── LEFT RAIL ──────── */}
      <aside className="w-48 flex-shrink-0 flex flex-col border-r overflow-hidden" style={{ background: "var(--atlas-surface-0)", borderColor: "rgba(255,255,255,0.052)" }}>
        {/* Back link */}
        <div className="atlas-rail-back flex-shrink-0">
          <Link href="/">
            <button className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-widest transition-colors" style={{ color: "rgba(255,255,255,0.22)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.22)")}>
              <ArrowLeft className="w-2.5 h-2.5 flex-shrink-0" />
              CASE CONTROL
            </button>
          </Link>
        </div>

        {/* Case identity block */}
        <div className="atlas-case-block flex-shrink-0">
          <div className="font-mono text-[7px] uppercase tracking-[0.22em] mb-1.5" style={{ color: "rgba(220,38,38,0.6)" }}>
            CASE-{caseData.id.toString().padStart(6, "0")}
          </div>
          <div className="text-[11px] font-bold text-white uppercase leading-tight tracking-tight mb-2" style={{ letterSpacing: "0.03em" }}>
            {caseData.title}
          </div>
          <div className={`flex items-center gap-1.5 font-mono text-[9px] ${statusColor}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot}`} />
            {caseData.status.toUpperCase()}
          </div>
          <div className="font-mono text-[7px] mt-1.5 uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.18)" }}>
            INIT {formatDate(caseData.createdAt).split(",")[0]}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-1">
          <div className="atlas-nav-section-label">Modules</div>
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = activeSection === s.id;
            const hasBadge = s.id === "documents" && pendingMentions > 0;
            return (
              <button
                key={s.id}
                onClick={() => onSectionChange(s.id)}
                className={cn("atlas-nav-item", isActive && "active")}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                <span className="flex-1 truncate">{s.label}</span>
                {hasBadge && (
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0 animate-pulse" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Case stats footer */}
        <div className="flex-shrink-0 px-3.5 py-3 space-y-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(255,255,255,0.006)" }}>
          {[
            { label: "ENTITIES", val: entities.length },
            { label: "DOCS", val: documents.length },
            { label: "LINKS", val: relationships.length },
            { label: "EVENTS", val: timeline.length },
            ...(pendingMentions > 0
              ? [{ label: "PENDING", val: pendingMentions, warn: true }]
              : []),
          ].map((m) => (
            <div key={m.label} className="atlas-case-stat">
              <span className={cn("atlas-case-stat-label", (m as { warn?: boolean }).warn && "!text-amber-600/70")}>
                {m.label}
              </span>
              <span className={cn("atlas-case-stat-val", (m as { warn?: boolean }).warn && "warn")}>
                {m.val.toString().padStart(2, "0")}
              </span>
            </div>
          ))}
        </div>
      </aside>

      {/* ──────── CENTER CANVAS ──────── */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden" style={{ background: "#020408" }}>
        <div className="atlas-canvas-header flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-1 h-4 flex-shrink-0" style={{ background: "rgba(220,38,38,0.7)", boxShadow: "0 0 6px rgba(220,38,38,0.35)" }} />
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] truncate max-w-xs" style={{ color: "rgba(255,255,255,0.5)" }}>{centerLabel}</span>
          </div>
          {activeSection === "graph" && !viewingDoc && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[8px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.2)" }}>
                {entities.length}&nbsp;<span style={{ color: "rgba(255,255,255,0.1)" }}>NODES</span>
                &nbsp;·&nbsp;{relationships.length}&nbsp;<span style={{ color: "rgba(255,255,255,0.1)" }}>EDGES</span>
                {suggestedEdges.length > 0 && (
                  <span style={{ color: "rgba(6,182,212,0.45)" }}>
                    &nbsp;·&nbsp;{suggestedEdges.length} SUGGESTED
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        <WorkflowStrip steps={workflowSteps} />

        <div
          className={cn(
            "flex-1",
            activeSection === "graph" ? "overflow-hidden" : "overflow-auto"
          )}
        >
          {activeSection === "graph" && (
            <div className="h-full">
              <GraphCanvas
                entities={visibleEntities}
                relationships={relationships}
                caseId={caseId}
                selectedEntityId={selectedEntityId}
                selectedRelId={selectedRelId}
                onEntitySelect={onEntitySelect}
                onRelSelect={onRelSelect}
                suggestedEdges={suggestedEdges}
                documentCount={documents.length}
                showSuggested={showSuggested}
                onToggleSuggested={onToggleSuggested}
              />
            </div>
          )}

          {activeSection === "overview" && (
            <OverviewPanel
              caseId={caseId}
              caseData={caseData}
              entities={entities}
              documents={documents}
              timeline={timeline}
              moneyFlows={moneyFlows}
              financialSignals={financialSignals}
              onViewDocument={(doc) => {
                onSectionChange("documents");
                onViewDoc(doc);
              }}
            />
          )}

          {activeSection === "dossier" && (
            <DossierCenterTab caseId={caseId} caseTitle={caseData.title} />
          )}

          {activeSection === "entities" && (
            <div className="h-full">
              <EntitiesTab caseId={caseId} entities={entities} />
            </div>
          )}

          {activeSection === "documents" && (
            <div className="h-full">
              {viewingDoc ? (
                <DocumentViewer
                  doc={viewingDoc}
                  onBack={() => onViewDoc(null)}
                />
              ) : (
                <DocumentsTab
                  caseId={caseId}
                  documents={documents}
                  selectedDocId={selectedDocId}
                  onDocumentSelect={onDocSelect}
                  onViewDocument={onViewDoc}
                />
              )}
            </div>
          )}

          {activeSection === "web-ingest" && (
            <div className="h-full">
              <WebIngestTab caseId={caseId} initialQuery={expansionQuery ?? undefined} />
            </div>
          )}

          {activeSection === "timeline" && (
            <div className="h-full">
              <TimelineTab caseId={caseId} timeline={timeline} />
            </div>
          )}

          {activeSection === "flows" && (
            <FlowTracePanel moneyFlows={moneyFlows} financialSignals={financialSignals} />
          )}

          {activeSection === "notes" && (
            <div className="h-full p-4">
              <NotesTab caseId={caseId} notes={notes} />
            </div>
          )}
        </div>
      </main>

      {/* ──────── RIGHT INSPECTOR ──────── */}
      <aside className="w-64 flex-shrink-0 hidden lg:flex flex-col overflow-hidden" style={{ background: "var(--atlas-surface-0)", borderLeft: "1px solid rgba(255,255,255,0.052)" }}>
        {activeSection === "graph" && selectedRel && (
          <LinkIntelPanel
            relationship={selectedRel}
            caseId={caseId}
            onClose={onRelClose}
            onHideAllSuggested={() => onToggleSuggested(false)}
          />
        )}
        {activeSection === "graph" && selectedEntity && !selectedRel && (
          <EntityIntelPanel
            entity={selectedEntity}
            relationships={relationships}
            caseId={caseId}
            onClose={onEntityClose}
            onOpenWebIngest={(query) => {
              onOpenWebIngest(query);
              onEntityClose();
            }}
            onRemoveFromGraph={onRemoveFromGraph}
          />
        )}
        {activeSection === "documents" && selectedDoc && (
          <DocumentInspector
            doc={selectedDoc}
            caseId={caseId}
            onClose={onDocClose}
            onView={() => onViewDoc(selectedDoc)}
          />
        )}
        {!(activeSection === "graph" && (selectedRel || selectedEntity)) &&
          !(activeSection === "documents" && selectedDoc) && (
          <DefaultInspector
            caseId={caseId}
            caseData={caseData}
            entities={entities}
            documents={documents}
            notes={notes}
            pendingMentions={pendingMentions}
            nextAction={nextAction}
            onNavigate={onSectionChange}
            financialSignalCount={financialSignals?.length ?? 0}
            timelineCount={timeline?.length ?? 0}
            relationshipCount={relationships?.length ?? 0}
          />
        )}
      </aside>
    </div>
  );
}

// ─── Seed Diagnostics ────────────────────────────────────────────────────────

interface SeedDiag {
  searched: number;
  total: number;
  ingested: number;
  ok: number;
  partial: number;
  failed: number;
  wrapper: number;
  noise: number;
  highContam: number;
  priorityA: number;
  priorityB: number;
  detected: number;
  admitted: number;
  rejectedFw: number;
  rejectReasons: Record<string, number>;
  promoted: number;
  promotedConfirmed: number;
  promotedStrong: number;
  heldCandidates: number;
  suppressedNoise: number;
  seedIntent: string;
  fallback: boolean;
  recoveryTriggered: boolean;
  recoveryReason: string;
  starterPromoted: number;
  finalPromoted: number;
  recoveryDocs: number;
  buildStatus: string;
  autoBuildQuality: "STRONG" | "PROVISIONAL" | "MODERATE" | "WEAK" | "FAILED" | "RECOVERED" | null;
  promotionCandidates: number;
  artifactRejected: number;
  shapeRejected: number;
  navRejected: number;
  mainEntityDocSupport: number;
  trustRating: string;
  nextQueries: string[];
  anchorCoreDocs: number;
  anchorRelevantDocs: number;
  strongRelationships: number;
  graphFailure: string;
}

const SEED_INTENT_LABELS: Record<string, string> = {
  housing_homelessness: "HOUSING",
  finance_funding: "FINANCE",
  education_university: "EDUCATION",
  crime_corruption: "CORRUPTION",
  legal_lawsuit: "LEGAL",
  entertainment_film: "FILM",
  policy_government: "GOVERNMENT",
  sports: "SPORTS",
  general: "GENERAL",
};

function parseSeedDiag(desc: string | null | undefined): SeedDiag | null {
  if (!desc) return null;
  const m = desc.match(/\[ATLAS-SEED:([^\]]+)\]/);
  if (!m) return null;
  const kv: Record<string, string> = {};
  m[1].split("|").forEach((p) => {
    const eq = p.indexOf("=");
    if (eq > 0) { kv[p.slice(0, eq)] = p.slice(eq + 1); }
  });
  const n = (k: string) => parseInt(kv[k] ?? "0", 10) || 0;
  const dec = (v?: string) => { try { return v ? decodeURIComponent(v) : ""; } catch { return v ?? ""; } };
  const nextQueriesRaw = dec(kv.next_queries);
  const rejectReasonsRaw = dec(kv.reject_reasons) || "";
  const rejectReasons: Record<string, number> = {};
  rejectReasonsRaw.split(",").filter(Boolean).forEach(pair => {
    const idx = pair.lastIndexOf(":");
    if (idx > 0) rejectReasons[pair.slice(0, idx)] = parseInt(pair.slice(idx + 1), 10) || 0;
  });
  const abq = kv["auto_build_quality"];
  return {
    searched: n("searched"),
    total: n("total"),
    ingested: n("ingested"),
    ok: n("ok"),
    partial: n("partial"),
    failed: n("failed"),
    wrapper: n("wrapper"),
    noise: n("noise"),
    highContam: n("high_contam"),
    priorityA: n("priority_a"),
    priorityB: n("priority_b"),
    detected: n("detected"),
    admitted: n("admitted"),
    rejectedFw: n("rejected_fw"),
    rejectReasons,
    promoted: n("promoted"),
    promotedConfirmed: n("promoted_confirmed"),
    promotedStrong: n("promoted_strong"),
    heldCandidates: n("held_candidates"),
    suppressedNoise: n("suppressed_noise"),
    seedIntent: kv["seed_intent"] || "general",
    fallback: kv["fallback"] === "1",
    recoveryTriggered: kv["recovery_triggered"] === "1",
    recoveryReason: dec(kv["recovery_reason"]) || "",
    starterPromoted: n("starter_promoted"),
    finalPromoted: n("final_promoted"),
    recoveryDocs: n("recovery_docs"),
    buildStatus: kv["build_status"] || "unknown",
    autoBuildQuality: (abq === "STRONG" || abq === "PROVISIONAL" || abq === "MODERATE" || abq === "WEAK" || abq === "FAILED" || abq === "RECOVERED") ? abq as SeedDiag["autoBuildQuality"] : null,
    promotionCandidates: n("promotion_candidates"),
    artifactRejected: n("artifact_rejected"),
    shapeRejected: n("shape_rejected"),
    navRejected: n("nav_rejected"),
    mainEntityDocSupport: n("main_entity_doc_support"),
    trustRating: dec(kv["trust"]) || "UNKNOWN",
    nextQueries: nextQueriesRaw ? nextQueriesRaw.split("||").filter(Boolean) : [],
    anchorCoreDocs: n("anchor_core_docs"),
    anchorRelevantDocs: n("anchor_relevant_docs"),
    strongRelationships: n("strong_relationships"),
    graphFailure: kv["graph_failure"] || "none",
  };
}

function cleanDescription(desc: string | null | undefined): string {
  if (!desc) return "";
  return desc.replace(/\[ATLAS-SEED:[^\]]+\]/, "").trim();
}

// Parse per-doc ATLAS-DIAG block from document rawText
function parseDocDiag(rawText: string | null | undefined): {
  status: string; chars: number; paras: number; strategy: string;
  finalUrl?: string; rssUrl?: string; srcUrl?: string;
  entities?: number; analysisRan?: boolean;
  score?: number; priority?: string; alignment?: string;
} | null {
  if (!rawText) return null;
  const m = rawText.match(/\[ATLAS-DIAG:([^\]]+)\]/);
  if (!m) return null;
  const kv: Record<string, string> = {};
  m[1].split("|").forEach((pair) => {
    const eqIdx = pair.indexOf("=");
    if (eqIdx > 0) kv[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
  });
  const dec = (v?: string) => { try { return v ? decodeURIComponent(v) : undefined; } catch { return v; } };
  return {
    status: kv.status || "failed",
    chars: parseInt(kv.chars || "0"),
    paras: parseInt(kv.paras || "0"),
    strategy: kv.strategy || "unknown",
    finalUrl: dec(kv.final_url),
    rssUrl: dec(kv.rss_url),
    srcUrl: dec(kv.src_url),
    entities: kv.entities !== undefined ? parseInt(kv.entities) : undefined,
    analysisRan: kv.analysis_ran !== undefined ? kv.analysis_ran === "1" : undefined,
    score: kv.score !== undefined ? parseInt(kv.score) : undefined,
    priority: kv.priority,
    alignment: kv.alignment,
  };
}

function SeedDiagnosticsCard({
  diag,
  documents,
  caseId,
  timelineCount,
  financialCount,
  usableDocCount,
  onRebuildComplete,
}: {
  diag: SeedDiag;
  documents: Document[];
  caseId?: number;
  timelineCount?: number;
  financialCount?: number;
  usableDocCount?: number;
  onRebuildComplete?: () => void;
}) {
  const [showDocs, setShowDocs] = React.useState(false);
  const [rebuildState, setRebuildState] = React.useState<"idle" | "running" | "done" | "error">("idle");
  const [rebuildResult, setRebuildResult] = React.useState<string | null>(null);

  const handleRebuild = async () => {
    if (!caseId || rebuildState === "running") return;
    setRebuildState("running");
    setRebuildResult(null);
    try {
      const r = await fetch(`/api/cases/${caseId}/backfill-signals`, { method: "POST" });
      const d = await r.json();
      if (r.ok) {
        setRebuildState("done");
        setRebuildResult(`+${d.timeline_added ?? 0} timeline · +${d.signals_added ?? 0} financial · ${d.docs_processed ?? 0} docs processed`);
        onRebuildComplete?.();
      } else {
        setRebuildState("error");
        setRebuildResult(d.error ?? "Backfill failed");
      }
    } catch (e) {
      setRebuildState("error");
      setRebuildResult(String(e));
    }
  };

  const usable = diag.ok + diag.partial;
  const blocked = diag.failed + diag.wrapper;

  // Status badge styling
  const statusStyle = (status: string) => {
    if (status === "ok") return "bg-[#002200] text-green-400 border border-green-900";
    if (status === "partial") return "bg-[#1a1000] text-amber-400 border border-amber-900";
    if (status === "wrapper") return "bg-[#200010] text-red-400 border border-red-900";
    return "bg-[#111] text-neutral-500 border border-neutral-800";
  };

  const intentLabel = SEED_INTENT_LABELS[diag.seedIntent] || diag.seedIntent.toUpperCase();

  let promotionNote: React.ReactNode = null;
  if (diag.promoted === 0 && diag.detected > 0) {
    promotionNote = (
      <div className="px-3 pb-3 text-[9px] font-mono text-amber-500 uppercase tracking-wide bg-[#1a0e00] border-t border-[#ff6b0015] py-2">
        ▲ NO ENTITIES PROMOTED — {diag.detected} signals detected but none passed confidence/blocklist checks. Review pending detections.
      </div>
    );
  } else if (diag.promoted === 0 && diag.detected === 0 && usable === 0) {
    promotionNote = (
      <div className="px-3 pb-3 text-[9px] font-mono text-neutral-600 uppercase tracking-wide bg-[#0a0a0a] border-t border-[#ffffff06] py-2">
        ✗ ALL SOURCES BLOCKED — No usable article text recovered. Add sources manually via Web Ingest.
      </div>
    );
  } else if (diag.fallback && diag.promoted > 0) {
    promotionNote = (
      <div className="px-3 py-2 text-[9px] font-mono text-amber-500/70 uppercase tracking-wide bg-[#100a00] border-t border-[#ffffff06]">
        ⚡ SEED FALLBACK — {diag.promoted} entity{diag.promoted !== 1 ? "s" : ""} promoted at T2_CANDIDATE threshold. Validate before relying on graph.
      </div>
    );
  }

  return (
    <div className="nexus-panel rounded-none lg:col-span-2 xl:col-span-3">
      <div className="nexus-header-strip flex items-center gap-2">
        <span className="nexus-label">SEED PIPELINE REPORT</span>
        {diag.seedIntent && diag.seedIntent !== "general" && (
          <span className="font-mono text-[8px] text-violet-400 border border-violet-900/40 bg-violet-500/5 px-1.5 py-0.5 uppercase tracking-widest">
            {intentLabel}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {caseId && (
            <button
              onClick={handleRebuild}
              disabled={rebuildState === "running"}
              title="Re-extract timeline events and financial signals from all ingested documents"
              className={cn(
                "font-mono text-[9px] uppercase tracking-wider border px-2 py-0.5 transition-colors",
                rebuildState === "running" ? "text-amber-500 border-amber-900/40 animate-pulse" :
                rebuildState === "done" ? "text-green-500 border-green-900/40" :
                rebuildState === "error" ? "text-red-500 border-red-900/40" :
                "text-neutral-500 hover:text-amber-300 border-[#ffffff10] hover:border-amber-900/40"
              )}
            >
              {rebuildState === "running" ? "REBUILDING..." :
               rebuildState === "done" ? "✓ REBUILT" :
               rebuildState === "error" ? "✗ FAILED" :
               "REBUILD SIGNALS"}
            </button>
          )}
          <button
            onClick={() => setShowDocs((v) => !v)}
            className="font-mono text-[9px] text-neutral-500 hover:text-white uppercase tracking-wider border border-[#ffffff10] px-2 py-0.5 transition-colors"
          >
            {showDocs ? "HIDE DOC LOG" : "SHOW DOC LOG"}
          </button>
        </div>
      </div>

      {/* Rebuild result message */}
      {rebuildResult && (
        <div className={cn(
          "px-3 py-1.5 font-mono text-[9px] uppercase border-b",
          rebuildState === "done" ? "text-green-400 bg-green-950/10 border-[#ffffff06]" : "text-red-400 bg-red-950/10 border-[#ffffff06]"
        )}>
          {rebuildResult}
        </div>
      )}

      {/* ── Summary stats grid ── */}
      <div className="p-3 grid grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {[
          { label: "Results", val: diag.total, color: "text-white" },
          { label: "Ingested", val: diag.ingested, color: "text-blue-400" },
          { label: "Usable", val: usable, color: usable > 0 ? "text-green-400" : "text-neutral-600" },
          { label: "Blocked", val: `${diag.wrapper}W·${diag.failed}F`, color: blocked > 0 ? "text-red-400" : "text-neutral-600" },
          { label: "Detected", val: diag.detected, color: diag.detected > 0 ? "text-amber-400" : "text-neutral-600" },
          { label: "Promoted", val: diag.promoted + (diag.fallback ? " ⚡" : ""), color: diag.promoted > 0 ? "text-green-300" : "text-neutral-600" },
          { label: "Timeline", val: timelineCount ?? "—", color: (timelineCount ?? 0) > 0 ? "text-cyan-400" : "text-neutral-600" },
          { label: "Financial", val: financialCount ?? "—", color: (financialCount ?? 0) > 0 ? "text-green-400" : "text-neutral-600" },
        ].map(({ label, val, color }) => (
          <div key={label} className="bg-[#0a0e14] border border-[#ffffff08] p-2">
            <div className="font-mono text-[8px] text-neutral-600 uppercase mb-0.5">{label}</div>
            <div className={cn("font-mono text-base font-bold tabular-nums", color)}>{val}</div>
          </div>
        ))}
      </div>

      {/* ── Tier breakdown row ── */}
      {(diag.promotedConfirmed > 0 || diag.promotedStrong > 0 || diag.heldCandidates > 0 || diag.suppressedNoise > 0) && (
        <div className="border-t border-[#ffffff06] px-3 py-2 flex items-center gap-4 flex-wrap">
          <span className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest">TRUST TIERS:</span>
          {diag.promotedConfirmed > 0 && (
            <span className="font-mono text-[9px] text-green-400 uppercase">{diag.promotedConfirmed} T1-CONFIRMED</span>
          )}
          {diag.promotedStrong > 0 && (
            <span className="font-mono text-[9px] text-cyan-400 uppercase">{diag.promotedStrong} T1b-STRONG</span>
          )}
          {diag.heldCandidates > 0 && (
            <span className="font-mono text-[9px] text-amber-500 uppercase">{diag.heldCandidates} CANDIDATES HELD</span>
          )}
          {diag.suppressedNoise > 0 && (
            <span className="font-mono text-[9px] text-neutral-600 uppercase">{diag.suppressedNoise} SUPPRESSED</span>
          )}
        </div>
      )}

      {/* ── Admission firewall row ── */}
      {(diag.admitted > 0 || diag.rejectedFw > 0) && (
        <div className="border-t border-[#ffffff06] px-3 py-2 flex items-center gap-4 flex-wrap">
          <span className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest">ADMISSION FW:</span>
          {diag.admitted > 0 && (
            <span className="font-mono text-[9px] text-green-500/80 uppercase">{diag.admitted} ADMITTED</span>
          )}
          {diag.rejectedFw > 0 && (
            <span className="font-mono text-[9px] text-red-500/70 uppercase">{diag.rejectedFw} BLOCKED</span>
          )}
          {Object.entries(diag.rejectReasons).filter(([, v]) => v > 0).slice(0, 4).map(([reason, count]) => (
            <span key={reason} className="font-mono text-[8px] text-neutral-700 uppercase">
              {count}× {reason.replace(/_/g, "-")}
            </span>
          ))}
        </div>
      )}

      {/* ── Relevance quality row ── */}
      {(diag.priorityA > 0 || diag.priorityB > 0 || diag.noise > 0) && (
        <div className="border-t border-[#ffffff06] px-3 py-2 flex items-center gap-4 flex-wrap">
          <span className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest">DOC QUALITY:</span>
          {diag.priorityA > 0 && <span className="font-mono text-[9px] text-green-400 uppercase">{diag.priorityA} PRIORITY-A</span>}
          {diag.priorityB > 0 && <span className="font-mono text-[9px] text-cyan-400 uppercase">{diag.priorityB} PRIORITY-B</span>}
          {diag.noise > 0 && <span className="font-mono text-[9px] text-neutral-600 uppercase">{diag.noise} NOISE SUPPRESSED</span>}
        </div>
      )}

      {promotionNote}

      {/* ── Per-doc pipeline log ── */}
      {showDocs && (
        <div className="border-t border-[#ffffff08]">
          <div className="px-3 py-1.5 font-mono text-[8px] text-neutral-600 uppercase tracking-widest bg-[#050709]">
            DOCUMENT PIPELINE LOG
          </div>
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-[10px]">
              <thead>
                <tr className="border-b border-[#ffffff08]">
                  <th className="text-left px-3 py-1.5 text-neutral-600 uppercase tracking-wider font-normal">Source</th>
                  <th className="text-center px-2 py-1.5 text-neutral-600 uppercase tracking-wider font-normal">Body</th>
                  <th className="text-center px-2 py-1.5 text-neutral-600 uppercase tracking-wider font-normal">Score</th>
                  <th className="text-center px-2 py-1.5 text-neutral-600 uppercase tracking-wider font-normal">Align</th>
                  <th className="text-right px-2 py-1.5 text-neutral-600 uppercase tracking-wider font-normal">Chars</th>
                  <th className="text-right px-2 py-1.5 text-neutral-600 uppercase tracking-wider font-normal">Ents</th>
                  <th className="text-center px-2 py-1.5 text-neutral-600 uppercase tracking-wider font-normal">URL</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const d = parseDocDiag(doc.rawText);
                  const urlMode = d?.rssUrl ? "REAL URL ✓" : "DIRECT";
                  const urlModeColor = d?.rssUrl ? "text-green-500" : "text-neutral-500";
                  const fetchedDomain = (() => {
                    try { return d?.finalUrl ? new URL(d.finalUrl).hostname.replace("www.", "") : (doc.sourceDomain || "—"); } catch { return doc.sourceDomain || "—"; }
                  })();
                  const priorityColor = d?.priority === "PRIORITY_A" ? "text-green-400" :
                    d?.priority === "PRIORITY_B" ? "text-cyan-400" :
                    d?.priority === "LOW_SIGNAL" ? "text-neutral-500" :
                    d?.priority === "NOISE" ? "text-red-800" : "text-neutral-700";
                  const priorityLabel = d?.priority === "PRIORITY_A" ? "A" :
                    d?.priority === "PRIORITY_B" ? "B" :
                    d?.priority === "LOW_SIGNAL" ? "L" :
                    d?.priority === "NOISE" ? "N" : "—";
                  return (
                    <tr key={doc.id} className="border-b border-[#ffffff04] hover:bg-[#ffffff03]">
                      <td className="px-3 py-2 text-white max-w-[200px]">
                        <div className="truncate">{doc.title.slice(0, 50)}</div>
                        <div className="text-[9px] text-neutral-600 truncate">{fetchedDomain}</div>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className={cn("px-1.5 py-0.5 text-[8px] uppercase", statusStyle(d?.status || "failed"))}>
                          {(d?.status || "?").toUpperCase()}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-center tabular-nums">
                        {d?.score !== undefined ? (
                          <span className={cn("font-bold", priorityColor)}>
                            {d.score}<span className="text-[8px] opacity-60 ml-0.5">{priorityLabel}</span>
                          </span>
                        ) : <span className="text-neutral-700">—</span>}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {d?.alignment ? (
                          <span className={cn("text-[8px] uppercase font-mono",
                            d.alignment === "aligned" ? "text-green-500" :
                            d.alignment === "partial" ? "text-cyan-600" :
                            d.alignment === "mismatched" ? "text-red-600" :
                            "text-neutral-700"
                          )}>
                            {d.alignment === "aligned" ? "✓" : d.alignment === "mismatched" ? "✗" : d.alignment === "partial" ? "~" : "?"}
                          </span>
                        ) : <span className="text-neutral-700">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-neutral-400">
                        {d ? d.chars.toLocaleString() : "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {d?.entities !== undefined
                          ? <span className={d.entities > 0 ? "text-amber-400" : "text-neutral-600"}>{d.entities}</span>
                          : d?.analysisRan === false
                            ? <span className="text-neutral-700">SKIP</span>
                            : <span className="text-neutral-700">—</span>}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className={cn("text-[9px] uppercase font-bold", urlModeColor)}>{urlMode}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* RSS vs Real URL proof for the first doc that has both */}
          {(() => {
            const firstWithRss = documents.find(d => parseDocDiag(d.rawText)?.rssUrl);
            if (!firstWithRss) return null;
            const d = parseDocDiag(firstWithRss.rawText)!;
            const rssShort = d.rssUrl?.slice(0, 60) + "…";
            const srcShort = d.srcUrl?.replace(/^https?:\/\//, "").slice(0, 60);
            return (
              <div className="border-t border-[#ffffff06] px-3 py-2 space-y-1 bg-[#050709]">
                <div className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest mb-1">URL RESOLUTION PROOF (sample doc)</div>
                <div className="font-mono text-[9px]">
                  <span className="text-neutral-600">RSS TOKEN → </span>
                  <span className="text-red-500/60 break-all">{rssShort}</span>
                </div>
                <div className="font-mono text-[9px]">
                  <span className="text-neutral-600">FETCHED → </span>
                  <span className="text-green-500 break-all">{srcShort || d.finalUrl?.replace(/^https?:\/\//, "").slice(0, 60)}</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── Overview Panel ──────────────────────────────────────────────────────────

function OverviewPanel({
  caseId,
  caseData,
  entities,
  documents,
  timeline,
  moneyFlows,
  financialSignals,
  onViewDocument,
}: {
  caseId: number;
  caseData: { title: string; description?: string | null; tags?: string[] | null; targetMode?: string | null; targetLabel?: string | null; autoGraphQuality?: string | null; relationshipCount?: number };
  entities: Entity[];
  documents: Document[];
  timeline: TimelineEntry[];
  moneyFlows: MoneyFlow[];
  financialSignals: any[];
  onViewDocument?: (doc: Document) => void;
}) {
  const queryClient = useQueryClient();
  const seedDiag = parseSeedDiag(caseData.description);
  const isAutoSeeded = caseData.tags?.includes("auto-seeded");

  const [actionState, setActionState] = React.useState<Record<string, "idle" | "running" | "done" | "error">>({});
  const setAction = (key: string, state: "idle" | "running" | "done" | "error") =>
    setActionState(prev => ({ ...prev, [key]: state }));

  const usableDocs = (documents as any[]).filter((d: any) => {
    const raw: string = d.rawText || "";
    const hasDiag = raw.includes("[ATLAS-DIAG:");
    if (!hasDiag) return raw.length > 100;
    return !raw.includes("status=failed") && !raw.includes("status=wrapper") &&
           !raw.includes("priority=NOISE");
  });

  const trustRating = seedDiag?.trustRating || (
    entities.length >= 3 && usableDocs.length >= 3 ? "STRONG BUILD" :
    entities.length >= 1 && usableDocs.length >= 1 ? "MODERATE BUILD" :
    usableDocs.length >= 1 ? "LOW CONFIDENCE" : "EMPTY CASE"
  );

  const nextQueries = seedDiag?.nextQueries?.length
    ? seedDiag.nextQueries
    : entities.slice(0, 2).filter(e => e.type !== "location").flatMap(e => [`${e.name} contracts`, `${e.name} audit`]);

  const targetMode = (caseData as any).targetMode as string | null | undefined;
  const autoGraphQuality = (caseData as any).autoGraphQuality as string | null | undefined;
  const relCount = (caseData as any).relationshipCount ?? 0;

  const TARGET_MODE_LABEL: Record<string, string> = {
    person_target: "PERSON OF INTEREST",
    organization_target: "ORGANIZATION",
    government_agency_target: "GOVT AGENCY",
    place_target: "LOCATION / PLACE",
    program_target: "PROGRAM / INITIATIVE",
    funding_target: "FUNDING TARGET",
    event_target: "EVENT / INCIDENT",
    scandal_target: "SCANDAL / INVESTIGATION",
    topic_investigation: "TOPIC INVESTIGATION",
    general: "GENERAL TARGET",
  };
  const TARGET_MODE_COLOR: Record<string, string> = {
    person_target: "text-amber-300 border-amber-900/40 bg-amber-500/5",
    organization_target: "text-cyan-300 border-cyan-900/40 bg-cyan-500/5",
    government_agency_target: "text-red-400 border-red-900/40 bg-red-500/5",
    place_target: "text-blue-300 border-blue-900/40 bg-blue-500/5",
    program_target: "text-violet-300 border-violet-900/40 bg-violet-500/5",
    funding_target: "text-green-300 border-green-900/40 bg-green-500/5",
    event_target: "text-orange-300 border-orange-900/40 bg-orange-500/5",
    scandal_target: "text-red-400 border-red-900/50 bg-red-500/8",
    topic_investigation: "text-violet-400 border-violet-900/40 bg-violet-500/5",
    general: "text-neutral-500 border-neutral-800 bg-transparent",
  };
  const GRAPH_QUALITY_COLOR: Record<string, string> = {
    STRONG: "text-green-400 border-green-900/40",
    PROVISIONAL: "text-cyan-400 border-cyan-900/40",
    RECOVERED: "text-amber-400 border-amber-900/40",
    MODERATE: "text-cyan-400 border-cyan-900/40",
    WEAK: "text-amber-600 border-amber-900/30",
    FAILED: "text-red-700 border-red-900/30",
  };

  const handleRecompile = async () => {
    setAction("recompile", "running");
    try {
      const r = await fetch(`/api/cases/${caseId}/compile`, { method: "POST" });
      const d = await r.json();
      setAction("recompile", d.ok ? "done" : "error");
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/brief`] });
    } catch { setAction("recompile", "error"); }
    setTimeout(() => setAction("recompile", "idle"), 3000);
  };

  const handleRebuildGraph = async () => {
    setAction("graph", "running");
    try {
      const r = await fetch(`/api/cases/${caseId}/rebuild-graph`, { method: "POST" });
      setAction("graph", r.ok ? "done" : "error");
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
    } catch { setAction("graph", "error"); }
    setTimeout(() => setAction("graph", "idle"), 3000);
  };

  const handleRunRecovery = async () => {
    setAction("recovery", "running");
    try {
      const r = await fetch(`/api/web-ingest/cases/${caseId}/seed/recovery`, { method: "POST" });
      setAction("recovery", r.ok ? "done" : "error");
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
    } catch { setAction("recovery", "error"); }
    setTimeout(() => setAction("recovery", "idle"), 3000);
  };

  const btnState = (key: string) => actionState[key] ?? "idle";
  const btnLabel = (key: string, idle: string, running: string) =>
    btnState(key) === "running" ? running :
    btnState(key) === "done" ? "✓ DONE" :
    btnState(key) === "error" ? "✗ ERROR" : idle;
  const btnCls = (key: string, baseClass: string) => cn(
    "atlas-btn transition-all",
    btnState(key) === "running" ? "text-amber-500 border-amber-900/40 animate-pulse cursor-not-allowed" :
    btnState(key) === "done" ? "text-green-500 border-green-900/40" :
    btnState(key) === "error" ? "text-red-500 border-red-900/40" :
    baseClass
  );

  return (
    <div className="p-3 space-y-3">

      {/* ── CASE HEALTH TILE GRID ── */}
      <div className="nexus-panel rounded-none">
        <div className="nexus-header-strip">
          <span className="nexus-label">CASE HEALTH</span>
          {targetMode && targetMode !== "general" && (
            <span className={cn("font-mono text-[8px] border px-2 py-0.5 uppercase tracking-widest",
              TARGET_MODE_COLOR[targetMode] || "text-neutral-500 border-neutral-800"
            )}>
              {TARGET_MODE_LABEL[targetMode] || targetMode.replace(/_/g, " ")}
            </span>
          )}
          {autoGraphQuality && (
            <span className={cn("font-mono text-[8px] border px-2 py-0.5 uppercase tracking-widest",
              GRAPH_QUALITY_COLOR[autoGraphQuality] || "text-neutral-500 border-neutral-800"
            )}>
              {autoGraphQuality} BUILD
            </span>
          )}
        </div>
        <div className="p-3 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
          {[
            { label: "SOURCES", val: documents.length, sub: `${usableDocs.length} usable`, color: "text-white" },
            { label: "ENTITIES", val: entities.length, sub: `${entities.filter(e=>e.type==="person").length} persons · ${entities.filter(e=>e.type!=="person"&&e.type!=="location").length} orgs`, color: "text-cyan-400" },
            { label: "GRAPH EDGES", val: relCount, sub: relCount > 0 ? "link analysis ready" : "no graph yet", color: relCount > 0 ? "text-violet-400" : "text-neutral-700" },
            { label: "TIMELINE", val: timeline.length, sub: timeline.length > 0 ? "events mapped" : "no events found", color: timeline.length > 0 ? "text-cyan-300" : "text-neutral-700" },
            { label: "FINANCIAL", val: financialSignals.length, sub: financialSignals.length > 0 ? "signals detected" : "none detected", color: financialSignals.length > 0 ? "text-green-400" : "text-neutral-700" },
          ].map(({ label, val, sub, color }) => (
            <div key={label} className="bg-[#080c12] border border-[#ffffff08] p-3 space-y-1">
              <div className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest">{label}</div>
              <div className={cn("font-mono text-3xl font-bold tabular-nums", color)}>{String(val).padStart(2, "0")}</div>
              <div className="font-mono text-[7px] text-neutral-600 uppercase">{sub}</div>
            </div>
          ))}
        </div>

        {/* ── RECOVERY MODE INDICATOR ── */}
        {entities.length === 0 && usableDocs.length > 0 && (
          <div className="mx-3 mb-2 px-3 py-2 border border-amber-900/30 bg-amber-950/5 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse flex-shrink-0" />
            <span className="font-mono text-[8px] text-amber-700 uppercase tracking-widest">
              RECOVERY MODE ACTIVE — entity extraction fallback engaged
            </span>
          </div>
        )}

        {/* ── ACTION BUTTONS ── */}
        <div className="border-t border-[#ffffff06] px-3 py-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest mr-1">ACTIONS</span>
          <button
            onClick={handleRecompile}
            disabled={btnState("recompile") === "running"}
            className={btnCls("recompile", "atlas-btn-red")}
          >
            {btnLabel("recompile", "RECOMPILE DOSSIER", "COMPILING...")}
          </button>
          <button
            onClick={handleRebuildGraph}
            disabled={btnState("graph") === "running"}
            className={btnCls("graph", "atlas-btn-cyan")}
          >
            {btnLabel("graph", "REBUILD GRAPH", "REBUILDING...")}
          </button>
          <button
            onClick={handleRunRecovery}
            disabled={btnState("recovery") === "running"}
            className={btnCls("recovery", "atlas-btn-amber")}
          >
            {btnLabel("recovery", "RUN RECOVERY", "RUNNING...")}
          </button>
        </div>
      </div>

      {/* ── TWO-COLUMN: PRIMARY ENTITIES + TOP EVIDENCE ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Primary entities */}
        <div className="nexus-panel rounded-none">
          <div className="atlas-section-header-accent">
            <span className="nexus-label">ENTITY REGISTRY ({entities.length})</span>
            {entities.length > 0 && <span className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest">{entities.filter(e => e.type === "person").length}P · {entities.filter(e => e.type === "organization").length}O · {entities.filter(e => e.type === "government_agency").length}G</span>}
          </div>
          <div className="p-0">
            {entities.length === 0 ? (
              <div className="atlas-empty-state">
                <Database className="atlas-empty-icon w-7 h-7" />
                <div className="atlas-empty-title">NO ENTITIES PROMOTED</div>
                {seedDiag && (
                  <div className="space-y-1.5 mt-2">
                    {seedDiag.heldCandidates > 0 && (
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle className="w-2.5 h-2.5 text-amber-700 flex-shrink-0 mt-0.5" />
                        <span className="font-mono text-[8px] text-amber-700/80">
                          {seedDiag.heldCandidates} candidate{seedDiag.heldCandidates > 1 ? "s" : ""} held — use triage to review
                        </span>
                      </div>
                    )}
                    {seedDiag.graphFailure === "no_entities_promoted" && seedDiag.detected === 0 && (
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle className="w-2.5 h-2.5 text-red-800 flex-shrink-0 mt-0.5" />
                        <span className="font-mono text-[8px] text-red-800/80">
                          No entity signals extracted — sources may be paywalled or content-light
                        </span>
                      </div>
                    )}
                    {seedDiag.graphFailure === "no_entities_promoted" && seedDiag.detected > 0 && (
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle className="w-2.5 h-2.5 text-red-800 flex-shrink-0 mt-0.5" />
                        <span className="font-mono text-[8px] text-red-800/80">
                          {seedDiag.detected} signals detected, none passed trust threshold — try recovery or add sources manually
                        </span>
                      </div>
                    )}
                    {(seedDiag.wrapper > 0 || seedDiag.failed > 0) && (
                      <div className="flex items-start gap-1.5">
                        <span className="w-2 h-2 text-neutral-700 flex-shrink-0 mt-0.5 font-mono text-[9px]">!</span>
                        <span className="font-mono text-[8px] text-neutral-700">
                          {seedDiag.wrapper} paywalled · {seedDiag.failed} failed extractions — ingest quality was low
                        </span>
                      </div>
                    )}
                    <div className="atlas-empty-badge">→ run recovery or add sources in web ingest</div>
                  </div>
                )}
                {!seedDiag && <div className="atlas-empty-sub">No entity signals found in ingested content</div>}
              </div>
            ) : (
              entities.filter(e => e.type !== "location").slice(0, 8).map((e) => (
                <div key={e.id} className="px-3 py-1.5 border-b border-[#ffffff04] flex items-center gap-2">
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                    e.type === "person" ? "bg-amber-400" :
                    e.type === "government_agency" ? "bg-red-500" :
                    e.type === "organization" ? "bg-cyan-500" : "bg-violet-500"
                  )} />
                  <span className="font-mono text-[9px] text-white uppercase truncate flex-1">{e.name}</span>
                  <span className={cn(
                    "font-mono text-[7px] border px-1 py-0.5 flex-shrink-0",
                    e.type === "person" ? "text-amber-400 border-amber-900/30" :
                    e.type === "government_agency" ? "text-red-400 border-red-900/30" :
                    "text-cyan-500 border-cyan-900/30"
                  )}>
                    {e.type.replace(/_/g, " ").toUpperCase()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Document vault preview */}
        <div className="nexus-panel rounded-none">
          <div className="atlas-section-header-cyan">
            <span className="nexus-label">EVIDENCE VAULT ({documents.length})</span>
            {documents.length > 0 && <span className="font-mono text-[7px] text-cyan-800 uppercase tracking-widest">{usableDocs.length} USABLE</span>}
          </div>
          <div className="p-0">
            {documents.length === 0 ? (
              <div className="atlas-empty-state">
                <Files className="atlas-empty-icon w-7 h-7" />
                <div className="atlas-empty-title">EVIDENCE VAULT EMPTY</div>
                <div className="atlas-empty-sub">Use web ingest or manual upload to add source documents</div>
                <div className="atlas-empty-badge">→ open web ingest to begin</div>
              </div>
            ) : (
              (documents as any[]).sort((a: any, b: any) => {
                const scoreA = (() => { const m = /score=(\d+)/.exec(a.rawText || ""); return m ? parseInt(m[1]) : 0; })();
                const scoreB = (() => { const m = /score=(\d+)/.exec(b.rawText || ""); return m ? parseInt(m[1]) : 0; })();
                return scoreB - scoreA;
              }).slice(0, 8).map((d: any) => {
                const diagM = /priority=([^\|]+)/.exec(d.rawText || "");
                const priority = diagM ? diagM[1].trim() : null;
                const isA = priority === "PRIORITY_A";
                return (
                  <div
                    key={d.id}
                    onClick={() => onViewDocument?.(d)}
                    className={cn(
                      "px-3 py-1.5 border-b border-[#ffffff04] flex items-center justify-between gap-2 transition-colors",
                      onViewDocument ? "cursor-pointer hover:bg-[#ffffff04] group" : ""
                    )}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {isA && <span className="w-1 h-1 rounded-full bg-red-500 flex-shrink-0" />}
                      <span className="font-mono text-[9px] text-neutral-300 truncate group-hover:text-white transition-colors">
                        {d.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isA && <span className="font-mono text-[7px] text-red-600 border border-red-900/30 px-1">A</span>}
                      <span className="font-mono text-[7px] text-neutral-700">{d.sourceDomain || ""}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── TWO-COLUMN: TIMELINE SNAPSHOT + FINANCIAL SNAPSHOT ── */}
      {(timeline.length > 0 || financialSignals.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="nexus-panel rounded-none">
            <div className="atlas-section-header-cyan">
              <span className="nexus-label">TEMPORAL TRACE ({timeline.length})</span>
              {timeline.length > 0 && <Clock className="w-2.5 h-2.5 text-neutral-700" />}
            </div>
            <div className="p-3 space-y-2">
              {timeline.length === 0 ? (
                <div className="atlas-empty-state py-5">
                  <Clock className="atlas-empty-icon w-6 h-6" />
                  <div className="atlas-empty-title">NO EVENTS MAPPED</div>
                  <div className="atlas-empty-sub">Date-anchored events will appear here as documents are processed</div>
                </div>
              ) : (
                [...timeline]
                  .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())
                  .slice(0, 5)
                  .map((t) => (
                    <div key={t.id} className="flex gap-2.5 items-start">
                      <div className="w-1 h-1 bg-cyan-600 rounded-full mt-1.5 flex-shrink-0" />
                      <div>
                        <div className="font-mono text-[8px] text-cyan-700">
                          {formatDate(t.eventDate).split(",")[0]}
                        </div>
                        <div className="font-mono text-[9px] text-neutral-300">{t.title}</div>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>

          <div className="nexus-panel rounded-none">
            <div className="atlas-section-header-green">
              <span className="nexus-label">FLOW TRACE ({financialSignals.length})</span>
              {financialSignals.length > 0 && <TrendingUp className="w-2.5 h-2.5 text-neutral-700" />}
            </div>
            <div className="p-0">
              {financialSignals.length === 0 ? (
                <div className="atlas-empty-state py-5">
                  <TrendingUp className="atlas-empty-icon w-6 h-6" />
                  <div className="atlas-empty-title">NO FINANCIAL SIGNALS</div>
                  <div className="atlas-empty-sub">Ingest docs with budget, contract, grant or appropriation language to detect signals</div>
                </div>
              ) : (
                financialSignals.slice(0, 5).map((sig: any, i: number) => {
                  const isNonNumeric = sig.signalType?.startsWith("NON_NUMERIC") || sig.amountDisplay === "NON-NUMERIC";
                  const conf = sig.financialConfidence ?? 0;
                  const isInferred = sig.inferredSignal;
                  const displayAmt = sig.amountDisplay ?? sig.amountRaw;
                  return (
                    <div key={sig.id ?? i} className="px-3 py-2 border-b border-[#ffffff04]">
                      <div className="flex items-center gap-2">
                        <span className={cn("font-mono text-[9px] font-bold flex-shrink-0",
                          isNonNumeric ? "text-amber-700" : conf >= 0.7 ? "text-green-400" : "text-green-600"
                        )}>
                          {isNonNumeric ? "NON-NUMERIC" : displayAmt}
                        </span>
                        <span className="font-mono text-[7px] text-neutral-700 border border-[#ffffff08] px-1 flex-shrink-0">
                          {sig.signalType?.replace(/^NON_NUMERIC_/, "").replace(/_/g, " ") || "SIGNAL"}
                        </span>
                        {isInferred && (
                          <span className="font-mono text-[7px] text-cyan-800 border border-cyan-900/30 px-1 flex-shrink-0">INFERRED</span>
                        )}
                        {sig.entityName && (
                          <span className="font-mono text-[8px] text-cyan-500 truncate flex-1">{sig.entityName}</span>
                        )}
                      </div>
                      {(sig.programName || sig.eventSummary) && (
                        <div className="font-mono text-[7.5px] text-neutral-700 mt-0.5 truncate">
                          {sig.programName ? `[${sig.programName}] ` : ""}{sig.eventSummary?.slice(0, 70)}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── NEXT QUERIES + TRIAGE WARNING ── */}
      {(nextQueries.length > 0 || (seedDiag && seedDiag.heldCandidates > 0)) && (
        <div className="nexus-panel rounded-none">
          <div className="nexus-header-strip">
            <span className="nexus-label">ANALYST GUIDANCE</span>
          </div>
          <div className="p-3 space-y-3">
            {seedDiag && seedDiag.heldCandidates > 0 && (
              <div className="flex items-center gap-2 bg-amber-500/4 border border-amber-900/20 px-3 py-2">
                <span className="font-mono text-[8px] text-amber-600">⚑</span>
                <span className="font-mono text-[9px] text-amber-600 uppercase">
                  {seedDiag.heldCandidates} ENTITY CANDIDATE{seedDiag.heldCandidates !== 1 ? "S" : ""} HELD — approve or reject in entity registry
                </span>
              </div>
            )}
            {nextQueries.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest">SUGGESTED NEXT QUERIES</div>
                <div className="flex flex-wrap gap-1.5">
                  {nextQueries.slice(0, 8).map((q: string, i: number) => (
                    <span key={i} className="font-mono text-[9px] text-neutral-400 uppercase px-2 py-0.5 border border-[#ffffff08] bg-[#050709] hover:border-red-900/50 hover:text-red-300 transition-colors cursor-default">
                      {q}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Seed Diagnostics Card ── */}
      {isAutoSeeded && seedDiag && (
        <SeedDiagnosticsCard
          diag={seedDiag}
          documents={documents}
          caseId={caseId}
          timelineCount={timeline.length}
          financialCount={financialSignals.length}
          usableDocCount={usableDocs.length}
          onRebuildComplete={() =>
            queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] })
          }
        />
      )}

      {/* ── ATLAS Case Brief (compiled intelligence layer) ── */}
      <AtlasCaseBrief
        caseId={caseId}
        onViewDocument={(docId) => onViewDocument?.({ id: docId } as any)}
      />

    </div>
  );
}

// ─── ATLAS Case Brief ─────────────────────────────────────────────────────────

type BriefQuality = "STRONG" | "MODERATE" | "WEAK" | "EMPTY";

interface EarlySignalEntry {
  type: "entity" | "financial" | "timeline";
  label: string;
  confidence: number;
  note?: string;
}

interface CaseBriefData {
  caseId: number;
  caseTitle: string;
  seedIntent: string | null;
  targetMode: string | null;
  targetLabel: string | null;
  autoGraphQuality: string | null;
  compiledAt: string;
  dataQuality: BriefQuality;
  qualityNote: string;
  caseConfidence?: number;
  caseHealth?: "SPARSE" | "DEVELOPING" | "STRONG";
  whatThisCaseIs: string;
  primaryActors: string[];
  primaryOrganizations: string[];
  keyEvidence: Array<{ id: number; title: string; source: string | null; score: number; scoreBreakdown: string; hasTimeline: boolean; hasFinancial: boolean; priority?: string; alignment?: string }>;
  topTimeline: Array<{ id: number; title: string; eventDate: string; eventType: string; priority: number }>;
  topFinancial: Array<{ id: number; amountRaw: string; amountDisplay?: string | null; normalizedAmount: number | null; signalType: string; eventSummary: string | null; entityName: string | null; controlledBy?: string | null; receivedBy?: string | null; programName?: string | null; financialConfidence?: number | null; inferredSignal?: boolean | null }>;
  primaryEntities: Array<{ id: number; name: string; type: string; mentionCount: number; docSupport: number; avgConfidence: number; promotionReason: string; isPrimary?: boolean }>;
  secondaryEntities: Array<{ id: number; name: string; type: string; mentionCount: number; docSupport: number; avgConfidence: number }>;
  keyRelationships: Array<{ entityA: string; entityB: string; relationshipType: string; confidence: number }>;
  likelyAngles: string[];
  currentState: string;
  knownGaps: string[];
  suggestedNextQueries: string[];
  earlySignals?: EarlySignalEntry[];
  keyFindings?: string[];
  financialRedFlags?: string[];
  powerNodes?: string[];
  oversightFailures?: string[];
  recommendedActions?: string[];
  stats: { totalDocs: number; usableDocs: number; totalEntities: number; totalTimeline: number; totalFinancial: number; totalRelationships?: number; totalMentions?: number };
}

const QUALITY_CONFIG: Record<BriefQuality, { color: string; dot: string; label: string }> = {
  STRONG:   { color: "text-green-400",  dot: "bg-green-500",  label: "STRONG" },
  MODERATE: { color: "text-cyan-400",   dot: "bg-cyan-500",   label: "MODERATE" },
  WEAK:     { color: "text-amber-400",  dot: "bg-amber-500",  label: "WEAK" },
  EMPTY:    { color: "text-neutral-600",dot: "bg-neutral-700",label: "EMPTY" },
};

function AtlasCaseBrief({ caseId, onViewDocument }: { caseId: number; onViewDocument?: (id: number) => void }) {
  const [brief, setBrief] = React.useState<CaseBriefData | null>(null);
  const [loadState, setLoadState] = React.useState<"loading" | "idle" | "compiling" | "error">("loading");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set(["evidence", "timeline"]));

  const toggleSection = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  React.useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    fetch(`/api/cases/${caseId}/brief`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.ok) { setBrief(d.brief); setLoadState("idle"); }
        else { setBrief(null); setLoadState("idle"); }
      })
      .catch(() => { if (!cancelled) setLoadState("idle"); });
    return () => { cancelled = true; };
  }, [caseId]);

  const handleCompile = async () => {
    setLoadState("compiling");
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/cases/${caseId}/compile`, { method: "POST" });
      const d = await r.json();
      if (d.ok) { setBrief(d.brief); setLoadState("idle"); }
      else { setErrorMsg(d.error ?? "Compilation failed"); setLoadState("error"); }
    } catch (e) {
      setErrorMsg(String(e)); setLoadState("error");
    }
  };

  const qc = brief ? QUALITY_CONFIG[brief.dataQuality] : null;

  return (
    <div className="nexus-panel rounded-none lg:col-span-2 xl:col-span-3">
      {/* Header */}
      <div className="atlas-section-header">
        <div className="flex items-center gap-2">
          {qc && <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", qc.dot)} />}
          <span className="nexus-label">ATLAS CASE BRIEF</span>
          {brief && (
            <span className={cn("font-mono text-[8px] border px-1 py-0.5", qc?.color,
              brief.dataQuality === "STRONG" ? "border-green-900/40 bg-green-950/10" :
              brief.dataQuality === "MODERATE" ? "border-cyan-900/40 bg-cyan-950/10" :
              brief.dataQuality === "WEAK" ? "border-amber-900/40 bg-amber-950/10" :
              "border-neutral-800 bg-transparent"
            )}>
              {qc?.label}
            </span>
          )}
          {brief?.caseHealth && (
            <span className={cn(
              "font-mono text-[8px] border px-1 py-0.5 tracking-wider",
              brief.caseHealth === "STRONG" ? "text-green-400 border-green-900/40 bg-green-950/10" :
              brief.caseHealth === "DEVELOPING" ? "text-cyan-400 border-cyan-900/40 bg-cyan-950/10" :
              "text-amber-500 border-amber-900/40 bg-amber-950/10"
            )}>
              {brief.caseHealth}
            </span>
          )}
          {brief?.compiledAt && (
            <span className="font-mono text-[8px] text-neutral-700">
              compiled {new Date(brief.compiledAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <button
          onClick={handleCompile}
          disabled={loadState === "compiling"}
          className={cn(
            "atlas-btn transition-all",
            loadState === "compiling" ? "text-amber-500 border-amber-900/40 animate-pulse" : "atlas-btn-red"
          )}
        >
          {loadState === "compiling" ? "COMPILING..." : brief ? "RECOMPILE CASE" : "COMPILE CASE"}
        </button>
      </div>

      {/* Body */}
      {loadState === "loading" && (
        <div className="p-4 font-mono text-[9px] text-neutral-700 uppercase tracking-widest text-center">
          LOADING BRIEF...
        </div>
      )}

      {loadState !== "loading" && !brief && (
        <div className="p-4 space-y-2">
          <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest text-center">
            No compiled brief — hit COMPILE CASE to generate intelligence summary
          </div>
          {errorMsg && (
            <div className="font-mono text-[9px] text-red-500 text-center">{errorMsg}</div>
          )}
        </div>
      )}

      {brief && (
        <div className="p-3 space-y-3">

          {/* Quality note */}
          <div className={cn("font-mono text-[9px] leading-relaxed", qc?.color)}>
            {brief.qualityNote}
          </div>

          {/* WHAT THIS CASE IS */}
          <div className="atlas-brief-section">
            <div className="atlas-brief-section-header">
              <span className="font-mono text-[8px] text-neutral-500 uppercase tracking-widest">WHAT THIS CASE IS</span>
            </div>
            <div className="px-3 py-2 font-mono text-[10px] text-neutral-300 leading-relaxed">
              {brief.whatThisCaseIs}
            </div>
          </div>

          {/* ACTORS + ORGS */}
          {(brief.primaryActors.length > 0 || brief.primaryOrganizations.length > 0) && (
            <div className="grid grid-cols-2 gap-2">
              {brief.primaryActors.length > 0 && (
                <div className="atlas-brief-section">
                  <div className="atlas-brief-section-header">
                    <span className="font-mono text-[8px] text-neutral-500 uppercase tracking-widest">PRIMARY ACTORS</span>
                  </div>
                  <div className="px-3 py-2 space-y-1">
                    {brief.primaryActors.map((name, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="w-1 h-1 bg-red-600 rounded-full flex-shrink-0" />
                        <span className="font-mono text-[9px] text-white uppercase">{name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {brief.primaryOrganizations.length > 0 && (
                <div className="atlas-brief-section">
                  <div className="atlas-brief-section-header">
                    <span className="font-mono text-[8px] text-neutral-500 uppercase tracking-widest">PRIMARY ORGS</span>
                  </div>
                  <div className="px-3 py-2 space-y-1">
                    {brief.primaryOrganizations.map((name, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="w-1 h-1 bg-cyan-600 rounded-full flex-shrink-0" />
                        <span className="font-mono text-[9px] text-cyan-300 uppercase">{name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ENTITY INTELLIGENCE (A6 — promotion explanation) */}
          {brief.primaryEntities.length > 0 && (
            <div className="atlas-brief-section">
              <button
                onClick={() => toggleSection("entities")}
                className="atlas-brief-section-header w-full text-left"
              >
                <span className="font-mono text-[8px] text-neutral-500 uppercase tracking-widest flex-1">
                  ENTITY INTELLIGENCE ({brief.primaryEntities.length} primary)
                </span>
                <span className="font-mono text-[8px] text-neutral-700">{expanded.has("entities") ? "▲" : "▼"}</span>
              </button>
              {expanded.has("entities") && (
                <div className="divide-y divide-[#ffffff04]">
                  {brief.primaryEntities.map((e) => (
                    <div key={e.id} className="px-3 py-1.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <span className={cn("font-mono text-[9px] font-semibold uppercase",
                          e.type === "person" ? "text-white" : "text-cyan-300"
                        )}>{e.name}</span>
                        <span className="font-mono text-[8px] text-neutral-700 ml-2">{e.type.toUpperCase()}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="font-mono text-[8px] text-neutral-600">{e.mentionCount} mentions</span>
                        <span className="font-mono text-[8px] text-neutral-700">·</span>
                        <span className="font-mono text-[8px] text-neutral-600">{e.docSupport} docs</span>
                        <span className="font-mono text-[8px] text-neutral-700">·</span>
                        <span className="font-mono text-[8px] text-neutral-600">{(e.avgConfidence * 100).toFixed(0)}% conf</span>
                      </div>
                      <span className="font-mono text-[8px] text-neutral-700 italic truncate max-w-[120px]">{e.promotionReason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* LIKELY INVESTIGATIVE ANGLES (Dossier 2.0) */}
          {brief.likelyAngles && brief.likelyAngles.length > 0 && (
            <div className="atlas-brief-section">
              <button
                onClick={() => toggleSection("angles")}
                className="atlas-brief-section-header w-full text-left"
              >
                <span className="font-mono text-[8px] text-violet-500/80 uppercase tracking-widest flex-1">
                  LIKELY INVESTIGATIVE ANGLES ({brief.likelyAngles.length})
                </span>
                <span className="font-mono text-[8px] text-neutral-700">{expanded.has("angles") ? "▲" : "▼"}</span>
              </button>
              {expanded.has("angles") && (
                <div className="px-3 py-2 space-y-2">
                  {brief.likelyAngles.map((angle, i) => {
                    const [head, ...rest] = angle.split(" — ");
                    return (
                      <div key={i} className="flex gap-2 items-start">
                        <span className="font-mono text-[8px] text-violet-700 mt-0.5 flex-shrink-0">◈</span>
                        <div>
                          <span className="font-mono text-[9px] text-violet-300 font-semibold">{head}</span>
                          {rest.length > 0 && (
                            <span className="font-mono text-[8px] text-neutral-500 ml-1">— {rest.join(" — ")}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* KEY RELATIONSHIPS (Dossier 2.0) */}
          {brief.keyRelationships && brief.keyRelationships.length > 0 && (
            <div className="atlas-brief-section">
              <button
                onClick={() => toggleSection("relationships")}
                className="atlas-brief-section-header w-full text-left"
              >
                <span className="font-mono text-[8px] text-cyan-700/80 uppercase tracking-widest flex-1">
                  KEY RELATIONSHIPS ({brief.keyRelationships.length})
                </span>
                <span className="font-mono text-[8px] text-neutral-700">{expanded.has("relationships") ? "▲" : "▼"}</span>
              </button>
              {expanded.has("relationships") && (
                <div className="divide-y divide-[#ffffff04]">
                  {brief.keyRelationships.map((rel, i) => (
                    <div key={i} className="px-3 py-1.5 flex items-center gap-2">
                      <span className="font-mono text-[9px] text-white uppercase truncate max-w-[30%]">{rel.entityA}</span>
                      <span className="font-mono text-[8px] text-neutral-700 border border-[#ffffff08] px-1 py-0.5 flex-shrink-0">
                        {rel.relationshipType.replace(/_/g, " ")}
                      </span>
                      <span className="font-mono text-[9px] text-cyan-300 uppercase truncate max-w-[30%]">{rel.entityB}</span>
                      <span className="font-mono text-[8px] text-neutral-700 ml-auto flex-shrink-0">
                        {(rel.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* KEY EVIDENCE */}
          {brief.keyEvidence.length > 0 && (
            <div className="atlas-brief-section">
              <button
                onClick={() => toggleSection("evidence")}
                className="atlas-brief-section-header w-full text-left"
              >
                <span className="font-mono text-[8px] text-neutral-500 uppercase tracking-widest flex-1">
                  KEY EVIDENCE ({brief.keyEvidence.length} sources)
                </span>
                <span className="font-mono text-[8px] text-neutral-700">{expanded.has("evidence") ? "▲" : "▼"}</span>
              </button>
              {expanded.has("evidence") && (
                <div className="divide-y divide-[#ffffff04]">
                  {brief.keyEvidence.map((doc, i) => (
                    <div
                      key={doc.id}
                      onClick={() => onViewDocument?.(doc.id)}
                      className={cn("px-3 py-2 flex items-start gap-2.5", onViewDocument && "cursor-pointer hover:bg-[#ffffff03]")}
                    >
                      <span className="font-mono text-[8px] text-neutral-700 mt-0.5 flex-shrink-0">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[9px] text-neutral-300 truncate">{doc.title}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {doc.source && <span className="font-mono text-[8px] text-neutral-700">{doc.source}</span>}
                          <span className="font-mono text-[8px] text-neutral-700">{doc.scoreBreakdown}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {doc.hasTimeline && <span className="w-1 h-1 rounded-full bg-cyan-500" title="has timeline events" />}
                        {doc.hasFinancial && <span className="w-1 h-1 rounded-full bg-green-500" title="has financial signals" />}
                        <span className={cn("font-mono text-[9px] font-bold",
                          doc.score >= 100 ? "text-green-400" : doc.score >= 70 ? "text-cyan-400" : doc.score >= 40 ? "text-amber-400" : "text-neutral-600"
                        )}>{doc.score}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TIMELINE */}
          <div className="atlas-brief-section">
            <button
              onClick={() => toggleSection("timeline")}
              className="atlas-brief-section-header w-full text-left"
            >
              <span className="font-mono text-[8px] text-neutral-500 uppercase tracking-widest flex-1">
                TIMELINE{brief.topTimeline.length > 0 ? ` (${brief.topTimeline.length} events)` : ""}
              </span>
              <span className="font-mono text-[8px] text-neutral-700">{expanded.has("timeline") ? "▲" : "▼"}</span>
            </button>
            {expanded.has("timeline") && (
              <div className="px-3 py-2">
                {brief.topTimeline.length === 0 ? (
                  <div className="font-mono text-[9px] text-neutral-700 italic">No date-anchored events found.</div>
                ) : (
                  <div className="space-y-2">
                    {brief.topTimeline.map((ev) => {
                      const isSoft = ev.title?.startsWith("[SOFT]");
                      const cleanTitle = ev.title.replace(/^\[SOFT\]\[?[A-Z_]*\]?\s*/i, "").replace(/^\[[A-Z_]+\]\s*/, "");
                      return (
                        <div key={ev.id} className="flex gap-2.5 items-start">
                          <div className={cn("w-1 h-1 rounded-full mt-1.5 flex-shrink-0", isSoft ? "bg-amber-700" : "bg-cyan-600")} />
                          <div>
                            <div className="flex items-center gap-1.5 font-mono text-[8px] text-cyan-600/70">
                              <span>{new Date(ev.eventDate).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span>
                              <span className="text-neutral-700">·</span>
                              <span className="text-neutral-700">{ev.eventType.replace(/_/g, " ")}</span>
                              {isSoft && <span className="text-amber-700 border border-amber-900/50 px-1 py-px text-[7px] tracking-wider">SOFT</span>}
                            </div>
                            <div className="font-mono text-[9px] text-neutral-300">{cleanTitle}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* FINANCIAL SIGNALS */}
          <div className="atlas-brief-section">
            <button
              onClick={() => toggleSection("financial")}
              className="atlas-brief-section-header w-full text-left"
            >
              <span className="font-mono text-[8px] text-neutral-500 uppercase tracking-widest flex-1">
                MONEY FLOW{brief.topFinancial.length > 0 ? ` (${brief.topFinancial.length} signals)` : ""}
              </span>
              <span className="font-mono text-[8px] text-neutral-700">{expanded.has("financial") ? "▲" : "▼"}</span>
            </button>
            {expanded.has("financial") && (
              <div className="px-3 py-2">
                {brief.topFinancial.length === 0 ? (
                  <div className="font-mono text-[9px] text-neutral-700 italic">No financial signals detected.</div>
                ) : (
                  <div className="space-y-2">
                    {brief.topFinancial.map((sig) => {
                      const isNonNumeric = sig.signalType?.startsWith("NON_NUMERIC") || sig.amountDisplay === "NON-NUMERIC";
                      const conf = sig.financialConfidence ?? 0;
                      const signalStrength = isNonNumeric || conf < 0.40 ? "WEAK" :
                        sig.inferredSignal ? "INFERRED" :
                        conf >= 0.75 ? "STRONG" : "MODERATE";
                      const strengthColor = signalStrength === "STRONG" ? "text-green-400 border-green-900/50" :
                        signalStrength === "INFERRED" ? "text-cyan-500 border-cyan-900/50" :
                        signalStrength === "MODERATE" ? "text-neutral-400 border-neutral-800" :
                        "text-amber-700 border-amber-900/40";
                      const displayAmount = sig.amountDisplay || sig.amountRaw;
                      return (
                        <div key={sig.id} className="flex gap-2.5 items-start">
                          <div className={cn("w-1 h-1 rounded-full mt-1.5 flex-shrink-0", isNonNumeric ? "bg-amber-800" : "bg-green-600")} />
                          <div className="flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={cn("font-mono text-[9px] font-bold", isNonNumeric ? "text-amber-700" : "text-green-400")}>
                                {isNonNumeric ? "NON-NUMERIC" : displayAmount}
                              </span>
                              <span className={cn("font-mono text-[7px] border px-1 py-px tracking-wider", strengthColor)}>
                                {signalStrength} SIGNAL
                              </span>
                              <span className="font-mono text-[8px] text-neutral-700 border border-[#ffffff08] px-1">{sig.signalType?.replace(/^NON_NUMERIC_/, "")}</span>
                              {sig.entityName && <span className="font-mono text-[8px] text-cyan-500">{sig.entityName}</span>}
                            </div>
                            {sig.eventSummary && (
                              <div className="font-mono text-[8px] text-neutral-600 mt-0.5">{sig.eventSummary.slice(0, 140)}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CURRENT STATE */}
          <div className="atlas-brief-section">
            <div className="atlas-brief-section-header">
              <span className="font-mono text-[8px] text-neutral-500 uppercase tracking-widest">CURRENT STATE / WHY IT MATTERS</span>
            </div>
            <div className="px-3 py-2 font-mono text-[9px] text-neutral-400 leading-relaxed">{brief.currentState}</div>
          </div>

          {/* EARLY SIGNALS — shown when caseHealth is SPARSE and earlySignals present */}
          {brief.caseHealth === "SPARSE" && brief.earlySignals && brief.earlySignals.length > 0 && (
            <div className="atlas-brief-section border border-amber-900/30 bg-amber-950/5">
              <div className="atlas-brief-section-header">
                <span className="font-mono text-[8px] text-amber-600 uppercase tracking-widest">EARLY SIGNALS — RECOVERY MODE ACTIVE</span>
              </div>
              <div className="px-3 py-2 space-y-1.5">
                <div className="font-mono text-[7px] text-amber-800 mb-2 leading-relaxed">
                  NO HARD SIGNALS — RUNNING RECOVERY MODE. Extracting preliminary indicators from available sources.
                </div>
                {brief.earlySignals.map((sig, i) => {
                  const typeIcon = sig.type === "entity" ? "◈" : sig.type === "financial" ? "◎" : "◷";
                  const typeColor = sig.type === "entity" ? "text-cyan-700" : sig.type === "financial" ? "text-amber-700" : "text-neutral-600";
                  return (
                    <div key={i} className="flex gap-2 items-start">
                      <span className={cn("font-mono text-[8px] mt-0.5 flex-shrink-0", typeColor)}>{typeIcon}</span>
                      <div>
                        <span className="font-mono text-[8px] text-neutral-400">{sig.label}</span>
                        {sig.note && <div className="font-mono text-[7px] text-neutral-700 mt-px">{sig.note}</div>}
                      </div>
                      <span className="ml-auto font-mono text-[7px] text-neutral-700 border border-neutral-900 px-1">
                        {Math.round(sig.confidence * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* KNOWN GAPS + SUGGESTED QUERIES */}
          <div className="grid grid-cols-2 gap-2">
            {brief.knownGaps.length > 0 && (
              <div className="atlas-brief-section">
                <div className="atlas-brief-section-header">
                  <span className="font-mono text-[8px] text-amber-600/70 uppercase tracking-widest">KNOWN GAPS</span>
                </div>
                <div className="px-3 py-2 space-y-1.5">
                  {brief.knownGaps.map((gap, i) => (
                    <div key={i} className="flex gap-1.5 items-start">
                      <span className="font-mono text-[8px] text-amber-700 mt-0.5">⚠</span>
                      <span className="font-mono text-[8px] text-neutral-500">{gap}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {brief.suggestedNextQueries.length > 0 && (
              <div className="atlas-brief-section">
                <div className="atlas-brief-section-header">
                  <span className="font-mono text-[8px] text-cyan-700/80 uppercase tracking-widest">SUGGESTED QUERIES</span>
                </div>
                <div className="px-3 py-2 space-y-1.5">
                  {brief.suggestedNextQueries.map((q, i) => (
                    <div key={i} className="flex gap-1.5 items-start">
                      <span className="font-mono text-[8px] text-cyan-800 mt-0.5">›</span>
                      <span className="font-mono text-[8px] text-neutral-500 italic">{q}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* KEY FINDINGS */}
          {(brief.keyFindings?.length ?? 0) > 0 && (
            <div className="atlas-brief-section">
              <button onClick={() => toggleSection("keyFindings")} className="atlas-brief-section-header w-full text-left">
                <span className="font-mono text-[8px] text-red-500/80 uppercase tracking-widest flex-1">⬛ KEY FINDINGS ({brief.keyFindings!.length})</span>
                <span className="font-mono text-[8px] text-neutral-700">{expanded.has("keyFindings") ? "▲" : "▼"}</span>
              </button>
              {expanded.has("keyFindings") && (
                <div className="px-3 py-2 space-y-2">
                  {brief.keyFindings!.map((f, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="font-mono text-[8px] text-red-800 mt-0.5 flex-shrink-0">{(i + 1).toString().padStart(2, "0")}</span>
                      <span className="font-mono text-[8px] text-neutral-300 leading-relaxed">{f}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* FINANCIAL RED FLAGS */}
          {(brief.financialRedFlags?.length ?? 0) > 0 && (
            <div className="atlas-brief-section" style={{ borderColor: "rgba(239,68,68,0.12)" }}>
              <button onClick={() => toggleSection("finRedFlags")} className="atlas-brief-section-header w-full text-left">
                <span className="font-mono text-[8px] text-red-400/80 uppercase tracking-widest flex-1">◎ FINANCIAL RED FLAGS ({brief.financialRedFlags!.length})</span>
                <span className="font-mono text-[8px] text-neutral-700">{expanded.has("finRedFlags") ? "▲" : "▼"}</span>
              </button>
              {expanded.has("finRedFlags") && (
                <div className="px-3 py-2 space-y-1.5">
                  {brief.financialRedFlags!.map((flag, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="font-mono text-[8px] text-red-700 mt-0.5 flex-shrink-0">⚑</span>
                      <span className="font-mono text-[8px] text-red-200/60 leading-relaxed">{flag}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* POWER NODES */}
          {(brief.powerNodes?.length ?? 0) > 0 && (
            <div className="atlas-brief-section">
              <button onClick={() => toggleSection("powerNodes")} className="atlas-brief-section-header w-full text-left">
                <span className="font-mono text-[8px] text-amber-500/70 uppercase tracking-widest flex-1">◉ POWER NODES ({brief.powerNodes!.length})</span>
                <span className="font-mono text-[8px] text-neutral-700">{expanded.has("powerNodes") ? "▲" : "▼"}</span>
              </button>
              {expanded.has("powerNodes") && (
                <div className="px-3 py-2 space-y-1.5">
                  {brief.powerNodes!.map((node, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="font-mono text-[8px] text-amber-700 mt-0.5 flex-shrink-0">◈</span>
                      <span className="font-mono text-[8px] text-amber-200/50 leading-relaxed">{node}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* OVERSIGHT FAILURES */}
          {(brief.oversightFailures?.length ?? 0) > 0 && (
            <div className="atlas-brief-section" style={{ borderColor: "rgba(245,158,11,0.15)" }}>
              <button onClick={() => toggleSection("oversightFails")} className="atlas-brief-section-header w-full text-left">
                <span className="font-mono text-[8px] text-orange-600/70 uppercase tracking-widest flex-1">⚠ OVERSIGHT FAILURES ({brief.oversightFailures!.length})</span>
                <span className="font-mono text-[8px] text-neutral-700">{expanded.has("oversightFails") ? "▲" : "▼"}</span>
              </button>
              {expanded.has("oversightFails") && (
                <div className="px-3 py-2 space-y-1.5">
                  {brief.oversightFailures!.map((fail, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="font-mono text-[8px] text-orange-700 mt-0.5 flex-shrink-0">⚠</span>
                      <span className="font-mono text-[8px] text-orange-200/50 leading-relaxed">{fail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* RECOMMENDED ACTIONS */}
          {(brief.recommendedActions?.length ?? 0) > 0 && (
            <div className="atlas-brief-section" style={{ borderColor: "rgba(34,197,94,0.12)" }}>
              <button onClick={() => toggleSection("recActions")} className="atlas-brief-section-header w-full text-left">
                <span className="font-mono text-[8px] text-green-600/70 uppercase tracking-widest flex-1">→ RECOMMENDED ACTIONS ({brief.recommendedActions!.length})</span>
                <span className="font-mono text-[8px] text-neutral-700">{expanded.has("recActions") ? "▲" : "▼"}</span>
              </button>
              {expanded.has("recActions") && (
                <div className="px-3 py-2 space-y-1.5">
                  {brief.recommendedActions!.map((action, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="font-mono text-[8px] text-green-800 mt-0.5 flex-shrink-0">{(i + 1).toString().padStart(2, "0")}</span>
                      <span className="font-mono text-[8px] text-green-300/60 leading-relaxed">{action}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Stats footer */}
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-[#ffffff05]">
            {[
              ["DOCS", `${brief.stats.usableDocs}/${brief.stats.totalDocs}`],
              ["ENTITIES", brief.stats.totalEntities],
              ["TIMELINE", brief.stats.totalTimeline],
              ["FINANCIAL", brief.stats.totalFinancial],
              ...(brief.stats.totalRelationships != null ? [["EDGES", brief.stats.totalRelationships]] : []),
              ...(brief.stats.totalMentions != null ? [["MENTIONS", brief.stats.totalMentions]] : []),
            ].map(([label, val]) => (
              <span key={label as string} className="font-mono text-[8px] text-neutral-700">
                {label}: <span className="text-neutral-500">{val}</span>
              </span>
            ))}
            {brief.targetMode && (
              <span className="font-mono text-[8px] text-violet-700 ml-auto uppercase">{brief.targetMode.replace(/_/g, " ")}</span>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ─── Dossier Center Tab ───────────────────────────────────────────────────────

function DossierCenterTab({ caseId, caseTitle }: { caseId: number; caseTitle: string }) {
  const [brief, setBrief] = React.useState<CaseBriefData | null>(null);
  const [loadState, setLoadState] = React.useState<"loading" | "idle" | "compiling" | "error">("loading");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    fetch(`/api/cases/${caseId}/brief`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.ok) { setBrief(d.brief); setLoadState("idle"); }
        else { setBrief(null); setLoadState("idle"); }
      })
      .catch(() => { if (!cancelled) setLoadState("idle"); });
    return () => { cancelled = true; };
  }, [caseId]);

  const handleCompile = async () => {
    setLoadState("compiling");
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/cases/${caseId}/compile`, { method: "POST" });
      const d = await r.json();
      if (d.ok) { setBrief(d.brief); setLoadState("idle"); }
      else { setErrorMsg(d.error ?? "Compilation failed"); setLoadState("error"); }
    } catch (e) { setErrorMsg(String(e)); setLoadState("error"); }
  };

  const handleCopy = () => {
    if (!brief) return;
    const sections: string[] = [
      `ATLAS DOSSIER — ${caseTitle.toUpperCase()}`,
      `Compiled: ${new Date(brief.compiledAt).toLocaleString()}`,
      `Quality: ${brief.dataQuality} | Confidence: ${brief.caseConfidence ?? "—"}%`,
      ``,
      `=== CASE SUMMARY ===`,
      brief.whatThisCaseIs,
      ``,
      brief.primaryActors.length > 0 ? `ACTORS: ${brief.primaryActors.join(", ")}` : "",
      brief.primaryOrganizations.length > 0 ? `INSTITUTIONS: ${brief.primaryOrganizations.join(", ")}` : "",
      ``,
      `=== CURRENT STATE ===`,
      brief.currentState,
      ``,
      brief.knownGaps.length > 0 ? `=== INTELLIGENCE GAPS ===\n${brief.knownGaps.map(g => `• ${g}`).join("\n")}` : "",
      ``,
      brief.likelyAngles.length > 0 ? `=== INVESTIGATIVE ANGLES ===\n${brief.likelyAngles.map(a => `• ${a}`).join("\n")}` : "",
      ``,
      brief.suggestedNextQueries.length > 0 ? `=== SUGGESTED QUERIES ===\n${brief.suggestedNextQueries.map(q => `> ${q}`).join("\n")}` : "",
    ].filter(Boolean);
    navigator.clipboard.writeText(sections.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const qc = brief ? QUALITY_CONFIG[brief.dataQuality] : null;
  const confidenceColor = !brief?.caseConfidence ? "text-neutral-600"
    : brief.caseConfidence >= 70 ? "text-green-400"
    : brief.caseConfidence >= 40 ? "text-amber-400"
    : "text-red-400";

  if (loadState === "loading") {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest animate-pulse">LOADING DOSSIER...</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-4">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BookOpen className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
              <span className="font-mono text-[9px] text-neutral-500 uppercase tracking-[0.2em]">ATLAS INTELLIGENCE DOSSIER</span>
            </div>
            <div className="font-mono text-base text-white font-bold tracking-wide leading-tight">{caseTitle}</div>
            {brief && (
              <div className="flex items-center gap-3 mt-1">
                <span className={cn("font-mono text-[9px] border px-1.5 py-0.5 uppercase tracking-widest", qc?.color,
                  brief.dataQuality === "STRONG" ? "border-green-900/50 bg-green-950/20" :
                  brief.dataQuality === "MODERATE" ? "border-cyan-900/50 bg-cyan-950/20" :
                  brief.dataQuality === "WEAK" ? "border-amber-900/50 bg-amber-950/20" :
                  "border-neutral-800"
                )}>{brief.dataQuality}</span>
                {brief.caseConfidence !== undefined && (
                  <span className={cn("font-mono text-[9px]", confidenceColor)}>
                    {brief.caseConfidence}% CONFIDENCE
                  </span>
                )}
                <span className="font-mono text-[8px] text-neutral-700">
                  {new Date(brief.compiledAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {brief && (
              <button onClick={handleCopy} className="atlas-btn flex items-center gap-1.5">
                <Copy className="w-3 h-3" />
                {copied ? "COPIED" : "COPY"}
              </button>
            )}
            <button
              onClick={handleCompile}
              disabled={loadState === "compiling"}
              className={cn("atlas-btn", loadState === "compiling" ? "text-amber-500 border-amber-900/40 animate-pulse" : "atlas-btn-red")}
            >
              {loadState === "compiling" ? "COMPILING..." : brief ? "RECOMPILE" : "COMPILE DOSSIER"}
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="font-mono text-[9px] text-red-500 px-3 py-2 border border-red-900/40 bg-red-950/10">
            ERROR: {errorMsg}
          </div>
        )}

        {!brief && loadState === "idle" && (
          <div className="border border-[#ffffff08] bg-[#0a0c10] rounded p-8 text-center space-y-3">
            <BookOpen className="w-8 h-8 text-neutral-700 mx-auto" />
            <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest">
              No compiled dossier — hit COMPILE DOSSIER to generate the intelligence brief
            </div>
            <div className="font-mono text-[8px] text-neutral-700">
              Requires at least one web ingest session to have completed
            </div>
          </div>
        )}

        {brief && (
          <div className="space-y-3">

            {/* Quality Banner */}
            <div className={cn(
              "border px-4 py-3 font-mono text-[9px] leading-relaxed",
              brief.dataQuality === "STRONG" ? "border-green-900/40 bg-green-950/10 text-green-400/80" :
              brief.dataQuality === "MODERATE" ? "border-cyan-900/40 bg-cyan-950/10 text-cyan-400/80" :
              brief.dataQuality === "WEAK" ? "border-amber-900/40 bg-amber-950/10 text-amber-400/80" :
              "border-neutral-800 text-neutral-600"
            )}>
              {brief.qualityNote}
            </div>

            {/* Two-column layout for main content */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">

              {/* LEFT: Summary + State */}
              <div className="xl:col-span-2 space-y-3">

                {/* Case Summary */}
                <div className="border border-[#ffffff08] bg-[#0a0c10]">
                  <div className="px-4 py-2 border-b border-[#ffffff08] flex items-center gap-2">
                    <span className="w-1 h-3 bg-red-600 flex-shrink-0" />
                    <span className="font-mono text-[9px] text-neutral-400 uppercase tracking-[0.15em]">CASE SUMMARY</span>
                  </div>
                  <div className="px-4 py-3 font-mono text-[11px] text-neutral-200 leading-relaxed">
                    {brief.whatThisCaseIs}
                  </div>
                  {(brief.primaryActors.length > 0 || brief.primaryOrganizations.length > 0) && (
                    <div className="px-4 pb-3 grid grid-cols-2 gap-3 border-t border-[#ffffff05] pt-3">
                      {brief.primaryActors.length > 0 && (
                        <div>
                          <div className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest mb-1.5">INDIVIDUALS</div>
                          {brief.primaryActors.map((name, i) => (
                            <div key={i} className="flex items-center gap-1.5 mb-1">
                              <span className="w-1 h-1 bg-red-600 rounded-full flex-shrink-0" />
                              <span className="font-mono text-[10px] text-neutral-300">{name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {brief.primaryOrganizations.length > 0 && (
                        <div>
                          <div className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest mb-1.5">INSTITUTIONS</div>
                          {brief.primaryOrganizations.map((name, i) => (
                            <div key={i} className="flex items-center gap-1.5 mb-1">
                              <span className="w-1 h-1 bg-cyan-700 rounded-full flex-shrink-0" />
                              <span className="font-mono text-[10px] text-neutral-300">{name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Current State */}
                <div className="border border-[#ffffff08] bg-[#0a0c10]">
                  <div className="px-4 py-2 border-b border-[#ffffff08] flex items-center gap-2">
                    <span className="w-1 h-3 bg-cyan-700 flex-shrink-0" />
                    <span className="font-mono text-[9px] text-neutral-400 uppercase tracking-[0.15em]">CURRENT STATE</span>
                  </div>
                  <div className="px-4 py-3 font-mono text-[10px] text-neutral-300 leading-relaxed">
                    {brief.currentState}
                  </div>
                </div>

                {/* Key Evidence */}
                {brief.keyEvidence.length > 0 && (
                  <div className="border border-[#ffffff08] bg-[#0a0c10]">
                    <div className="px-4 py-2 border-b border-[#ffffff08] flex items-center gap-2">
                      <span className="w-1 h-3 bg-amber-700 flex-shrink-0" />
                      <span className="font-mono text-[9px] text-neutral-400 uppercase tracking-[0.15em]">KEY EVIDENCE</span>
                      <span className="font-mono text-[8px] text-neutral-700">{brief.keyEvidence.length} source{brief.keyEvidence.length > 1 ? "s" : ""}</span>
                    </div>
                    <div className="divide-y divide-[#ffffff04]">
                      {brief.keyEvidence.slice(0, 5).map((doc, i) => (
                        <div key={doc.id} className="px-4 py-2.5 flex items-start gap-3">
                          <span className="font-mono text-[9px] text-neutral-700 w-4 flex-shrink-0 mt-0.5">{(i + 1).toString().padStart(2, "0")}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-[10px] text-neutral-200 leading-snug truncate">{doc.title}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {doc.source && <span className="font-mono text-[8px] text-neutral-600">{doc.source}</span>}
                              <span className={cn("font-mono text-[8px] border px-1",
                                doc.priority === "PRIORITY_A" ? "text-green-500 border-green-900/40" :
                                doc.priority === "PRIORITY_B" ? "text-cyan-600 border-cyan-900/40" :
                                "text-neutral-600 border-neutral-800"
                              )}>{doc.priority === "PRIORITY_A" ? "A" : doc.priority === "PRIORITY_B" ? "B" : "C"}</span>
                              {doc.hasTimeline && <span className="font-mono text-[8px] text-amber-700">TL</span>}
                              {doc.hasFinancial && <span className="font-mono text-[8px] text-green-800">$</span>}
                              <span className="font-mono text-[8px] text-neutral-700">score:{doc.score}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Key Relationships */}
                {brief.keyRelationships.length > 0 && (
                  <div className="border border-[#ffffff08] bg-[#0a0c10]">
                    <div className="px-4 py-2 border-b border-[#ffffff08] flex items-center gap-2">
                      <span className="w-1 h-3 bg-violet-700 flex-shrink-0" />
                      <span className="font-mono text-[9px] text-neutral-400 uppercase tracking-[0.15em]">ENTITY RELATIONSHIPS</span>
                    </div>
                    <div className="divide-y divide-[#ffffff04]">
                      {brief.keyRelationships.slice(0, 6).map((rel, i) => (
                        <div key={i} className="px-4 py-2 flex items-center gap-2">
                          <span className="font-mono text-[9px] text-neutral-300 truncate">{rel.entityA}</span>
                          <span className="font-mono text-[8px] text-neutral-700 flex-shrink-0">—{rel.relationshipType.replace(/_/g, " ")}→</span>
                          <span className="font-mono text-[9px] text-neutral-300 truncate">{rel.entityB}</span>
                          <span className="font-mono text-[8px] text-neutral-700 flex-shrink-0 ml-auto">{Math.round(rel.confidence * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: Angles + Gaps + Queries + Timeline + Financial */}
              <div className="space-y-3">

                {/* Investigative Angles */}
                {brief.likelyAngles.length > 0 && (
                  <div className="border border-[#ffffff08] bg-[#0a0c10]">
                    <div className="px-4 py-2 border-b border-[#ffffff08] flex items-center gap-2">
                      <span className="w-1 h-3 bg-red-800 flex-shrink-0" />
                      <span className="font-mono text-[9px] text-neutral-400 uppercase tracking-[0.15em]">LIKELY ANGLES</span>
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      {brief.likelyAngles.map((angle, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className="w-1 h-1 bg-red-700 rounded-full flex-shrink-0 mt-1.5" />
                          <span className="font-mono text-[10px] text-neutral-300 leading-snug">{angle}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Intelligence Gaps */}
                {brief.knownGaps.length > 0 && (
                  <div className="border border-[#ffffff08] bg-[#0a0c10]">
                    <div className="px-4 py-2 border-b border-[#ffffff08] flex items-center gap-2">
                      <span className="w-1 h-3 bg-amber-800 flex-shrink-0" />
                      <span className="font-mono text-[9px] text-neutral-400 uppercase tracking-[0.15em]">INTELLIGENCE GAPS</span>
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      {brief.knownGaps.map((gap, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <AlertTriangle className="w-2.5 h-2.5 text-amber-700 flex-shrink-0 mt-0.5" />
                          <span className="font-mono text-[10px] text-amber-400/70 leading-snug">{gap}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggested Queries */}
                {brief.suggestedNextQueries.length > 0 && (
                  <div className="border border-[#ffffff08] bg-[#0a0c10]">
                    <div className="px-4 py-2 border-b border-[#ffffff08] flex items-center gap-2">
                      <span className="w-1 h-3 bg-neutral-700 flex-shrink-0" />
                      <span className="font-mono text-[9px] text-neutral-400 uppercase tracking-[0.15em]">NEXT QUERIES</span>
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      {brief.suggestedNextQueries.map((q, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <Search className="w-2.5 h-2.5 text-neutral-600 flex-shrink-0 mt-0.5" />
                          <span className="font-mono text-[9px] text-neutral-400 leading-snug break-all">{q}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Timeline preview */}
                {brief.topTimeline.length > 0 && (
                  <div className="border border-[#ffffff08] bg-[#0a0c10]">
                    <div className="px-4 py-2 border-b border-[#ffffff08] flex items-center gap-2">
                      <span className="w-1 h-3 bg-blue-900 flex-shrink-0" />
                      <span className="font-mono text-[9px] text-neutral-400 uppercase tracking-[0.15em]">TIMELINE ({brief.topTimeline.length})</span>
                    </div>
                    <div className="divide-y divide-[#ffffff04]">
                      {brief.topTimeline.slice(0, 5).map((ev) => (
                        <div key={ev.id} className="px-4 py-2">
                          <div className="font-mono text-[8px] text-neutral-700">{ev.eventDate?.slice(0, 10)}</div>
                          <div className="font-mono text-[9px] text-neutral-300 leading-snug mt-0.5 truncate">
                            {ev.title.replace(/^\[[A-Z_]+\]\s*/, "")}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Financial preview */}
                {brief.topFinancial.length > 0 && (
                  <div className="border border-[#ffffff08] bg-[#0a0c10]">
                    <div className="px-4 py-2 border-b border-[#ffffff08] flex items-center gap-2">
                      <span className="w-1 h-3 bg-green-900 flex-shrink-0" />
                      <span className="font-mono text-[9px] text-neutral-400 uppercase tracking-[0.15em]">FINANCIAL ({brief.topFinancial.length})</span>
                    </div>
                    <div className="divide-y divide-[#ffffff04]">
                      {brief.topFinancial.slice(0, 4).map((sig) => (
                        <div key={sig.id} className="px-4 py-2">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] text-green-400 font-bold">{sig.amountRaw}</span>
                            <span className="font-mono text-[8px] text-neutral-700">{sig.signalType}</span>
                          </div>
                          {sig.entityName && <div className="font-mono text-[8px] text-neutral-500 mt-0.5">{sig.entityName}</div>}
                          {sig.eventSummary && <div className="font-mono text-[8px] text-neutral-600 mt-0.5 truncate">{sig.eventSummary.slice(0, 80)}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stats */}
                <div className="border border-[#ffffff08] bg-[#0a0c10] px-4 py-3">
                  <div className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest mb-2">CASE STATISTICS</div>
                  {[
                    ["Documents", `${brief.stats.usableDocs} usable / ${brief.stats.totalDocs} total`],
                    ["Entities", brief.stats.totalEntities.toString()],
                    ["Timeline", brief.stats.totalTimeline.toString()],
                    ["Financial", brief.stats.totalFinancial.toString()],
                    ["Relationships", (brief.stats.totalRelationships ?? 0).toString()],
                  ].map(([label, val]) => (
                    <div key={label} className="flex justify-between py-0.5">
                      <span className="font-mono text-[9px] text-neutral-600">{label}</span>
                      <span className="font-mono text-[9px] text-neutral-400">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Flow Trace Panel ────────────────────────────────────────────────────────

function FlowTracePanel({ moneyFlows, financialSignals }: { moneyFlows: MoneyFlow[]; financialSignals: any[] }) {
  const SIGNAL_COLOR: Record<string, string> = {
    fraud_misuse: "text-red-400",
    contract: "text-purple-400",
    grant: "text-emerald-400",
    appropriation: "text-blue-400",
    cut_reallocation: "text-orange-400",
    expenditure: "text-yellow-400",
    program_funding: "text-green-400",
    payment: "text-green-400",
    transfer: "text-cyan-400",
    investment: "text-blue-400",
    loan: "text-yellow-400",
    fine: "text-red-400",
    bribe: "text-red-500",
    revenue: "text-green-500",
    expense: "text-orange-400",
  };

  const SIGNAL_BORDER: Record<string, string> = {
    fraud_misuse: "border-red-900/40",
    contract: "border-purple-900/30",
    grant: "border-emerald-900/30",
    appropriation: "border-blue-900/30",
    cut_reallocation: "border-orange-900/30",
    expenditure: "border-yellow-900/20",
    program_funding: "border-green-900/20",
  };

  const hasData = financialSignals.length > 0 || moneyFlows.length > 0;

  function confColor(conf: number | null): string {
    if (conf === null) return "text-neutral-700";
    if (conf >= 0.85) return "text-green-500";
    if (conf >= 0.70) return "text-yellow-500";
    return "text-orange-500";
  }

  return (
    <div className="nexus-panel rounded-none h-full flex flex-col">
      <div className="nexus-header-strip flex items-center justify-between">
        <span className="nexus-label">FLOW TRACE</span>
        {financialSignals.length > 0 && (
          <span className="font-mono text-[9px] text-green-500 pr-3">
            {financialSignals.length} VERIFIED SIGNAL{financialSignals.length !== 1 ? "S" : ""}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {!hasData ? (
          <div className="py-12 text-center space-y-2">
            <TrendingUp className="w-6 h-6 text-neutral-800 mx-auto mb-3" />
            <div className="font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
              NO FINANCIAL SIGNALS DETECTED
            </div>
            <div className="font-mono text-[9px] text-neutral-800 uppercase mt-1 max-w-[240px] mx-auto leading-relaxed">
              INGEST DOCUMENTS REFERENCING BUDGETS, CONTRACTS, GRANTS OR APPROPRIATIONS TO AUTO-DETECT SIGNALS
            </div>
          </div>
        ) : (
          <>
            {financialSignals.length > 0 && (
              <div>
                <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest mb-2">
                  AUTO-DETECTED FINANCIAL SIGNALS
                </div>
                <div className="space-y-2">
                  {financialSignals.map((sig: any) => {
                    const typeKey = (sig.signalType || "").toLowerCase();
                    const borderClass = SIGNAL_BORDER[typeKey] ?? "border-[#ffffff0d]";
                    const conf: number | null = sig.financialConfidence ?? null;
                    const isNonNumeric = sig.signalType?.startsWith("NON_NUMERIC") || sig.amountDisplay === "NON-NUMERIC";
                    const signalStrength = isNonNumeric || (conf !== null && conf < 0.40) ? "WEAK" :
                      sig.inferredSignal ? "INFERRED" :
                      conf !== null && conf >= 0.75 ? "STRONG" : "MODERATE";
                    const strengthClass = signalStrength === "STRONG" ? "text-green-400 border-green-900/50" :
                      signalStrength === "INFERRED" ? "text-cyan-500 border-cyan-900/50" :
                      signalStrength === "MODERATE" ? "text-neutral-500 border-neutral-800" :
                      "text-amber-700 border-amber-900/40";
                    return (
                    <div
                      key={sig.id}
                      className={`p-3 border ${isNonNumeric ? "border-amber-900/20 bg-amber-950/5" : borderClass + " bg-[#0a0e14]"} space-y-2`}
                    >
                      {/* Header: type badge + strength badge + amount */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 border border-[#ffffff10] ${SIGNAL_COLOR[typeKey] ?? "text-neutral-400"}`}>
                          {sig.signalType?.replace(/^NON_NUMERIC_/, "").replace(/_/g, " ") || "SIGNAL"}
                        </span>
                        <span className={`text-[7px] font-mono uppercase px-1 py-0.5 border ${strengthClass} tracking-wider`}>
                          {signalStrength} SIGNAL
                        </span>
                        {conf !== null && (
                          <span className={`text-[8px] font-mono uppercase ${confColor(conf)}`}>
                            CONF {Math.round(conf * 100)}%
                          </span>
                        )}
                        {(sig.amountDisplay || sig.amountRaw) && !isNonNumeric && (
                          <span className="ml-auto text-lg font-bold text-green-400 font-mono tabular-nums leading-none">
                            {sig.amountDisplay || sig.amountRaw}
                          </span>
                        )}
                        {isNonNumeric && (
                          <span className="ml-auto text-[10px] font-bold text-amber-700/60 font-mono uppercase tracking-wider">
                            NON-NUMERIC
                          </span>
                        )}
                      </div>

                      {/* Actor flow: controlledBy → receivedBy / entityName */}
                      {(sig.controlledBy || sig.receivedBy || sig.entityName) && (
                        <div className="flex items-center gap-1.5 flex-wrap font-mono text-[9px]">
                          {sig.controlledBy && (
                            <>
                              <span className="text-neutral-600 uppercase">CONTROLS:</span>
                              <span className="text-amber-400 uppercase">{sig.controlledBy}</span>
                            </>
                          )}
                          {sig.controlledBy && sig.receivedBy && (
                            <span className="text-green-700">→</span>
                          )}
                          {sig.receivedBy && (
                            <>
                              <span className="text-neutral-600 uppercase">RECEIVES:</span>
                              <span className="text-cyan-400 uppercase">{sig.receivedBy}</span>
                            </>
                          )}
                          {!sig.controlledBy && !sig.receivedBy && sig.entityName && (
                            <>
                              <span className="text-neutral-600 uppercase">ENTITY:</span>
                              <span className="text-cyan-400 uppercase">{sig.entityName}</span>
                            </>
                          )}
                        </div>
                      )}

                      {/* Program name */}
                      {sig.programName && (
                        <div className="font-mono text-[9px] text-neutral-500 uppercase tracking-wide">
                          PROGRAM: <span className="text-neutral-300">{sig.programName}</span>
                        </div>
                      )}

                      {/* Event summary */}
                      {sig.eventSummary && (
                        <p className="text-[11px] text-neutral-400 leading-relaxed font-mono border-t border-[#ffffff05] pt-1.5">
                          {sig.eventSummary.length > 200 ? sig.eventSummary.slice(0, 200) + "…" : sig.eventSummary}
                        </p>
                      )}

                      {/* Source */}
                      {sig.documentTitle && (
                        <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
                          SOURCE: {sig.documentTitle.length > 60 ? sig.documentTitle.slice(0, 60) + "…" : sig.documentTitle}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            {moneyFlows.length > 0 && (
              <div>
                <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest mb-2">
                  MANUAL FLOW RECORDS
                </div>
                <div className="space-y-2">
                  {moneyFlows.map((mf) => (
                    <div
                      key={mf.id}
                      className="p-3 border border-[#ffffff0d] bg-[#0a0e14] space-y-1.5"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-cyan-400 uppercase">
                          {mf.sourceEntityName}
                        </span>
                        <span className="text-[9px] font-mono text-green-500">→</span>
                        <span className="text-sm font-bold text-cyan-400 uppercase">
                          {mf.destinationEntityName}
                        </span>
                        {mf.amount && (
                          <span className="ml-auto text-sm font-bold text-green-400 font-mono">
                            {mf.currency || "USD"}&nbsp;
                            {mf.amount.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 font-mono text-[9px] text-neutral-600">
                        {mf.date && <span>DATE: {mf.date}</span>}
                        {mf.confidenceLevel && (
                          <span>CONF: <span className="text-neutral-400">{mf.confidenceLevel}</span></span>
                        )}
                      </div>
                      {mf.description && (
                        <p className="text-xs text-neutral-500">{mf.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Default Inspector ───────────────────────────────────────────────────────

interface NextActionConfig {
  message: string;
  cta: string;
  navigate: SectionId;
  icon: React.ElementType;
  color: string;
}

function DefaultInspector({
  caseId,
  caseData,
  entities,
  documents,
  notes,
  pendingMentions,
  nextAction,
  onNavigate,
  financialSignalCount = 0,
  timelineCount = 0,
  relationshipCount = 0,
}: {
  caseId: number;
  caseData: {
    title: string;
    description?: string | null;
    tags?: string[] | null;
    status: string;
  };
  entities: Entity[];
  documents: Document[];
  notes: Note[];
  pendingMentions: number;
  nextAction: NextActionConfig | null;
  onNavigate: (s: SectionId) => void;
  financialSignalCount?: number;
  timelineCount?: number;
  relationshipCount?: number;
}) {
  const queryClient = useQueryClient();
  const [ctrlMsg, setCtrlMsg] = React.useState<string | null>(null);
  const [ctrlWorking, setCtrlWorking] = React.useState(false);
  const [dossier, setDossier] = React.useState<null | Record<string, any>>(null);
  const [dossierLoading, setDossierLoading] = React.useState(false);
  const [dossierExpanded, setDossierExpanded] = React.useState(false);
  const [exportToast, setExportToast] = React.useState(false);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [triageOpen, setTriageOpen] = React.useState(false);
  const [qualityOpen, setQualityOpen] = React.useState(false);
  const [diagOpen, setDiagOpen] = React.useState(false);
  const [dossierSectionOpen, setDossierSectionOpen] = React.useState(false);
  const [autoTriageResult, setAutoTriageResult] = React.useState<{ promoted: number; rejected: number; held: number } | null>(null);
  const [autoTriageWorking, setAutoTriageWorking] = React.useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });

  const triggerExport = (d: Record<string, any>) => {
    openPrintDossier({
      caseId: Number(caseId),
      caseTitle: caseData.title,
      caseStatus: caseData.status,
      autoBuildQuality: parseSeedDiag(caseData.description)?.autoBuildQuality ?? null,
      entities: entities.map(e => ({ name: e.name, type: e.type, docCount: (e as any).docCount ?? 0 })),
      documents,
      dossierSections: d.sections ?? {},
    });
    setExportToast(true);
    setTimeout(() => setExportToast(false), 3500);
  };

  const handleGenerateAndExport = async () => {
    if (dossier) {
      triggerExport(dossier);
      return;
    }
    setDossierLoading(true);
    setDossierSectionOpen(true);
    try {
      const r = await fetch(`/api/cases/${caseId}/dossier`);
      const d = await r.json();
      setDossier(d);
      setDossierExpanded(true);
      triggerExport(d);
    } catch { /* silent */ } finally { setDossierLoading(false); }
  };

  const bulkReject = async (type: string) => {
    setCtrlWorking(true); setCtrlMsg(null);
    try {
      const r = await fetch(`/api/cases/${caseId}/mentions/bulk-reject`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type })
      });
      const d = await r.json();
      setCtrlMsg(`Rejected ${d.rejected ?? "?"} mention(s).`);
      await invalidate();
    } catch (e) { setCtrlMsg(`Error: ${e}`); } finally { setCtrlWorking(false); }
  };

  const purgeFailedDocs = async () => {
    setCtrlWorking(true); setCtrlMsg(null);
    try {
      const r = await fetch(`/api/cases/${caseId}/documents/purge?type=all-failed`, { method: "DELETE" });
      const d = await r.json();
      setCtrlMsg(`Purged ${d.purged ?? "?"} failed doc(s).`);
      await invalidate();
    } catch (e) { setCtrlMsg(`Error: ${e}`); } finally { setCtrlWorking(false); }
  };

  const handleAutoTriage = async () => {
    setAutoTriageWorking(true);
    setAutoTriageResult(null);
    try {
      const r = await fetch(`/api/cases/${caseId}/mentions/auto-triage`, { method: "POST" });
      const d = await r.json();
      setAutoTriageResult({ promoted: d.promoted ?? 0, rejected: d.rejected ?? 0, held: d.held ?? 0 });
      await invalidate();
    } catch { /* silent */ } finally { setAutoTriageWorking(false); }
  };

  const sd = parseSeedDiag(caseData.description);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="atlas-module-header flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-0.5 h-3.5 flex-shrink-0" style={{ background: "rgba(220,38,38,0.6)" }} />
          <span className="atlas-module-label">CASE INTELLIGENCE</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">

        {/* ══ ZONE 1: STATUS OVERVIEW (compact, always visible) ══ */}
        {(() => {
          const usableDocs = sd ? (sd.ok + sd.partial) : documents.length;
          const blockedDocs = sd ? (sd.failed + sd.wrapper) : 0;
          const abq = sd?.autoBuildQuality ?? null;
          const abqMeta: Record<string, { color: string; bar: string; label: string }> = {
            STRONG:      { color: "text-green-400",  bar: "bg-green-500",  label: "STRONG" },
            PROVISIONAL: { color: "text-sky-400",    bar: "bg-sky-500",    label: "PROVISIONAL" },
            MODERATE:    { color: "text-cyan-400",   bar: "bg-cyan-500",   label: "MODERATE" },
            RECOVERED:   { color: "text-teal-400",   bar: "bg-teal-500",   label: "RECOVERED" },
            WEAK:        { color: "text-amber-500",  bar: "bg-amber-600",  label: "WEAK" },
            FAILED:      { color: "text-red-600",    bar: "bg-red-700",    label: "FAILED" },
          };
          const meta = abq ? (abqMeta[abq] ?? abqMeta.WEAK) : null;
          const funnelSteps = sd ? [
            { label: "INGESTED",  val: sd.ingested,      color: "text-cyan-600" },
            { label: "USABLE",    val: usableDocs,        color: usableDocs > 0 ? "text-green-500" : "text-neutral-700" },
            { label: "ENTITIES",  val: sd.finalPromoted,  color: sd.finalPromoted > 0 ? "text-green-400" : "text-red-700" },
            { label: "PENDING",   val: pendingMentions,   color: pendingMentions > 0 ? "text-amber-500" : "text-neutral-700" },
          ] : [
            { label: "DOCS",     val: documents.length,  color: documents.length > 0 ? "text-white" : "text-neutral-700" },
            { label: "USABLE",   val: usableDocs,        color: usableDocs > 0 ? "text-green-500" : "text-neutral-700" },
            { label: "ENTITIES", val: entities.length,   color: entities.length > 0 ? "text-cyan-500" : "text-neutral-700" },
            { label: "PENDING",  val: pendingMentions,   color: pendingMentions > 0 ? "text-amber-500" : "text-neutral-700" },
          ];
          const rejectEntries = sd ? Object.entries(sd.rejectReasons).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 3) : [];
          return (
            <div style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {/* Compact always-visible summary strip */}
              <div className="px-3 pt-2.5 pb-2.5" style={{ background: "rgba(0,0,0,0.3)" }}>
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    {meta && <div className={`w-0.5 h-3.5 rounded-full ${meta.bar} opacity-60 flex-shrink-0`} />}
                    <span className={`font-mono text-[9px] font-bold uppercase tracking-widest ${meta ? meta.color : "text-neutral-700"}`}>
                      {meta ? meta.label : "AWAITING BUILD"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(sd?.highContam ?? 0) > 0 && (
                      <span className="font-mono text-[7px] text-orange-600 border border-orange-900/30 px-1 uppercase">{sd!.highContam}× CONTAM</span>
                    )}
                    {sd?.recoveryTriggered && (
                      <span className="font-mono text-[7px] text-teal-600 border border-teal-900/30 px-1 uppercase">RECOV</span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-4 divide-x divide-[#ffffff06]">
                  {funnelSteps.map(step => (
                    <div key={step.label} className="pl-2 first:pl-0">
                      <div className={`font-mono text-base font-bold tabular-nums leading-none ${step.color}`}>
                        {(step.val ?? 0).toString().padStart(2, "0")}
                      </div>
                      <div className="font-mono text-[6px] text-neutral-800 uppercase tracking-wider mt-0.5">{step.label}</div>
                    </div>
                  ))}
                </div>
                {sd && sd.detected > 0 && (
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span className="font-mono text-[9px] text-neutral-500 tabular-nums">{sd.detected} detected</span>
                    <span className="font-mono text-[9px] text-neutral-700">→</span>
                    {pendingMentions > 0 ? (
                      <span className="font-mono text-[9px] font-bold text-amber-500 uppercase tracking-wide tabular-nums">
                        {pendingMentions} require review
                      </span>
                    ) : (
                      <span className="font-mono text-[9px] text-green-600 uppercase tracking-wide">
                        auto-processed
                      </span>
                    )}
                  </div>
                )}
                {blockedDocs > 0 && (
                  <div className="mt-1 font-mono text-[7px] text-red-800 uppercase tracking-wide">
                    {blockedDocs} source{blockedDocs > 1 ? "s" : ""} blocked
                  </div>
                )}
                {/* Coverage matrix — 5-dimension investigation readiness */}
                {(() => {
                  const docCount = sd ? (sd.ok + sd.partial) : documents.length;
                  const entityCount = sd ? sd.finalPromoted : entities.length;
                  const dimColor = (val: number, thresh: number) =>
                    val >= thresh ? "rgba(34,197,94,0.6)" : val > 0 ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.06)";
                  const dims = [
                    { label: "SRC",  val: docCount,              thresh: 3 },
                    { label: "ENT",  val: entityCount,           thresh: 2 },
                    { label: "REL",  val: relationshipCount,     thresh: 1 },
                    { label: "FIN",  val: financialSignalCount,  thresh: 1 },
                    { label: "TL",   val: timelineCount,         thresh: 2 },
                  ];
                  return (
                    <div className="mt-2.5 flex items-end gap-1" title="Investigation coverage: SOURCES / ENTITIES / RELATIONSHIPS / FINANCIAL / TIMELINE">
                      {dims.map(d => (
                        <div key={d.label} className="flex flex-col items-center gap-0.5 flex-1">
                          <div className="w-full h-1 rounded-full" style={{ background: dimColor(d.val, d.thresh) }} />
                          <div className="font-mono text-[5.5px] text-neutral-800 uppercase">{d.label}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              {/* Collapsible full system report */}
              <button onClick={() => setStatusOpen(o => !o)} className={cn("atlas-collapse-btn", statusOpen && "open")}>
                <span>SYSTEM REPORT</span>
                <span className="font-mono text-[8px]" style={{ color: "rgba(255,255,255,0.15)" }}>{statusOpen ? "▲" : "▼"}</span>
              </button>
              {statusOpen && (
                <div className="px-3 pb-3 space-y-2 pt-1 atlas-fade-in">
                  {sd && (sd.promotedConfirmed > 0 || sd.promotedStrong > 0 || (sd.heldCandidates ?? 0) > 0) && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[7px] text-neutral-800 uppercase tracking-wider">TIER</span>
                      {sd.promotedConfirmed > 0 && <span className="font-mono text-[8px] text-green-600 uppercase">{sd.promotedConfirmed} T1-CONF</span>}
                      {sd.promotedStrong > 0 && <span className="font-mono text-[8px] text-cyan-700 uppercase">{sd.promotedStrong} T1b-STR</span>}
                      {(sd.heldCandidates ?? 0) > 0 && <span className="font-mono text-[8px] text-amber-600 uppercase">{sd.heldCandidates} HELD</span>}
                    </div>
                  )}
                  {rejectEntries.length > 0 && (
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-[7px] text-neutral-800 uppercase tracking-wider">BLOCKED</span>
                      {rejectEntries.map(([reason, count]) => (
                        <span key={reason} className="font-mono text-[7px] uppercase">
                          <span className="text-red-800">{count}×</span>
                          <span className="text-neutral-800 ml-1">{reason.replace(/_/g, "-")}</span>
                        </span>
                      ))}
                      {sd && sd.rejectedFw > 0 && (
                        <span className="font-mono text-[7px] text-neutral-800 ml-auto">{sd.rejectedFw} FW</span>
                      )}
                    </div>
                  )}
                  {sd?.seedIntent && sd.seedIntent !== "general" && (
                    <div className="font-mono text-[7px] text-violet-700 uppercase">
                      INTENT: {SEED_INTENT_LABELS[sd.seedIntent] || sd.seedIntent}
                    </div>
                  )}
                  {sd && sd.finalPromoted === 0 && sd.detected === 0 && (sd.ok + sd.partial) === 0 && (
                    <div className="font-mono text-[8px] text-red-700 uppercase tracking-wide bg-red-950/10 border border-red-900/20 px-2 py-1.5">
                      ALL SOURCES BLOCKED — ADD SOURCES MANUALLY
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ══ ZONE 2: INTEL BRIEF (always visible, prominent) ══ */}
        {caseData.description && cleanDescription(caseData.description) && (() => {
          const raw = cleanDescription(caseData.description);
          const SECTIONS_RE = /\b(WHAT|PRIMARY ACTORS|PRIMARY INSTITUTIONS|DOCUMENT SIGNALS|LIKELY ANGLE):/g;
          const parts: Array<{ label: string; text: string }> = [];
          let match: RegExpExecArray | null;
          const positions: Array<{ label: string; start: number; end: number }> = [];
          while ((match = SECTIONS_RE.exec(raw)) !== null) {
            positions.push({ label: match[1], start: match.index, end: match.index + match[0].length });
          }
          if (positions.length >= 2) {
            for (let i = 0; i < positions.length; i++) {
              const { label, end } = positions[i];
              const nextStart = i + 1 < positions.length ? positions[i + 1].start : raw.length;
              const text = raw.slice(end, nextStart).trim().replace(/\.$/, "");
              parts.push({ label, text });
            }
            if (parts.length > 0) {
              const lastPart = parts[parts.length - 1];
              const splitIdx = lastPart.text.indexOf(". ");
              if (splitIdx > 0) {
                const note = lastPart.text.slice(splitIdx + 2).trim();
                parts[parts.length - 1] = { ...lastPart, text: lastPart.text.slice(0, splitIdx) };
                if (note) parts.push({ label: "NOTE", text: note });
              }
            }
            return (
              <div
                style={{
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  borderLeft: "2px solid rgba(220,38,38,0.2)",
                  background: "linear-gradient(to right, rgba(220,38,38,0.04), transparent 80%)",
                }}
                className="px-3 py-3 space-y-2"
              >
                <div className="font-mono text-[7px] text-neutral-700 uppercase tracking-[0.2em] mb-1">INTEL BRIEF</div>
                <div className="space-y-1.5">
                  {parts.map(({ label, text }) => (
                    <div key={label} className="flex gap-2">
                      <span className={cn(
                        "font-mono text-[7px] uppercase tracking-wider flex-shrink-0 mt-0.5 w-16",
                        label === "WHAT" ? "text-neutral-600" :
                        label === "PRIMARY ACTORS" ? "text-cyan-700" :
                        label === "PRIMARY INSTITUTIONS" ? "text-violet-700" :
                        label === "DOCUMENT SIGNALS" ? "text-blue-700" :
                        label === "LIKELY ANGLE" ? "text-amber-700" :
                        "text-neutral-700"
                      )}>{label}:</span>
                      <span className="font-mono text-[9px] text-neutral-300 leading-relaxed">{text}</span>
                    </div>
                  ))}
                </div>
                {caseData.tags && caseData.tags.filter((t) => t !== "auto-seeded").length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {caseData.tags.filter((t) => t !== "auto-seeded").map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 border border-[#ffffff0d] font-mono text-[7px] text-neutral-800 uppercase">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return (
            <div
              style={{
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                borderLeft: "2px solid rgba(220,38,38,0.2)",
                background: "linear-gradient(to right, rgba(220,38,38,0.04), transparent 80%)",
              }}
              className="px-3 py-3"
            >
              <div className="font-mono text-[7px] text-neutral-700 uppercase tracking-[0.2em] mb-1.5">INTEL BRIEF</div>
              <p className="font-mono text-[9px] text-neutral-300 leading-relaxed">{raw}</p>
            </div>
          );
        })()}

        {/* ══ ZONE 3: NEXT ACTION (dominant command box) ══ */}
        {nextAction && (
          <div style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <button
              className="atlas-next-action-box w-full text-left group"
              onClick={() => onNavigate(nextAction.navigate)}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1 h-1 rounded-full bg-red-500" style={{ boxShadow: "0 0 4px rgba(220,38,38,0.8)" }} />
                <span className="font-mono text-[7px] text-neutral-600 uppercase tracking-[0.22em]">NEXT ACTION</span>
              </div>
              <div className={cn("font-mono text-[10px] font-bold uppercase tracking-wide leading-snug mb-2.5", nextAction.color)}>
                {nextAction.message}
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[8px] text-neutral-600 group-hover:text-neutral-400 uppercase tracking-widest transition-colors">{nextAction.cta}</span>
                <nextAction.icon className="w-3 h-3 text-neutral-700 group-hover:text-neutral-400 transition-colors" />
              </div>
            </button>
          </div>
        )}

        {/* ══ SECTION 3: TRIAGE SUMMARY + ACTIONS ══ */}
        {pendingMentions > 0 && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            {/* Always-visible triage summary strip */}
            <div className="atlas-triage-summary">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[9px] font-bold text-amber-500 uppercase tracking-widest tabular-nums">
                  {pendingMentions} PENDING
                </div>
                <div className="font-mono text-[7px] text-neutral-700 uppercase tracking-wider mt-0.5">
                  Entities awaiting analyst approval
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={handleAutoTriage}
                  disabled={autoTriageWorking}
                  className="font-mono text-[7px] uppercase tracking-widest transition-colors disabled:opacity-40"
                  style={{ color: autoTriageWorking ? "rgba(139,92,246,0.4)" : "rgba(139,92,246,0.7)" }}
                  title="Auto-classify pending entities using admission rules"
                >
                  {autoTriageWorking ? "TRIAGING…" : "AUTO-TRIAGE"}
                </button>
                <button
                  onClick={() => onNavigate("documents")}
                  className="font-mono text-[7px] text-neutral-700 hover:text-amber-400 uppercase tracking-widest transition-colors"
                >
                  REVIEW →
                </button>
              </div>
            </div>
            {/* Auto-triage result feedback */}
            {autoTriageResult && (
              <div className="px-3 pb-2 flex items-center gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                <div className="flex items-center gap-1">
                  <div className="w-1 h-1 rounded-full bg-green-500" />
                  <span className="font-mono text-[7px] text-green-600 uppercase">{autoTriageResult.promoted} PROMOTED</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1 h-1 rounded-full bg-red-700" />
                  <span className="font-mono text-[7px] text-red-800 uppercase">{autoTriageResult.rejected} REJECTED</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1 h-1 rounded-full bg-amber-700" />
                  <span className="font-mono text-[7px] text-amber-800 uppercase">{autoTriageResult.held} HELD</span>
                </div>
              </div>
            )}
          </div>
        )}


        {/* ══ SECTION 5: ATLAS DOSSIER ══ */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {/* Header row — ALWAYS visible with export button */}
          <div className="flex items-stretch" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <button
              onClick={() => setDossierSectionOpen(o => !o)}
              className="flex-1 flex items-center justify-between px-3 py-2 font-mono text-[8px] uppercase tracking-widest transition-colors"
              style={{ color: dossierSectionOpen ? "rgba(139,92,246,0.65)" : "rgba(255,255,255,0.2)" }}
            >
              <div className="flex items-center gap-1.5">
                <div className="w-0.5 h-3 rounded-full" style={{ background: dossier ? "rgba(139,92,246,0.6)" : "rgba(255,255,255,0.1)" }} />
                <span>ATLAS DOSSIER</span>
              </div>
              <span className="text-[8px]" style={{ color: "rgba(255,255,255,0.12)" }}>{dossierSectionOpen ? "▲" : "▼"}</span>
            </button>
            <button
              onClick={handleGenerateAndExport}
              disabled={dossierLoading}
              style={{
                borderLeft: "1px solid rgba(255,255,255,0.06)",
                background: dossier
                  ? "linear-gradient(135deg, rgba(139,92,246,0.15), rgba(109,40,217,0.08))"
                  : "rgba(0,0,0,0.2)",
                color: dossier ? "rgba(167,139,250,0.9)" : "rgba(139,92,246,0.55)",
                boxShadow: dossier ? "0 0 8px rgba(139,92,246,0.15)" : "none",
              }}
              className="px-3 py-2 font-mono text-[8px] uppercase tracking-widest flex items-center gap-1.5 flex-shrink-0 transition-all hover:opacity-80 disabled:opacity-40"
            >
              {dossierLoading ? (
                <span className="font-mono text-[7px]">GENERATING...</span>
              ) : dossier ? (
                <>
                  <span style={{ fontSize: "10px" }}>↓</span>
                  <span>EXPORT PDF</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: "10px" }}>⊕</span>
                  <span>GENERATE &amp; EXPORT</span>
                </>
              )}
            </button>
          </div>
          {/* Toast feedback */}
          {exportToast && (
            <div
              className="px-3 py-2 font-mono text-[8px] atlas-fade-in"
              style={{
                background: "rgba(139,92,246,0.08)",
                borderBottom: "1px solid rgba(139,92,246,0.15)",
                color: "rgba(167,139,250,0.8)",
              }}
            >
              ✓ Dossier ready — export window opened
            </div>
          )}
          {dossierSectionOpen && (
            <div className="px-2.5 pb-2.5 space-y-2">
              {!dossier ? (
                <div className="py-3 font-mono text-[8px] text-neutral-700 text-center">
                  Click GENERATE &amp; EXPORT to build and export the dossier.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between pt-2">
                    <span className="font-mono text-[8px] text-violet-700 uppercase tracking-widest">DOSSIER READY</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setDossierExpanded(e => !e)}
                        className="font-mono text-[7px] text-neutral-600 hover:text-neutral-400 uppercase tracking-wider transition-colors"
                      >
                        {dossierExpanded ? "▲ COLLAPSE" : "▼ EXPAND"}
                      </button>
                      <button
                        onClick={() => { setDossier(null); setDossierExpanded(false); }}
                        className="font-mono text-[7px] text-neutral-800 hover:text-neutral-600 uppercase tracking-wider transition-colors"
                      >
                        ↺ REGEN
                      </button>
                    </div>
                  </div>
                  {dossierExpanded && (() => {
                    const s = dossier.sections ?? {};
                    return (
                      <div className="space-y-3 text-[9px] font-mono">
                        {/* SUMMARY */}
                        {s.caseSummary && (
                          <div className="space-y-0.5">
                            <div className="text-[7px] text-violet-700 uppercase tracking-[0.2em]">SUMMARY</div>
                            <p className="text-neutral-500 leading-relaxed text-[8.5px]">{s.caseSummary}</p>
                          </div>
                        )}

                        {/* INTELLIGENCE TIERS — CONFIRMED / DEVELOPING */}
                        {s.keyEntities?.length > 0 && (() => {
                          const confirmed = s.keyEntities.filter((e: any) => (e.docCount ?? 0) >= 3);
                          const developing = s.keyEntities.filter((e: any) => (e.docCount ?? 0) > 0 && (e.docCount ?? 0) < 3);
                          return (
                            <div className="space-y-2">
                              {confirmed.length > 0 && (
                                <div>
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <div className="w-1 h-1 rounded-full bg-green-500" />
                                    <span className="text-[7px] text-green-600 uppercase tracking-[0.2em]">CONFIRMED</span>
                                  </div>
                                  {confirmed.map((e: any) => (
                                    <div key={e.id} className="flex items-center justify-between py-0.5">
                                      <span className="text-neutral-200 uppercase text-[8.5px]">{e.name}</span>
                                      <span className="text-neutral-700 text-[7px]">{e.docCount}d</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {developing.length > 0 && (
                                <div>
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <div className="w-1 h-1 rounded-full bg-amber-500" />
                                    <span className="text-[7px] text-amber-600 uppercase tracking-[0.2em]">DEVELOPING</span>
                                  </div>
                                  {developing.map((e: any) => (
                                    <div key={e.id} className="flex items-center justify-between py-0.5">
                                      <span className="text-neutral-500 uppercase text-[8px]">{e.name}</span>
                                      <span className="text-neutral-800 text-[7px]">{e.docCount}d</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* CONNECTIONS */}
                        {s.entityRelationships?.length > 0 && (
                          <div className="space-y-0.5">
                            <div className="text-[7px] text-blue-700 uppercase tracking-[0.2em]">CONNECTIONS</div>
                            {s.entityRelationships.slice(0, 4).map((r: any, i: number) => (
                              <div key={i} className="text-neutral-600 truncate text-[8px]">
                                <span className="text-neutral-400">{r.entityAName}</span>
                                <span className="text-neutral-700 mx-1">→</span>
                                <span className="text-neutral-400">{r.entityBName}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* TIMELINE */}
                        {s.timelineSignals?.length > 0 && (
                          <div className="space-y-0.5">
                            <div className="text-[7px] text-amber-700 uppercase tracking-[0.2em]">TIMELINE</div>
                            {s.timelineSignals.slice(0, 3).map((t: any, i: number) => (
                              <div key={i} className="flex gap-1.5 text-[8px]">
                                <span className="text-neutral-700 flex-shrink-0 tabular-nums">{t.date?.slice(0, 10) ?? "?"}</span>
                                <span className="text-neutral-500 truncate">{t.title}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* FINANCIAL — T004: structured signals from financialSignalsTable */}
                        <div className="space-y-1">
                          <div className="text-[7px] text-green-700 uppercase tracking-[0.2em]">FINANCIAL FLOWS</div>
                          {(s.financialSignals?.length ?? 0) > 0 ? (
                            s.financialSignals.slice(0, 5).map((f: any, i: number) => (
                              <div key={i} style={{ borderLeft: "2px solid rgba(34,197,94,0.2)", paddingLeft: "6px" }}>
                                <div className="flex items-baseline justify-between gap-1">
                                  <div className="text-neutral-300 text-[8px] font-bold uppercase truncate">{f.entityName}</div>
                                  {(f.amountDisplay || f.amountRaw) && (
                                    <div className="text-green-500 text-[8.5px] font-mono font-bold flex-shrink-0">{f.amountDisplay ?? f.amountRaw}</div>
                                  )}
                                </div>
                                {f.signalType && (
                                  <div className="text-[7px] text-green-900 uppercase tracking-wider">{f.signalType.replace(/_/g, " ")}</div>
                                )}
                                {(f.eventSummary || f.programName) && (
                                  <div className="text-neutral-700 text-[7.5px] leading-snug mt-0.5 line-clamp-2">
                                    {f.programName ? `[${f.programName}] ` : ""}{f.eventSummary ?? ""}
                                  </div>
                                )}
                                {(f.controlledBy || f.receivedBy) && (
                                  <div className="text-[7px] text-neutral-800 mt-0.5 flex gap-2">
                                    {f.controlledBy && <span>FROM: {f.controlledBy}</span>}
                                    {f.receivedBy && <span>TO: {f.receivedBy}</span>}
                                  </div>
                                )}
                                {f.confidence !== undefined && f.confidence !== null && (
                                  <div className="text-[7px] text-neutral-800 mt-0.5 flex items-center gap-1">
                                    <span>CONF: {Math.round((f.confidence ?? 0) * 100)}%</span>
                                    {f.inferred && <span className="text-amber-900">INFERRED</span>}
                                  </div>
                                )}
                              </div>
                            ))
                          ) : (
                            <div style={{ borderLeft: "2px solid rgba(255,255,255,0.06)", paddingLeft: "6px" }} className="space-y-1">
                              <div className="text-[7.5px] text-neutral-700">No financial flows detected.</div>
                              <div className="text-[7px] text-neutral-800">Expected: contracts, grants, appropriations, budgets.</div>
                              <div className="text-[7px] text-neutral-800 mt-0.5">Ingest: budget reports · contract disclosures · audit findings</div>
                            </div>
                          )}
                        </div>

                        {/* ANGLES */}
                        {s.investigativeAngles?.length > 0 && (
                          <div className="space-y-0.5">
                            <div className="text-[7px] text-orange-700 uppercase tracking-[0.2em]">ANGLES</div>
                            {s.investigativeAngles.map((a: any, i: number) => (
                              <div key={i} className="text-neutral-600 flex gap-1 text-[8px]">
                                <span className="text-neutral-800 flex-shrink-0">·</span>
                                <span>{a.angle}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* POWER STRUCTURE */}
                        {s.powerStructure && (
                          <div className="space-y-0.5" style={{ borderLeft: "2px solid rgba(6,182,212,0.2)", paddingLeft: "6px" }}>
                            <div className="text-[7px] text-cyan-800 uppercase tracking-[0.2em]">POWER STRUCTURE</div>
                            <p className="text-neutral-600 leading-relaxed text-[7.5px]">{s.powerStructure}</p>
                          </div>
                        )}

                        {/* RISK FLAGS */}
                        {(s.riskFlags?.length ?? 0) > 0 && (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <div className="w-1 h-1 rounded-full bg-orange-700" />
                              <span className="text-[7px] text-orange-800 uppercase tracking-[0.2em]">RISK FLAGS</span>
                            </div>
                            {s.riskFlags.slice(0, 4).map((flag: string, i: number) => (
                              <div key={i} className="text-[7.5px] text-orange-900/80 pl-2.5 leading-relaxed">⚠ {flag}</div>
                            ))}
                          </div>
                        )}

                        {/* WHY THIS MATTERS */}
                        {s.whyItMatters && (
                          <div className="space-y-0.5" style={{ borderLeft: "2px solid rgba(239,68,68,0.25)", paddingLeft: "6px" }}>
                            <div className="text-[7px] text-red-700 uppercase tracking-[0.2em]">WHY THIS MATTERS</div>
                            <p className="text-neutral-500 leading-relaxed text-[8px]">{s.whyItMatters}</p>
                          </div>
                        )}

                        {/* RECOMMENDED ACTIONS */}
                        {(s.recommendedActions?.length ?? 0) > 0 && (
                          <div className="space-y-0.5">
                            <div className="text-[7px] text-green-800 uppercase tracking-[0.2em]">RECOMMENDED ACTIONS</div>
                            {s.recommendedActions.slice(0, 4).map((action: string, i: number) => (
                              <div key={i} className="text-[7.5px] text-green-900/70 pl-2.5 leading-relaxed">→ {action}</div>
                            ))}
                          </div>
                        )}

                        {/* INTELLIGENCE GAPS — server-computed */}
                        {(s.knownGaps?.length ?? 0) > 0 && (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <div className="w-1 h-1 rounded-full bg-amber-800" />
                              <span className="text-[7px] text-amber-800 uppercase tracking-[0.2em]">INTELLIGENCE GAPS</span>
                            </div>
                            {s.knownGaps.map((g: string, i: number) => (
                              <div key={i} className="text-[7.5px] text-neutral-800 pl-2.5 leading-relaxed">· {g}</div>
                            ))}
                          </div>
                        )}

                        {/* CONFIDENCE NOTE */}
                        {s.confidenceNote && (
                          <div className="px-2 py-1.5 rounded" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                            <div className="text-[7px] text-neutral-800 uppercase tracking-[0.2em] mb-0.5">CONFIDENCE</div>
                            <div className="text-[7.5px] text-neutral-700 leading-relaxed">{s.confidenceNote}</div>
                          </div>
                        )}

                        {/* QUERY EXPANSION */}
                        {s.nextQueries?.length > 0 && (
                          <div className="space-y-0.5">
                            <div className="text-[7px] text-neutral-700 uppercase tracking-[0.2em]">EXPAND</div>
                            {s.nextQueries.slice(0, 4).map((q: string, i: number) => (
                              <div key={i} className="text-neutral-800 text-[7.5px] truncate font-mono">→ {q}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ══ SECTION 6: DIAGNOSTICS ══ (collapsed by default) */}
        {sd && (
          <div>
            <button
              onClick={() => setDiagOpen(o => !o)}
              className={cn("atlas-collapse-btn", diagOpen && "open")}
            >
              <span>DIAGNOSTICS</span>
              <span className="font-mono text-[8px]" style={{ color: "rgba(255,255,255,0.15)" }}>{diagOpen ? "▲" : "▼"}</span>
            </button>
            {diagOpen && (
              <div className="px-3 pb-3 space-y-2">
                {/* Reject reasons */}
                {(() => {
                  const rejectEntries = Object.entries(sd.rejectReasons ?? {})
                    .filter(([, v]) => (v as number) > 0)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .slice(0, 5);
                  return rejectEntries.length > 0 ? (
                    <div className="space-y-0.5">
                      <div className="font-mono text-[7px] text-neutral-800 uppercase tracking-widest">REJECT REASONS</div>
                      {rejectEntries.map(([reason, count]) => (
                        <div key={reason} className="flex items-center justify-between">
                          <span className="font-mono text-[8px] text-neutral-700 uppercase">{reason.replace(/_/g, "-")}</span>
                          <span className="font-mono text-[8px] text-red-800">{count as number}×</span>
                        </div>
                      ))}
                    </div>
                  ) : null;
                })()}
                {/* Numeric metrics */}
                <div className="space-y-0.5">
                  <div className="font-mono text-[7px] text-neutral-800 uppercase tracking-widest">RAW COUNTS</div>
                  {[
                    { label: "detected", val: sd.detected },
                    { label: "admitted", val: sd.admitted },
                    { label: "held cand.", val: sd.heldCandidates },
                    { label: "suppressed", val: sd.suppressedNoise },
                    { label: "fw blocked", val: sd.rejectedFw },
                    { label: "artifact rej.", val: sd.artifactRejected },
                  ].filter(x => (x.val ?? 0) > 0).map(({ label, val }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="font-mono text-[8px] text-neutral-800 uppercase">{label}</span>
                      <span className="font-mono text-[8px] text-neutral-700">{val}</span>
                    </div>
                  ))}
                </div>
                {sd.fallback && (
                  <div className="font-mono text-[7px] text-amber-800 uppercase">FALLBACK MODE ACTIVE</div>
                )}
                {sd.recoveryTriggered && sd.recoveryReason && (
                  <div className="font-mono text-[7px] text-teal-800 uppercase truncate" title={sd.recoveryReason}>
                    RECOVERY: {sd.recoveryReason}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
