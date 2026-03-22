import React, { useState } from "react";
import { asArray } from "@/lib/as-array";
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
import { Plus, ChevronRight, LayoutGrid, List, Briefcase, Database, Files, Cpu, Zap, Search, CheckCircle, AlertTriangle, Trash2, ShieldAlert, ChevronDown } from "lucide-react";
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
type SeedTab = "target" | "urls" | "notes";
type LauncherMode = "new" | "command";
type CmdStatus = "idle" | "running" | "done" | "error";

function parseCaseId(input: string): number | null {
  const m = input.match(/(?:case[-\s#]?(\d+)|#(\d+)|(\d{4,6}))/i);
  if (!m) return null;
  const raw = m[1] || m[2] || m[3];
  return raw ? parseInt(raw) : null;
}

function parseCommand(input: string): { intent: string; caseId: number | null; payload: string } | null {
  const s = input.trim().toLowerCase();
  const caseId = parseCaseId(input);
  const quoteMatch = input.match(/"([^"]+)"/);
  const payload = quoteMatch ? quoteMatch[1] : input.replace(/^(add|update|rebuild|recompile|attach)\s+/i, "").trim();

  if (/add\s+(entity|person|org|organization)/.test(s)) return { intent: "add-entity", caseId, payload };
  if (/add\s+(document|doc|file)/.test(s)) return { intent: "add-doc-note", caseId, payload: input };
  if (/add\s+note/.test(s)) return { intent: "add-note", caseId, payload };
  if (/attach\s+url|add\s+url/.test(s)) return { intent: "attach-url", caseId, payload: (input.match(/https?:\/\/\S+/)?.[0] ?? "") };
  if (/rebuild\s+graph/.test(s)) return { intent: "rebuild-graph", caseId, payload: "" };
  if (/recompile\s+dossier/.test(s)) return { intent: "recompile-dossier", caseId, payload: "" };
  if (/update\s+entit/.test(s)) return { intent: "update-entities", caseId, payload };
  return null;
}

const CMD_EXAMPLES = [
  'add entity "LAHSA" to case 010001',
  'add note "Subject identified at 0300" to case 000034',
  'attach url https://example.com/report to case 000032',
  'rebuild graph for case 000021',
  'recompile dossier for case 000021',
  'update entities in case 010001 with LA County Initiative',
];

function SeedLauncher() {
  const [launcherMode, setLauncherMode] = useState<LauncherMode>("new");
  const [target, setTarget] = useState("");
  const [urlsRaw, setUrlsRaw] = useState("");
  const [rawNotes, setRawNotes] = useState("");
  const [activeTab, setActiveTab] = useState<SeedTab>("target");
  const [status, setStatus] = useState<SeedStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [seededCaseId, setSeededCaseId] = useState<number | null>(null);

  // Case command state
  const [cmdInput, setCmdInput] = useState("");
  const [cmdStatus, setCmdStatus] = useState<CmdStatus>("idle");
  const [cmdResult, setCmdResult] = useState<string | null>(null);
  const [cmdError, setCmdError] = useState<string | null>(null);

  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const seed = target.trim();
  const parsedUrls = urlsRaw
    .split("\n")
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
  const hasNotes = rawNotes.trim().length > 0;

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
        body: JSON.stringify({
          target: seed,
          sourceUrls: parsedUrls,
          rawNotes: rawNotes.trim() || undefined,
        }),
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

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = cmdInput.trim();
    if (!cmd) return;
    setCmdStatus("running");
    setCmdResult(null);
    setCmdError(null);

    const parsed = parseCommand(cmd);
    if (!parsed) {
      setCmdError("Command not recognized. Try: add entity, add note, attach url, rebuild graph, recompile dossier");
      setCmdStatus("error");
      return;
    }
    const { intent, caseId, payload } = parsed;

    if (!caseId) {
      setCmdError("Could not identify case ID. Include 'case XXXXXX' in your command.");
      setCmdStatus("error");
      return;
    }

    const caseLabel = `CASE-${caseId.toString().padStart(6, "0")}`;

    try {
      if (intent === "add-entity") {
        const entityName = payload;
        if (!entityName) throw new Error("No entity name found. Use quotes: add entity \"Name\" to case 000001");
        const resp = await fetch("/api/entities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: entityName, type: "organization", caseId, confidence: 0.7, source: "operator-command" }),
        });
        if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || `HTTP ${resp.status}`); }
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
        setCmdResult(`Entity "${entityName}" added to ${caseLabel}`);
      } else if (intent === "add-note") {
        const content = payload || cmd;
        const resp = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId, content }),
        });
        if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || `HTTP ${resp.status}`); }
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
        setCmdResult(`Note added to ${caseLabel}`);
      } else if (intent === "attach-url") {
        const url = payload;
        if (!url) throw new Error("No URL found in command");
        const domain = (() => { try { return new URL(url).hostname; } catch { return url; } })();
        const resp = await fetch("/api/web-ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, title: url, sourceDomain: domain, caseId }),
        });
        if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || `HTTP ${resp.status}`); }
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
        setCmdResult(`URL attached to ${caseLabel}`);
      } else if (intent === "rebuild-graph") {
        const resp = await fetch(`/api/cases/${caseId}/rebuild-graph`, { method: "POST" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
        setCmdResult(`Graph rebuilt for ${caseLabel}`);
      } else if (intent === "recompile-dossier") {
        const resp = await fetch(`/api/cases/${caseId}/compile`, { method: "POST" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
        setCmdResult(`Dossier recompiled for ${caseLabel}`);
      } else if (intent === "update-entities") {
        const resp = await fetch(`/api/cases/${caseId}/web-search-ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queries: [payload], maxResults: 3 }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
        setCmdResult(`Entity update queued for ${caseLabel} — ingesting "${payload}"`);
      } else {
        throw new Error("Unsupported command");
      }
      setCmdStatus("done");
      setTimeout(() => { setCmdStatus("idle"); setCmdResult(null); }, 5000);
    } catch (err) {
      setCmdError(String((err as Error).message));
      setCmdStatus("error");
    }
  };

  const tabs: { id: SeedTab; label: string; badge?: number }[] = [
    { id: "target", label: "TARGET" },
    { id: "urls", label: "SOURCE URLs", badge: parsedUrls.length || undefined },
    { id: "notes", label: "RAW NOTES", badge: hasNotes ? 1 : undefined },
  ];

  return (
    <div className="border border-red-500/20 bg-red-500/[0.03] mb-5">
      <div className="nexus-header-strip border-b border-red-500/15">
        <div className="flex items-center gap-2 font-mono text-[9px] text-red-400 uppercase tracking-widest">
          <Zap className="w-3 h-3" />
          ATLAS SEED LAUNCHER
        </div>
        <div className="flex items-center gap-1 border border-[#ffffff08]">
          <button
            type="button"
            onClick={() => setLauncherMode("new")}
            className={`px-3 py-1 font-mono text-[8px] uppercase tracking-widest transition-colors ${launcherMode === "new" ? "bg-red-500/15 text-red-400" : "text-neutral-600 hover:text-neutral-400"}`}
          >
            NEW INVESTIGATION
          </button>
          <button
            type="button"
            onClick={() => setLauncherMode("command")}
            className={`px-3 py-1 font-mono text-[8px] uppercase tracking-widest transition-colors ${launcherMode === "command" ? "bg-cyan-500/10 text-cyan-400" : "text-neutral-600 hover:text-neutral-400"}`}
          >
            CASE COMMAND
          </button>
        </div>
      </div>

      {/* CASE COMMAND MODE */}
      {launcherMode === "command" && (
        <div className="p-4 space-y-3">
          <div className="space-y-1">
            <label className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest block">Operational Command</label>
            <p className="font-mono text-[8px] text-neutral-700">Issue direct commands to active cases. ATLAS resolves the case, performs the action, and confirms.</p>
          </div>
          <form onSubmit={handleCommand} className="flex gap-2">
            <input
              type="text"
              value={cmdInput}
              onChange={e => { setCmdInput(e.target.value); if (cmdStatus !== "idle") { setCmdStatus("idle"); setCmdResult(null); setCmdError(null); } }}
              placeholder='e.g. add entity "LAHSA" to case 010001'
              disabled={cmdStatus === "running"}
              className="flex-1 bg-black border border-[#ffffff12] text-white font-mono text-sm px-3 h-9 focus:outline-none focus:border-cyan-500/50 disabled:opacity-40 placeholder:text-neutral-700"
            />
            <button
              type="submit"
              disabled={!cmdInput.trim() || cmdStatus === "running"}
              className="h-9 px-4 bg-cyan-800/60 hover:bg-cyan-700/60 disabled:bg-neutral-800 disabled:text-neutral-600 text-cyan-300 font-mono text-[10px] uppercase tracking-widest transition-colors flex items-center gap-1.5"
            >
              {cmdStatus === "running" ? <><span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />EXEC...</> : <>EXECUTE</>}
            </button>
          </form>
          {cmdResult && (
            <div className="flex items-center gap-2 text-green-400 font-mono text-[10px]">
              <CheckCircle className="w-3 h-3 flex-shrink-0" />
              {cmdResult}
            </div>
          )}
          {cmdError && (
            <div className="flex items-center gap-2 text-red-400 font-mono text-[10px]">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              {cmdError}
            </div>
          )}
          <div className="space-y-1 pt-1 border-t border-[#ffffff06]">
            <div className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest">Command examples</div>
            <div className="flex flex-col gap-1">
              {CMD_EXAMPLES.map(ex => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => { setCmdInput(ex); setCmdStatus("idle"); setCmdResult(null); setCmdError(null); }}
                  className="text-left font-mono text-[9px] text-neutral-700 hover:text-cyan-500 transition-colors truncate"
                >
                  → {ex}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* NEW INVESTIGATION MODE */}
      {launcherMode === "new" && <>
        <div className="flex border-b border-[#ffffff08]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 font-mono text-[8px] uppercase tracking-widest flex items-center gap-1.5 transition-colors border-b-2 ${
                activeTab === tab.id
                  ? "border-red-500 text-red-400 bg-red-500/[0.04]"
                  : "border-transparent text-neutral-600 hover:text-neutral-400"
              }`}
            >
              {tab.label}
              {tab.badge !== undefined && (
                <span className="px-1 py-0 bg-red-500/20 text-red-400 text-[7px] rounded-sm">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

      <form onSubmit={handleSeed} className="p-4 space-y-3">
        {/* TARGET TAB */}
        {activeTab === "target" && (
          <div className="space-y-2">
            <label className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest block">
              Investigation Target
            </label>
            <p className="font-mono text-[8px] text-neutral-700">
              ATLAS auto-generates investigative queries, ingests web sources, extracts entities &amp; financial signals, and builds your case graph.
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
            {queryVariations.length > 0 && status === "idle" && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="font-mono text-[8px] text-neutral-700 uppercase tracking-wider self-center">Will search:</span>
                {queryVariations.map((q) => (
                  <span key={q} className="px-2 py-0.5 border border-[#ffffff08] bg-[#ffffff03] font-mono text-[9px] text-neutral-500">{q}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SOURCE URLs TAB */}
        {activeTab === "urls" && (
          <div className="space-y-2">
            <label className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest block">
              Analyst Source URLs
            </label>
            <p className="font-mono text-[8px] text-neutral-700">
              One URL per line. ATLAS will fetch and ingest each source directly into the case document vault and run entity extraction.
            </p>
            <textarea
              value={urlsRaw}
              onChange={(e) => setUrlsRaw(e.target.value)}
              disabled={status === "seeding"}
              placeholder={"https://example.com/article-one\nhttps://example.com/article-two"}
              rows={5}
              className="w-full bg-black border border-[#ffffff12] text-white font-mono text-[11px] px-3 py-2 focus:outline-none focus:border-amber-500/50 disabled:opacity-40 placeholder:text-neutral-700 resize-none"
            />
            {parsedUrls.length > 0 && (
              <div className="space-y-1">
                <div className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest">{parsedUrls.length} valid URL{parsedUrls.length !== 1 ? "s" : ""} detected</div>
                {parsedUrls.map((u) => (
                  <div key={u} className="flex items-center gap-1.5 font-mono text-[9px] text-amber-600">
                    <span className="w-1 h-1 rounded-full bg-amber-500 flex-shrink-0" />
                    <span className="truncate">{u}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* RAW NOTES TAB */}
        {activeTab === "notes" && (
          <div className="space-y-2">
            <label className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest block">
              Raw Analyst Notes
            </label>
            <p className="font-mono text-[8px] text-neutral-700">
              Paste unstructured notes, evidence fragments, or briefing text. ATLAS will process them as a source document and extract entities.
            </p>
            <textarea
              value={rawNotes}
              onChange={(e) => setRawNotes(e.target.value)}
              disabled={status === "seeding"}
              placeholder="Subject was observed at 0300 hours near the Port of Long Beach. Vehicle registration linked to shell company..."
              rows={7}
              className="w-full bg-black border border-[#ffffff12] text-white font-mono text-[11px] px-3 py-2 focus:outline-none focus:border-purple-500/50 disabled:opacity-40 placeholder:text-neutral-700 resize-none"
            />
            {hasNotes && (
              <div className="font-mono text-[8px] text-purple-500/70 uppercase tracking-widest">
                {rawNotes.trim().length} chars · Will be ingested as analyst notes document
              </div>
            )}
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center gap-3 pt-1 border-t border-[#ffffff06]">
          <button
            type="submit"
            disabled={!seed || status === "seeding"}
            className="h-8 px-5 bg-red-600 hover:bg-red-700 disabled:bg-neutral-800 disabled:text-neutral-600 text-white font-mono text-[10px] uppercase tracking-widest transition-colors flex items-center gap-2"
          >
            {status === "seeding" ? (
              <><span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />SEEDING...</>
            ) : (
              <><Zap className="w-3 h-3" />INITIATE</>
            )}
          </button>
          {(parsedUrls.length > 0 || hasNotes) && (
            <div className="flex items-center gap-2 font-mono text-[8px] text-neutral-600">
              {parsedUrls.length > 0 && <span className="text-amber-600/70">+{parsedUrls.length} URL{parsedUrls.length !== 1 ? "s" : ""}</span>}
              {hasNotes && <span className="text-purple-500/70">+NOTES</span>}
              <span>will be ingested alongside auto-search</span>
            </div>
          )}
        </div>

        {/* Seeding progress */}
        {status === "seeding" && (
          <div className="space-y-1.5">
            <div className="font-mono text-[9px] text-orange-400 uppercase tracking-widest animate-pulse">
              ATLAS IS INGESTING SOURCES AND BUILDING ENTITY GRAPH...
            </div>
            <div className="h-0.5 bg-neutral-900 overflow-hidden">
              <div className="h-full bg-red-500 animate-[scan_2s_linear_infinite]" style={{ width: "40%" }} />
            </div>
          </div>
        )}

        {/* Success */}
        {status === "done" && seededCaseId && (
          <div className="flex items-center gap-2 text-green-400 font-mono text-[10px]">
            <CheckCircle className="w-3.5 h-3.5" />
            CASE-{seededCaseId.toString().padStart(6, "0")} CREATED — REDIRECTING TO INVESTIGATION...
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="flex items-center gap-2 text-red-400 font-mono text-[10px]">
            <AlertTriangle className="w-3.5 h-3.5" />
            SEED FAILED: {errorMsg}
          </div>
        )}
      </form>
      </>}
    </div>
  );
}

export default function Dashboard() {
  const { data: cases, isLoading } = useListCases();
  const { data: entities } = useListEntities();
  const { data: documents } = useListDocuments();
  const { data: pending } = useListEntityMentions({ status: "pending" });
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");

  const totalCases = asArray(cases).length;
  const activeCases = asArray(cases).filter((c) => c.status === "active").length;
  const totalEntities = asArray(entities).length;
  const totalDocs = asArray(documents).length;
  const pendingCount = asArray(pending).length;

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
          <span className="font-mono text-[8px] text-neutral-800 uppercase">{totalCases} CASES</span>
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
      ) : asArray(cases).length === 0 ? (
        <EmptyDossiers />
      ) : (
        <div
          className={
            viewMode === "grid"
              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3"
              : "border-x border-b border-[#ffffff0a]"
          }
        >
          {asArray(cases).map((c) => (
            <DossierCard key={c.id} c={c} viewMode={viewMode} />
          ))}
        </div>
      )}

      <SystemWipePanel />
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
      <div className="group relative flex items-center atlas-case-row overflow-hidden">
        <Link href={`/cases/${c.id}`} className="flex-1 min-w-0 pr-10">
          <div className="flex items-center gap-3 px-3 py-2 cursor-pointer">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
            <span className={`font-mono text-[9px] uppercase tracking-wider flex-shrink-0 w-14 ${s.text}`}>
              {s.label}
            </span>
            <span className="font-mono text-[9px] text-neutral-700 flex-shrink-0 w-24 tabular-nums hidden sm:inline">
              CASE-{c.id.toString().padStart(6, "0")}
            </span>
            <span className="font-mono text-xs text-white font-semibold uppercase truncate flex-1 group-hover:text-red-300 transition-colors tracking-tight">
              {c.title}
            </span>
            {asArray(c.tags).length > 0 && (
              <div className="hidden md:flex items-center gap-1 flex-shrink-0">
                {asArray(c.tags).filter((t) => t !== "auto-seeded").slice(0, 2).map((tag) => (
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
        {/* Trash — absolutely positioned so it never shifts content */}
        <div
          className="absolute right-0 top-0 bottom-0 flex items-center px-2"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          {confirmDelete ? (
            <div className="flex items-center gap-1 border border-red-800/50 bg-[#0a0000]/95 px-1.5 py-1">
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
            {asArray(c.tags).filter((t) => t !== "auto-seeded").length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {asArray(c.tags).filter((t) => t !== "auto-seeded").slice(0, 3).map((tag) => (
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

const WIPE_PHRASE = "WIPE ATLAS";

function SystemWipePanel() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "confirm" | "wiping" | "done" | "error">("idle");
  const [confirmInput, setConfirmInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const phraseMatch = confirmInput.trim().toUpperCase() === WIPE_PHRASE;

  const handleWipe = async () => {
    if (!phraseMatch) return;
    setPhase("wiping");
    try {
      const resp = await fetch("/api/admin/wipe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "WIPE_ALL_DATA" }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      setPhase("done");
      setConfirmInput("");
      await queryClient.invalidateQueries();
    } catch (err) {
      setErrorMsg(String(err));
      setPhase("error");
    }
  };

  const handleClose = () => {
    setOpen(false);
    if (phase !== "done") { setPhase("idle"); setConfirmInput(""); }
  };

  return (
    <div className="mt-5 border border-red-950/40 bg-red-950/[0.02]">
      <button
        onClick={() => (open ? handleClose() : setOpen(true))}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-red-950/10 transition-colors"
      >
        <div className="flex items-center gap-2 font-mono text-[8px] text-red-900 uppercase tracking-widest">
          <ShieldAlert className="w-3 h-3" />
          SYSTEM CONTROLS — RESTRICTED
        </div>
        <ChevronDown className={`w-3 h-3 text-red-900 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-4 py-3 border-t border-red-950/30 space-y-3">
          <div className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest">
            ATLAS DATABASE — FULL WIPE
          </div>
          <p className="font-mono text-[9px] text-neutral-700 leading-relaxed">
            Permanently deletes ALL cases, entities, documents, relationships, financial signals, and system logs.
            This action is <span className="text-red-700">irreversible</span> and cannot be undone.
          </p>

          {phase === "idle" && (
            <button
              onClick={() => setPhase("confirm")}
              className="flex items-center gap-2 px-3 py-1.5 border border-red-800/40 bg-red-950/10 text-red-700 hover:text-red-400 hover:border-red-700/60 hover:bg-red-950/20 font-mono text-[9px] uppercase tracking-widest transition-all"
            >
              <ShieldAlert className="w-3 h-3" />
              INITIATE SYSTEM WIPE
            </button>
          )}

          {phase === "confirm" && (
            <div className="border border-red-800/60 bg-red-950/20 p-3 space-y-3">
              <div className="font-mono text-[9px] text-red-400 uppercase tracking-widest">
                ⚠ AUTHORIZATION REQUIRED
              </div>
              <p className="font-mono text-[8px] text-neutral-500 leading-relaxed">
                This will destroy all investigation data permanently. There is no recovery option.<br />
                Type <span className="text-red-400 font-bold">{WIPE_PHRASE}</span> to authorize.
              </p>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder={`Type "${WIPE_PHRASE}" to confirm`}
                className="w-full bg-black border border-red-800/40 text-red-300 font-mono text-[10px] px-2 py-1.5 focus:outline-none focus:border-red-500 placeholder:text-neutral-700"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={handleWipe}
                  disabled={!phraseMatch}
                  className="px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:bg-neutral-800 disabled:text-neutral-600 disabled:cursor-not-allowed text-white font-mono text-[9px] uppercase tracking-widest transition-colors"
                >
                  CONFIRM — WIPE ALL DATA
                </button>
                <button
                  onClick={() => { setPhase("idle"); setConfirmInput(""); }}
                  className="px-3 py-1.5 border border-neutral-700 text-neutral-500 hover:text-white font-mono text-[9px] uppercase tracking-widest transition-colors"
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}

          {phase === "wiping" && (
            <div className="flex items-center gap-2 font-mono text-[9px] text-amber-500 uppercase tracking-widest animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
              PURGING ALL DATA...
            </div>
          )}

          {phase === "done" && (
            <div className="flex items-center gap-2 font-mono text-[9px] text-green-500 uppercase tracking-widest">
              <CheckCircle className="w-3 h-3" />
              WIPE COMPLETE — ALL DATA PURGED
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-mono text-[9px] text-red-500 uppercase tracking-widest">
                <AlertTriangle className="w-3 h-3" />
                WIPE FAILED
              </div>
              {errorMsg && <p className="font-mono text-[8px] text-neutral-600">{errorMsg}</p>}
              <button
                onClick={() => { setPhase("idle"); setConfirmInput(""); }}
                className="font-mono text-[8px] text-neutral-600 hover:text-neutral-400 uppercase tracking-widest underline"
              >
                RESET
              </button>
            </div>
          )}
        </div>
      )}
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
