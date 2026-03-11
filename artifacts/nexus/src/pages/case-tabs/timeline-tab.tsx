import React, { useState } from "react";
import { useCreateTimelineEntry, TimelineEntry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Clock } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function TimelineTab({ caseId, timeline }: { caseId: number, timeline: TimelineEntry[] }) {
  // Sort timeline chronologically
  const sorted = [...timeline].sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());

  return (
    <div className="space-y-6 max-w-4xl mx-auto py-6">
      <div className="flex justify-between items-center border-b border-border pb-4">
        <h3 className="font-mono text-lg flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" /> CHRONOLOGY
        </h3>
        <CreateTimelineDialog caseId={caseId} />
      </div>

      <div className="relative pl-8 space-y-8 before:absolute before:inset-0 before:ml-[15px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
        {sorted.length === 0 ? (
          <div className="text-center font-mono text-muted-foreground py-10">NO TIMELINE ENTRIES DETECTED</div>
        ) : sorted.map((entry, i) => (
          <div key={entry.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
            {/* Marker */}
            <div className="flex items-center justify-center w-8 h-8 rounded-full border-4 border-background bg-primary absolute left-0 md:left-1/2 -translate-x-1/2 shadow shadow-primary/40 z-10 group-hover:scale-125 transition-transform">
              <div className="w-2 h-2 bg-background rounded-full" />
            </div>
            
            {/* Card */}
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-lg bg-card border border-border shadow-md group-hover:border-primary/50 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="font-mono text-xs text-primary font-bold">{formatDate(entry.eventDate)}</div>
              </div>
              <h4 className="text-md font-bold text-foreground mb-2">{entry.title}</h4>
              {entry.description && <p className="text-sm text-muted-foreground">{entry.description}</p>}
              
              {entry.linkedEntityName && (
                <div className="mt-3 inline-block px-2 py-1 bg-secondary rounded text-xs font-mono text-secondary-foreground border border-border">
                  LINKED: {entry.linkedEntityName}
                </div>
              )}
            </div>
          </div>
        ))}
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
        <Button size="sm" className="bg-secondary text-secondary-foreground font-mono gap-2 border border-border">
          <Plus className="w-4 h-4" /> ADD_EVENT
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-mono">LOG TIMELINE EVENT</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label className="font-mono text-xs">Event Title</Label>
            <Input name="title" required className="bg-input font-mono" />
          </div>
          <div className="space-y-2">
            <Label className="font-mono text-xs">Date & Time</Label>
            <Input type="datetime-local" name="eventDate" required className="bg-input font-mono" />
          </div>
          <div className="space-y-2">
            <Label className="font-mono text-xs">Details</Label>
            <Input name="description" className="bg-input font-mono" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createMutation.isPending} className="bg-primary text-primary-foreground font-mono">
              SAVE_LOG
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
