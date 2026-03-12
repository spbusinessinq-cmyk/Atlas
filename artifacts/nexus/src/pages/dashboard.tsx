import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListCases,
  useListEntities,
  useListDocuments,
  useListEntityMentions,
  useCreateCase,
  Case,
  CaseStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronRight, LayoutGrid, List, Briefcase, Database, Files, Cpu, Zap, Search, CheckCircle, AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from "@/components/ui/dialog";
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
  active: { dot: "bg-red-500 animate-pulse", text: "text-red-500", label: "ACTIVE" },
  closed: { dot: "bg-neutral-600", text: "text-neutral-500", label: "CLOSED" },
  archived: { dot: "bg-amber-500", text: "text-amber-400", label: "ARCHIVED" },
};

type SeedStatus = "idle" | "seeding" | "done" | "error";

function SeedLauncher() {
  const [target, setTarget] = useState("");
  const [status, setStatus] = useState<SeedStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [seededCaseId, setSeededCaseId] = useState<number | null>(null);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const seed = target.trim();
  const queryVariations = seed
    ? [seed, `${seed} investigation`, `${seed} contracts`, `${seed} funding`, `${seed} program`]
    : [];

  const handleSeed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!seed) return;
    setStatus("seeding");
    setErrorMsg(null);

    try {
      const resp = await fetch("/api/cases/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: seed }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setSeededCaseId(data.caseId);
      setStatus("done");
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setTimeout(() => navigate(`/cases/${data.caseId}`), 1800);
    } catch (err) {
      setErrorMsg(String(err));
      setStatus("error");
    }
  };

  return (
    <div className="border border-red-500/20 bg-red-500/[0.03] mb-5">
      <div className="nexus-header-strip border-b border-red-500/15">
        <div className="flex items-center gap-2 font-mono text-[9px] text-red-400 uppercase tracking-widest">
          <Zap className="w-3 h-3" />
          START NEW INVESTIGATION
        </div>
        <div className="font-mono text-[9px] text-neutral-700 uppercase">ATLAS SEED LAUNCHER</div>
      </div>

      <form onSubmit={handleSeed} className="p-4">
        <div className="flex gap-3 items-end">
          <div className="flex-1 space-y-1">
            <label className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest block">
              Investigation Target
            </label>
            <p className="font-mono text-[8px] text-neutral-700 uppercase tracking-wide">
              ATLAS auto-generates 5 search queries, ingests web sources, extracts entities &amp; financial signals, and builds your case graph automatically.
            </p>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-600" />
              <input
                type="text"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  if (status === "done" || status === "error") setStatus("idle");
                }}
                placeholder='e.g. "Highland Gardens Hotel Los Angeles"'
                disabled={status === "seeding"}
                className="w-full bg-black border border-[#ffffff12] text-white font-mono text-sm pl-8 pr-3 h-9 focus:outline-none focus:border-red-500/50 disabled:opacity-40 placeholder:text-neutral-700"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={!seed || status === "seeding"}
            className="h-9 px-5 bg-red-600 hover:bg-red-700 disabled:bg-neutral-800 disabled:text-neutral-600 text-white font-mono text-[10px] uppercase tracking-widest transition-colors flex items-center gap-2 flex-shrink-0"
          >
            {status === "seeding" ? (
              <>
                <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
                SEEDING...
              </>
            ) : (
              <>
                <Zap className="w-3 h-3" />
                INITIATE
              </>
            )}
          </button>
        </div>

        {/* Query preview */}
        {queryVariations.length > 0 && status === "idle" && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="font-mono text-[8px] text-neutral-700 uppercase tracking-wider self-center">
              Will search:
            </span>
            {queryVariations.map((q) => (
              <span
                key={q}
                className="px-2 py-0.5 border border-[#ffffff08] bg-[#ffffff03] font-mono text-[9px] text-neutral-500"
              >
                {q}
              </span>
            ))}
          </div>
        )}

        {/* Seeding progress */}
        {status === "seeding" && (
          <div className="mt-3 space-y-1.5">
            <div className="font-mono text-[9px] text-orange-400 uppercase tracking-widest animate-pulse">
              ATLAS IS INGESTING SOURCES AND BUILDING ENTITY GRAPH...
            </div>
            <div className="h-0.5 bg-neutral-900 overflow-hidden">
              <div className="h-full bg-red-500 animate-[scan_2s_linear_infinite]" style={{ width: "40%" }} />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {queryVariations.map((q) => (
                <span key={q} className="px-2 py-0.5 border border-orange-500/20 bg-orange-500/5 font-mono text-[9px] text-orange-500/70">
                  {q}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Success */}
        {status === "done" && seededCaseId && (
          <div className="mt-3 flex items-center gap-2 text-green-400 font-mono text-[10px]">
            <CheckCircle className="w-3.5 h-3.5" />
            CASE-{seededCaseId.toString().padStart(6, "0")} CREATED — REDIRECTING TO INVESTIGATION...
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="mt-3 flex items-center gap-2 text-red-400 font-mono text-[10px]">
            <AlertTriangle className="w-3.5 h-3.5" />
            SEED FAILED: {errorMsg}
          </div>
        )}
      </form>
    </div>
  );
}

export default function Dashboard() {
  const { data: cases, isLoading } = useListCases();
  const { data: entities } = useListEntities();
  const { data: documents } = useListDocuments();
  const { data: pending } = useListEntityMentions({ status: "pending" });
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");

  const totalCases = cases?.length ?? 0;
  const activeCases = cases?.filter((c) => c.status === "active").length ?? 0;
  const totalEntities = entities?.length ?? 0;
  const totalDocs = documents?.length ?? 0;
  const pendingCount = pending?.length ?? 0;

  return (
    <div className="space-y-0 max-w-7xl mx-auto">
      {/* Seed Launcher */}
      <SeedLauncher />

      {/* System Status Panel — three visual depth planes */}
      <div className="atlas-shell mb-0">
        {/* Shell header */}
        <div className="atlas-control-panel flex items-center justify-between px-3 py-1.5 border-b border-[#ffffff07]">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="font-mono text-[9px] text-green-500 uppercase tracking-[0.2em]">ATLAS CORE</span>
            <span className="font-mono text-[9px] text-green-700 uppercase tracking-widest">ONLINE</span>
          </div>
          <span className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest">SYSTEM STATUS</span>
        </div>
        {/* Content surface — metric rows */}
        <div className="atlas-content-surface grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[#ffffff06]">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <Briefcase className="w-3.5 h-3.5 text-red-700 flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest">DOSSIERS</div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="font-mono text-lg font-bold text-red-500 tabular-nums leading-none">
                  {totalCases.toString().padStart(2, "0")}
                </span>
                {activeCases > 0 && (
                  <span className="font-mono text-[8px] text-red-700 uppercase">{activeCases} ACTIVE</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-2.5">
            <Database className="w-3.5 h-3.5 text-cyan-700 flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest">ENTITY REGISTRY</div>
              <div className="font-mono text-lg font-bold text-cyan-500 tabular-nums leading-none mt-0.5">
                {totalEntities.toString().padStart(2, "0")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-2.5">
            <Files className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest">DOCUMENT VAULT</div>
              <div className="font-mono text-lg font-bold text-neutral-400 tabular-nums leading-none mt-0.5">
                {totalDocs.toString().padStart(2, "0")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-2.5">
            <Cpu className="w-3.5 h-3.5 flex-shrink-0" style={{ color: pendingCount > 0 ? "#f97316" : "#404040" }} />
            <div className="min-w-0">
              <div className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest">TRIAGE QUEUE</div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className={`font-mono text-lg font-bold tabular-nums leading-none ${pendingCount > 0 ? "text-orange-400" : "text-neutral-600"}`}>
                  {pendingCount.toString().padStart(2, "0")}
                </span>
                {pendingCount > 0 && (
                  <span className="font-mono text-[8px] text-orange-700 uppercase animate-pulse">REQUIRED</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dossier registry header */}
      <div className="border-x border-b border-[#ffffff0a] bg-[#ffffff02] px-3 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">DOSSIER REGISTRY</span>
          <span className="font-mono text-[8px] text-neutral-800 uppercase">{cases?.length ?? 0} CASES</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-[#000] p-0.5 border border-[#ffffff0d] gap-0.5">
            <button
              className={`p-1 transition-colors ${
                viewMode === "grid"
                  ? "bg-[#ffffff0d] text-white"
                  : "text-neutral-700 hover:text-neutral-400"
              }`}
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="w-3 h-3" />
            </button>
            <button
              className={`p-1 transition-colors ${
                viewMode === "list"
                  ? "bg-[#ffffff0d] text-white"
                  : "text-neutral-700 hover:text-neutral-400"
              }`}
              onClick={() => setViewMode("list")}
            >
              <List className="w-3 h-3" />
            </button>
          </div>
          <CreateCaseDialog />
        </div>
      </div>

      {isLoading ? (
        <div className="border-x border-b border-[#ffffff0a] divide-y divide-[#ffffff06]">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 animate-pulse bg-[#ffffff02]" />
          ))}
        </div>
      ) : !cases || cases.length === 0 ? (
        <EmptyDossiers />
      ) : (
        <div
          className={
            viewMode === "grid"
              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3"
              : "border-x border-b border-[#ffffff0a]"
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
    <div className="border border-dashed border-[#ffffff0d] py-20 flex flex-col items-center justify-center gap-3">
      <Briefcase className="w-8 h-8 text-neutral-800" />
      <div className="font-bold text-sm text-neutral-600 font-mono uppercase tracking-widest">
        NO ACTIVE DOSSIERS
      </div>
      <div className="text-[10px] font-mono text-neutral-700 uppercase tracking-widest">
        Initialize a new case to begin operations
      </div>
    </div>
  );
}

function DossierCard({ c, viewMode }: { c: Case; viewMode: "grid" | "list" }) {
  const s = STATUS_STYLES[c.status as CaseStatus] ?? STATUS_STYLES.open;
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDeleting(true);
    try {
      await fetch(`/api/cases/${c.id}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (viewMode === "list") {
    return (
      <div className="group relative flex items-center border-b border-[#ffffff06] hover:bg-[#ffffff03] transition-colors">
        <Link href={`/cases/${c.id}`} className="flex-1 min-w-0">
          <div className="flex items-center gap-3 px-3 py-2 cursor-pointer">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
            <span className={`font-mono text-[9px] uppercase tracking-wider flex-shrink-0 w-14 ${s.text}`}>
              {s.label}
            </span>
            <span className="font-mono text-[9px] text-neutral-700 flex-shrink-0 w-24 tabular-nums">
              CASE-{c.id.toString().padStart(6, "0")}
            </span>
            <span className="font-mono text-xs text-white font-semibold uppercase truncate flex-1 group-hover:text-red-300 transition-colors tracking-tight">
              {c.title}
            </span>
            {c.tags && c.tags.length > 0 && (
              <div className="hidden md:flex items-center gap-1 flex-shrink-0">
                {c.tags.filter((t) => t !== "auto-seeded").slice(0, 2).map((tag) => (
                  <span key={tag} className="px-1.5 py-0.5 border border-[#ffffff08] text-[8px] font-mono text-neutral-700 uppercase">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="hidden sm:flex items-center gap-2 text-[9px] font-mono text-neutral-700 tabular-nums flex-shrink-0">
              <span>ENT <span className="text-neutral-500">{c.entityCount ?? 0}</span></span>
              <span className="text-[#ffffff10]">·</span>
              <span>DOC <span className="text-neutral-500">{c.documentCount ?? 0}</span></span>
              <span className="text-[#ffffff10]">·</span>
              <span>LNK <span className="text-neutral-500">{c.relationshipCount ?? 0}</span></span>
            </div>
            <ChevronRight className="w-3 h-3 text-neutral-800 group-hover:text-red-600 transition-colors flex-shrink-0" />
          </div>
        </Link>
        <div
          className="flex-shrink-0 px-2 flex items-center"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          {confirmDelete ? (
            <div className="flex items-center gap-1 border border-red-800/50 bg-[#0d0000]/90 px-1.5 py-1">
              <span className="font-mono text-[8px] text-red-400 uppercase">DEL?</span>
              <button onClick={handleDelete} disabled={isDeleting} className="font-mono text-[8px] text-red-400 hover:text-red-300 uppercase px-1 hover:bg-red-500/20 transition-colors">
                {isDeleting ? "…" : "Y"}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="font-mono text-[8px] text-neutral-600 hover:text-neutral-400 uppercase px-1">N</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="opacity-0 group-hover:opacity-100 p-1 text-neutral-800 hover:text-red-600 transition-all"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <Link href={`/cases/${c.id}`}>
        <div className="cursor-pointer nexus-card flex flex-col hover:border-[#dc262635] transition-all duration-200 relative">
          <div className="nexus-header-strip">
            <div className={`flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider ${s.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
              {s.label}
            </div>
            <div className="font-mono text-[9px] text-neutral-700">
              CASE-{c.id.toString().padStart(6, "0")}
            </div>
          </div>

          <div className="p-2.5 flex-1 flex flex-col gap-1.5">
            <h3 className="text-sm font-bold text-white group-hover:text-red-400 transition-colors uppercase leading-tight tracking-tight">
              {c.title}
            </h3>
            {c.description && (
              <p className="text-[11px] text-neutral-600 line-clamp-2 leading-relaxed">
                {cleanDescriptionPreview(c.description)}
              </p>
            )}
            {c.tags && c.tags.filter((t) => t !== "auto-seeded").length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {c.tags.filter((t) => t !== "auto-seeded").slice(0, 3).map((tag) => (
                  <span key={tag} className="px-1.5 py-0.5 border border-[#ffffff08] text-[8px] font-mono text-neutral-700 uppercase">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#00000040] border-t border-[#ffffff06] px-2.5 py-1.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[9px] font-mono text-neutral-700 tabular-nums">
              <span>ENT <span className="text-neutral-500">{c.entityCount ?? 0}</span></span>
              <span className="text-[#ffffff10]">·</span>
              <span>DOC <span className="text-neutral-500">{c.documentCount ?? 0}</span></span>
              <span className="text-[#ffffff10]">·</span>
              <span>LNK <span className="text-neutral-500">{c.relationshipCount ?? 0}</span></span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-neutral-700 group-hover:text-red-500 transition-colors" />
          </div>
        </div>
      </Link>

      <div
        className="absolute bottom-1.5 right-7 z-10"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        {confirmDelete ? (
          <div className="flex items-center gap-1 border border-red-800/50 bg-[#0d0000]/90 px-1.5 py-1">
            <span className="font-mono text-[8px] text-red-400 uppercase tracking-wider">DELETE?</span>
            <button onClick={handleDelete} disabled={isDeleting} className="font-mono text-[8px] text-red-400 hover:text-red-300 uppercase px-1 py-0.5 hover:bg-red-500/20 transition-colors">
              {isDeleting ? "…" : "YES"}
            </button>
            <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }} className="font-mono text-[8px] text-neutral-600 hover:text-neutral-400 uppercase px-1 py-0.5">
              NO
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
            className="opacity-0 group-hover:opacity-100 p-1 text-neutral-700 hover:text-red-500 transition-all"
            title="Delete case"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function cleanDescriptionPreview(desc: string | null | undefined): string {
  if (!desc) return "";
  return desc.replace(/\[ATLAS-SEED:[^\]]+\]/, "").replace(/\[ATLAS-DIAG:[^\]]+\]/, "").trim().slice(0, 120);
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
        <DialogTitle asChild>
          <div className="nexus-header-strip">
            <span className="nexus-label flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              INITIALIZE NEW CASE
            </span>
          </div>
        </DialogTitle>
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
              Briefing
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
              <Label htmlFor="status" className="nexus-label">Status</Label>
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
              <Label htmlFor="tags" className="nexus-label">Tags</Label>
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
