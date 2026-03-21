import React, { useState, useMemo } from "react";
import { useCreateEntity, Entity, EntityType, useListEntityMentions } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Search, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";

function EntityDeleteButton({ entity, caseId }: { entity: Entity; caseId: number }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    try {
      await fetch(`/api/cases/${caseId}/entities/${entity.id}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
      queryClient.invalidateQueries({ queryKey: ["/api/entities"] });
    } finally {
      setDeleting(false);
      setConfirm(false);
    }
  };

  if (confirm) {
    return (
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.preventDefault()}>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="px-1.5 py-0.5 bg-red-700 hover:bg-red-600 text-white font-mono text-[7px] uppercase tracking-widest transition-colors disabled:opacity-40"
        >
          {deleting ? "…" : "YES"}
        </button>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirm(false); }}
          className="px-1.5 py-0.5 border border-neutral-700 text-neutral-500 hover:text-white font-mono text-[7px] uppercase tracking-widest transition-colors"
        >
          NO
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirm(true); }}
      className="opacity-0 group-hover:opacity-100 p-1 text-neutral-700 hover:text-red-400 transition-all shrink-0"
      title="Delete entity from case"
    >
      <Trash2 className="w-3 h-3" />
    </button>
  );
}

export default function EntitiesTab({ caseId, entities }: { caseId: number, entities: Entity[] }) {
  const [search, setSearch] = useState("");

  const { data: allMentions = [] } = useListEntityMentions({ caseId, status: "approved" });

  const entityStats = useMemo(() => {
    const stats: Record<string, { mentions: number; docs: Set<number>; firstSeen: Date | null }> = {};
    allMentions.forEach((m) => {
      const key = m.entityName.toLowerCase();
      if (!stats[key]) stats[key] = { mentions: 0, docs: new Set(), firstSeen: null };
      stats[key].mentions++;
      stats[key].docs.add(m.documentId);
      const d = new Date(m.createdAt);
      if (!stats[key].firstSeen || d < stats[key].firstSeen!) {
        stats[key].firstSeen = d;
      }
    });
    return stats;
  }, [allMentions]);

  const maxMentions = useMemo(() => {
    return Math.max(1, ...Object.values(entityStats).map(s => s.mentions));
  }, [entityStats]);

  const filtered = entities
    .filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aM = entityStats[a.name.toLowerCase()]?.mentions ?? 0;
      const bM = entityStats[b.name.toLowerCase()]?.mentions ?? 0;
      return bM - aM;
    });

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
    <div className="nexus-panel rounded-none h-full flex flex-col">
      <div className="atlas-module-header-cyan flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-0.5 h-3.5 flex-shrink-0" style={{ background: "rgba(6,182,212,0.5)" }} />
          <span className="atlas-module-label">ENTITY REGISTRY — <span style={{ color: "rgba(255,255,255,0.55)" }}>{entities.length}</span></span>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.2)" }} />
            <input 
              placeholder="SEARCH..." 
              className="border text-[9px] font-mono pl-6 pr-2.5 py-1 w-36 focus:outline-none placeholder:uppercase transition-colors"
              style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }}
              onFocus={e => { e.currentTarget.style.borderColor = "rgba(6,182,212,0.4)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <CreateEntityDialog caseId={caseId} />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="flex sticky top-0 z-10" style={{ background: "rgba(3,5,10,0.97)", borderBottom: "1px solid rgba(255,255,255,0.055)" }}>
          <div className="flex w-full px-4 py-1.5 font-mono text-[7px] uppercase tracking-[0.2em]" style={{ color: "rgba(255,255,255,0.2)" }}>
            <div className="w-6 text-center mr-3">#</div>
            <div className="w-28">TYPE</div>
            <div className="flex-1">NAME</div>
            <div className="w-20 text-right hidden md:block">CONFIDENCE</div>
            <div className="w-14 text-right hidden md:block">MNTNS</div>
            <div className="w-10 text-right hidden md:block">DOCS</div>
            <div className="w-16 text-right">→</div>
          </div>
        </div>
        
        <div className="divide-y divide-[#ffffff04]">
          {filtered.length === 0 ? (
            <div className="p-8 text-center font-mono text-neutral-600 text-sm uppercase">NO RECORDS MATCH QUERY</div>
          ) : filtered.map((entity, idx) => {
            const key = entity.name.toLowerCase();
            const stats = entityStats[key];
            const mentionCount = stats?.mentions ?? 0;
            const docCount = stats?.docs.size ?? 0;
            const confidencePct = Math.round((mentionCount / maxMentions) * 100);
            const isPrimary = idx === 0 && mentionCount > 0;
            const isTop3 = idx < 3 && mentionCount > 0;
            return (
              <Link key={entity.id} href={`/entities/${entity.id}`}>
                <div className={`flex px-4 py-2.5 items-center hover:bg-[#ffffff05] cursor-pointer transition-colors group ${isPrimary ? "bg-[#dc262604] border-l-2 border-l-red-900" : "border-l-2 border-l-transparent"}`}>
                  <div className="w-6 text-center mr-3 font-mono text-[9px] tabular-nums">
                    {mentionCount > 0 ? (
                      <span className={isTop3 ? "text-red-900" : "text-neutral-800"}>
                        {(idx + 1).toString().padStart(2, "0")}
                      </span>
                    ) : (
                      <span className="text-neutral-900">—</span>
                    )}
                  </div>
                  <div className="w-28">
                    <span className={`text-[8px] font-mono uppercase px-1 py-0.5 border bg-black ${typeColors[entity.type] || typeColors.other}`}>
                      {entity.type.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex-1 font-medium text-[11px] text-white group-hover:text-red-400 transition-colors uppercase min-w-0 pr-2">
                    <span className="truncate block">{entity.name}</span>
                    {entity.aliases && entity.aliases.length > 0 && (
                      <span className="text-[8px] font-mono text-neutral-800 block">
                        AKA: {entity.aliases.slice(0, 2).join(", ")}
                      </span>
                    )}
                  </div>
                  <div className="w-20 hidden md:flex flex-col items-end gap-0.5">
                    {mentionCount > 0 ? (
                      <>
                        <span className={`font-mono text-[8px] tabular-nums ${confidencePct >= 70 ? "text-red-500" : confidencePct >= 40 ? "text-amber-600" : "text-neutral-600"}`}>
                          {confidencePct}%
                        </span>
                        <div className="w-16 h-0.5 bg-[#ffffff08] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${confidencePct >= 70 ? "bg-red-700" : confidencePct >= 40 ? "bg-amber-700" : "bg-neutral-700"}`}
                            style={{ width: `${confidencePct}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <span className="text-neutral-900 font-mono text-[8px]">—</span>
                    )}
                  </div>
                  <div className="w-14 text-right hidden md:block font-mono text-[10px] tabular-nums">
                    {mentionCount > 0 ? (
                      <span className="text-cyan-800">{mentionCount.toString().padStart(2, "0")}</span>
                    ) : (
                      <span className="text-neutral-900">—</span>
                    )}
                  </div>
                  <div className="w-10 text-right hidden md:block font-mono text-[10px] tabular-nums">
                    {docCount > 0 ? (
                      <span className="text-neutral-600">{docCount.toString().padStart(2, "0")}</span>
                    ) : (
                      <span className="text-neutral-900">—</span>
                    )}
                  </div>
                  <div className="w-16 text-right text-neutral-700 group-hover:text-red-600 font-mono text-[9px] uppercase flex items-center justify-end gap-1">
                    <EntityDeleteButton entity={entity} caseId={caseId} />
                    <span className="group-hover:hidden">→</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CreateEntityDialog({ caseId }: { caseId: number }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const createMutation = useCreateEntity({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
        queryClient.invalidateQueries({ queryKey: [`/api/entities`] });
        setOpen(false);
      }
    }
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      data: {
        name: fd.get("name") as string,
        type: fd.get("type") as EntityType,
        description: fd.get("description") as string,
        caseId: caseId
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#ffffff10] hover:bg-[#ffffff20] text-white rounded-none h-6 px-3 font-mono text-[10px] uppercase tracking-wider gap-1.5 border border-[#ffffff1a]">
          <Plus className="w-3 h-3" /> ADD ENTITY
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px] border border-[#ffffff1a] bg-[#0d1117] rounded-none p-0">
        <div className="nexus-header-strip">
          <span className="nexus-label">REGISTER NEW ENTITY</span>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="space-y-1">
            <Label className="nexus-label">Primary Designation / Name</Label>
            <Input name="name" required className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="nexus-label">Classification</Label>
            <Select name="type" defaultValue="person">
              <SelectTrigger className="bg-[#000] border-[#ffffff1a] rounded-none font-mono focus:ring-0 focus:border-red-500 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0d1117] border-[#ffffff1a] rounded-none font-mono text-xs uppercase tracking-wider">
                {Object.values(EntityType).map(t => (
                  <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="nexus-label">Initial Intel</Label>
            <Input name="description" className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm font-mono" />
          </div>
          <div className="pt-2 flex justify-end gap-2 border-t border-[#ffffff0d] mt-4">
            <Button type="submit" disabled={createMutation.isPending} className="bg-red-600 hover:bg-red-700 text-white rounded-none font-mono text-[11px] w-full uppercase tracking-widest">
              {createMutation.isPending ? "REGISTERING..." : "COMMIT RECORD"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
