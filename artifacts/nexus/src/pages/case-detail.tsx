import React, { useState, useCallback } from "react";
import { useParams, Link } from "wouter";
import { useGetCaseSummary, MoneyFlow } from "@workspace/api-client-react";
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
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

import GraphCanvas, { LinkIntelPanel, EntityIntelPanel } from "./case-tabs/graph-view";
import EntitiesTab from "./case-tabs/entities-tab";
import DocumentsTab from "./case-tabs/documents-tab";
import TimelineTab from "./case-tabs/timeline-tab";
import NotesTab from "./case-tabs/notes-tab";

const SECTIONS = [
  { id: "overview", label: "OVERVIEW", icon: LayoutGrid },
  { id: "graph", label: "LINK ANALYSIS", icon: GitBranch },
  { id: "entities", label: "ENTITY REGISTRY", icon: Database },
  { id: "documents", label: "DOCUMENT VAULT", icon: Files },
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

  const handleSectionChange = useCallback(
    (section: SectionId) => {
      setActiveSection(section);
      if (section !== "graph") {
        setSelectedEntityId(null);
        setSelectedRelId(null);
      }
    },
    []
  );

  const handleEntitySelect = useCallback((id: number | null) => {
    setSelectedEntityId(id);
    setSelectedRelId(null);
  }, []);

  const handleRelSelect = useCallback((id: number | null) => {
    setSelectedRelId(id);
    setSelectedEntityId(null);
  }, []);

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
    pendingMentions,
  } = summary;

  const selectedEntity = entities.find((e) => e.id === selectedEntityId) || null;
  const selectedRel = relationships.find((r) => r.id === selectedRelId) || null;

  const statusColor =
    STATUS_COLORS[caseData.status as keyof typeof STATUS_COLORS] ?? STATUS_COLORS.open;
  const statusDot =
    STATUS_DOT[caseData.status as keyof typeof STATUS_DOT] ?? STATUS_DOT.open;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ──────── LEFT RAIL ──────── */}
      <aside className="w-52 flex-shrink-0 flex flex-col bg-[#040507] border-r border-[#ffffff0d] overflow-hidden">
        {/* Back */}
        <div className="px-3 py-2 border-b border-[#ffffff0d] flex-shrink-0">
          <Link href="/">
            <button className="flex items-center gap-1.5 text-[9px] font-mono text-neutral-700 hover:text-white uppercase tracking-widest transition-colors">
              <ArrowLeft className="w-3 h-3" />
              CASE CONTROL
            </button>
          </Link>
        </div>

        {/* Case identity */}
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

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
          <div className="px-2 py-1 font-mono text-[8px] text-neutral-800 uppercase tracking-widest">
            NAVIGATION
          </div>
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = activeSection === s.id;
            const hasBadge =
              s.id === "documents" && (pendingMentions as number) > 0;
            return (
              <button
                key={s.id}
                onClick={() => handleSectionChange(s.id)}
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
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Mini metrics */}
        <div className="px-3 py-3 border-t border-[#ffffff0d] flex-shrink-0 space-y-1">
          {[
            { label: "ENTITIES", val: entities.length },
            { label: "DOCUMENTS", val: documents.length },
            { label: "LINKS", val: relationships.length },
            { label: "TIMELINE", val: timeline.length },
            ...(moneyFlows.length > 0
              ? [{ label: "FLOWS", val: moneyFlows.length }]
              : []),
            ...((pendingMentions as number) > 0
              ? [{ label: "ATLAS PENDING", val: pendingMentions as number, warn: true }]
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
        {/* Center strip header */}
        <div className="nexus-header-strip flex-shrink-0">
          <span className="nexus-label">
            {SECTIONS.find((s) => s.id === activeSection)?.label}
          </span>
          {activeSection === "graph" && (
            <span className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
              {entities.length} NODES&nbsp;·&nbsp;{relationships.length} EDGES
            </span>
          )}
        </div>

        {/* Content area */}
        <div
          className={cn(
            "flex-1",
            activeSection === "graph"
              ? "overflow-hidden"
              : "overflow-auto"
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
                onEntitySelect={handleEntitySelect}
                onRelSelect={handleRelSelect}
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
            />
          )}

          {activeSection === "entities" && (
            <div className="h-full">
              <EntitiesTab caseId={caseId} entities={entities} />
            </div>
          )}

          {activeSection === "documents" && (
            <div className="h-full">
              <DocumentsTab caseId={caseId} documents={documents} />
            </div>
          )}

          {activeSection === "timeline" && (
            <div className="h-full">
              <TimelineTab caseId={caseId} timeline={timeline} />
            </div>
          )}

          {activeSection === "flows" && (
            <FlowTracePanel moneyFlows={moneyFlows} />
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
            onClose={() => setSelectedRelId(null)}
          />
        )}
        {activeSection === "graph" && selectedEntity && !selectedRel && (
          <EntityIntelPanel
            entity={selectedEntity}
            relationships={relationships}
            onClose={() => setSelectedEntityId(null)}
          />
        )}
        {(activeSection !== "graph" || (!selectedRel && !selectedEntity)) && (
          <DefaultInspector
            caseData={caseData}
            entities={entities}
            documents={documents}
            notes={notes}
            pendingMentions={pendingMentions as number}
            onNavigate={handleSectionChange}
          />
        )}
      </aside>
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
}: {
  caseData: { title: string; description?: string | null; tags?: string[] | null };
  entities: { id: number; name: string; type: string }[];
  documents: { id: number; title: string; uploadedAt: string }[];
  timeline: { id: number; title: string; eventDate: string }[];
  moneyFlows: MoneyFlow[];
}) {
  return (
    <div className="p-4 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-max">
      {/* Entities */}
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

      {/* Documents */}
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
                className="px-3 py-2 border-b border-[#ffffff04] flex flex-col"
              >
                <span className="text-sm text-white truncate">{d.title}</span>
                <span className="text-[9px] font-mono text-neutral-600 mt-0.5">
                  {formatDate(d.uploadedAt).split(",")[0]}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Timeline */}
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

      {/* Money flows if any */}
      {moneyFlows.length > 0 && (
        <div className="nexus-panel rounded-none lg:col-span-2">
          <div className="nexus-header-strip">
            <span className="nexus-label">FLOW TRACE ({moneyFlows.length})</span>
          </div>
          <div className="p-0">
            {moneyFlows.slice(0, 5).map((mf) => (
              <div
                key={mf.id}
                className="px-3 py-2 border-b border-[#ffffff04] flex items-center gap-3"
              >
                <span className="text-sm font-semibold text-cyan-400 uppercase">
                  {mf.sourceEntityName}
                </span>
                <span className="text-[9px] font-mono text-green-500">→</span>
                <span className="text-sm font-semibold text-cyan-400 uppercase">
                  {mf.destinationEntityName}
                </span>
                {mf.amount && (
                  <span className="text-xs font-mono text-green-400 ml-auto">
                    {mf.currency || "USD"} {mf.amount.toLocaleString()}
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

function FlowTracePanel({ moneyFlows }: { moneyFlows: MoneyFlow[] }) {
  return (
    <div className="nexus-panel rounded-none h-full flex flex-col">
      <div className="nexus-header-strip">
        <span className="nexus-label">FLOW TRACE</span>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {moneyFlows.length === 0 ? (
          <div className="py-12 text-center">
            <TrendingUp className="w-6 h-6 text-neutral-800 mx-auto mb-3" />
            <div className="font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
              NO FINANCIAL FLOWS RECORDED
            </div>
          </div>
        ) : (
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
                    <span>
                      CONF:{" "}
                      <span className="text-neutral-400">{mf.confidenceLevel}</span>
                    </span>
                  )}
                </div>
                {mf.description && (
                  <p className="text-xs text-neutral-500">{mf.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Default Inspector ───────────────────────────────────────────────────────

function DefaultInspector({
  caseData,
  entities,
  documents,
  notes,
  pendingMentions,
  onNavigate,
}: {
  caseData: {
    title: string;
    description?: string | null;
    tags?: string[] | null;
    status: string;
  };
  entities: { id: number }[];
  documents: { id: number }[];
  notes: { id: number; content: string; createdAt: string }[];
  pendingMentions: number;
  onNavigate: (s: SectionId) => void;
}) {
  const latestNote = notes.length > 0
    ? [...notes].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0]
    : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="nexus-header-strip flex-shrink-0">
        <span className="nexus-label">CASE OVERVIEW</span>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Description */}
        {caseData.description && (
          <div className="space-y-1.5">
            <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
              BRIEF
            </div>
            <p className="text-sm text-neutral-300 leading-relaxed">
              {caseData.description}
            </p>
          </div>
        )}

        {/* Tags */}
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

        {/* ATLAS alert */}
        {pendingMentions > 0 && (
          <div
            className="p-2.5 border border-amber-500/25 bg-amber-500/5 space-y-2 cursor-pointer hover:bg-amber-500/10 transition-colors"
            onClick={() => onNavigate("documents")}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span className="font-mono text-[9px] text-amber-500 uppercase tracking-widest">
                ATLAS DETECTIONS
              </span>
            </div>
            <div className="font-bold text-lg text-amber-400 font-mono tabular-nums">
              {pendingMentions}
            </div>
            <div className="font-mono text-[9px] text-amber-600 uppercase tracking-wider">
              ENTITIES PENDING TRIAGE
            </div>
            <div className="font-mono text-[9px] text-amber-700 hover:text-amber-500 transition-colors">
              OPEN DOCUMENT VAULT →
            </div>
          </div>
        )}

        {/* Quick navigation */}
        <div className="space-y-1">
          <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest mb-2">
            QUICK ACCESS
          </div>
          {(
            [
              { id: "graph", label: "LINK ANALYSIS", val: null },
              { id: "entities", label: "ENTITY REGISTRY", val: entities.length },
              { id: "documents", label: "DOCUMENT VAULT", val: documents.length },
              { id: "notes", label: "ANALYST NOTES", val: notes.length },
            ] as { id: SectionId; label: string; val: number | null }[]
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className="w-full flex justify-between items-center py-2 px-2.5 text-left hover:bg-[#ffffff04] border border-transparent hover:border-[#ffffff08] transition-all group"
            >
              <span className="font-mono text-[10px] text-neutral-600 group-hover:text-neutral-300 uppercase tracking-wider transition-colors">
                {item.label}
              </span>
              {item.val !== null && (
                <span className="font-mono text-xs font-bold text-neutral-500 group-hover:text-white tabular-nums transition-colors">
                  {item.val.toString().padStart(2, "0")}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Latest note */}
        {latestNote && (
          <div className="space-y-1.5">
            <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
              LATEST LOG
            </div>
            <div
              className="p-2.5 bg-[#0a0e14] border border-[#ffffff06] cursor-pointer hover:border-[#ffffff0d] transition-colors"
              onClick={() => onNavigate("notes")}
            >
              <div className="font-mono text-[8px] text-neutral-700 mb-1.5">
                {formatDate(latestNote.createdAt)}
              </div>
              <p className="text-xs text-neutral-400 line-clamp-4 leading-relaxed">
                {latestNote.content}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
