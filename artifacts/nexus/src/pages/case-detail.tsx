import React, { useState, useCallback, useMemo, useEffect } from "react";
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
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

import GraphCanvas, { LinkIntelPanel, EntityIntelPanel, SuggestedEdge } from "./case-tabs/graph-view";
import EntitiesTab from "./case-tabs/entities-tab";
import DocumentsTab, { DocumentInspector, DocumentViewer } from "./case-tabs/documents-tab";
import TimelineTab from "./case-tabs/timeline-tab";
import NotesTab from "./case-tabs/notes-tab";
import WebIngestTab from "./case-tabs/web-ingest-tab";

const SECTIONS = [
  { id: "overview", label: "OVERVIEW", icon: LayoutGrid },
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
      <div className="p-8 text-red-500 font-mono text-xs uppercase tracking-widest">
        ERROR 404: FILE NOT FOUND OR CLASSIFIED.
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
    <div className="flex items-center gap-0 px-3 py-1 bg-[#000] border-b border-[#ffffff06] overflow-x-auto flex-shrink-0">
      {steps.map((step, i) => (
        <React.Fragment key={step.id}>
          <div className={cn(
            "flex items-center gap-1 px-2 py-0.5 font-mono text-[8px] uppercase tracking-widest whitespace-nowrap",
            step.status === "done" && "text-green-600",
            step.status === "active" && "text-cyan-400",
            step.status === "pending" && "text-neutral-800",
          )}>
            {step.status === "done" && <CheckCircle2 className="w-2.5 h-2.5" />}
            {step.status === "active" && (
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 flex-shrink-0 animate-pulse" />
            )}
            {step.status === "pending" && (
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-800 flex-shrink-0" />
            )}
            {step.label}
          </div>
          {i < steps.length - 1 && (
            <ChevronRight className="w-2.5 h-2.5 text-[#ffffff0d] flex-shrink-0" />
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

    return Array.from(pairData.values()).map((p) => ({
      entityAId: p.entityAId,
      entityBId: p.entityBId,
      documentTitle: p.docTitle,
      sharedDocCount: p.docCount,
      score: p.docCount >= 3 ? "HIGH" : p.docCount >= 2 ? "MEDIUM" : "LOW",
    }));
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
    return null;
  }, [documents, pendingMentions, entities, relationships, notes, suggestedEdges]);

  const centerLabel = viewingDoc
    ? `VIEWING: ${viewingDoc.title}`
    : SECTIONS.find((s) => s.id === activeSection)?.label;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ──────── LEFT RAIL ──────── */}
      <aside className="w-52 flex-shrink-0 flex flex-col bg-[#040507] border-r border-[#ffffff0d] overflow-hidden">
        <div className="px-3 py-2 border-b border-[#ffffff0d] flex-shrink-0">
          <Link href="/">
            <button className="flex items-center gap-1.5 text-[9px] font-mono text-neutral-700 hover:text-white uppercase tracking-widest transition-colors">
              <ArrowLeft className="w-3 h-3" />
              CASE CONTROL
            </button>
          </Link>
        </div>

        <div className="px-3 pt-4 pb-3 border-b border-[#ffffff0d] flex-shrink-0 space-y-1.5">
          <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
            CASE-{caseData.id.toString().padStart(6, "0")}
          </div>
          <div className="text-sm font-bold text-white uppercase leading-tight tracking-tight">
            {caseData.title}
          </div>
          <div className={`flex items-center gap-1.5 text-[10px] font-mono ${statusColor}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
            {caseData.status.toUpperCase()}
          </div>
          <div className="font-mono text-[9px] text-neutral-700">
            INIT: {formatDate(caseData.createdAt).split(",")[0]}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
          <div className="px-2 py-1 font-mono text-[8px] text-neutral-800 uppercase tracking-widest">
            NAVIGATION
          </div>
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = activeSection === s.id;
            const hasBadge = s.id === "documents" && pendingMentions > 0;
            return (
              <button
                key={s.id}
                onClick={() => onSectionChange(s.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2.5 py-2 text-[10px] font-mono uppercase tracking-wider transition-all text-left border-l-2",
                  isActive
                    ? "bg-[#dc262608] text-white border-red-600"
                    : "text-neutral-600 hover:text-neutral-300 hover:bg-[#ffffff04] border-transparent"
                )}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="flex-1">{s.label}</span>
                {hasBadge && (
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-[#ffffff0d] flex-shrink-0 space-y-1">
          {[
            { label: "ENTITIES", val: entities.length },
            { label: "DOCUMENTS", val: documents.length },
            { label: "LINKS", val: relationships.length },
            { label: "TIMELINE", val: timeline.length },
            ...(moneyFlows.length > 0
              ? [{ label: "FLOWS", val: moneyFlows.length }]
              : []),
            ...(pendingMentions > 0
              ? [{ label: "ATLAS PENDING", val: pendingMentions, warn: true }]
              : []),
          ].map((m) => (
            <div key={m.label} className="flex justify-between items-center">
              <span
                className={cn(
                  "font-mono text-[9px] uppercase tracking-widest",
                  (m as { warn?: boolean }).warn ? "text-amber-600" : "text-neutral-700"
                )}
              >
                {m.label}
              </span>
              <span
                className={cn(
                  "font-mono text-[11px] font-bold tabular-nums",
                  (m as { warn?: boolean }).warn ? "text-amber-400" : "text-neutral-400"
                )}
              >
                {m.val.toString().padStart(2, "0")}
              </span>
            </div>
          ))}
        </div>
      </aside>

      {/* ──────── CENTER CANVAS ──────── */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[#080a0d]">
        <div className="nexus-header-strip flex-shrink-0">
          <span className="nexus-label truncate max-w-xs">{centerLabel}</span>
          {activeSection === "graph" && !viewingDoc && (
            <span className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
              {entities.length} NODES&nbsp;·&nbsp;{relationships.length} EDGES
              {suggestedEdges.length > 0 && (
                <span className="text-cyan-800">
                  &nbsp;·&nbsp;{suggestedEdges.length} SUGGESTED
                </span>
              )}
            </span>
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
                entities={entities}
                relationships={relationships}
                caseId={caseId}
                selectedEntityId={selectedEntityId}
                selectedRelId={selectedRelId}
                onEntitySelect={onEntitySelect}
                onRelSelect={onRelSelect}
                suggestedEdges={suggestedEdges}
                documentCount={documents.length}
              />
            </div>
          )}

          {activeSection === "overview" && (
            <OverviewPanel
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
      <aside className="w-72 flex-shrink-0 border-l border-[#ffffff0d] hidden lg:flex flex-col overflow-hidden bg-[#040507]">
        {activeSection === "graph" && selectedRel && (
          <LinkIntelPanel
            relationship={selectedRel}
            caseId={caseId}
            onClose={onRelClose}
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
            caseData={caseData}
            entities={entities}
            documents={documents}
            notes={notes}
            pendingMentions={pendingMentions}
            nextAction={nextAction}
            onNavigate={onSectionChange}
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
  detected: number;
  promoted: number;
  fallback: boolean;
}

function parseSeedDiag(desc: string | null | undefined): SeedDiag | null {
  if (!desc) return null;
  const m = desc.match(/\[ATLAS-SEED:([^\]]+)\]/);
  if (!m) return null;
  const parts = Object.fromEntries(m[1].split("|").map((p) => p.split("=")));
  const n = (k: string) => parseInt(parts[k] ?? "0", 10) || 0;
  return {
    searched: n("searched"),
    total: n("total"),
    ingested: n("ingested"),
    ok: n("ok"),
    partial: n("partial"),
    failed: n("failed"),
    wrapper: n("wrapper"),
    detected: n("detected"),
    promoted: n("promoted"),
    fallback: parts["fallback"] === "1",
  };
}

function cleanDescription(desc: string | null | undefined): string {
  if (!desc) return "";
  return desc.replace(/\[ATLAS-SEED:[^\]]+\]/, "").trim();
}

function SeedDiagnosticsCard({ diag }: { diag: SeedDiag }) {
  const usable = diag.ok + diag.partial;
  const blocked = diag.failed + diag.wrapper;

  let promotionNote: React.ReactNode = null;
  if (diag.promoted === 0 && diag.detected > 0) {
    promotionNote = (
      <div className="mt-2 px-2 py-1.5 bg-[#1a0e00] border border-[#ff6b0020] text-[9px] font-mono text-amber-500 uppercase tracking-wide leading-relaxed">
        No entities auto-promoted — {diag.detected} signal{diag.detected !== 1 ? "s" : ""} detected but none passed confidence/blocklist checks. Review pending detections.
      </div>
    );
  } else if (diag.promoted === 0 && diag.detected === 0 && usable === 0) {
    promotionNote = (
      <div className="mt-2 px-2 py-1.5 bg-[#0a0a0a] border border-[#ffffff0a] text-[9px] font-mono text-neutral-600 uppercase tracking-wide leading-relaxed">
        All sources were blocked, paywalled, or JS-rendered. Add sources manually via Web Ingest.
      </div>
    );
  } else if (diag.fallback && diag.promoted > 0) {
    promotionNote = (
      <div className="mt-2 px-2 py-1.5 bg-[#001a0a] border border-[#00ff6620] text-[9px] font-mono text-green-500/70 uppercase tracking-wide leading-relaxed">
        Seed fallback active — {diag.promoted} entity{diag.promoted !== 1 ? "s" : ""} promoted at lower confidence threshold. Review and validate.
      </div>
    );
  }

  return (
    <div className="nexus-panel rounded-none lg:col-span-2 xl:col-span-3">
      <div className="nexus-header-strip flex items-center gap-2">
        <span className="nexus-label">SEED INTELLIGENCE REPORT</span>
        <span className="font-mono text-[9px] text-neutral-600 ml-auto">AUTO-SEEDED</span>
      </div>
      <div className="p-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-[#0a0e14] border border-[#ffffff08] p-2">
          <div className="font-mono text-[8px] text-neutral-600 uppercase mb-1">Results Found</div>
          <div className="font-mono text-lg font-bold text-white tabular-nums">{diag.total}</div>
        </div>
        <div className="bg-[#0a0e14] border border-[#ffffff08] p-2">
          <div className="font-mono text-[8px] text-neutral-600 uppercase mb-1">Ingested</div>
          <div className="font-mono text-lg font-bold text-blue-400 tabular-nums">{diag.ingested}</div>
        </div>
        <div className={cn("bg-[#0a0e14] border p-2", usable > 0 ? "border-[#00ff6620]" : "border-[#ffffff08]")}>
          <div className="font-mono text-[8px] text-neutral-600 uppercase mb-1">Usable</div>
          <div className={cn("font-mono text-lg font-bold tabular-nums", usable > 0 ? "text-green-400" : "text-neutral-600")}>{usable}</div>
          {diag.ok > 0 && diag.partial > 0 && (
            <div className="font-mono text-[8px] text-neutral-600">{diag.ok} full · {diag.partial} partial</div>
          )}
        </div>
        <div className={cn("bg-[#0a0e14] border p-2", blocked > 0 ? "border-[#ff000015]" : "border-[#ffffff08]")}>
          <div className="font-mono text-[8px] text-neutral-600 uppercase mb-1">Blocked</div>
          <div className={cn("font-mono text-lg font-bold tabular-nums", blocked > 0 ? "text-red-500" : "text-neutral-600")}>{blocked}</div>
          {diag.wrapper > 0 && <div className="font-mono text-[8px] text-neutral-600">{diag.wrapper} wrapper · {diag.failed} failed</div>}
        </div>
        <div className={cn("bg-[#0a0e14] border p-2", diag.detected > 0 ? "border-[#ffffff10]" : "border-[#ffffff08]")}>
          <div className="font-mono text-[8px] text-neutral-600 uppercase mb-1">Detected</div>
          <div className={cn("font-mono text-lg font-bold tabular-nums", diag.detected > 0 ? "text-amber-400" : "text-neutral-600")}>{diag.detected}</div>
        </div>
        <div className={cn("bg-[#0a0e14] border p-2", diag.promoted > 0 ? "border-[#00ff6630]" : "border-[#ffffff08]")}>
          <div className="font-mono text-[8px] text-neutral-600 uppercase mb-1">Promoted</div>
          <div className={cn("font-mono text-lg font-bold tabular-nums", diag.promoted > 0 ? "text-green-300" : "text-neutral-600")}>{diag.promoted}</div>
          {diag.fallback && diag.promoted > 0 && <div className="font-mono text-[8px] text-amber-600">FALLBACK</div>}
        </div>
      </div>
      {promotionNote && <div className="px-3 pb-3">{promotionNote}</div>}
    </div>
  );
}

// ─── Overview Panel ──────────────────────────────────────────────────────────

function OverviewPanel({
  caseData,
  entities,
  documents,
  timeline,
  moneyFlows,
  financialSignals,
  onViewDocument,
}: {
  caseData: { title: string; description?: string | null; tags?: string[] | null };
  entities: Entity[];
  documents: Document[];
  timeline: TimelineEntry[];
  moneyFlows: MoneyFlow[];
  financialSignals: any[];
  onViewDocument?: (doc: Document) => void;
}) {
  const seedDiag = parseSeedDiag(caseData.description);
  const descText = cleanDescription(caseData.description);
  const isAutoSeeded = caseData.tags?.includes("auto-seeded");

  return (
    <div className="p-4 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-max">
      {/* ── Seed Diagnostics Card — shown for auto-seeded cases ── */}
      {isAutoSeeded && seedDiag && <SeedDiagnosticsCard diag={seedDiag} />}

      {/* ── Case brief — only for non-seeded or seeded with clean text ── */}
      {descText && (
        <div className="nexus-panel rounded-none lg:col-span-2 xl:col-span-3">
          <div className="nexus-header-strip">
            <span className="nexus-label">CASE BRIEF</span>
          </div>
          <div className="p-3 text-sm text-neutral-400 leading-relaxed">{descText}</div>
        </div>
      )}

      <div className="nexus-panel rounded-none">
        <div className="nexus-header-strip">
          <span className="nexus-label">ENTITY LIST ({entities.length})</span>
        </div>
        <div className="p-0">
          {entities.length === 0 ? (
            <div className="px-4 py-6 font-mono text-[10px] text-neutral-700 text-center uppercase tracking-widest">
              NO ENTITIES
            </div>
          ) : (
            entities.slice(0, 8).map((e) => (
              <div
                key={e.id}
                className="px-3 py-2 border-b border-[#ffffff04] flex justify-between items-center"
              >
                <span className="text-sm font-semibold text-white uppercase truncate">{e.name}</span>
                <span className="text-[9px] font-mono text-neutral-600 ml-2 flex-shrink-0">
                  {e.type.replace(/_/g, " ").toUpperCase()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="nexus-panel rounded-none">
        <div className="nexus-header-strip">
          <span className="nexus-label">DOCUMENT VAULT ({documents.length})</span>
        </div>
        <div className="p-0">
          {documents.length === 0 ? (
            <div className="px-4 py-6 font-mono text-[10px] text-neutral-700 text-center uppercase tracking-widest">
              NO DOCUMENTS
            </div>
          ) : (
            documents.slice(0, 8).map((d) => (
              <div
                key={d.id}
                onClick={() => onViewDocument?.(d)}
                className={cn(
                  "px-3 py-2 border-b border-[#ffffff04] flex flex-col transition-colors",
                  onViewDocument
                    ? "cursor-pointer hover:bg-[#ffffff05] group"
                    : ""
                )}
              >
                <span className="text-sm text-white truncate group-hover:text-red-200 transition-colors">
                  {d.title}
                </span>
                <span className="text-[9px] font-mono text-neutral-600 mt-0.5">
                  {formatDate(d.uploadedAt).split(",")[0]}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="nexus-panel rounded-none">
        <div className="nexus-header-strip">
          <span className="nexus-label">TEMPORAL TRACE ({timeline.length})</span>
        </div>
        <div className="p-3 space-y-2.5">
          {timeline.length === 0 ? (
            <div className="py-4 font-mono text-[10px] text-neutral-700 text-center uppercase tracking-widest">
              NO EVENTS
            </div>
          ) : (
            [...timeline]
              .sort(
                (a, b) =>
                  new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime()
              )
              .slice(0, 6)
              .map((t) => (
                <div key={t.id} className="flex gap-2.5">
                  <div className="w-1.5 h-1.5 bg-red-600 rounded-full mt-1.5 shrink-0" />
                  <div>
                    <div className="text-[9px] font-mono text-red-500">
                      {formatDate(t.eventDate).split(",")[0]}
                    </div>
                    <div className="text-sm text-white font-medium">{t.title}</div>
                  </div>
                </div>
              ))
          )}
        </div>
      </div>

      {financialSignals.length > 0 && (
        <div className="nexus-panel rounded-none lg:col-span-2 xl:col-span-3">
          <div className="nexus-header-strip">
            <span className="nexus-label">FINANCIAL SIGNALS ({financialSignals.length})</span>
          </div>
          <div className="p-0">
            {financialSignals.slice(0, 6).map((sig: any) => (
              <div
                key={sig.id}
                className="px-3 py-2 border-b border-[#ffffff04] flex items-center gap-3"
              >
                <span className="text-[9px] font-mono text-neutral-500 uppercase bg-[#0a0e14] px-1.5 py-0.5 border border-[#ffffff08]">
                  {sig.signalType?.replace(/_/g, " ") || "SIGNAL"}
                </span>
                {sig.entityName && (
                  <span className="text-sm font-semibold text-cyan-400 uppercase truncate">
                    {sig.entityName}
                  </span>
                )}
                <span className="text-xs text-neutral-500 truncate flex-1">
                  {sig.eventSummary?.slice(0, 80)}
                </span>
                {sig.amountRaw && (
                  <span className="text-xs font-mono text-green-400 ml-auto flex-shrink-0">
                    {sig.currency || "USD"} {sig.amountRaw}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Flow Trace Panel ────────────────────────────────────────────────────────

function FlowTracePanel({ moneyFlows, financialSignals }: { moneyFlows: MoneyFlow[]; financialSignals: any[] }) {
  const SIGNAL_COLOR: Record<string, string> = {
    payment: "text-green-400",
    transfer: "text-cyan-400",
    investment: "text-blue-400",
    loan: "text-yellow-400",
    fine: "text-red-400",
    bribe: "text-red-500",
    contract: "text-purple-400",
    grant: "text-emerald-400",
    revenue: "text-green-500",
    expense: "text-orange-400",
  };

  const hasData = financialSignals.length > 0 || moneyFlows.length > 0;

  return (
    <div className="nexus-panel rounded-none h-full flex flex-col">
      <div className="nexus-header-strip flex items-center justify-between">
        <span className="nexus-label">FLOW TRACE</span>
        {financialSignals.length > 0 && (
          <span className="font-mono text-[9px] text-green-500 pr-3">
            {financialSignals.length} AUTO-DETECTED SIGNAL{financialSignals.length !== 1 ? "S" : ""}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {!hasData ? (
          <div className="py-12 text-center">
            <TrendingUp className="w-6 h-6 text-neutral-800 mx-auto mb-3" />
            <div className="font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
              NO FINANCIAL FLOWS RECORDED
            </div>
            <div className="font-mono text-[9px] text-neutral-800 uppercase mt-1">
              ANALYZE DOCUMENTS TO AUTO-DETECT SIGNALS
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
                  {financialSignals.map((sig: any) => (
                    <div
                      key={sig.id}
                      className="p-3 border border-[#ffffff0d] bg-[#0a0e14] space-y-1.5"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 border border-[#ffffff10] ${SIGNAL_COLOR[sig.signalType] ?? "text-neutral-400"}`}>
                          {sig.signalType?.replace(/_/g, " ") || "SIGNAL"}
                        </span>
                        {sig.entityName && (
                          <span className="text-sm font-bold text-cyan-400 uppercase">
                            {sig.entityName}
                          </span>
                        )}
                        {sig.amountRaw && (
                          <span className="ml-auto text-sm font-bold text-green-400 font-mono">
                            {sig.currency || "USD"}&nbsp;{sig.amountRaw}
                          </span>
                        )}
                      </div>
                      {sig.eventSummary && (
                        <p className="text-xs text-neutral-500 leading-relaxed">{sig.eventSummary}</p>
                      )}
                      {sig.documentTitle && (
                        <div className="font-mono text-[9px] text-neutral-700 uppercase">
                          SRC: {sig.documentTitle}
                        </div>
                      )}
                    </div>
                  ))}
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
  caseData,
  entities,
  documents,
  notes,
  pendingMentions,
  nextAction,
  onNavigate,
}: {
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
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="nexus-header-strip flex-shrink-0">
        <span className="nexus-label">CASE OVERVIEW</span>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {caseData.description && cleanDescription(caseData.description) && (
          <div className="space-y-1.5">
            <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
              BRIEF
            </div>
            <p className="text-sm text-neutral-300 leading-relaxed">
              {cleanDescription(caseData.description)}
            </p>
          </div>
        )}

        {caseData.tags && caseData.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {caseData.tags.map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 border border-[#ffffff0d] font-mono text-[9px] text-neutral-600 uppercase"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {nextAction && (
          <div
            className={cn(
              "p-2.5 border space-y-2 cursor-pointer transition-colors",
              nextAction.color
            )}
            onClick={() => onNavigate(nextAction.navigate)}
          >
            <div className="flex items-center gap-2">
              <nextAction.icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-mono text-[9px] uppercase tracking-widest font-bold">
                NEXT ACTION
              </span>
            </div>
            <div className="font-mono text-[9px] opacity-80 leading-relaxed uppercase tracking-wide">
              {nextAction.message}
            </div>
            <div className="font-mono text-[9px] opacity-60 uppercase tracking-widest hover:opacity-90 transition-opacity">
              {nextAction.cta} →
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
