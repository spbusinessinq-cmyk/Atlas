import React, { useState } from "react";
import { useParams, Link } from "wouter";
import { useGetCaseSummary } from "@workspace/api-client-react";
import { ArrowLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RightRail } from "@/components/right-rail";
import { formatDate } from "@/lib/utils";

import GraphView from "./case-tabs/graph-view";
import EntitiesTab from "./case-tabs/entities-tab";
import DocumentsTab from "./case-tabs/documents-tab";
import TimelineTab from "./case-tabs/timeline-tab";
import NotesTab from "./case-tabs/notes-tab";

const STATUS_COLORS = {
  open: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  active: "text-red-500 bg-red-500/10 border-red-500/30",
  closed: "text-neutral-400 bg-neutral-500/10 border-neutral-500/30",
  archived: "text-amber-500 bg-amber-500/10 border-amber-500/30",
};
const STATUS_DOT = {
  open: "bg-blue-500",
  active: "bg-red-500 animate-pulse",
  closed: "bg-neutral-500",
  archived: "bg-amber-500",
};

const TABS = [
  { id: "overview", label: "OVERVIEW" },
  { id: "entities", label: "ENTITY REGISTRY" },
  { id: "documents", label: "DOCUMENT VAULT" },
  { id: "graph", label: "LINK ANALYSIS" },
  { id: "timeline", label: "TEMPORAL TRACE" },
  { id: "notes", label: "ANALYST" },
];

export default function CaseDetail() {
  const { id } = useParams();
  const caseId = parseInt(id || "0", 10);
  const { data: summary, isLoading } = useGetCaseSummary(caseId);
  const [activeTab, setActiveTab] = useState("overview");

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
    events,
    notes,
    relationships,
    moneyFlows,
    pendingMentions,
  } = summary;

  const statusColor =
    STATUS_COLORS[caseData.status as keyof typeof STATUS_COLORS] ?? STATUS_COLORS.open;
  const statusDot =
    STATUS_DOT[caseData.status as keyof typeof STATUS_DOT] ?? STATUS_DOT.open;

  return (
    <div className="flex h-full gap-4 max-w-[1600px] mx-auto">
      <div className="flex-1 flex flex-col min-w-0 space-y-3">
        {/* Header */}
        <div>
          <Link href="/">
            <button className="text-[9px] font-mono text-neutral-600 hover:text-white uppercase tracking-widest flex items-center gap-1.5 mb-2 transition-colors">
              <ArrowLeft className="w-3 h-3" /> CASE CONTROL
            </button>
          </Link>
          <div className="flex items-center gap-3 mb-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-white uppercase">
              {caseData.title}
            </h1>
            <span className="text-red-600 font-mono text-sm tracking-widest opacity-70">
              // DOSSIER
            </span>
          </div>
          <div className="flex items-center flex-wrap gap-2 font-mono text-[10px] text-neutral-600 uppercase tracking-widest">
            <span className="text-neutral-500">
              ID: CASE-{caseData.id.toString().padStart(6, "0")}
            </span>
            <span className="w-px h-3 bg-[#ffffff0d]" />
            <div
              className={`flex items-center gap-1.5 px-1.5 py-0.5 border ${statusColor}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
              {caseData.status}
            </div>
            <span className="w-px h-3 bg-[#ffffff0d]" />
            <span>INIT: {formatDate(caseData.createdAt).split(",")[0]}</span>
            <span className="w-px h-3 bg-[#ffffff0d]" />
            <span>
              ENT: <span className="text-white">{entities.length}</span>
            </span>
            <span className="w-px h-3 bg-[#ffffff0d]" />
            <span>
              DOC: <span className="text-white">{documents.length}</span>
            </span>
            <span className="w-px h-3 bg-[#ffffff0d]" />
            <span>
              LNK: <span className="text-white">{relationships.length}</span>
            </span>
            {pendingMentions > 0 && (
              <>
                <span className="w-px h-3 bg-[#ffffff0d]" />
                <span className="text-amber-400">
                  ATLAS: {pendingMentions} PENDING
                </span>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="bg-transparent border-b border-[#ffffff0d] w-full justify-start h-8 rounded-none p-0 overflow-x-auto flex-nowrap gap-4">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="h-full rounded-none font-mono text-[10px] tracking-widest px-0 uppercase data-[state=active]:bg-transparent data-[state=active]:text-red-500 data-[state=active]:border-b-2 data-[state=active]:border-red-500 data-[state=active]:shadow-none text-neutral-600 hover:text-neutral-300 transition-colors"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 overflow-auto mt-3">
            {/* OVERVIEW */}
            <TabsContent value="overview" className="m-0">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="nexus-panel rounded-none">
                  <div className="nexus-header-strip">
                    <span className="nexus-label">
                      ENTITY LIST ({entities.length})
                    </span>
                  </div>
                  <div className="p-0">
                    {entities.length === 0 ? (
                      <div className="px-3 py-5 text-center font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
                        NO ENTITIES
                      </div>
                    ) : (
                      entities.slice(0, 6).map((e) => (
                        <div
                          key={e.id}
                          className="px-3 py-1.5 border-b border-[#ffffff04] flex justify-between items-center hover:bg-[#ffffff02]"
                        >
                          <span className="text-xs text-white font-medium uppercase truncate">
                            {e.name}
                          </span>
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
                    <span className="nexus-label">
                      RECENT DOCS ({documents.length})
                    </span>
                  </div>
                  <div className="p-0">
                    {documents.length === 0 ? (
                      <div className="px-3 py-5 text-center font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
                        NO DOCUMENTS
                      </div>
                    ) : (
                      documents.slice(0, 6).map((d) => (
                        <div
                          key={d.id}
                          className="px-3 py-1.5 border-b border-[#ffffff04] flex flex-col hover:bg-[#ffffff02]"
                        >
                          <span className="text-xs text-white truncate">{d.title}</span>
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
                    <span className="nexus-label">
                      TEMPORAL TRACE ({timeline.length})
                    </span>
                  </div>
                  <div className="p-3 space-y-2">
                    {timeline.length === 0 ? (
                      <div className="py-4 text-center font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
                        NO EVENTS
                      </div>
                    ) : (
                      timeline.slice(0, 5).map((t) => (
                        <div key={t.id} className="flex gap-2.5">
                          <div className="w-1.5 h-1.5 bg-red-600 rounded-full mt-1 shrink-0" />
                          <div>
                            <div className="text-[9px] font-mono text-red-500 mb-0.5">
                              {formatDate(t.eventDate).split(",")[0]}
                            </div>
                            <div className="text-xs text-white">{t.title}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="entities" className="m-0 h-full">
              <EntitiesTab caseId={caseId} entities={entities} />
            </TabsContent>
            <TabsContent
              value="graph"
              className="m-0 h-[600px] border border-[#ffffff0d] bg-[#000]"
            >
              <GraphView
                entities={entities}
                relationships={relationships}
                caseId={caseId}
              />
            </TabsContent>
            <TabsContent value="documents" className="m-0 h-full">
              <DocumentsTab caseId={caseId} documents={documents} />
            </TabsContent>
            <TabsContent value="timeline" className="m-0 h-full">
              <TimelineTab caseId={caseId} timeline={timeline} />
            </TabsContent>
            <TabsContent value="notes" className="m-0 h-full">
              <NotesTab caseId={caseId} notes={notes} />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <RightRail
        entities={entities.length}
        documents={documents.length}
        relationships={relationships.length}
        timeline={timeline.length}
        moneyFlows={moneyFlows.length}
        pendingMentions={pendingMentions}
        caseStatus={caseData.status}
      />
    </div>
  );
}
