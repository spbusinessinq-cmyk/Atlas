import React, { useState, useMemo } from "react";
import { useCreateEntity, Entity, EntityType, useListEntityMentions } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Search } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";

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

  const filtered = entities.filter(e => e.name.toLowerCase().includes(search.toLowerCase()));

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
      <div className="nexus-header-strip">
        <span className="nexus-label">ENTITY REGISTRY</span>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input 
              placeholder="SEARCH REGISTRY..." 
              className="bg-[#000] border border-[#ffffff1a] text-[10px] font-mono pl-7 pr-3 py-1 w-48 text-white focus:outline-none focus:border-red-500 placeholder:text-neutral-600 transition-colors"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <CreateEntityDialog caseId={caseId} />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="flex bg-[#ffffff05] border-b border-[#ffffff0d] px-4 py-2 font-mono text-[10px] text-neutral-500 uppercase tracking-widest sticky top-0">
          <div className="w-32">TYPE</div>
          <div className="flex-1">NAME</div>
          <div className="w-16 text-right hidden md:block">MENTIONS</div>
          <div className="w-12 text-right hidden md:block">DOCS</div>
          <div className="w-28 text-right hidden lg:block">FIRST SEEN</div>
          <div className="w-16 text-right">→</div>
        </div>
        
        <div className="divide-y divide-[#ffffff05]">
          {filtered.length === 0 ? (
            <div className="p-8 text-center font-mono text-neutral-500 text-sm uppercase">NO RECORDS MATCH QUERY</div>
          ) : filtered.map((entity) => {
            const key = entity.name.toLowerCase();
            const stats = entityStats[key];
            const mentionCount = stats?.mentions ?? 0;
            const docCount = stats?.docs.size ?? 0;
            const firstSeen = stats?.firstSeen ?? null;
            return (
              <Link key={entity.id} href={`/entities/${entity.id}`}>
                <div className="flex px-4 py-3 items-center hover:bg-[#ffffff05] cursor-pointer transition-colors group">
                  <div className="w-32">
                    <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 border bg-black ${typeColors[entity.type] || typeColors.other}`}>
                      {entity.type.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex-1 font-medium text-sm text-white group-hover:text-red-400 transition-colors uppercase min-w-0">
                    <span className="truncate block">{entity.name}</span>
                    {entity.aliases && entity.aliases.length > 0 && (
                      <span className="text-[9px] font-mono text-neutral-700 block">
                        AKA: {entity.aliases.slice(0, 2).join(", ")}
                      </span>
                    )}
                  </div>
                  <div className="w-16 text-right hidden md:block font-mono text-[11px] tabular-nums">
                    {mentionCount > 0 ? (
                      <span className="text-cyan-700">{mentionCount.toString().padStart(2, "0")}</span>
                    ) : (
                      <span className="text-neutral-800">—</span>
                    )}
                  </div>
                  <div className="w-12 text-right hidden md:block font-mono text-[11px] tabular-nums">
                    {docCount > 0 ? (
                      <span className="text-neutral-500">{docCount.toString().padStart(2, "0")}</span>
                    ) : (
                      <span className="text-neutral-800">—</span>
                    )}
                  </div>
                  <div className="w-28 text-right hidden lg:block font-mono text-[9px] text-neutral-700">
                    {firstSeen ? format(firstSeen, "yyyy-MM-dd") : "—"}
                  </div>
                  <div className="w-16 text-right text-neutral-600 group-hover:text-red-500 font-mono text-xs">
                    ACCESS
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
