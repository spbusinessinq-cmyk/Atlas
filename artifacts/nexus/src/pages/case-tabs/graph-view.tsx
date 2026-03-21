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
  NodeToolbar,
  Handle,
  Position,
  type Edge,
  type NodeProps,
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
import { X, Plus, Trash2, FileText, Link2, ScanLine, Globe, Calendar, Search, ChevronRight, RotateCcw, Maximize2, Eye, EyeOff, GitBranch, Crosshair, Unlink, Target } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";

// ─── Custom AtlasNode with hover micro-controls ──────────────────────────────

interface AtlasNodeData {
  label: string;
  type: string;
  color: string;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDeleteGlobal: () => void;
  onIsolate: () => void;
  onFocus: () => void;
  [key: string]: unknown;
}

const NODE_BTN = {
  display: "flex", alignItems: "center", gap: "3px",
  padding: "2px 6px",
  background: "rgba(4,6,12,0.97)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "1px",
  color: "rgba(255,255,255,0.7)",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: "8px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  cursor: "pointer",
  transition: "all 0.1s",
  whiteSpace: "nowrap" as const,
} as React.CSSProperties;

function AtlasNode({ data, selected }: NodeProps) {
  const d = data as AtlasNodeData;
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isVisible = hovered || selected;
  const color = d.color as string;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setConfirmDelete(false); }}
      style={{ position: "relative" }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 6, height: 6 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 6, height: 6 }} />

      <NodeToolbar isVisible={isVisible} position={Position.Top} offset={6} style={{ display: "flex", gap: "3px", alignItems: "center" }}>
        {!confirmDelete ? (
          <>
            <button
              style={{ ...NODE_BTN, color: "rgba(6,182,212,0.9)" }}
              title="Focus node"
              onClick={e => { e.stopPropagation(); d.onFocus(); }}
            >
              <Crosshair style={{ width: 8, height: 8 }} />
            </button>
            <button
              style={{ ...NODE_BTN, color: "rgba(245,158,11,0.9)" }}
              title="Isolate node — hide others"
              onClick={e => { e.stopPropagation(); d.onIsolate(); }}
            >
              <Target style={{ width: 8, height: 8 }} />
            </button>
            <button
              style={{ ...NODE_BTN, color: "rgba(255,255,255,0.6)" }}
              title="Open dossier"
              onClick={e => { e.stopPropagation(); d.onSelect(); }}
            >
              <ScanLine style={{ width: 8, height: 8 }} />
              DOSSIER
            </button>
            <button
              style={{ ...NODE_BTN, color: "rgba(239,68,68,0.7)", borderColor: "rgba(239,68,68,0.2)" }}
              title="Remove from graph"
              onClick={e => { e.stopPropagation(); d.onRemove(); }}
            >
              <Unlink style={{ width: 8, height: 8 }} />
            </button>
            <button
              style={{ ...NODE_BTN, color: "rgba(239,68,68,0.9)", borderColor: "rgba(239,68,68,0.3)", background: "rgba(20,2,2,0.97)" }}
              title="Delete globally"
              onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
            >
              <Trash2 style={{ width: 8, height: 8 }} />
            </button>
          </>
        ) : (
          <>
            <span style={{ ...NODE_BTN, color: "rgba(239,68,68,0.9)", background: "rgba(20,2,2,0.97)", border: "1px solid rgba(239,68,68,0.4)" }}>DELETE?</span>
            <button
              style={{ ...NODE_BTN, color: "#fff", background: "rgba(180,20,20,0.9)", border: "1px solid rgba(239,68,68,0.5)" }}
              onClick={e => { e.stopPropagation(); d.onDeleteGlobal(); setConfirmDelete(false); }}
            >YES</button>
            <button
              style={{ ...NODE_BTN }}
              onClick={e => { e.stopPropagation(); setConfirmDelete(false); }}
            >NO</button>
          </>
        )}
      </NodeToolbar>

      {/* Node box — matches original buildNodeStyle */}
      <div style={{
        background: selected
          ? "linear-gradient(135deg, rgba(6,9,15,0.98) 0%, rgba(8,12,20,0.98) 100%)"
          : "linear-gradient(135deg, rgba(4,6,12,0.97) 0%, rgba(6,9,15,0.97) 100%)",
        color: selected ? "#ffffff" : "rgba(255,255,255,0.88)",
        border: selected ? `1px solid ${color}80` : "1px solid rgba(255,255,255,0.1)",
        borderLeft: `2px solid ${color}`,
        borderRadius: "1px",
        padding: "9px 14px",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "10px",
        width: 158,
        textAlign: "left",
        textTransform: "uppercase",
        fontWeight: "600",
        letterSpacing: "0.04em",
        boxShadow: selected
          ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px ${color}30, 0 0 24px ${color}35, 0 6px 24px rgba(0,0,0,0.8), 0 2px 8px rgba(0,0,0,0.9)`
          : "inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 20px rgba(0,0,0,0.75), 0 1px 6px rgba(0,0,0,0.9)",
        outline: "none",
        transition: "border-color 0.15s, box-shadow 0.15s",
        cursor: "pointer",
      }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130, color }}>
          {d.label as string}
        </div>
        <div style={{ fontSize: "7px", color: "rgba(255,255,255,0.25)", marginTop: "3px", letterSpacing: "0.08em" }}>
          {(d.type as string).replace(/_/g, " ")}
        </div>
      </div>
    </div>
  );
}

const ATLAS_NODE_TYPES = { atlas: AtlasNode } as const;

// ─── Manual Add Panel (T003) ─────────────────────────────────────────────────

function ManualAddPanel({
  caseId,
  entities,
  addMode,
  setAddMode,
  onClose,
  onSuccess,
}: {
  caseId: number;
  entities: Entity[];
  addMode: "entity" | "relationship";
  setAddMode: (m: "entity" | "relationship") => void;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Entity form
  const [eName, setEName] = useState("");
  const [eType, setEType] = useState("organization");
  const [eConf, setEConf] = useState("0.7");
  const [eNotes, setENotes] = useState("");

  // Relationship form
  const [relA, setRelA] = useState("");
  const [relB, setRelB] = useState("");
  const [relLabel, setRelLabel] = useState("associated_with");
  const [relConf, setRelConf] = useState("0.6");
  const [relNote, setRelNote] = useState("");

  const queryClient = useQueryClient();

  const handleAddEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eName.trim()) { setErr("Name required"); return; }
    setBusy(true); setErr(null);
    try {
      const resp = await fetch("/api/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: eName.trim(), type: eType, caseId, confidence: parseFloat(eConf) || 0.7, source: eNotes.trim() || "manual" }),
      });
      if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || `HTTP ${resp.status}`); }
      onSuccess();
    } catch (ex) { setErr(String((ex as Error).message)); } finally { setBusy(false); }
  };

  const handleAddRelationship = async (e: React.FormEvent) => {
    e.preventDefault();
    const aId = parseInt(relA);
    const bId = parseInt(relB);
    if (!aId || !bId) { setErr("Select both entities"); return; }
    if (aId === bId) { setErr("Source and target must be different"); return; }
    setBusy(true); setErr(null);
    try {
      const resp = await fetch("/api/relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityAId: aId, entityBId: bId, relationshipType: relLabel.trim() || "associated_with", confidence: parseFloat(relConf) || 0.6, description: relNote.trim() || undefined }),
      });
      if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || `HTTP ${resp.status}`); }
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
      onSuccess();
    } catch (ex) { setErr(String((ex as Error).message)); } finally { setBusy(false); }
  };

  const panelStyle: React.CSSProperties = {
    position: "absolute", bottom: 48, right: 16, width: 280, zIndex: 30,
    background: "rgba(4,6,12,0.97)", border: "1px solid rgba(255,255,255,0.1)",
    boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
    fontFamily: "'JetBrains Mono', monospace",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "#000", border: "1px solid rgba(255,255,255,0.12)",
    color: "#fff", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px",
    padding: "4px 8px", height: 28, outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "8px", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 3,
  };

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", alignItems: "center", padding: "6px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", gap: 6 }}>
        <span style={{ fontSize: "8px", color: "rgba(6,182,212,0.8)", textTransform: "uppercase", letterSpacing: "0.1em", flex: 1 }}>ADD TO GRAPH</span>
        <button
          onClick={() => setAddMode("entity")}
          style={{ fontSize: "8px", color: addMode === "entity" ? "rgba(6,182,212,0.9)" : "rgba(255,255,255,0.3)", background: addMode === "entity" ? "rgba(6,182,212,0.08)" : "transparent", border: "1px solid " + (addMode === "entity" ? "rgba(6,182,212,0.3)" : "rgba(255,255,255,0.07)"), padding: "2px 6px", cursor: "pointer", letterSpacing: "0.06em" }}
        >ENTITY</button>
        <button
          onClick={() => setAddMode("relationship")}
          style={{ fontSize: "8px", color: addMode === "relationship" ? "rgba(245,158,11,0.9)" : "rgba(255,255,255,0.3)", background: addMode === "relationship" ? "rgba(245,158,11,0.08)" : "transparent", border: "1px solid " + (addMode === "relationship" ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.07)"), padding: "2px 6px", cursor: "pointer", letterSpacing: "0.06em" }}
        >LINK</button>
        <button onClick={onClose} style={{ color: "rgba(255,255,255,0.3)", cursor: "pointer" }}><X style={{ width: 12, height: 12 }} /></button>
      </div>

      <div style={{ padding: "10px 12px" }}>
        {err && <div style={{ fontSize: "9px", color: "#ef4444", marginBottom: 8, padding: "4px 6px", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(20,2,2,0.8)" }}>{err}</div>}

        {addMode === "entity" ? (
          <form onSubmit={handleAddEntity} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <label style={labelStyle}>Entity Name</label>
              <input style={inputStyle} value={eName} onChange={e => setEName(e.target.value)} placeholder="e.g. LAHSA" />
            </div>
            <div>
              <label style={labelStyle}>Type</label>
              <select style={{ ...inputStyle, cursor: "pointer" }} value={eType} onChange={e => setEType(e.target.value)}>
                <option value="person">Person</option>
                <option value="organization">Organization</option>
                <option value="company">Company</option>
                <option value="government_agency">Government Agency</option>
                <option value="location">Location</option>
                <option value="event">Event</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Confidence (0–1)</label>
              <input style={inputStyle} value={eConf} onChange={e => setEConf(e.target.value)} type="number" min="0" max="1" step="0.05" />
            </div>
            <div>
              <label style={labelStyle}>Source / Notes</label>
              <input style={inputStyle} value={eNotes} onChange={e => setENotes(e.target.value)} placeholder="e.g. operator, field report" />
            </div>
            <button type="submit" disabled={busy} style={{ background: busy ? "#1a1a1a" : "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.3)", color: "rgba(6,182,212,0.9)", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.08em", padding: "5px 0", cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
              {busy ? "ADDING..." : "ADD ENTITY"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleAddRelationship} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <label style={labelStyle}>Source Entity</label>
              <select style={{ ...inputStyle, cursor: "pointer" }} value={relA} onChange={e => setRelA(e.target.value)}>
                <option value="">Select entity A...</option>
                {entities.map(e => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Target Entity</label>
              <select style={{ ...inputStyle, cursor: "pointer" }} value={relB} onChange={e => setRelB(e.target.value)}>
                <option value="">Select entity B...</option>
                {entities.map(e => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Relationship Type</label>
              <input style={inputStyle} value={relLabel} onChange={e => setRelLabel(e.target.value)} placeholder="e.g. associated_with, owns, contracted" />
            </div>
            <div>
              <label style={labelStyle}>Confidence (0–1)</label>
              <input style={inputStyle} value={relConf} onChange={e => setRelConf(e.target.value)} type="number" min="0" max="1" step="0.05" />
            </div>
            <div>
              <label style={labelStyle}>Supporting Note</label>
              <input style={inputStyle} value={relNote} onChange={e => setRelNote(e.target.value)} placeholder="Evidence or rationale" />
            </div>
            <button type="submit" disabled={busy} style={{ background: busy ? "#1a1a1a" : "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", color: "rgba(245,158,11,0.9)", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.08em", padding: "5px 0", cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
              {busy ? "ADDING..." : "ADD LINK"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

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
  financialSignals?: Array<{
    entityName?: string | null;
    controlledBy?: string | null;
    receivedBy?: string | null;
    amountDisplay?: string | null;
    normalizedAmount?: number | null;
    signalType?: string | null;
    financialConfidence?: number | null;
  }>;
  showFinancialLinks?: boolean;
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
  caseId,
  selectedEntityId,
  selectedRelId,
  onEntitySelect,
  onRelSelect,
  suggestedEdges = [],
  documentCount = 0,
  showSuggested = true,
  onToggleSuggested,
  financialSignals = [],
  showFinancialLinks = true,
}: GraphCanvasProps) {
  const posStorageKey = `atlas-graph-pos-${entities[0]?.caseId ?? caseId ?? "default"}`;
  const rfRef = useRef<{ fitView: (opts?: object) => void; fitBounds?: (bounds: object, opts?: object) => void } | null>(null);
  const queryClient = useQueryClient();

  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      const stored = localStorage.getItem(posStorageKey);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  const [hideIsolated, setHideIsolated] = useState(false);
  const [hideLowDegree, setHideLowDegree] = useState(false);
  const [showFinancialLinksLocal, setShowFinancialLinksLocal] = useState(showFinancialLinks);
  const [isolatedEntityId, setIsolatedEntityId] = useState<number | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addMode, setAddMode] = useState<"entity" | "relationship">("entity");

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

  // Filter entities based on active toggles + isolation
  const visibleEntities = useMemo(() => {
    if (isolatedEntityId !== null) {
      const connectedIds = new Set<number>([isolatedEntityId]);
      relationships.forEach(r => {
        if (r.entityAId === isolatedEntityId) connectedIds.add(r.entityBId);
        if (r.entityBId === isolatedEntityId) connectedIds.add(r.entityAId);
      });
      return entities.filter(e => connectedIds.has(e.id));
    }
    return entities.filter(e => {
      if (hideIsolated && !confirmedEdgeEntityIds.has(e.id)) return false;
      if (hideLowDegree && (confirmedDegree[e.id] || 0) <= 1) return false;
      return true;
    });
  }, [entities, hideIsolated, hideLowDegree, confirmedEdgeEntityIds, confirmedDegree, isolatedEntityId, relationships]);

  // Node-level action callbacks
  const handleNodeRemove = useCallback(async (entityId: number) => {
    const eid = entityId;
    const cid = caseId || entities[0]?.caseId;
    if (!cid) return;
    await fetch(`/api/cases/${cid}/entities/${eid}`, { method: "DELETE" });
    queryClient.invalidateQueries({ queryKey: [`/api/cases/${cid}/summary`] });
  }, [caseId, entities, queryClient]);

  const handleNodeDeleteGlobal = useCallback(async (entityId: number) => {
    await fetch(`/api/entities/${entityId}`, { method: "DELETE" });
    const cid = caseId || entities[0]?.caseId;
    if (cid) queryClient.invalidateQueries({ queryKey: [`/api/cases/${cid}/summary`] });
    queryClient.invalidateQueries({ queryKey: ["/api/entities"] });
  }, [caseId, entities, queryClient]);

  // Compute "source of truth" nodes from entity list + saved positions (T011/T013 — guarded)
  const computedNodes = useMemo(() => {
    try {
      const radius = 260;
      const center = { x: 420, y: 300 };
      const result = visibleEntities
        .filter(entity => {
          // T012 — soft mode: preserve borderline but skip truly empty/broken entries
          if (!entity.name || entity.name.trim().length === 0) return false;
          if (/^[\d\s\$£€,%\.\/\-\+]+$/.test(entity.name.trim())) return false;
          return true;
        })
        .map((entity, i, arr) => {
          const angle = (i / Math.max(arr.length, 1)) * 2 * Math.PI;
          const rawLabel = entity.name?.trim() ?? "UNKNOWN";
          // T012 — coerce safe label if name is long/malformed
          const safeLabel = rawLabel.length > 50 ? rawLabel.slice(0, 47) + "…" : rawLabel;
          const color = TYPE_COLORS[entity.type] || TYPE_COLORS.other;
          const isSelected = entity.id === selectedEntityId;
          const defaultPos = {
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle),
          };
          const pos = nodePositions[entity.id.toString()] || defaultPos;
          return {
            id: entity.id.toString(),
            type: "atlas",
            data: {
              label: safeLabel,
              type: entity.type || "unknown",
              color,
              isSelected,
              onSelect: () => onEntitySelect(entity.id),
              onRemove: () => handleNodeRemove(entity.id),
              onDeleteGlobal: () => handleNodeDeleteGlobal(entity.id),
              onIsolate: () => setIsolatedEntityId(prev => prev === entity.id ? null : entity.id),
              onFocus: () => rfRef.current?.fitView({ padding: 0.5, duration: 400 }),
            },
            position: pos,
          };
        });

      // T011 — graph state diagnostic log
      console.debug("[ATLAS GRAPH]", {
        caseId: caseId || entities[0]?.caseId,
        rawEntities: entities.length,
        visibleEntities: visibleEntities.length,
        computedNodes: result.length,
        edges: relationships.length,
        filterState: { hideIsolated, hideLowDegree, isolatedEntityId },
        resolveStatus: result.length === 0 && visibleEntities.length > 0
          ? "VALIDATION_FILTERED_ALL"
          : result.length === 0
          ? "NO_VISIBLE_ENTITIES"
          : "OK",
      });

      return result;
    } catch (err) {
      // T013 — computed nodes guard: catch any mapping failure, return safe empty state
      console.error("[ATLAS GRAPH] computedNodes mapping failed:", err);
      return [];
    }
  }, [visibleEntities, selectedEntityId, nodePositions, onEntitySelect, handleNodeRemove, handleNodeDeleteGlobal, caseId, entities, relationships, hideIsolated, hideLowDegree, isolatedEntityId]);

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
    // Build name→id lookup for financial link matching
    const nameToId = new Map<string, string>();
    for (const e of entities) {
      if (e.name) nameToId.set(e.name.toLowerCase().trim(), e.id.toString());
    }

    function matchEntityId(name: string | null | undefined): string | null {
      if (!name) return null;
      const key = name.toLowerCase().trim();
      if (nameToId.has(key)) return nameToId.get(key)!;
      // Partial match: any entity name that starts with the given name or vice versa
      for (const [ename, eid] of nameToId.entries()) {
        if (ename.startsWith(key) || key.startsWith(ename)) return eid;
      }
      return null;
    }

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

    // Financial link edges — green dashed arrows between actors in financial signals
    const financialLinks: typeof confirmed = [];
    if (showFinancialLinksLocal && financialSignals.length > 0) {
      const existingPairs = new Set([
        ...relationships.map(r => `${Math.min(r.entityAId, r.entityBId)}-${Math.max(r.entityAId, r.entityBId)}`),
        ...suggested.map(se => `${Math.min(se.entityAId, se.entityBId)}-${Math.max(se.entityAId, se.entityBId)}`),
      ]);
      const finPairs = new Set<string>();

      for (const sig of financialSignals) {
        const srcName = sig.controlledBy ?? sig.entityName;
        const tgtName = sig.receivedBy ?? null;
        const srcId = matchEntityId(srcName);
        const tgtId = matchEntityId(tgtName);
        if (!srcId || !tgtId || srcId === tgtId) continue;
        const numA = parseInt(srcId), numB = parseInt(tgtId);
        const pairKey = `${Math.min(numA, numB)}-${Math.max(numA, numB)}`;
        if (existingPairs.has(pairKey) || finPairs.has(pairKey)) continue;
        finPairs.add(pairKey);
        const amt = sig.amountDisplay && sig.amountDisplay !== "NON-NUMERIC" ? sig.amountDisplay : null;
        financialLinks.push({
          id: `fin-${pairKey}`,
          source: srcId,
          target: tgtId,
          label: amt ? `$ ${amt}` : "FINANCIAL",
          animated: false,
          data: { suggested: false },
          style: {
            stroke: "#22c55e",
            strokeWidth: 1.5,
            strokeDasharray: "4 5",
            opacity: 0.55,
          },
          labelStyle: {
            fill: "#22c55e",
            fontFamily: "monospace",
            fontSize: 7,
            opacity: 0.85,
          },
          labelBgStyle: { fill: "#000", fillOpacity: 0.88 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#22c55e",
            width: 10,
            height: 10,
          },
        });
      }
    }

    return [...confirmed, ...suggested, ...financialLinks];
  }, [relationships, selectedRelId, suggestedEdges, showSuggested, financialSignals, showFinancialLinksLocal, entities]);

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

  // T010 — safe fallback: entities exist but computedNodes is zero (filter/guard eliminated all)
  if (rfNodes.length === 0 && visibleEntities.length === 0 && entities.length > 0) {
    const reason = hideIsolated
      ? "ISOLATED NODES HIDDEN — ALL ENTITIES FILTERED"
      : hideLowDegree
      ? "LOW-DEGREE FILTER ACTIVE — ALL ENTITIES HIDDEN"
      : isolatedEntityId !== null
      ? "ISOLATION MODE — NO CONNECTED NODES FOUND"
      : "GRAPH FILTER ACTIVE — NO MATCHING NODES";
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#000]">
        <div className="atlas-empty-state max-w-sm">
          <GitBranch className="atlas-empty-icon w-10 h-10" />
          <div className="atlas-empty-title">NO GRAPH DATA VISIBLE</div>
          <div className="atlas-empty-sub">{reason}</div>
          <div className="space-y-1 mt-3 font-mono text-[8px] text-neutral-700 uppercase text-left w-full">
            <div>ENTITIES IN REGISTRY: <span className="text-neutral-500">{entities.length}</span></div>
            <div>DOCUMENTS INGESTED: <span className="text-neutral-500">{documentCount}</span></div>
            <div>CONFIRMED EDGES: <span className="text-neutral-500">{relationships.length}</span></div>
          </div>
          <button
            onClick={() => { setHideIsolated(false); setHideLowDegree(false); setIsolatedEntityId(null); }}
            className="mt-4 px-3 py-1.5 border border-red-900/40 font-mono text-[8px] uppercase tracking-widest text-red-500 hover:bg-red-900/10 transition-colors"
          >
            CLEAR ALL FILTERS
          </button>
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
          nodeTypes={ATLAS_NODE_TYPES}
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

      {/* Isolation indicator */}
      {isolatedEntityId !== null && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1" style={{ background: "rgba(4,6,12,0.97)", border: "1px solid rgba(245,158,11,0.4)", fontFamily: "'JetBrains Mono', monospace", fontSize: "8px", color: "rgba(245,158,11,0.9)", letterSpacing: "0.08em" }}>
          <Target className="w-2.5 h-2.5" />
          ISOLATED: {entities.find(e => e.id === isolatedEntityId)?.name ?? "NODE"}
          <button onClick={() => setIsolatedEntityId(null)} style={{ color: "rgba(255,255,255,0.5)", cursor: "pointer", marginLeft: 4 }}>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Manual Add overlay panel */}
      {showAddPanel && (
        <ManualAddPanel
          caseId={caseId || entities[0]?.caseId || 0}
          entities={entities}
          addMode={addMode}
          setAddMode={setAddMode}
          onClose={() => setShowAddPanel(false)}
          onSuccess={() => {
            const cid = caseId || entities[0]?.caseId;
            if (cid) queryClient.invalidateQueries({ queryKey: [`/api/cases/${cid}/summary`] });
            setShowAddPanel(false);
          }}
        />
      )}

      {/* Layout controls overlay */}
      <div className="absolute top-3 right-3 z-10 flex flex-wrap justify-end gap-1">
        {financialSignals.length > 0 && (
          <button
            onClick={() => setShowFinancialLinksLocal(v => !v)}
            title={showFinancialLinksLocal ? "Hide financial flow links" : "Show financial flow links"}
            style={{
              display: "flex", alignItems: "center", gap: "0.25rem",
              padding: "0.2rem 0.5rem",
              background: showFinancialLinksLocal ? "rgba(34,197,94,0.06)" : "rgba(2,4,10,0.9)",
              border: showFinancialLinksLocal ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(255,255,255,0.07)",
              color: showFinancialLinksLocal ? "rgba(34,197,94,0.85)" : "rgba(255,255,255,0.3)",
              fontFamily: "'JetBrains Mono', monospace", fontSize: "8px",
              textTransform: "uppercase", letterSpacing: "0.10em", cursor: "pointer",
              transition: "all 0.12s",
              boxShadow: "0 2px 10px rgba(0,0,0,0.6)",
            }}
          >
            {showFinancialLinksLocal ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
            {showFinancialLinksLocal ? "$ FLOWS ✓" : "$ FLOWS"}
          </button>
        )}
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
        <button
          onClick={() => { setShowAddPanel(v => !v); setAddMode("entity"); }}
          title="Manually add entity or relationship to graph"
          style={{
            display: "flex", alignItems: "center", gap: "0.25rem",
            padding: "0.2rem 0.5rem",
            background: showAddPanel ? "rgba(6,182,212,0.08)" : "rgba(2,4,10,0.9)",
            border: showAddPanel ? "1px solid rgba(6,182,212,0.3)" : "1px solid rgba(255,255,255,0.07)",
            color: showAddPanel ? "rgba(6,182,212,0.9)" : "rgba(255,255,255,0.3)",
            fontFamily: "'JetBrains Mono', monospace", fontSize: "8px",
            textTransform: "uppercase", letterSpacing: "0.10em", cursor: "pointer",
            transition: "all 0.12s",
            boxShadow: "0 2px 10px rgba(0,0,0,0.6)",
          }}
        >
          <Plus className="w-2.5 h-2.5" />
          ADD
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
