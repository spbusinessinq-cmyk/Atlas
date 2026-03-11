import React from "react";
import { useParams, Link } from "wouter";
import { useGetEntity } from "@workspace/api-client-react";
import { ArrowLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function EntityProfile() {
  const { id } = useParams();
  const entityId = parseInt(id || "0", 10);
  const { data: profile, isLoading } = useGetEntity(entityId);

  if (isLoading) return <div className="p-8 text-red-500 font-mono animate-pulse text-sm">COMPILING DOSSIER...</div>;
  if (!profile) return <div className="p-8 text-red-500 font-mono text-sm">ERROR 404: IDENTITY EXPUNGED.</div>;

  const { entity, relationships, documents, timelineAppearances } = profile;

  const typeColors: Record<string, string> = {
    person: "text-cyan-500 border-cyan-500/30",
    organization: "text-amber-500 border-amber-500/30",
    company: "text-green-500 border-green-500/30",
    government_agency: "text-red-500 border-red-500/30",
    location: "text-purple-500 border-purple-500/30",
    event: "text-blue-500 border-blue-500/30",
    other: "text-neutral-400 border-neutral-500/30"
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Link href="/entities">
        <button className="text-[10px] font-mono text-neutral-500 hover:text-white uppercase tracking-widest flex items-center gap-2 transition-colors mb-2">
          <ArrowLeft className="w-3 h-3" /> RETURN TO REGISTRY
        </button>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Main Column */}
        <div className="lg:col-span-3 space-y-6">
          <div className="nexus-panel rounded-none">
            <div className="nexus-header-strip">
              <span className="nexus-label">// CLEARANCE: INTERNAL</span>
              <span className="font-mono text-[10px] text-neutral-500">ID:{entity.id.toString().padStart(8, '0')}</span>
            </div>
            <div className="p-6">
              <div className="flex items-start gap-4 mb-6">
                <div>
                  <h1 className="text-3xl font-bold text-white uppercase leading-tight">{entity.name}</h1>
                  <span className={`inline-block mt-2 text-[10px] font-mono uppercase px-2 py-0.5 border ${typeColors[entity.type] || typeColors.other}`}>
                    {entity.type.replace('_', ' ')}
                  </span>
                </div>
              </div>
              
              <div className="text-sm text-neutral-400 leading-relaxed mb-6">
                {entity.description || "No supplemental intelligence recorded for this identity."}
              </div>
              
              <div className="space-y-2">
                <div className="text-[10px] font-mono text-neutral-500 tracking-widest uppercase">KNOWN ALIASES</div>
                <div className="flex flex-wrap gap-2">
                  {entity.aliases && entity.aliases.length > 0 ? (
                    entity.aliases.map(a => (
                      <span key={a} className="px-2 py-1 bg-[#000] border border-[#ffffff1a] text-xs font-mono text-neutral-300">
                        {a}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs font-mono text-neutral-600">NONE RECORDED</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="nexus-panel rounded-none">
            <div className="nexus-header-strip">
              <span className="nexus-label">RELATIONSHIPS</span>
            </div>
            <div className="p-0">
              {relationships.length === 0 ? (
                <div className="p-4 text-xs font-mono text-neutral-600">NO KNOWN ASSOCIATIONS</div>
              ) : relationships.map(rel => {
                const isA = rel.entityAId === entity.id;
                const otherName = isA ? rel.entityBName : rel.entityAName;
                const otherId = isA ? rel.entityBId : rel.entityAId;
                
                return (
                  <div key={rel.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border-b border-[#ffffff05] hover:bg-[#ffffff02]">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono uppercase text-red-500 border border-red-500/30 px-1.5 py-0.5 bg-red-500/5">
                        {rel.relationshipType}
                      </span>
                      <span className="text-sm text-white font-medium uppercase">{otherName}</span>
                    </div>
                    <Link href={`/entities/${otherId}`}>
                      <button className="text-[10px] font-mono text-neutral-500 hover:text-white mt-2 sm:mt-0">VIEW →</button>
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
          
          <div className="nexus-panel rounded-none">
            <div className="nexus-header-strip">
              <span className="nexus-label">TIMELINE APPEARANCES</span>
            </div>
            <div className="p-4 space-y-4">
              {timelineAppearances.length === 0 ? (
                <div className="text-xs font-mono text-neutral-600">NO ACTIVITY RECORDED</div>
              ) : timelineAppearances.map(t => (
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

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-6">
          <div className="nexus-panel rounded-none">
            <div className="nexus-header-strip">
              <span className="nexus-label">METADATA</span>
            </div>
            <div className="p-4 space-y-3 font-mono text-[11px] uppercase">
              <div className="flex justify-between border-b border-[#ffffff0a] pb-2">
                <span className="text-neutral-500">SYSTEM ID</span>
                <span className="text-white">{entity.id.toString().padStart(8, '0')}</span>
              </div>
              <div className="flex justify-between border-b border-[#ffffff0a] pb-2">
                <span className="text-neutral-500">CREATED</span>
                <span className="text-white">{formatDate(entity.createdAt).split(',')[0]}</span>
              </div>
              <div className="flex justify-between pb-1">
                <span className="text-neutral-500">PRIMARY OP</span>
                {entity.caseId ? (
                  <Link href={`/cases/${entity.caseId}`}>
                    <span className="text-red-500 hover:text-red-400 cursor-pointer">OP_{entity.caseId.toString().padStart(4, '0')}</span>
                  </Link>
                ) : (
                  <span className="text-neutral-600">UNLINKED</span>
                )}
              </div>
            </div>
          </div>

          <div className="nexus-panel rounded-none">
            <div className="nexus-header-strip">
              <span className="nexus-label">LINKED DOCUMENTS</span>
            </div>
            <div className="p-0">
              {documents && documents.length > 0 ? documents.map(doc => (
                 <div key={doc.id} className="px-3 py-2 border-b border-[#ffffff05] text-sm text-white hover:bg-[#ffffff02]">
                   <div className="truncate">{doc.title}</div>
                   <div className="text-[10px] font-mono text-neutral-500 mt-1">{formatDate(doc.uploadedAt).split(',')[0]}</div>
                 </div>
              )) : (
                 <div className="p-4 text-xs font-mono text-neutral-600">NO DOCUMENTS ATTACHED</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
