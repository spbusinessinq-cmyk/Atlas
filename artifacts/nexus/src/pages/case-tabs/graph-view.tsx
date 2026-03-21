import React, { useMemo, useCallback, useRef, useEffect } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  NodeMouseHandler,
  EdgeMouseHandler,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  type Edge,
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
import { X, Plus, Trash2, FileText, Link2, ScanLine, Globe, Calendar, Search, ChevronRight, RotateCcw, Maximize2, Eye, EyeOff, GitBranch } from "lucide-react";
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
  showSuggested?: boolean;
  onToggleSuggested?: (v: boolean) => void;
}

const SCORE_STYLE: Record<string, { stroke: string; opacity: number; width: number; label: string; dashed?: boolean }> = {
  HIGH:   { stroke: "#22c55e", opacity: 0.70, width: 2.0, label: "HIGH CO-OCCUR"  },
  MEDIUM: { stroke: "#06b6d4", opacity: 0.45, width: 1.3, label: "CO-MENTION"     },
  LOW:    { stroke: "#06b6d4", opacity: 0.18, width: 1.0, label: "POSSIBLE ASSOC", dashed: true },
};

function buildNodeStyle(color: string, isSelected: boolean) {
  return {
    background: isSelected
      ? `linear-gradient(135deg, rgba(6,9,15,0.98) 0%, rgba(8,12,20,0.98) 100%)`
      : `linear-gradient(135deg, rgba(4,6,12,0.97) 0%, rgba(6,9,15,0.97) 100%)`,
    color: isSelected ? "#ffffff" : "rgba(255,255,255,0.88)",
    border: isSelected ? `1px solid ${color}80` : `1px solid rgba(255,255,255,0.1)`,
    borderLeft: `2px solid ${color}`,
    borderRadius: "1px",
    padding: "9px 14px",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "10px",
    width: 158,
    textAlign: "left" as const,
    textTransform: "uppercase" as const,
    fontWeight: "600",
    letterSpacing: "0.04em",
    boxShadow: isSelected
      ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px ${color}30, 0 0 24px ${color}35, 0 6px 24px rgba(0,0,0,0.8), 0 2px 8px rgba(0,0,0,0.9)`
      : `inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 20px rgba(0,0,0,0.75), 0 1px 6px rgba(0,0,0,0.9)`,
    outline: "none",
    transition: "border-color 0.15s, box-shadow 0.15s",
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
  showSuggested = true,
  onToggleSuggested,
}: GraphCanvasProps) {
  const posStorageKey = `atlas-graph-pos-${entities[0]?.caseId ?? "default"}`;
  const rfRef = useRef<{ fitView: (opts?: object) => void } | null>(null);

  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      const stored = localStorage.getItem(posStorageKey);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  const [hideIsolated, setHideIsolated] = useState(false);
  const [hideLowDegree, setHideLowDegree] = useState(false);

  const handleResetLayout = useCallback(() => {
    setNodePositions({});
    try { localStorage.removeItem(posStorageKey); } catch { /* ignore */ }
  }, [posStorageKey]);

  // Compute which entity IDs have confirmed edges
  const confirmedEdgeEntityIds = useMemo(() => {
    const ids = new Set<number>();
    relationships.forEach(r => { ids.add(r.entityAId); ids.add(r.entityBId); });
    return ids;
  }, [relationships]);

  // Degree count for each entity (confirmed edges only)
  const confirmedDegree = useMemo(() => {
    const degree: Record<number, number> = {};
    relationships.forEach(r => {
      degree[r.entityAId] = (degree[r.entityAId] || 0) + 1;
      degree[r.entityBId] = (degree[r.entityBId] || 0) + 1;
    });
    return degree;
  }, [relationships]);

  // Filter entities based on active toggles
  const visibleEntities = useMemo(() => {
    return entities.filter(e => {
      if (hideIsolated && !confirmedEdgeEntityIds.has(e.id)) return false;
      if (hideLowDegree && (confirmedDegree[e.id] || 0) <= 1) return false;
      return true;
    });
  }, [entities, hideIsolated, hideLowDegree, confirmedEdgeEntityIds, confirmedDegree]);

  // Compute "source of truth" nodes from entity list + saved positions
  const computedNodes = useMemo(() => {
    const radius = 260;
    const center = { x: 420, y: 300 };
    return visibleEntities.map((entity, i) => {
      const angle = (i / visibleEntities.length) * 2 * Math.PI;
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
  }, [visibleEntities, selectedEntityId, nodePositions]);

  // useNodesState/useEdgesState give ReactFlow internal control over drag positions
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(computedNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([] as Edge[]);

  // Sync from computed nodes when entity list or selection changes
  // (but NOT during drag — onNodesChange handles that internally)
  const prevEntityKeyRef = useRef("");
  useEffect(() => {
    const key = visibleEntities.map(e => `${e.id}:${e.name}:${e.type}`).join("|") + `:sel=${selectedEntityId}`;
    if (key !== prevEntityKeyRef.current) {
      prevEntityKeyRef.current = key;
      setRfNodes(computedNodes);
    }
  }, [computedNodes, visibleEntities, selectedEntityId, setRfNodes]);

  // Save position to localStorage on drag stop
  const onNodeDragStop = useCallback((_evt: React.MouseEvent, node: { id: string; position: { x: number; y: number } }) => {
    setNodePositions((prev) => {
      const updated = { ...prev, [node.id]: node.position };
      try { localStorage.setItem(posStorageKey, JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }, [posStorageKey]);

  const computedEdges = useMemo(() => {
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
            strokeDasharray: s.dashed ? "3 6" : se.score === "MEDIUM" ? "5 4" : "none",
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

  // Sync computed edges into ReactFlow state
  useEffect(() => {
    setRfEdges(computedEdges);
  }, [computedEdges, setRfEdges]);

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
        <div className="h-full flex flex-col items-center justify-center bg-[#000]">
          <div className="atlas-empty-state max-w-xs">
            <GitBranch className="atlas-empty-icon w-10 h-10" />
            <div className="atlas-empty-title">GRAPH EMPTY — ENTITIES IN TRIAGE</div>
            <div className="atlas-empty-sub">
              {documentCount} document{documentCount !== 1 ? "s" : ""} ingested but no entities have been promoted yet.
              Open the Entity Registry tab to review and approve candidates.
            </div>
            <div className="atlas-empty-badge">
              <ScanLine className="inline w-2.5 h-2.5 mr-1 mb-0.5" />
              ENTITY REGISTRY → APPROVE CANDIDATES
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#000]">
        <div className="atlas-empty-state max-w-xs">
          <GitBranch className="atlas-empty-icon w-10 h-10" />
          <div className="atlas-empty-title">NO LINK GRAPH</div>
          <div className="atlas-empty-sub">
            Ingest source documents and promote entities to build the network map.
          </div>
          <div className="atlas-empty-badge">→ OPEN WEB INGEST TO BEGIN</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <ReactFlowProvider>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          colorMode="dark"
          className="atlas-graph-bg atlas-graph"
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
            gap={32}
            size={0.8}
            color="rgba(255,255,255,0.06)"
          />
          <Controls
            style={{
              backgroundColor: "rgba(2,4,10,0.95)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "1px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
            }}
          />
        </ReactFlow>
      </ReactFlowProvider>

      {/* Layout controls overlay */}
      <div className="absolute top-3 right-3 z-10 flex flex-wrap justify-end gap-1">
        {suggestedEdges.length > 0 && (
          <button
            onClick={() => onToggleSuggested ? onToggleSuggested(!showSuggested) : undefined}
            title={showSuggested ? "Hide suggested links" : "Show suggested links"}
            style={{
              display: "flex", alignItems: "center", gap: "0.25rem",
              padding: "0.2rem 0.5rem",
              background: showSuggested ? "rgba(6,182,212,0.05)" : "rgba(2,4,10,0.9)",
              border: showSuggested ? "1px solid rgba(6,182,212,0.3)" : "1px solid rgba(255,255,255,0.07)",
              color: showSuggested ? "rgba(6,182,212,0.8)" : "rgba(255,255,255,0.3)",
              fontFamily: "'JetBrains Mono', monospace", fontSize: "8px",
              textTransform: "uppercase", letterSpacing: "0.10em", cursor: "pointer",
              transition: "all 0.12s",
              boxShadow: "0 2px 10px rgba(0,0,0,0.6)",
            }}
          >
            {showSuggested ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
            {showSuggested ? "SUGGESTED ✓" : "SUGGESTED"}
          </button>
        )}
        <button
          onClick={() => setHideIsolated(v => !v)}
          title="Hide nodes with no confirmed edges"
          style={{
            display: "flex", alignItems: "center", gap: "0.25rem",
            padding: "0.2rem 0.5rem",
            background: hideIsolated ? "rgba(245,158,11,0.05)" : "rgba(2,4,10,0.9)",
            border: hideIsolated ? "1px solid rgba(245,158,11,0.3)" : "1px solid rgba(255,255,255,0.07)",
            color: hideIsolated ? "rgba(245,158,11,0.8)" : "rgba(255,255,255,0.3)",
            fontFamily: "'JetBrains Mono', monospace", fontSize: "8px",
            textTransform: "uppercase", letterSpacing: "0.10em", cursor: "pointer",
            transition: "all 0.12s",
            boxShadow: "0 2px 10px rgba(0,0,0,0.6)",
          }}
        >
          <EyeOff className="w-2.5 h-2.5" />
          {hideIsolated ? "ISOLATED ✓" : "ISOLATED"}
        </button>
        <button
          onClick={() => setHideLowDegree(v => !v)}
          title="Hide nodes with only 1 confirmed edge"
          style={{
            display: "flex", alignItems: "center", gap: "0.25rem",
            padding: "0.2rem 0.5rem",
            background: hideLowDegree ? "rgba(245,158,11,0.05)" : "rgba(2,4,10,0.9)",
            border: hideLowDegree ? "1px solid rgba(245,158,11,0.3)" : "1px solid rgba(255,255,255,0.07)",
            color: hideLowDegree ? "rgba(245,158,11,0.8)" : "rgba(255,255,255,0.3)",
            fontFamily: "'JetBrains Mono', monospace", fontSize: "8px",
            textTransform: "uppercase", letterSpacing: "0.10em", cursor: "pointer",
            transition: "all 0.12s",
            boxShadow: "0 2px 10px rgba(0,0,0,0.6)",
          }}
        >
          <EyeOff className="w-2.5 h-2.5" />
          {hideLowDegree ? "LOW-DEG ✓" : "LOW-DEG"}
        </button>
        <button
          onClick={() => rfRef.current?.fitView({ padding: 0.2, duration: 400 })}
          title="Fit graph to view"
          style={{
            display: "flex", alignItems: "center", gap: "0.25rem",
            padding: "0.2rem 0.5rem",
            background: "rgba(2,4,10,0.9)", border: "1px solid rgba(255,255,255,0.07)",
            color: "rgba(255,255,255,0.3)",
            fontFamily: "'JetBrains Mono', monospace", fontSize: "8px",
            textTransform: "uppercase", letterSpacing: "0.10em", cursor: "pointer",
            transition: "all 0.12s",
            boxShadow: "0 2px 10px rgba(0,0,0,0.6)",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "rgba(6,182,212,0.8)"; e.currentTarget.style.borderColor = "rgba(6,182,212,0.25)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.3)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
        >
          <Maximize2 className="w-2.5 h-2.5" />
          FIT
        </button>
        <button
          onClick={handleResetLayout}
          title="Reset node layout"
          style={{
            display: "flex", alignItems: "center", gap: "0.25rem",
            padding: "0.2rem 0.5rem",
            background: "rgba(2,4,10,0.9)", border: "1px solid rgba(255,255,255,0.07)",
            color: "rgba(255,255,255,0.3)",
            fontFamily: "'JetBrains Mono', monospace", fontSize: "8px",
            textTransform: "uppercase", letterSpacing: "0.10em", cursor: "pointer",
            transition: "all 0.12s",
            boxShadow: "0 2px 10px rgba(0,0,0,0.6)",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "rgba(220,38,38,0.8)"; e.currentTarget.style.borderColor = "rgba(220,38,38,0.25)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.3)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
        >
          <RotateCcw className="w-2.5 h-2.5" />
          RESET
        </button>
      </div>

      {/* ── Graph stats (top-left) ── */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
        <div style={{
          display: "flex", alignItems: "center", gap: "0.5rem",
          padding: "0.2rem 0.625rem",
          background: "rgba(2,4,10,0.85)",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
        }}>
          <span className="font-mono text-[8px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>
            {visibleEntities.length}{visibleEntities.length !== entities.length ? `/${entities.length}` : ""}&nbsp;NODES
          </span>
          <span style={{ color: "rgba(255,255,255,0.1)" }}>·</span>
          <span className="font-mono text-[8px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>
            {relationships.length}&nbsp;EDGES
          </span>
          {suggestedEdges.length > 0 && (
            <>
              <span style={{ color: "rgba(255,255,255,0.1)" }}>·</span>
              <span className="font-mono text-[8px] uppercase tracking-widest" style={{ color: "rgba(6,182,212,0.4)" }}>
                {suggestedEdges.length} SUGGESTED{highSuggested > 0 && ` · ${highSuggested} HIGH`}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Bottom hint ── */}
      <div className="absolute bottom-3 left-3 z-10 font-mono text-[8px] uppercase tracking-widest pointer-events-none" style={{ color: "rgba(255,255,255,0.12)" }}>
        CLICK EDGE → LINK INTEL &nbsp;·&nbsp; CLICK NODE → ENTITY DOSSIER
        {medSuggested > 0 && (
          <span style={{ color: "rgba(6,182,212,0.25)" }}>
            &nbsp;·&nbsp; DASHED = CO-MENTION
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
  onHideAllSuggested,
}: {
  relationship: Relationship;
  caseId: number;
  onClose: () => void;
  onHideAllSuggested?: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedDocId, setSelectedDocId] = useState<number | undefined>();
  const [excerpt, setExcerpt] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
        {/* ── Edge control actions ── */}
        <div className="space-y-1">
          <div className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest mb-1.5">EDGE CONTROLS</div>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-red-800/40 text-red-700 hover:bg-red-500/10 hover:border-red-500/60 hover:text-red-400 font-mono text-[9px] uppercase tracking-widest transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              DELETE EDGE
            </button>
          ) : (
            <div className="flex items-center gap-2 border border-red-700/50 bg-[#0d0000] px-2 py-1.5">
              <span className="font-mono text-[9px] text-red-400 uppercase flex-1">Confirm delete edge?</span>
              <button
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await fetch(`/api/relationships/${relationship.id}`, { method: "DELETE" });
                    queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
                    onClose();
                  } finally { setDeleting(false); setConfirmDelete(false); }
                }}
                disabled={deleting}
                className="font-mono text-[9px] text-red-400 hover:text-red-300 uppercase px-1.5 py-0.5 hover:bg-red-500/20 transition-colors"
              >
                {deleting ? "…" : "YES"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="font-mono text-[9px] text-neutral-600 hover:text-white uppercase px-1.5 py-0.5"
              >
                NO
              </button>
            </div>
          )}
          {onHideAllSuggested && (
            <button
              onClick={onHideAllSuggested}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-[#ffffff10] text-neutral-600 hover:text-white hover:border-[#ffffff20] font-mono text-[9px] uppercase tracking-widest transition-colors"
            >
              <EyeOff className="w-3 h-3" />
              HIDE ALL SUGGESTED EDGES
            </button>
          )}
        </div>

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
  onRemoveFromGraph,
}: {
  entity: Entity;
  relationships: Relationship[];
  caseId: number;
  onClose: () => void;
  onOpenWebIngest?: (query: string) => void;
  onRemoveFromGraph?: (entityId: number) => void;
}) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const color = TYPE_COLORS[entity.type] || TYPE_COLORS.other;

  // Operator action state
  const [opsConfirm, setOpsConfirm] = useState<"delete-case" | "delete-global" | null>(null);
  const [opsWorking, setOpsWorking] = useState(false);
  const [opsMsg, setOpsMsg] = useState<string | null>(null);

  const invalidateSummary = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });

  const handleDeleteFromCase = async () => {
    setOpsWorking(true);
    setOpsMsg(null);
    try {
      const r = await fetch(`/api/cases/${caseId}/entities/${entity.id}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
      await invalidateSummary();
      onClose();
    } catch (e) {
      setOpsMsg(`Error: ${e}`);
    } finally { setOpsWorking(false); setOpsConfirm(null); }
  };

  const handleDeleteGlobal = async () => {
    setOpsWorking(true);
    setOpsMsg(null);
    try {
      const r = await fetch(`/api/entities/${entity.id}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
      await invalidateSummary();
      onClose();
    } catch (e) {
      setOpsMsg(`Error: ${e}`);
    } finally { setOpsWorking(false); setOpsConfirm(null); }
  };

  const handleRejectMentions = async () => {
    setOpsWorking(true);
    setOpsMsg(null);
    try {
      const r = await fetch(`/api/cases/${caseId}/entities/${entity.id}/reject-mentions`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      setOpsMsg(`Rejected ${(data as any).rejected ?? "?"} pending mention(s).`);
      await invalidateSummary();
    } catch (e) {
      setOpsMsg(`Error: ${e}`);
    } finally { setOpsWorking(false); }
  };
  const expansionSuggestions = useMemo(
    () => generateExpansionSuggestions(entity.name, entity.type),
    [entity.name, entity.type]
  );

  const OpsActionRow = ({ label, cls, onClick }: { label: string; cls?: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      disabled={opsWorking}
      className={`w-full flex items-center justify-center gap-1.5 py-1.5 border font-mono text-[9px] uppercase tracking-widest transition-colors disabled:opacity-40 ${cls || "border-red-800/40 text-red-700 hover:bg-red-500/10 hover:border-red-500/60 hover:text-red-400"}`}
    >
      {opsWorking ? "…" : label}
    </button>
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

        {/* ── OPERATOR ACTIONS ── */}
        <div className="space-y-1.5">
          <div className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest border-b border-[#ffffff08] pb-1">OPERATOR ACTIONS</div>
          {opsMsg && (
            <div className="font-mono text-[9px] text-green-500/80 bg-green-500/5 border border-green-500/20 px-2 py-1">{opsMsg}</div>
          )}
          {onRemoveFromGraph && (
            <OpsActionRow
              label="⊖  REMOVE FROM GRAPH VIEW"
              cls="border-amber-800/40 text-amber-700 hover:bg-amber-500/10 hover:border-amber-500/60 hover:text-amber-400"
              onClick={() => { onRemoveFromGraph(entity.id); onClose(); }}
            />
          )}
          <OpsActionRow
            label="✕  REJECT ALL PENDING MENTIONS"
            cls="border-[#ffffff10] text-neutral-600 hover:text-white hover:border-[#ffffff20]"
            onClick={handleRejectMentions}
          />
          {opsConfirm !== "delete-case" ? (
            <OpsActionRow label="⊗  DELETE FROM CASE" onClick={() => setOpsConfirm("delete-case")} />
          ) : (
            <div className="flex items-center gap-2 border border-red-700/50 bg-[#0d0000] px-2 py-1.5">
              <span className="font-mono text-[9px] text-red-400 uppercase flex-1">Delete from this case?</span>
              <button onClick={handleDeleteFromCase} disabled={opsWorking} className="font-mono text-[9px] text-red-400 hover:text-red-300 uppercase px-1.5 py-0.5 hover:bg-red-500/20">{opsWorking ? "…" : "YES"}</button>
              <button onClick={() => setOpsConfirm(null)} className="font-mono text-[9px] text-neutral-600 hover:text-white uppercase px-1.5 py-0.5">NO</button>
            </div>
          )}
          {opsConfirm !== "delete-global" ? (
            <OpsActionRow
              label="⊗  DELETE GLOBALLY (ALL CASES)"
              cls="border-red-900/60 text-red-800 hover:bg-red-500/10 hover:border-red-600/60 hover:text-red-500"
              onClick={() => setOpsConfirm("delete-global")}
            />
          ) : (
            <div className="flex items-center gap-2 border border-red-700/50 bg-[#120000] px-2 py-1.5">
              <span className="font-mono text-[9px] text-red-300 uppercase flex-1">GLOBALLY delete entity?</span>
              <button onClick={handleDeleteGlobal} disabled={opsWorking} className="font-mono text-[9px] text-red-300 hover:text-red-200 uppercase px-1.5 py-0.5 hover:bg-red-500/20">{opsWorking ? "…" : "YES"}</button>
              <button onClick={() => setOpsConfirm(null)} className="font-mono text-[9px] text-neutral-600 hover:text-white uppercase px-1.5 py-0.5">NO</button>
            </div>
          )}
        </div>

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
