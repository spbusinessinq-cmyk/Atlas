import React, { useState } from "react";
import { Link } from "wouter";
import { useListCases, useCreateCase, CaseStatus } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronRight, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/utils";

const STATUS_STYLES: Record<CaseStatus, { dot: string; text: string; label: string }> = {
  open: { dot: "bg-blue-500", text: "text-blue-400", label: "OPEN" },
  active: { dot: "bg-red-500", text: "text-red-500", label: "ACTIVE" },
  closed: { dot: "bg-neutral-500", text: "text-neutral-400", label: "CLOSED" },
  archived: { dot: "bg-amber-500", text: "text-amber-400", label: "ARCHIVED" },
};

export default function Dashboard() {
  const { data: cases, isLoading } = useListCases();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-[#ffffff0d] pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white uppercase">
            ACTIVE DOSSIERS
          </h1>
          <p className="text-neutral-600 tracking-widest text-[9px] font-mono mt-0.5 uppercase">
            CASE CONTROL // {cases?.length ?? 0} TOTAL
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-[#000] p-0.5 border border-[#ffffff0d] gap-0.5">
            <button
              className={`p-1.5 transition-colors ${
                viewMode === "grid"
                  ? "bg-[#ffffff0d] text-white"
                  : "text-neutral-600 hover:text-neutral-300"
              }`}
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              className={`p-1.5 transition-colors ${
                viewMode === "list"
                  ? "bg-[#ffffff0d] text-white"
                  : "text-neutral-600 hover:text-neutral-300"
              }`}
              onClick={() => setViewMode("list")}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
          <CreateCaseDialog />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse bg-[#0d1117] border border-[#ffffff0d]"
            />
          ))}
        </div>
      ) : !cases || cases.length === 0 ? (
        <EmptyDossiers />
      ) : (
        <div
          className={
            viewMode === "grid"
              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
              : "space-y-2"
          }
        >
          {cases.map((c) => (
            <DossierCard key={c.id} c={c} viewMode={viewMode} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyDossiers() {
  return (
    <div className="border border-dashed border-[#ffffff0d] py-16 flex flex-col items-center justify-center gap-3">
      <div className="font-bold text-sm text-white font-mono uppercase tracking-widest">
        NO ACTIVE DOSSIERS
      </div>
      <div className="text-[10px] font-mono text-neutral-600 uppercase tracking-widest">
        Initialize a new case to begin operations
      </div>
    </div>
  );
}

function DossierCard({
  c,
  viewMode,
}: {
  c: ReturnType<typeof useListCases>["data"] extends Array<infer T> ? T : never;
  viewMode: "grid" | "list";
}) {
  const s = STATUS_STYLES[c.status as CaseStatus] ?? STATUS_STYLES.open;
  const caseId = c.id.toString().padStart(6, "0");

  return (
    <Link href={`/cases/${c.id}`}>
      <div
        className={`group cursor-pointer nexus-card flex flex-col hover:border-[#dc262630] transition-all duration-200 relative ${
          viewMode === "list" ? "flex-row" : ""
        }`}
      >
        {/* Header strip */}
        <div className="nexus-header-strip">
          <div className={`flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider ${s.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
            {s.label}
          </div>
          <div className="font-mono text-[9px] text-neutral-600">
            CASE-{caseId} // {formatDate(c.updatedAt).split(",")[0]}
          </div>
        </div>

        {/* Body */}
        <div className="p-3 flex-1 flex flex-col gap-2">
          <h3 className="text-sm font-bold text-white group-hover:text-red-400 transition-colors uppercase leading-tight tracking-tight">
            {c.title}
          </h3>
          {c.description && (
            <p className="text-[11px] text-neutral-500 line-clamp-2 leading-relaxed">
              {c.description}
            </p>
          )}
          {c.tags && c.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-auto pt-1">
              {c.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 border border-[#ffffff08] text-[9px] font-mono text-neutral-600 uppercase"
                >
                  {tag}
                </span>
              ))}
              {c.tags.length > 3 && (
                <span className="px-1.5 py-0.5 border border-[#ffffff08] text-[9px] font-mono text-neutral-700">
                  +{c.tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Bottom telemetry */}
        <div className="bg-[#00000040] border-t border-[#ffffff08] px-3 py-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[9px] font-mono text-neutral-600 tabular-nums">
            <span>
              ENT: <span className="text-neutral-400">{c.entityCount ?? 0}</span>
            </span>
            <span className="text-[#ffffff15]">·</span>
            <span>
              DOC: <span className="text-neutral-400">{c.documentCount ?? 0}</span>
            </span>
            <span className="text-[#ffffff15]">·</span>
            <span>
              TL: <span className="text-neutral-400">{c.timelineCount ?? 0}</span>
            </span>
            <span className="text-[#ffffff15]">·</span>
            <span>
              LNK: <span className="text-neutral-400">{c.relationshipCount ?? 0}</span>
            </span>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-neutral-700 group-hover:text-red-500 transition-colors" />
        </div>
      </div>
    </Link>
  );
}

function CreateCaseDialog() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const createMutation = useCreateCase({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
        setOpen(false);
      },
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      data: {
        title: fd.get("title") as string,
        description: fd.get("description") as string,
        status: fd.get("status") as CaseStatus,
        tags: (fd.get("tags") as string)
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-red-600 hover:bg-red-700 text-white rounded-none h-7 px-3 font-mono text-[10px] uppercase tracking-wider gap-1.5">
          <Plus className="w-3 h-3" /> NEW CASE
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px] border border-[#ffffff1a] bg-[#0d1117] rounded-none p-0">
        <div className="nexus-header-strip">
          <span className="nexus-label flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            INITIALIZE NEW CASE
          </span>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="title" className="nexus-label">
              Designation
            </Label>
            <Input
              id="title"
              name="title"
              required
              className="font-mono bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm h-8"
              placeholder="e.g. OP-CRIMSON-TIDE"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="description" className="nexus-label">
              Briefing / Objective
            </Label>
            <Textarea
              id="description"
              name="description"
              className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 min-h-[80px] text-sm"
              placeholder="Case objectives and scope..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="status" className="nexus-label">
                Initial Status
              </Label>
              <Select name="status" defaultValue="open">
                <SelectTrigger className="bg-[#000] border-[#ffffff1a] rounded-none font-mono focus:ring-0 focus:border-red-500 text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1117] border-[#ffffff1a] rounded-none font-mono text-xs">
                  <SelectItem value="open">OPEN</SelectItem>
                  <SelectItem value="active">ACTIVE</SelectItem>
                  <SelectItem value="closed">CLOSED</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tags" className="nexus-label">
                Tags
              </Label>
              <Input
                id="tags"
                name="tags"
                className="bg-[#000] border-[#ffffff1a] rounded-none font-mono text-sm h-8 focus-visible:ring-0 focus-visible:border-red-500"
                placeholder="fraud, target-x"
              />
            </div>
          </div>
          <div className="pt-3 flex justify-end gap-2 border-t border-[#ffffff0d]">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              className="rounded-none font-mono text-[10px] text-neutral-500 hover:text-white hover:bg-[#ffffff05] h-7"
            >
              CANCEL
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white rounded-none font-mono text-[10px] h-7 px-4"
            >
              {createMutation.isPending ? "INITIALIZING..." : "CONFIRM INIT"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
