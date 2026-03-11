import React, { useState } from "react";
import { useParams } from "wouter";
import { useGetCaseSummary } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { Activity, ShieldAlert, ArrowLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RightRail } from "@/components/right-rail";
import { formatDate } from "@/lib/utils";

// Sub-components
import GraphView from "./case-tabs/graph-view";
import EntitiesTab from "./case-tabs/entities-tab";
import DocumentsTab from "./case-tabs/documents-tab";
import TimelineTab from "./case-tabs/timeline-tab";
import NotesTab from "./case-tabs/notes-tab";

export default function CaseDetail() {
  const { id } = useParams();
  const caseId = parseInt(id || "0", 10);
  const { data: summary, isLoading } = useGetCaseSummary(caseId);
  const [activeTab, setActiveTab] = useState("overview");

  if (isLoading) return <div className="p-8 text-red-500 font-mono animate-pulse text-sm">DECRYPTING FILE...</div>;
  if (!summary) return <div className="p-8 text-red-500 font-mono text-sm">ERROR 404: FILE NOT FOUND OR CLASSIFIED.</div>;

  const { case: caseData, entities, documents, timeline, events, notes, relationships, moneyFlows } = summary;

  const statusColors = {
    open: "text-blue-400 bg-blue-500/10",
    active: "text-red-500 bg-red-500/10",
    closed: "text-neutral-400 bg-neutral-500/10",
    archived: "text-amber-500 bg-amber-500/10"
  };

  const statusDot = {
    open: "bg-blue-500",
    active: "bg-red-500",
    closed: "bg-neutral-500",
    archived: "bg-amber-500"
  };

  return (
    <div className="flex h-full gap-4 max-w-[1600px] mx-auto">
      <div className="flex-1 flex flex-col min-w-0 space-y-4">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight text-white uppercase">{caseData.title}</h1>
            <span className="text-red-600 font-mono text-xl tracking-widest">// DOSSIER</span>
          </div>
          
          <div className="flex items-center flex-wrap gap-3 font-mono text-[11px] text-neutral-500 uppercase tracking-widest">
            <span>ID: CASE-{caseData.id.toString().padStart(6, '0')}</span>
            <span className="w-px h-3 bg-[#ffffff1a]" />
            <div className={`flex items-center gap-1.5 px-1.5 py-0.5 ${statusColors[caseData.status as keyof typeof statusColors]}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${statusDot[caseData.status as keyof typeof statusDot]}`} />
              {caseData.status}
            </div>
            <span className="w-px h-3 bg-[#ffffff1a]" />
            <span>INIT: {formatDate(caseData.createdAt).split(',')[0]}</span>
            <span className="w-px h-3 bg-[#ffffff1a]" />
            <span>ENTITIES: {entities.length}</span>
            <span className="w-px h-3 bg-[#ffffff1a]" />
            <span>DOCS: {documents.length}</span>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="bg-transparent border-b border-[#ffffff1a] w-full justify-start h-10 rounded-none p-0 overflow-x-auto flex-nowrap space-x-6">
            {[
              { id: 'overview', label: 'OVERVIEW' },
              { id: 'entities', label: 'ENTITY REGISTRY' },
              { id: 'documents', label: 'DOCUMENT VAULT' },
              { id: 'graph', label: 'LINK ANALYSIS' },
              { id: 'timeline', label: 'TEMPORAL TRACE' },
              { id: 'notes', label: 'ANALYST NOTES' }
            ].map(tab => (
              <TabsTrigger 
                key={tab.id}
                value={tab.id} 
                className="h-full rounded-none font-mono text-[11px] tracking-widest px-0 uppercase data-[state=active]:bg-transparent data-[state=active]:text-red-500 data-[state=active]:border-b-2 data-[state=active]:border-red-500 text-neutral-500 hover:text-white transition-colors"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 overflow-auto mt-4">
            <TabsContent value="overview" className="m-0 h-full">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Entities Summary */}
                <div className="nexus-panel rounded-none">
                  <div className="nexus-header-strip">
                    <span className="nexus-label">ENTITY LIST ({entities.length})</span>
                  </div>
                  <div className="p-0">
                    {entities.slice(0, 5).map(e => (
                      <div key={e.id} className="px-3 py-2 border-b border-[#ffffff05] flex justify-between items-center hover:bg-[#ffffff02]">
                        <span className="text-sm text-white font-medium">{e.name}</span>
                        <span className="text-[10px] font-mono text-cyan-500">{e.type.toUpperCase()}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Docs Summary */}
                <div className="nexus-panel rounded-none">
                  <div className="nexus-header-strip">
                    <span className="nexus-label">RECENT DOCS ({documents.length})</span>
                  </div>
                  <div className="p-0">
                    {documents.slice(0, 5).map(d => (
                      <div key={d.id} className="px-3 py-2 border-b border-[#ffffff05] flex flex-col hover:bg-[#ffffff02]">
                        <span className="text-sm text-white truncate">{d.title}</span>
                        <span className="text-[10px] font-mono text-neutral-500 mt-0.5">{formatDate(d.uploadedAt).split(',')[0]}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Timeline Summary */}
                <div className="nexus-panel rounded-none">
                  <div className="nexus-header-strip">
                    <span className="nexus-label">TEMPORAL TRACE</span>
                  </div>
                  <div className="p-3 space-y-3">
                    {timeline.slice(0, 4).map(t => (
                      <div key={t.id} className="flex gap-3">
                        <div className="w-1.5 h-1.5 bg-red-600 rounded-full mt-1.5 shrink-0" />
                        <div>
                          <div className="text-[10px] font-mono text-red-500 mb-0.5">{formatDate(t.eventDate).split(',')[0]}</div>
                          <div className="text-sm text-white">{t.title}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="entities" className="m-0 h-full"><EntitiesTab caseId={caseId} entities={entities} /></TabsContent>
            <TabsContent value="graph" className="m-0 h-[600px] border border-[#ffffff0d] bg-[#000]"><GraphView entities={entities} relationships={relationships} caseId={caseId} /></TabsContent>
            <TabsContent value="documents" className="m-0 h-full"><DocumentsTab caseId={caseId} documents={documents} /></TabsContent>
            <TabsContent value="timeline" className="m-0 h-full"><TimelineTab caseId={caseId} timeline={timeline} /></TabsContent>
            <TabsContent value="notes" className="m-0 h-full"><NotesTab caseId={caseId} notes={notes} /></TabsContent>
          </div>
        </Tabs>
      </div>
      <RightRail />
    </div>
  );
}
