import React, { useState } from "react";
import { useCreateTimelineEntry, TimelineEntry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function TimelineTab({ caseId, timeline }: { caseId: number, timeline: TimelineEntry[] }) {
  // Sort timeline chronologically
  const sorted = [...timeline].sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());

  return (
    <div className="nexus-panel rounded-none h-full flex flex-col">
      <div className="nexus-header-strip">
        <span className="nexus-label">TEMPORAL TRACE</span>
        <CreateTimelineDialog caseId={caseId} />
      </div>

      <div className="flex-1 overflow-auto p-6 lg:p-10">
        <div className="relative pl-6 space-y-8 before:absolute before:inset-0 before:ml-[5px] before:h-full before:w-px before:bg-red-600/30 max-w-3xl mx-auto">
          {sorted.length === 0 ? (
            <div className="text-center font-mono text-neutral-500 text-sm uppercase tracking-widest py-10">NO TIMELINE ENTRIES DETECTED</div>
          ) : sorted.map((entry) => (
            <div key={entry.id} className="relative group">
              {/* Diamond Marker */}
              <div className="absolute left-[-29px] top-1 w-2.5 h-2.5 bg-black border border-red-600 rotate-45 group-hover:bg-red-600 transition-colors z-10" />
              
              <div className="p-4 bg-[#111820] border border-[#ffffff0d] group-hover:border-red-500/30 transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <div className="font-mono text-[10px] text-red-500 uppercase tracking-widest">{formatDate(entry.eventDate)}</div>
                </div>
                <h4 className="text-sm font-bold text-white mb-2 uppercase">{entry.title}</h4>
                {entry.description && <p className="text-xs text-neutral-400 leading-relaxed mb-3">{entry.description}</p>}
                
                {entry.linkedEntityName && (
                  <div className="inline-block px-1.5 py-0.5 bg-[#000] border border-[#ffffff1a] text-[9px] font-mono text-cyan-500 uppercase">
                    LINKED: {entry.linkedEntityName}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CreateTimelineDialog({ caseId }: { caseId: number }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const createMutation = useCreateTimelineEntry({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
        setOpen(false);
      }
    }
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      data: {
        title: fd.get("title") as string,
        description: fd.get("description") as string,
        eventDate: new Date(fd.get("eventDate") as string).toISOString(),
        caseId: caseId
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#ffffff10] hover:bg-[#ffffff20] text-white rounded-none h-6 px-3 font-mono text-[10px] uppercase tracking-wider gap-1.5 border border-[#ffffff1a]">
          <Plus className="w-3 h-3" /> ADD EVENT
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px] border border-[#ffffff1a] bg-[#0d1117] rounded-none p-0">
        <div className="nexus-header-strip">
          <span className="nexus-label">LOG TIMELINE EVENT</span>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="space-y-1">
            <Label className="nexus-label">Event Title</Label>
            <Input name="title" required className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="nexus-label">Date & Time</Label>
            <Input type="datetime-local" name="eventDate" required className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm font-mono [color-scheme:dark]" />
          </div>
          <div className="space-y-1">
            <Label className="nexus-label">Details</Label>
            <Input name="description" className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm font-mono" />
          </div>
          <div className="pt-2 flex justify-end gap-2 border-t border-[#ffffff0d] mt-4">
            <Button type="submit" disabled={createMutation.isPending} className="bg-red-600 hover:bg-red-700 text-white rounded-none font-mono text-[11px] w-full uppercase tracking-widest">
              {createMutation.isPending ? "SAVING..." : "SAVE LOG"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
