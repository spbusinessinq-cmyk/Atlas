import React, { useMemo, useState, useCallback } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  Edge,
  NodeMouseHandler,
  EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Entity,
  Relationship,
  useListRelationshipEvidence,
  useCreateRelationshipEvidence,
  useDeleteRelationshipEvidence,
  useListDocuments,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Plus, Trash2, FileText, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface GraphViewProps {
  entities: Entity[];
  relationships: Relationship[];
  caseId: number;
}

const TYPE_COLORS: Record<string, string> = {
  person: "#06b6d4",
  organization: "#f59e0b",
  company: "#22c55e",
  government_agency: "#ef4444",
  location: "#a855f7",
  event: "#3b82f6",
  other: "#737373",
};

export default function GraphView({ entities, relationships, caseId }: GraphViewProps) {
  const [selectedRelId, setSelectedRelId] = useState<number | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);

  const selectedRel = relationships.find((r) => r.id === selectedRelId) || null;
  const selectedEntity = entities.find((e) => e.id === selectedEntityId) || null;

  const nodes = useMemo(() => {
    const radius = 240;
    const center = { x: 380, y: 280 };
    return entities.map((entity, i) => {
      const angle = (i / entities.length) * 2 * Math.PI;
      const color = TYPE_COLORS[entity.type] || TYPE_COLORS.other;
      const isSelected = entity.id === selectedEntityId;
      return {
        id: entity.id.toString(),
        data: { label: entity.name, type: entity.type },
        position: {
          x: center.x + radius * Math.cos(angle),
          y: center.y + radius * Math.sin(angle),
        },
        style: {
          background: isSelected ? "#0d1f2a" : "#0d1117",
          color: "#ffffff",
          border: isSelected ? `2px solid ${color}` : `1px solid ${color}40`,
          borderLeft: `3px solid ${color}`,
          borderRadius: "0",
          padding: "8px 14px",
          fontFamily: "monospace",
          fontSize: "10px",
          width: 155,
          textAlign: "left" as const,
          textTransform: "uppercase" as const,
          fontWeight: "bold",
          letterSpacing: "0.05em",
          boxShadow: isSelected ? `0 0 12px ${color}33` : "none",
        },
      };
    });
  }, [entities, selectedEntityId]);

  const edges = useMemo(() => {
    return relationships.map((rel) => {
      const isSelected = rel.id === selectedRelId;
      return {
        id: `e${rel.id}`,
        source: rel.entityAId.toString(),
        target: rel.entityBId.toString(),
        label: rel.relationshipType.toUpperCase(),
        animated: isSelected,
        data: { relId: rel.id },
        style: {
          stroke: isSelected ? "#f59e0b" : "#dc2626",
          strokeWidth: isSelected ? 2.5 : 1,
          opacity: isSelected ? 1 : 0.55,
        },
        labelStyle: {
          fill: isSelected ? "#f59e0b" : "#ffffff",
          fontWeight: 700,
          fontFamily: "monospace",
          fontSize: 8,
          textTransform: "uppercase" as const,
        },
        labelBgStyle: { fill: "#000000", fillOpacity: 0.85 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isSelected ? "#f59e0b" : "#dc2626",
          width: 14,
          height: 14,
        },
      };
    });
  }, [relationships, selectedRelId]);

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_evt, edge) => {
      const relId = (edge.data as { relId: number })?.relId;
      setSelectedRelId((prev) => (prev === relId ? null : relId));
      setSelectedEntityId(null);
    },
    []
  );

  const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    setSelectedEntityId((prev) =>
      prev === parseInt(node.id) ? null : parseInt(node.id)
    );
    setSelectedRelId(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedRelId(null);
    setSelectedEntityId(null);
  }, []);

  if (entities.length === 0) {
    return (
      <div className="nexus-panel rounded-none h-full flex items-center justify-center">
        <div className="text-center font-mono text-neutral-600 text-sm uppercase tracking-widest">
          INSUFFICIENT DATA FOR NEXUS GRAPH
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex">
      <div className="relative flex-1 h-full">
        <div className="absolute top-0 left-0 w-full z-10 pointer-events-none">
          <div className="nexus-header-strip">
            <span className="nexus-label">LINK ANALYSIS — {entities.length} NODES / {relationships.length} EDGES</span>
          </div>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          colorMode="dark"
          className="bg-[#000]"
          onEdgeClick={onEdgeClick}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#ffffff1a" />
          <Controls
            style={{
              backgroundColor: "#0d1117",
              border: "1px solid #ffffff1a",
              borderRadius: "0",
            }}
            className="border border-[#ffffff1a] rounded-none overflow-hidden"
          />
        </ReactFlow>
        <div className="absolute bottom-2 left-2 z-10 font-mono text-[9px] text-neutral-700 uppercase tracking-widest pointer-events-none">
          CLICK EDGE FOR LINK INTEL · CLICK NODE FOR ENTITY PROFILE
        </div>
      </div>

      {selectedRel && (
        <LinkIntelPanel
          relationship={selectedRel}
          caseId={caseId}
          onClose={() => setSelectedRelId(null)}
        />
      )}

      {selectedEntity && !selectedRel && (
        <EntityIntelPanel
          entity={selectedEntity}
          relationships={relationships}
          onClose={() => setSelectedEntityId(null)}
        />
      )}
    </div>
  );
}

