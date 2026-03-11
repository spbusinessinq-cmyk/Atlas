import React, { useMemo } from 'react';
import { ReactFlow, Controls, Background, BackgroundVariant, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Entity, Relationship } from '@workspace/api-client-react';

interface GraphViewProps {
  entities: Entity[];
  relationships: Relationship[];
}

export default function GraphView({ entities, relationships }: GraphViewProps) {
  // Simple layout logic: place nodes in a circle
  const nodes = useMemo(() => {
    const radius = 250;
    const center = { x: 400, y: 300 };
    return entities.map((entity, i) => {
      const angle = (i / entities.length) * 2 * Math.PI;
      return {
        id: entity.id.toString(),
        data: { label: entity.name, type: entity.type },
        position: {
          x: center.x + radius * Math.cos(angle),
          y: center.y + radius * Math.sin(angle)
        },
        style: {
          background: 'hsl(var(--card))',
          color: 'hsl(var(--foreground))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '4px',
          padding: '10px 15px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)',
          fontFamily: 'monospace',
          fontSize: '12px',
          width: 150,
          textAlign: 'center' as const
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
      style: { stroke: 'hsl(var(--primary))', strokeWidth: 2 },
      labelStyle: { fill: 'hsl(var(--foreground))', fontWeight: 700, fontFamily: 'monospace', fontSize: 10 },
      labelBgStyle: { fill: 'hsl(var(--background))', fillOpacity: 0.8 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: 'hsl(var(--primary))',
      },
    }));
  }, [relationships]);

  if (entities.length === 0) {
    return <div className="h-full w-full flex items-center justify-center font-mono text-muted-foreground">INSUFFICIENT DATA FOR NEXUS GRAPH</div>;
  }

  return (
    <ReactFlow nodes={nodes} edges={edges} fitView colorMode="dark">
      <Background variant={BackgroundVariant.Dots} gap={12} size={1} color="hsl(var(--muted-foreground))" />
      <Controls style={{ backgroundColor: 'hsl(var(--card))', fill: 'hsl(var(--foreground))' }} />
    </ReactFlow>
  );
}
