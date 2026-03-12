import React, { useMemo, useCallback, useRef } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  NodeMouseHandler,
  EdgeMouseHandler,
  NodeDragHandler,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Entity,
  Relationship,
  useListRelationshipEvidence,
  useCreateRelationshipEvidence,
  useDeleteRelationshipEvidence,
  useListDocuments,
  useListEntityMentions,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { X, Plus, Trash2, FileText, Link2, ScanLine, Globe, Calendar, Search, ChevronRight, RotateCcw, Maximize2, Eye, EyeOff } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";

function generateExpansionSuggestions(name: string, type: string): string[] {
  const base = name.replace(/"/g, "");
  const nameLower = base.toLowerCase();
  if (nameLower.includes("hotel") || nameLower.includes("motel") || nameLower.includes("inn")) {
    return [
      `"${base}" homelessness program`,
      `"${base}" Project Homekey contract`,
      `"${base}" LAHSA contract`,
    ];
  }
  if (nameLower.includes("homeless") || nameLower.includes("lahsa") || nameLower.includes("housing authority")) {
    return [
      `"${base}" hotel contracts`,
      `"${base}" Project Homekey`,
      `"${base}" interim housing providers`,
    ];
  }
  if (nameLower.includes("project") || nameLower.includes("program")) {
    return [
      `"${base}" Los Angeles funding`,
      `"${base}" hotel acquisitions`,
      `"${base}" accountability`,
    ];
  }
  return [
    `"${base}" Los Angeles`,
    `"${base}" contract funding`,
    `"${base}" investigation`,
  ];
}

export const TYPE_COLORS: Record<string, string> = {
  person: "#06b6d4",
  organization: "#f59e0b",
  company: "#22c55e",
  government_agency: "#ef4444",
  location: "#a855f7",
  event: "#3b82f6",
  other: "#737373",
};

export interface SuggestedEdge {
  entityAId: number;
  entityBId: number;
  documentTitle?: string;
  sharedDocCount?: number;
  score?: "LOW" | "MEDIUM" | "HIGH";
}

interface GraphCanvasProps {
  entities: Entity[];
  relationships: Relationship[];
  caseId: number;
  selectedEntityId: number | null;
  selectedRelId: number | null;
  onEntitySelect: (id: number | null) => void;
  onRelSelect: (id: number | null) => void;
  suggestedEdges?: SuggestedEdge[];
  documentCount?: number;
}

const SCORE_STYLE: Record<string, { stroke: string; opacity: number; width: number; label: string }> = {
  HIGH:   { stroke: "#06b6d4", opacity: 0.60, width: 1.8, label: "HIGH CO-OCCUR" },
  MEDIUM: { stroke: "#06b6d4", opacity: 0.40, width: 1.2, label: "CO-MENTION"    },
  LOW:    { stroke: "#06b6d4", opacity: 0.22, width: 1.0, label: "POSSIBLE ASSOC" },
};

function buildNodeStyle(color: string, isSelected: boolean) {
  return {
    background: isSelected ? "#0d1f2a" : "#090d12",
    color: "#ffffff",
    border: isSelected ? `2px solid ${color}` : `1px solid ${color}50`,
    borderLeft: `3px solid ${color}`,
    borderRadius: "0",
    padding: "10px 16px",
    fontFamily: "monospace",
    fontSize: "11px",
    width: 165,
    textAlign: "left" as const,
    textTransform: "uppercase" as const,
    fontWeight: "bold",
    letterSpacing: "0.05em",
    boxShadow: isSelected
      ? `0 0 18px ${color}50, 0 0 6px ${color}25`
      : `0 0 6px ${color}18`,
    outline: "none",
  };
}

export default function GraphCanvas({
  entities,
  relationships,
  selectedEntityId,
  selectedRelId,
  onEntitySelect,
  onRelSelect,
  suggestedEdges = [],
  documentCount = 0,
}: GraphCanvasProps) {
  const posStorageKey = `atlas-graph-pos-${entities[0]?.caseId ?? "default"}`;
  const rfRef = useRef<{ fitView: (opts?: object) => void } | null>(null);

  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      const stored = localStorage.getItem(posStorageKey);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  const [showSuggested, setShowSuggested] = useState(true);

  const handleResetLayout = useCallback(() => {
    setNodePositions({});
    try { localStorage.removeItem(posStorageKey); } catch { /* ignore */ }
  }, [posStorageKey]);

  const onNodeDragStop: NodeDragHandler = useCallback((_evt, node) => {
    setNodePositions((prev) => {
      const updated = { ...prev, [node.id]: node.position };
      try { localStorage.setItem(posStorageKey, JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }, [posStorageKey]);

  const nodes = useMemo(() => {
    const radius = 260;
    const center = { x: 420, y: 300 };
    return entities.map((entity, i) => {
      const angle = (i / entities.length) * 2 * Math.PI;
      const color = TYPE_COLORS[entity.type] || TYPE_COLORS.other;
      const isSelected = entity.id === selectedEntityId;
      const defaultPos = {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      };
      const pos = nodePositions[entity.id.toString()] || defaultPos;
      return {
        id: entity.id.toString(),
        data: { label: entity.name, type: entity.type },
        position: pos,
        style: buildNodeStyle(color, isSelected),
      };
    });
  }, [entities, selectedEntityId, nodePositions]);

  const edges = useMemo(() => {
    const confirmed = relationships.map((rel) => {
      const isSelected = rel.id === selectedRelId;
      return {
        id: `e${rel.id}`,
        source: rel.entityAId.toString(),
        target: rel.entityBId.toString(),
        label: rel.relationshipType.toUpperCase(),
        animated: isSelected,
        data: { relId: rel.id, suggested: false },
        style: {
          stroke: isSelected ? "#f59e0b" : "#dc2626",
          strokeWidth: isSelected ? 2.5 : 1.5,
          opacity: isSelected ? 1 : 0.65,
        },
        labelStyle: {
          fill: isSelected ? "#f59e0b" : "#ffffff",
          fontWeight: 700,
          fontFamily: "monospace",
          fontSize: 9,
          textTransform: "uppercase" as const,
        },
        labelBgStyle: { fill: "#000000", fillOpacity: 0.9 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isSelected ? "#f59e0b" : "#dc2626",
          width: 14,
          height: 14,
        },
      };
    });

    if (!showSuggested) return confirmed;

    const confirmedPairs = new Set(
      relationships.map(
        (r) => `${Math.min(r.entityAId, r.entityBId)}-${Math.max(r.entityAId, r.entityBId)}`
      )
    );

    const suggested = suggestedEdges
      .filter((se) => {
        const key = `${Math.min(se.entityAId, se.entityBId)}-${Math.max(se.entityAId, se.entityBId)}`;
        return !confirmedPairs.has(key);
      })
      .map((se) => {
        const s = SCORE_STYLE[se.score || "LOW"];
        return {
          id: `suggested-${Math.min(se.entityAId, se.entityBId)}-${Math.max(se.entityAId, se.entityBId)}`,
          source: se.entityAId.toString(),
          target: se.entityBId.toString(),
          label: s.label,
          animated: false,
          data: { suggested: true, documentTitle: se.documentTitle, score: se.score },
          style: {
            stroke: s.stroke,
            strokeWidth: s.width,
            strokeDasharray: "5 4",
            opacity: s.opacity,
          },
          labelStyle: {
            fill: s.stroke,
            fontFamily: "monospace",
            fontSize: 7,
            opacity: s.opacity + 0.15,
          },
          labelBgStyle: { fill: "#000", fillOpacity: 0.9 },
        };
      });

    return [...confirmed, ...suggested];
  }, [relationships, selectedRelId, suggestedEdges, showSuggested]);

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_evt, edge) => {
      if ((edge.data as { suggested?: boolean })?.suggested) return;
      const relId = (edge.data as { relId: number })?.relId;
      onRelSelect(relId ?? null);
    },
    [onRelSelect]
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      onEntitySelect(parseInt(node.id));
    },
    [onEntitySelect]
  );

  const onPaneClick = useCallback(() => {
    onEntitySelect(null);
    onRelSelect(null);
  }, [onEntitySelect, onRelSelect]);

  const highSuggested = suggestedEdges.filter((e) => e.score === "HIGH").length;
  const medSuggested  = suggestedEdges.filter((e) => e.score === "MEDIUM").length;

  if (entities.length === 0) {
    if (documentCount > 0) {
      return (
        <div className="h-full flex flex-col items-center justify-center bg-[#000] gap-5">
          <div className="w-12 h-px bg-[#ffffff08]" />
          <div className="text-center space-y-2">
            <div className="font-mono text-xs text-neutral-600 uppercase tracking-widest">
              NO ENTITIES IN THIS CASE
            </div>
            <div className="font-mono text-[10px] text-cyan-700 uppercase tracking-wider max-w-[280px] leading-relaxed">
              Approve detected entities from the Document Vault
              <br />
              to begin link analysis.
            </div>
            <div className="flex items-center justify-center gap-1.5 mt-1">
              <ScanLine className="w-3 h-3 text-neutral-800" />
              <span className="font-mono text-[9px] text-neutral-800 uppercase tracking-widest">
                Open DOCUMENT VAULT → run ANALYZE → INGEST entities
              </span>
            </div>
          </div>
          <div className="w-12 h-px bg-[#ffffff08]" />
        </div>
      );
    }
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#000] gap-4">
        <div className="w-16 h-px bg-[#ffffff08]" />
        <div className="text-center font-mono text-neutral-700 text-xs uppercase tracking-widest">
          NO ENTITIES IN THIS CASE
          <br />
          <span className="text-[10px] text-neutral-800 mt-1 block">
            Add entities to begin link analysis
          </span>
        </div>
        <div className="w-16 h-px bg-[#ffffff08]" />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          colorMode="dark"
          className="bg-[#000] atlas-graph"
          onEdgeClick={onEdgeClick}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onNodeDragStop={onNodeDragStop}
          onInit={(instance) => { rfRef.current = instance; }}
          nodesDraggable={true}
          panOnDrag={true}
          zoomOnScroll={true}
          zoomOnPinch={true}
          minZoom={0.2}
          maxZoom={3}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="#ffffff10"
          />
          <Controls
            style={{
              backgroundColor: "#0d1117",
              border: "1px solid #ffffff1a",
              borderRadius: "0",
            }}
          />
        </ReactFlow>
      </ReactFlowProvider>

      {/* Layout controls overlay */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        {suggestedEdges.length > 0 && (
          <button
            onClick={() => setShowSuggested(!showSuggested)}
            className="flex items-center gap-1 px-2 py-1 bg-[#0d1117] border border-[#ffffff15] hover:border-cyan-500/40 text-neutral-500 hover:text-cyan-400 font-mono text-[9px] uppercase tracking-wider transition-colors"
            title={showSuggested ? "Hide suggested links" : "Show suggested links"}
          >
            {showSuggested ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showSuggested ? "HIDE SUGGESTED" : "SHOW SUGGESTED"}
          </button>
        )}
        <button
          onClick={() => rfRef.current?.fitView({ padding: 0.2, duration: 400 })}
          className="flex items-center gap-1 px-2 py-1 bg-[#0d1117] border border-[#ffffff15] hover:border-cyan-500/40 text-neutral-500 hover:text-cyan-400 font-mono text-[9px] uppercase tracking-wider transition-colors"
          title="Fit graph to view"
        >
          <Maximize2 className="w-3 h-3" />
          FIT
        </button>
        <button
          onClick={handleResetLayout}
          className="flex items-center gap-1 px-2 py-1 bg-[#0d1117] border border-[#ffffff15] hover:border-red-500/40 text-neutral-500 hover:text-red-400 font-mono text-[9px] uppercase tracking-wider transition-colors"
          title="Reset node layout"
        >
          <RotateCcw className="w-3 h-3" />
          RESET
        </button>
      </div>

      {/* ── Graph stats (top-left) ── */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
        <span className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
          {entities.length} NODE{entities.length !== 1 ? "S" : ""}
        </span>
        <span className="text-neutral-800">·</span>
        <span className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
          {relationships.length} EDGE{relationships.length !== 1 ? "S" : ""}
        </span>
        {suggestedEdges.length > 0 && (
          <>
            <span className="text-neutral-800">·</span>
            <span className="font-mono text-[9px] text-cyan-900 uppercase tracking-widest">
              {suggestedEdges.length} SUGGESTED
              {highSuggested > 0 && <span className="text-cyan-700"> ({highSuggested} HIGH)</span>}
            </span>
          </>
        )}
      </div>

      {/* ── Bottom hint ── */}
      <div className="absolute bottom-3 left-3 z-10 font-mono text-[9px] text-neutral-800 uppercase tracking-widest pointer-events-none">
        CLICK EDGE → LINK INTELLIGENCE &nbsp;·&nbsp; CLICK NODE → ENTITY DOSSIER
        {medSuggested > 0 && (
          <span className="text-cyan-900">
            &nbsp;·&nbsp; DASHED = CO-MENTION SUGGESTION
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Named Exports ────────────────────────────────────────────────────────────

export function LinkIntelPanel({
  relationship,
  caseId,
  onClose,
}: {
  relationship: Relationship;
  caseId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedDocId, setSelectedDocId] = useState<number | undefined>();
  const [excerpt, setExcerpt] = useState("");

  const { data: evidenceList = [] } = useListRelationshipEvidence({
    relationshipId: relationship.id,
  });
  const { data: docs = [] } = useListDocuments({ caseId });

  const addMutation = useCreateRelationshipEvidence({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/relationship-evidence"] });
        setSelectedDocId(undefined);
        setExcerpt("");
      },
    },
  });
  const deleteMutation = useDeleteRelationshipEvidence({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: ["/api/relationship-evidence"] }),
    },
  });

  const confidencePct = relationship.confidence
    ? Math.round(relationship.confidence * 100)
    : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="nexus-header-strip flex-shrink-0">
        <span className="nexus-label flex items-center gap-1.5">
          <Link2 className="w-3 h-3 text-amber-500" />
          LINK INTELLIGENCE
        </span>
        <button
          onClick={onClose}
          className="text-neutral-600 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        <div className="p-2.5 border border-amber-500/20 bg-amber-500/5 space-y-2">
          <div className="font-mono text-[9px] text-amber-500/70 uppercase tracking-widest">
            RELATIONSHIP VECTOR
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-cyan-400 uppercase truncate max-w-[80px]">
              {relationship.entityAName}
            </span>
            <span className="text-[9px] font-mono text-amber-500 uppercase whitespace-nowrap">
              —{relationship.relationshipType}→
            </span>
            <span className="text-sm font-bold text-cyan-400 uppercase truncate max-w-[80px]">
              {relationship.entityBName}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {confidencePct !== null && (
              <div className="text-[9px] font-mono text-neutral-600">
                CONF:{" "}
                <span className={confidencePct >= 70 ? "text-green-400" : confidencePct >= 40 ? "text-amber-400" : "text-red-400"}>
                  {confidencePct}%
                </span>
              </div>
            )}
            {relationship.dateRange && (
              <div className="text-[9px] font-mono text-neutral-600">
                RANGE: <span className="text-neutral-400">{relationship.dateRange}</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest">
            EVIDENCE CHAIN ({evidenceList.length})
          </div>
          {evidenceList.length === 0 ? (
            <div className="text-[10px] font-mono text-neutral-800 py-4 text-center border border-dashed border-[#ffffff06]">
              NO EVIDENCE LINKED
            </div>
          ) : (
            evidenceList.map((ev) => (
              <div
                key={ev.id}
                className="flex items-start gap-2 p-2 border border-[#ffffff08] bg-[#0a0e14]"
              >
                <FileText className="w-3 h-3 text-neutral-700 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white truncate">
                    {ev.documentTitle || `DOC ${ev.documentId}`}
                  </div>
                  {ev.excerpt && (
                    <div className="text-[9px] font-mono text-neutral-600 mt-0.5 line-clamp-2">
                      &ldquo;{ev.excerpt}&rdquo;
                    </div>
                  )}
                </div>
                <button
                  onClick={() => deleteMutation.mutate({ id: ev.id })}
                  className="text-neutral-700 hover:text-red-500 transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2 border-t border-[#ffffff08] pt-3">
          <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest">
            ADD EVIDENCE
          </div>
          <select
            value={selectedDocId || ""}
            onChange={(e) =>
              setSelectedDocId(e.target.value ? parseInt(e.target.value) : undefined)
            }
            className="w-full bg-[#000] border border-[#ffffff12] text-white font-mono text-[10px] px-2 py-1.5 uppercase focus:outline-none focus:border-amber-500/50"
          >
            <option value="">SELECT DOCUMENT</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="EXCERPT (OPTIONAL)"
            rows={2}
            className="w-full bg-[#000] border border-[#ffffff12] text-white font-mono text-[10px] px-2 py-1.5 resize-none placeholder:text-neutral-800 focus:border-amber-500/50 focus:outline-none"
          />
          <button
            disabled={!selectedDocId || addMutation.isPending}
            onClick={() => {
              if (!selectedDocId) return;
              addMutation.mutate({
                data: {
                  relationshipId: relationship.id,
                  documentId: selectedDocId,
                  excerpt: excerpt || undefined,
                },
              });
            }}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-amber-500/30 text-amber-500 hover:bg-amber-500/10 font-mono text-[10px] uppercase tracking-widest transition-colors disabled:opacity-30"
          >
            <Plus className="w-3 h-3" />
            {addMutation.isPending ? "LINKING..." : "LINK EVIDENCE"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EntityIntelPanel({
  entity,
  relationships,
  caseId,
  onClose,
  onOpenWebIngest,
}: {
  entity: Entity;
  relationships: Relationship[];
  caseId: number;
  onClose: () => void;
  onOpenWebIngest?: (query: string) => void;
}) {
  const [, navigate] = useLocation();
  const color = TYPE_COLORS[entity.type] || TYPE_COLORS.other;
  const expansionSuggestions = useMemo(
    () => generateExpansionSuggestions(entity.name, entity.type),
    [entity.name, entity.type]
  );
  const handleExpand = (query: string) => {
    sessionStorage.setItem("atlas_expansion_query", query);
    if (onOpenWebIngest) {
      onOpenWebIngest(query);
    } else {
      navigate(`/cases/${caseId}?section=web-ingest`);
    }
  };
  const connectedRels = relationships.filter(
    (r) => r.entityAId === entity.id || r.entityBId === entity.id
  );

  const { data: allMentions = [] } = useListEntityMentions({ caseId });
  const { data: docs = [] } = useListDocuments({ caseId });

  const docMap = useMemo(
    () => Object.fromEntries(docs.map((d) => [d.id, d])),
    [docs]
  );

  const entityMentions = useMemo(
    () => allMentions.filter((m) => m.entityName.toLowerCase() === entity.name.toLowerCase()),
    [allMentions, entity.name]
  );

  const approvedMentions = entityMentions.filter((m) => m.status === "approved");
  const linkedDocIds = [...new Set(approvedMentions.map((m) => m.documentId))];

  const { firstSeen, lastSeen } = useMemo(() => {
    if (!entityMentions.length) return { firstSeen: null, lastSeen: null };
    const sorted = [...entityMentions].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return {
      firstSeen: new Date(sorted[0].createdAt),
      lastSeen: new Date(sorted[sorted.length - 1].createdAt),
    };
  }, [entityMentions]);

  const coMentionedEntities = useMemo(() => {
    const sharedDocs = new Map<string, number>();
    entityMentions.forEach((m) => {
      allMentions
        .filter(
          (m2) =>
            m2.documentId === m.documentId &&
            m2.entityName.toLowerCase() !== entity.name.toLowerCase() &&
            m2.status === "approved"
        )
        .forEach((m2) => {
          const key = m2.entityName;
          sharedDocs.set(key, (sharedDocs.get(key) || 0) + 1);
        });
    });
    return Array.from(sharedDocs.entries())
      .map(([name, count]) => ({
        name,
        count,
        score: count >= 3 ? "HIGH" : count >= 2 ? "MEDIUM" : "LOW",
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [entityMentions, allMentions, entity.name]);

  const scoreColor = (s: string) =>
    s === "HIGH" ? "text-red-400" : s === "MEDIUM" ? "text-amber-400" : "text-neutral-600";

  const formatDate = (d: Date | null) =>
    d ? format(d, "yyyy-MM-dd") : "—";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="nexus-header-strip flex-shrink-0">
        <span className="nexus-label">ENTITY DOSSIER</span>
        <button
          onClick={onClose}
          className="text-neutral-600 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* ── Identity block ── */}
        <div
          className="p-3 border space-y-2"
          style={{ borderColor: `${color}30`, background: `${color}08` }}
        >
          <div className="text-base font-bold text-white uppercase tracking-tight">
            {entity.name}
          </div>
          <span
            className="inline-block text-[9px] font-mono uppercase px-1.5 py-0.5 border tracking-widest"
            style={{ color, borderColor: `${color}50`, background: `${color}12` }}
          >
            {entity.type.replace(/_/g, " ")}
          </span>
          {entity.description && (
            <p className="text-xs text-neutral-400 leading-relaxed">
              {entity.description}
            </p>
          )}
          {entity.aliases && entity.aliases.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {entity.aliases.map((a) => (
                <span
                  key={a}
                  className="text-[9px] font-mono text-neutral-600 border border-[#ffffff0d] px-1.5 py-0.5"
                >
                  AKA: {a}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Metrics ── */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 border border-[#ffffff06] bg-[#0a0e14] text-center">
            <div className="font-mono text-[18px] font-bold tabular-nums" style={{ color }}>
              {approvedMentions.length.toString().padStart(2, "0")}
            </div>
            <div className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest mt-0.5">
              MENTIONS
            </div>
          </div>
          <div className="p-2 border border-[#ffffff06] bg-[#0a0e14] text-center">
            <div className="font-mono text-[18px] font-bold tabular-nums" style={{ color }}>
              {linkedDocIds.length.toString().padStart(2, "0")}
            </div>
            <div className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest mt-0.5">
              DOCUMENTS
            </div>
          </div>
        </div>

        {/* ── First / Last seen ── */}
        {(firstSeen || lastSeen) && (
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 border border-[#ffffff06] bg-[#0a0e14]">
              <div className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest mb-1">
                FIRST SEEN
              </div>
              <div className="font-mono text-[10px] text-neutral-400 flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5 text-neutral-700 flex-shrink-0" />
                {formatDate(firstSeen)}
              </div>
            </div>
            <div className="p-2 border border-[#ffffff06] bg-[#0a0e14]">
              <div className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest mb-1">
                LAST SEEN
              </div>
              <div className="font-mono text-[10px] text-neutral-400 flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5 text-neutral-700 flex-shrink-0" />
                {formatDate(lastSeen)}
              </div>
            </div>
          </div>
        )}

        {/* ── Linked Documents ── */}
        {linkedDocIds.length > 0 && (
          <div className="space-y-1.5">
            <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest">
              SOURCE DOCUMENTS ({linkedDocIds.length})
            </div>
            {linkedDocIds.map((docId) => {
              const docMentions = approvedMentions.filter((m) => m.documentId === docId);
              const doc = docMap[docId];
              const isWeb = (doc as any)?.ingestMethod === "web";
              return (
                <div
                  key={docId}
                  className="flex items-center gap-2 p-2 border border-[#ffffff06] bg-[#0a0e14] text-[10px] font-mono"
                >
                  {isWeb ? (
                    <Globe className="w-3 h-3 text-cyan-800 flex-shrink-0" />
                  ) : (
                    <FileText className="w-3 h-3 text-neutral-700 flex-shrink-0" />
                  )}
                  <span className="text-neutral-400 flex-1 truncate">
                    {doc?.title || `DOC-${docId.toString().padStart(4, "0")}`}
                  </span>
                  <span className="text-cyan-700 text-[9px]">
                    {docMentions.length}×
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Connections ── */}
        <div className="space-y-1.5">
          <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest">
            CONFIRMED CONNECTIONS ({connectedRels.length})
          </div>
          {connectedRels.length === 0 ? (
            <div className="text-[10px] font-mono text-neutral-800 py-3 text-center">
              NO CONFIRMED CONNECTIONS
            </div>
          ) : (
            connectedRels.map((r) => {
              const isSource = r.entityAId === entity.id;
              const otherName = isSource ? r.entityBName : r.entityAName;
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-2 p-2 border border-[#ffffff06] bg-[#0a0e14] text-[10px] font-mono"
                >
                  <span className="text-neutral-700 text-[8px]">
                    {isSource ? "→" : "←"}
                  </span>
                  <span className="text-amber-500 text-[9px] uppercase">
                    {r.relationshipType}
                  </span>
                  <span className="text-white truncate text-xs font-semibold uppercase">
                    {otherName}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* ── Co-mentioned / Related Entities ── */}
        {coMentionedEntities.length > 0 && (
          <div className="space-y-1.5">
            <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest">
              CO-MENTIONED ENTITIES ({coMentionedEntities.length})
            </div>
            {coMentionedEntities.map((ce) => (
              <div
                key={ce.name}
                className="flex items-center gap-2 p-2 border border-[#ffffff06] bg-[#0a0e14] text-[10px] font-mono"
              >
                <span className={`text-[9px] font-bold uppercase w-14 flex-shrink-0 ${scoreColor(ce.score)}`}>
                  {ce.score}
                </span>
                <span className="text-white truncate flex-1 uppercase">{ce.name}</span>
                <span className="text-neutral-700 text-[9px]">{ce.count}×</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Mention Log ── */}
        {entityMentions.length > 0 && (
          <div className="space-y-1.5">
            <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest">
              MENTION LOG ({entityMentions.length})
            </div>
            {entityMentions.map((m) => {
              const doc = docMap[m.documentId];
              const confPct = m.confidence ? Math.round(m.confidence * 100) : null;
              const statusColor =
                m.status === "approved"
                  ? "text-green-500"
                  : m.status === "rejected"
                  ? "text-red-700"
                  : "text-orange-500";
              const isWeb = (doc as any)?.ingestMethod === "web";
              return (
                <div
                  key={m.id}
                  className="p-2 border border-[#ffffff06] bg-[#080b10] space-y-1"
                >
                  <div className="flex items-center gap-2">
                    {isWeb ? (
                      <Globe className="w-2.5 h-2.5 text-cyan-800 flex-shrink-0" />
                    ) : (
                      <FileText className="w-2.5 h-2.5 text-neutral-700 flex-shrink-0" />
                    )}
                    <span className="text-[9px] font-mono text-neutral-400 flex-1 truncate">
                      {doc?.title || `DOC-${m.documentId.toString().padStart(4, "0")}`}
                    </span>
                    {doc && isWeb && (
                      <span className="text-[8px] font-mono text-cyan-800">
                        {(doc as any).sourceDomain || ""}
                      </span>
                    )}
                  </div>
                  {m.context && (
                    <div className="text-[9px] font-mono text-neutral-600 italic leading-relaxed line-clamp-2">
                      &ldquo;{m.context}&rdquo;
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-0.5">
                    <span className={`text-[8px] font-mono uppercase font-bold ${statusColor}`}>
                      {m.status}
                    </span>
                    {confPct !== null && (
                      <span className="text-[8px] font-mono text-neutral-700">
                        CONF: {confPct}%
                      </span>
                    )}
                    <span className="text-[8px] font-mono text-neutral-800 ml-auto">
                      {format(new Date(m.createdAt), "MM/dd/yyyy")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Expansion Suggestions ── */}
        <div className="space-y-1.5 border-t border-[#ffffff06] pt-3">
          <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest flex items-center gap-1.5">
            <Search className="w-2.5 h-2.5" />
            EXPANSION SUGGESTIONS
          </div>
          {expansionSuggestions.map((q, i) => (
            <button
              key={i}
              onClick={() => handleExpand(q)}
              className="w-full text-left flex items-center gap-2 p-2 border border-[#ffffff06] hover:border-cyan-500/30 hover:bg-cyan-500/5 group transition-all"
            >
              <Search className="w-2.5 h-2.5 text-neutral-800 group-hover:text-cyan-700 flex-shrink-0" />
              <span className="text-[9px] font-mono text-neutral-700 group-hover:text-cyan-500 flex-1 leading-relaxed transition-colors">
                {q}
              </span>
              <ChevronRight className="w-2.5 h-2.5 text-neutral-800 group-hover:text-cyan-700 flex-shrink-0 transition-colors" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
