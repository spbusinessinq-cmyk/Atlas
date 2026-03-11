import React, { useState } from "react";
import { useParams } from "wouter";
import { useGetCaseSummary } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { Shield, Activity, Users, FileText, Network, Clock, ListOrdered, DollarSign, TerminalSquare } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

  if (isLoading) return <div className="p-8 text-primary font-mono animate-pulse">DECRYPTING FILE...</div>;
  if (!summary) return <div className="p-8 text-destructive font-mono">ERROR 404: FILE NOT FOUND OR CLASSIFIED.</div>;

  const { case: caseData, entities, documents, timeline, events, notes, relationships, moneyFlows } = summary;

  const statusColors = {
    open: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    active: "bg-primary/20 text-primary border-primary/30",
    closed: "bg-muted text-muted-foreground border-border",
    archived: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30"
  };

  return (
    <div className="space-y-6 flex flex-col h-full">
      {/* Header Panel */}
      <motion.div 
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="bg-card border border-border p-6 rounded-lg shadow-md relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Badge variant="outline" className={`font-mono ${statusColors[caseData.status]}`}>
                {caseData.status.toUpperCase()}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">ID: {caseData.id.toString().padStart(6, '0')}</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <Shield className="w-8 h-8 text-primary" />
              {caseData.title}
            </h1>
            <p className="text-muted-foreground mt-2 max-w-3xl">{caseData.description}</p>
          </div>
          <div className="flex flex-col items-end gap-2 text-xs font-mono text-muted-foreground">
            <div>INIT: {formatDate(caseData.createdAt)}</div>
            <div>LAST_MOD: {formatDate(caseData.updatedAt)}</div>
            <div className="flex gap-2 mt-2">
              {caseData.tags?.map(t => (
                <span key={t} className="px-2 py-1 bg-secondary rounded border border-border">#{t}</span>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Main Workspace */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-sidebar border-b border-border w-full justify-start h-12 rounded-none p-0 overflow-x-auto flex-nowrap">
          <TabsTrigger value="overview" className="h-full rounded-none font-mono text-xs gap-2 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary">
            <Activity className="w-4 h-4" /> OVERVIEW
          </TabsTrigger>
          <TabsTrigger value="entities" className="h-full rounded-none font-mono text-xs gap-2 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary">
            <Users className="w-4 h-4" /> ENTITIES [{entities.length}]
          </TabsTrigger>
          <TabsTrigger value="graph" className="h-full rounded-none font-mono text-xs gap-2 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary">
            <Network className="w-4 h-4" /> NEXUS_GRAPH
          </TabsTrigger>
          <TabsTrigger value="documents" className="h-full rounded-none font-mono text-xs gap-2 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary">
            <FileText className="w-4 h-4" /> EVIDENCE [{documents.length}]
          </TabsTrigger>
          <TabsTrigger value="timeline" className="h-full rounded-none font-mono text-xs gap-2 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary">
            <Clock className="w-4 h-4" /> TIMELINE
          </TabsTrigger>
          <TabsTrigger value="notes" className="h-full rounded-none font-mono text-xs gap-2 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary">
            <TerminalSquare className="w-4 h-4" /> NOTES
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto mt-4">
          <TabsContent value="overview" className="m-0 h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono text-muted-foreground flex items-center gap-2"><Users className="w-4 h-4" /> KNOWN ENTITIES</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold">{entities.length}</div>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono text-muted-foreground flex items-center gap-2"><Network className="w-4 h-4" /> RELATIONSHIPS</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold">{relationships.length}</div>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono text-muted-foreground flex items-center gap-2"><FileText className="w-4 h-4" /> DOCUMENTS</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold">{documents.length}</div>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono text-muted-foreground flex items-center gap-2"><DollarSign className="w-4 h-4" /> FINANCIAL TRACES</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold">{moneyFlows.length}</div>
                </CardContent>
              </Card>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              <Card className="bg-card border-border col-span-1">
                <CardHeader>
                  <CardTitle className="font-mono flex items-center gap-2"><ListOrdered className="w-5 h-5 text-primary" /> RECENT ACTIVITY</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                   {timeline.slice(0, 5).map(t => (
                     <div key={t.id} className="flex gap-4 p-3 rounded-md bg-secondary/50 border border-border">
                       <div className="text-primary font-mono text-xs whitespace-nowrap mt-1">{formatDate(t.eventDate).split(',')[0]}</div>
                       <div>
                         <div className="font-medium text-sm">{t.title}</div>
                         <div className="text-xs text-muted-foreground line-clamp-1">{t.description}</div>
                       </div>
                     </div>
                   ))}
                   {timeline.length === 0 && <div className="text-sm text-muted-foreground font-mono">NO TIMELINE DATA AVAILABLE</div>}
                </CardContent>
              </Card>
              
              <Card className="bg-card border-border col-span-1 border-l-4 border-l-destructive">
                <CardHeader>
                  <CardTitle className="font-mono flex items-center gap-2 text-destructive"><Activity className="w-5 h-5" /> ORION INTEL ALERTS</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {events.slice(0,4).map(e => (
                      <div key={e.id} className="p-3 border border-destructive/30 bg-destructive/5 rounded-md flex justify-between items-center">
                        <div>
                          <div className="font-bold text-sm text-foreground">{e.title}</div>
                          <div className="text-xs text-muted-foreground mt-1">SRC: {e.source || 'UNKNOWN'} | LOC: {e.location || 'CLASSIFIED'}</div>
                        </div>
                        <Badge variant="outline" className="text-destructive border-destructive/50 font-mono">INTEL</Badge>
                      </div>
                    ))}
                    {events.length === 0 && <div className="text-sm text-muted-foreground font-mono">NO ORION ALERTS DETECTED</div>}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="entities" className="m-0 h-full">
            <EntitiesTab caseId={caseId} entities={entities} />
          </TabsContent>

          <TabsContent value="graph" className="m-0 h-[600px] border border-border rounded-lg overflow-hidden bg-sidebar">
            <GraphView entities={entities} relationships={relationships} />
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
  );
}
