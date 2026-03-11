import React from "react";
import { useParams, Link } from "wouter";
import { useGetEntity } from "@workspace/api-client-react";
import { User, Activity, FileText, ArrowLeft, Network, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default function EntityProfile() {
  const { id } = useParams();
  const entityId = parseInt(id || "0", 10);
  const { data: profile, isLoading } = useGetEntity(entityId);

  if (isLoading) return <div className="p-8 text-primary font-mono animate-pulse">COMPILING DOSSIER...</div>;
  if (!profile) return <div className="p-8 text-destructive font-mono">ERROR 404: IDENTITY EXPUNGED.</div>;

  const { entity, relationships, documents, timelineAppearances } = profile;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Link href="/entities">
        <Button variant="ghost" size="sm" className="font-mono text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> RETURN TO REGISTRY
        </Button>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Dossier summary */}
        <div className="col-span-1 space-y-6">
          <Card className="bg-card border-primary/20 shadow-lg shadow-primary/5 overflow-hidden">
            <div className="h-2 w-full bg-primary" />
            <CardContent className="pt-6">
              <div className="w-24 h-24 bg-muted rounded-full mx-auto mb-4 border-2 border-border flex items-center justify-center">
                <User className="w-12 h-12 text-muted-foreground" />
              </div>
              <h2 className="text-2xl font-bold text-center mb-1">{entity.name}</h2>
              <div className="text-center mb-6">
                <Badge className="bg-primary text-primary-foreground font-mono">{entity.type.toUpperCase()}</Badge>
              </div>
              
              <div className="space-y-4 text-sm font-mono">
                <div>
                  <div className="text-muted-foreground text-xs">SYSTEM ID</div>
                  <div>{entity.id.toString().padStart(8, '0')}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">RECORD ESTABLISHED</div>
                  <div>{formatDate(entity.createdAt)}</div>
                </div>
                {entity.caseId && (
                  <div>
                    <div className="text-muted-foreground text-xs">PRIMARY OPERATION</div>
                    <Link href={`/cases/${entity.caseId}`}>
                      <span className="text-primary hover:underline cursor-pointer">OP_{entity.caseId.toString().padStart(4, '0')}</span>
                    </Link>
                  </div>
                )}
                <div>
                  <div className="text-muted-foreground text-xs">KNOWN ALIASES</div>
                  <div className="mt-1">
                    {entity.aliases && entity.aliases.length > 0 ? (
                      entity.aliases.map(a => <Badge key={a} variant="outline" className="mr-1 mb-1">{a}</Badge>)
                    ) : (
                      <span className="text-muted-foreground">NONE RECORDED</span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-sm flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" /> INTEL SUMMARY
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-foreground/80 leading-relaxed">
                {entity.description || "No supplemental intelligence recorded for this identity."}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Relationships & Activity */}
        <div className="col-span-1 lg:col-span-2 space-y-6">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="font-mono flex items-center gap-2">
                <Network className="w-5 h-5 text-primary" /> KNOWN ASSOCIATIONS
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {relationships.length === 0 ? (
                  <div className="text-muted-foreground font-mono text-sm">NO KNOWN ASSOCIATIONS</div>
                ) : relationships.map(rel => {
                  const isA = rel.entityAId === entity.id;
                  const otherName = isA ? rel.entityBName : rel.entityAName;
                  const otherId = isA ? rel.entityBId : rel.entityAId;
                  
                  return (
                    <div key={rel.id} className="flex items-center justify-between p-3 border border-border bg-sidebar rounded-md">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="font-mono text-xs border-primary/50 text-primary">{rel.relationshipType}</Badge>
                        <span className="font-bold">{otherName}</span>
                      </div>
                      <Link href={`/entities/${otherId}`}>
                        <Button variant="ghost" size="sm" className="font-mono text-xs">VIEW</Button>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="font-mono flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" /> TIMELINE APPEARANCES
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-border pl-6 md:pl-0">
                {timelineAppearances.length === 0 ? (
                  <div className="text-muted-foreground font-mono text-sm text-center py-4">NO ACTIVITY RECORDED</div>
                ) : timelineAppearances.map(t => (
                  <div key={t.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                     <div className="flex items-center justify-center w-4 h-4 rounded-full bg-primary absolute left-[-1.5rem] md:left-1/2 md:-translate-x-1/2 z-10" />
                     <div className="w-full md:w-[calc(50%-1.5rem)] p-3 rounded-lg bg-sidebar border border-border">
                        <div className="font-mono text-xs text-primary mb-1">{formatDate(t.eventDate)}</div>
                        <div className="font-bold text-sm">{t.title}</div>
                     </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