function LinkIntelPanel({
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
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/relationship-evidence"] });
      },
    },
  });

  const confidencePct = relationship.confidence
    ? Math.round(relationship.confidence * 100)
    : null;

  return (
    <div className="w-80 border-l border-[#ffffff1a] bg-[#070b10] flex flex-col h-full overflow-hidden flex-shrink-0">
      <div className="nexus-header-strip">
        <span className="nexus-label flex items-center gap-1.5">
          <Link2 className="w-3 h-3 text-amber-500" />
          LINK INTELLIGENCE
        </span>
        <button onClick={onClose} className="text-neutral-600 hover:text-white transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        <div className="space-y-1">
          <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest mb-2">
            RELATIONSHIP VECTOR
          </div>
          <div className="p-2 border border-amber-500/20 bg-amber-500/5">
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-cyan-400 font-bold truncate max-w-[90px]" title={relationship.entityAName}>
                {relationship.entityAName}
              </span>
              <span className="text-amber-500 text-[9px] uppercase">
                —{relationship.relationshipType}→
              </span>
              <span className="text-cyan-400 font-bold truncate max-w-[90px]" title={relationship.entityBName}>
                {relationship.entityBName}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-2">
              {confidencePct !== null && (
                <div className="text-[9px] font-mono text-neutral-500 uppercase">
                  CONF: <span className="text-white">{confidencePct}%</span>
                </div>
              )}
              {relationship.dateRange && (
                <div className="text-[9px] font-mono text-neutral-500 uppercase">
                  RANGE: <span className="text-white">{relationship.dateRange}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest">
            EVIDENCE CHAIN — {evidenceList.length} DOCS
          </div>
          {evidenceList.length === 0 ? (
            <div className="text-[10px] font-mono text-neutral-700 py-4 text-center border border-dashed border-[#ffffff08]">
              NO EVIDENCE LINKED
            </div>
          ) : (
            <div className="space-y-1">
              {evidenceList.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-start gap-2 p-2 border border-[#ffffff08] bg-[#0a0e14]"
                >
                  <FileText className="w-3 h-3 text-neutral-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-mono text-white font-bold truncate">
                      {ev.documentTitle || `DOC ${ev.documentId}`}
                    </div>
                    {ev.excerpt && (
                      <div className="text-[9px] font-mono text-neutral-500 mt-0.5 line-clamp-2">
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
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-[#ffffff0d] pt-3">
          <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest">
            LINK EVIDENCE
          </div>
          <select
            value={selectedDocId || ""}
            onChange={(e) =>
              setSelectedDocId(e.target.value ? parseInt(e.target.value) : undefined)
            }
            className="w-full bg-[#000] border border-[#ffffff1a] text-white font-mono text-[10px] px-2 py-1.5 uppercase"
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
            className="w-full bg-[#000] border border-[#ffffff1a] text-white font-mono text-[10px] px-2 py-1.5 resize-none placeholder:text-neutral-700 focus:border-amber-500/60 focus:outline-none"
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
            className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-amber-500/40 text-amber-500 hover:bg-amber-500/10 font-mono text-[10px] uppercase tracking-widest transition-colors disabled:opacity-40"
          >
            <Plus className="w-3 h-3" />
            {addMutation.isPending ? "LINKING..." : "ADD EVIDENCE"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EntityIntelPanel({
  entity,
  relationships,
  onClose,
}: {
  entity: Entity;
  relationships: Relationship[];
  onClose: () => void;
}) {
  const color = TYPE_COLORS[entity.type] || TYPE_COLORS.other;
  const connectedRels = relationships.filter(
    (r) => r.entityAId === entity.id || r.entityBId === entity.id
  );

  return (
    <div className="w-72 border-l border-[#ffffff1a] bg-[#070b10] flex flex-col h-full overflow-hidden flex-shrink-0">
      <div className="nexus-header-strip">
        <span className="nexus-label">ENTITY PROFILE</span>
        <button onClick={onClose} className="text-neutral-600 hover:text-white transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-4">
        <div className="p-3 border bg-[#0a0e14]" style={{ borderColor: `${color}40` }}>
          <div className="font-bold text-sm text-white font-mono uppercase mb-1">{entity.name}</div>
          <span
            className="text-[9px] font-mono px-1.5 py-0.5 border uppercase tracking-wider"
            style={{ color, borderColor: `${color}60`, background: `${color}0d` }}
          >
            {entity.type.replace(/_/g, " ")}
          </span>
          {entity.description && (
            <p className="mt-2 text-[10px] text-neutral-400 font-mono leading-relaxed">
              {entity.description}
            </p>
          )}
          {entity.aliases && entity.aliases.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {entity.aliases.map((a) => (
                <span
                  key={a}
                  className="text-[9px] font-mono text-neutral-500 border border-[#ffffff0d] px-1 py-0.5"
                >
                  AKA: {a}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1">
          <div className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest">
            CONNECTIONS — {connectedRels.length}
          </div>
          {connectedRels.length === 0 ? (
            <div className="text-[10px] font-mono text-neutral-700 py-3 text-center">
              NO CONNECTIONS
            </div>
          ) : (
            connectedRels.map((r) => {
              const isSource = r.entityAId === entity.id;
              const otherName = isSource ? r.entityBName : r.entityAName;
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-2 p-2 border border-[#ffffff08] bg-[#0a0e14] text-[10px] font-mono"
                >
                  <span className="text-neutral-500 text-[8px]">{isSource ? "→" : "←"}</span>
                  <span className="text-amber-500 text-[9px] uppercase truncate">
                    {r.relationshipType}
                  </span>
                  <span className="text-white truncate" title={otherName}>
                    {otherName}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
