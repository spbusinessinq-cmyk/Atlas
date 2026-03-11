import React, { useMemo } from 'react';
import { ReactFlow, Controls, Background, BackgroundVariant, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Entity, Relationship } from '@workspace/api-client-react';

interface GraphViewProps {
  entities: Entity[];
  relationships: Relationship[];
}

export default function GraphView({ entities, relationships }: GraphViewProps) {
  const typeColors: Record<string, string> = {
    person: "#06b6d4", // cyan-500
    organization: "#f59e0b", // amber-500
    company: "#22c55e", // green-500
    government_agency: "#ef4444", // red-500
    location: "#a855f7", // purple-500
    event: "#3b82f6", // blue-500
    other: "#737373" // neutral-500
  };

  const nodes = useMemo(() => {
    const radius = 250;
    const center = { x: 400, y: 300 };
    return entities.map((entity, i) => {
      const angle = (i / entities.length) * 2 * Math.PI;
      const color = typeColors[entity.type] || typeColors.other;
      
      return {
        id: entity.id.toString(),
        data: { label: entity.name, type: entity.type },
        position: {
          x: center.x + radius * Math.cos(angle),
          y: center.y + radius * Math.sin(angle)
        },
        style: {
          background: '#0d1117',
          color: '#ffffff',
          border: `1px solid ${color}40`,
          borderLeft: `3px solid ${color}`,
          borderRadius: '0',
          padding: '10px 15px',
          fontFamily: 'monospace',
          fontSize: '11px',
          width: 160,
          textAlign: 'left' as const,
          textTransform: 'uppercase',
          fontWeight: 'bold',
          letterSpacing: '0.05em'
        }
      };
    });
  }, [entities]);

  const edges = useMemo(() => {
    return relationships.map((rel) => ({
      id: `e${rel.id}`,
      source: rel.entityAId.toString(),
      target: rel.entityBId.toString(),
      label: rel.relationshipType,
      animated: true,
      style: { stroke: '#dc2626', strokeWidth: 1, opacity: 0.6 },
      labelStyle: { fill: '#ffffff', fontWeight: 700, fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase' },
      labelBgStyle: { fill: '#000000', fillOpacity: 0.8 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#dc2626',
        width: 15,
        height: 15
      },
    }));
  }, [relationships]);

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
    <div className="relative w-full h-full">
      <div className="absolute top-0 left-0 w-full z-10 pointer-events-none">
        <div className="nexus-header-strip">
          <span className="nexus-label">LINK ANALYSIS</span>
        </div>
      </div>
      <ReactFlow nodes={nodes} edges={edges} fitView colorMode="dark" className="bg-[#000]">
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#ffffff1a" />
        <Controls 
          style={{ 
            backgroundColor: '#0d1117', 
            fill: '#ffffff', 
            border: '1px solid #ffffff1a',
            borderRadius: '0' 
          }} 
          className="border border-[#ffffff1a] rounded-none overflow-hidden"
        />
      </ReactFlow>
    </div>
  );
}
