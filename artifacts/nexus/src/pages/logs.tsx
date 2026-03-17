import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, FileText, Globe, ScanLine, UserCheck, UserX, Link2, RefreshCw,
  Zap, AlertTriangle, ShieldAlert, Search, Clock, Database, BarChart2,
  TrendingUp, Ban, Filter,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface SystemLogEntry {
  id: number;
  eventType: string;
  message: string;
  caseId: number | null;
  entityId: number | null;
  documentId: number | null;
  createdAt: string;
}

type Severity = "info" | "success" | "warn" | "error" | "debug";

interface EventConfig {
  icon: React.ElementType;
  color: string;
  label: string;
  severity: Severity;
  bg: string;
}

const EVENT_CONFIG: Record<string, EventConfig> = {
  // Auth
  auth_login:             { icon: UserCheck,  color: "text-green-400",   label: "AUTH LOGIN",         severity: "success", bg: "bg-green-950/20" },
  auth_logout:            { icon: UserX,      color: "text-neutral-500", label: "AUTH LOGOUT",        severity: "info",    bg: "" },
  auth_failed:            { icon: ShieldAlert,color: "text-red-600",     label: "AUTH FAILED",        severity: "error",   bg: "bg-red-950/20" },

  // Case lifecycle
  case_created:           { icon: Zap,        color: "text-red-500",     label: "CASE CREATED",       severity: "info",    bg: "bg-red-950/10" },
  case_seeded:            { icon: Zap,        color: "text-red-500",     label: "CASE SEEDED",        severity: "info",    bg: "bg-red-950/10" },
  auto_build_started:     { icon: Activity,   color: "text-orange-500",  label: "BUILD STARTED",      severity: "info",    bg: "bg-orange-950/10" },
  auto_ingest_started:    { icon: Activity,   color: "text-orange-500",  label: "BUILD STARTED",      severity: "info",    bg: "bg-orange-950/10" },
  auto_build_complete:    { icon: Activity,   color: "text-green-500",   label: "BUILD COMPLETE",     severity: "success", bg: "bg-green-950/20" },
  build_quality_assigned: { icon: BarChart2,  color: "text-cyan-500",    label: "BUILD QUALITY",      severity: "info",    bg: "bg-cyan-950/10" },
  seed_complete:          { icon: BarChart2,  color: "text-cyan-500",    label: "BUILD COMPLETE",     severity: "success", bg: "bg-cyan-950/10" },
  seed_intent_classified: { icon: Search,     color: "text-neutral-600", label: "INTENT CLASSIFIED",  severity: "debug",   bg: "" },

  // Query + doc pipeline
  query_run:              { icon: Search,     color: "text-cyan-700",    label: "QUERY RUN",          severity: "debug",   bg: "" },
  document_ingested:      { icon: FileText,   color: "text-neutral-400", label: "DOC INGESTED",       severity: "info",    bg: "" },
  web_source_ingested:    { icon: Globe,      color: "text-cyan-600",    label: "WEB INGESTED",       severity: "info",    bg: "" },
  extraction_failed:      { icon: AlertTriangle, color: "text-amber-600",label: "EXTRACTION FAILED",  severity: "warn",    bg: "bg-amber-950/10" },
  extraction_partial:     { icon: AlertTriangle, color: "text-amber-500",label: "EXTRACTION PARTIAL", severity: "warn",    bg: "" },
  doc_noise_skipped:      { icon: Ban,        color: "text-neutral-700", label: "DOC NOISE SKIP",     severity: "debug",   bg: "" },
  doc_topic_mismatch:     { icon: AlertTriangle, color: "text-amber-700",label: "TOPIC MISMATCH",     severity: "warn",    bg: "" },
  doc_contamination_high: { icon: ShieldAlert,color: "text-orange-600",  label: "HIGH CONTAMINATION", severity: "warn",    bg: "bg-orange-950/10" },

  // Entity pipeline
  analysis_completed:     { icon: ScanLine,   color: "text-blue-400",    label: "ANALYSIS DONE",      severity: "info",    bg: "" },
  entity_approved:        { icon: UserCheck,  color: "text-green-500",   label: "ENTITY APPROVED",    severity: "success", bg: "bg-green-950/15" },
  entity_auto_approved:   { icon: TrendingUp, color: "text-green-400",   label: "ENTITY PROMOTED",    severity: "success", bg: "bg-green-950/15" },
  entity_promoted:        { icon: TrendingUp, color: "text-green-400",   label: "ENTITY PROMOTED",    severity: "success", bg: "bg-green-950/15" },
  entity_rejected:        { icon: UserX,      color: "text-red-700",     label: "ENTITY REJECTED",    severity: "warn",    bg: "" },
  entity_candidate_held:  { icon: Clock,      color: "text-cyan-700",    label: "ENTITY HELD",        severity: "info",    bg: "" },
  entity_held:            { icon: Clock,      color: "text-cyan-700",    label: "ENTITY HELD",        severity: "info",    bg: "" },

  // Graph + timeline
  suggested_link:         { icon: Link2,      color: "text-cyan-700",    label: "LINK SUGGESTED",     severity: "info",    bg: "" },
  graph_built:            { icon: Database,   color: "text-cyan-500",    label: "GRAPH BUILT",        severity: "success", bg: "bg-cyan-950/10" },
  graph_updated:          { icon: Database,   color: "text-cyan-600",    label: "GRAPH UPDATED",      severity: "success", bg: "bg-cyan-950/10" },
  timeline_extracted:     { icon: Clock,      color: "text-blue-500",    label: "TIMELINE EXTRACTED", severity: "info",    bg: "" },
  financial_signal:       { icon: TrendingUp, color: "text-green-600",   label: "FINANCIAL SIGNAL",   severity: "info",    bg: "" },

  // Recovery
  recovery_triggered:     { icon: AlertTriangle, color: "text-amber-400",label: "RECOVERY TRIGGERED", severity: "warn",    bg: "bg-amber-950/15" },
  recovery_complete:      { icon: Activity,   color: "text-teal-500",    label: "RECOVERY COMPLETE",  severity: "success", bg: "bg-teal-950/10" },
  seed_fallback_triggered:{ icon: AlertTriangle, color: "text-amber-500",label: "FALLBACK TRIGGER",   severity: "warn",    bg: "" },
  seed_no_promotion:      { icon: Ban,        color: "text-red-700",     label: "NO PROMOTION",       severity: "error",   bg: "bg-red-950/15" },

  // Dossier
  dossier_generated:      { icon: FileText,   color: "text-violet-500",  label: "DOSSIER GENERATED",  severity: "success", bg: "bg-violet-950/10" },
};

const SEVERITY_FILTER_OPTIONS: { key: string; label: string; color: string }[] = [
  { key: "all",     label: "ALL",     color: "text-neutral-400" },
  { key: "error",   label: "ERRORS",  color: "text-red-600" },
  { key: "warn",    label: "WARN",    color: "text-amber-500" },
  { key: "success", label: "SUCCESS", color: "text-green-500" },
  { key: "info",    label: "INFO",    color: "text-cyan-600" },
];

function getEventConfig(eventType: string): EventConfig {
  return EVENT_CONFIG[eventType] ?? {
    icon: Activity,
    color: "text-neutral-600",
    label: eventType.toUpperCase().replace(/_/g, " "),
    severity: "info",
    bg: "",
  };
}

const SEVERITY_ORDER: Severity[] = ["error", "warn", "success", "info", "debug"];

export default function SystemLog() {
  const { data: logs = [], isLoading, refetch } = useQuery<SystemLogEntry[]>({
    queryKey: ["/api/system-log"],
    queryFn: () => fetch("/api/system-log").then(r => r.json()),
    refetchInterval: 12000,
  });

  const [severityFilter, setSeverityFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const filtered = logs.filter(entry => {
    const cfg = getEventConfig(entry.eventType);
    const severityOk = severityFilter === "all" || cfg.severity === severityFilter;
    const searchOk = !searchTerm ||
      entry.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.eventType.toLowerCase().includes(searchTerm.toLowerCase());
    return severityOk && searchOk;
  });

  const errorCount   = logs.filter(e => getEventConfig(e.eventType).severity === "error").length;
  const warnCount    = logs.filter(e => getEventConfig(e.eventType).severity === "warn").length;
  const successCount = logs.filter(e => getEventConfig(e.eventType).severity === "success").length;

  return (
    <div className="max-w-5xl mx-auto space-y-3">

      {/* Header */}
      <div className="border-b border-[#ffffff0d] pb-3 flex items-end justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-[0.15em] text-white uppercase font-mono">
            SYSTEM LOG
          </h1>
          <p className="text-neutral-700 tracking-widest text-[8px] font-mono mt-0.5 uppercase">
            ATLAS-CORE // AUDIT &amp; ACTIVITY TRACE
          </p>
        </div>
        <div className="flex items-center gap-3">
          {errorCount > 0 && (
            <span className="font-mono text-[8px] text-red-600 border border-red-900/40 px-1.5 py-0.5 uppercase">
              {errorCount} ERR
            </span>
          )}
          {warnCount > 0 && (
            <span className="font-mono text-[8px] text-amber-600 border border-amber-900/40 px-1.5 py-0.5 uppercase">
              {warnCount} WARN
            </span>
          )}
          {successCount > 0 && (
            <span className="font-mono text-[8px] text-green-600 border border-green-900/40 px-1.5 py-0.5 uppercase">
              {successCount} OK
            </span>
          )}
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-neutral-600 hover:text-white font-mono text-[8px] uppercase tracking-widest transition-colors"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            REFRESH
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Filter className="w-3 h-3 text-neutral-700" />
          <span className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest">FILTER</span>
        </div>
        {SEVERITY_FILTER_OPTIONS.map(opt => (
          <button
            key={opt.key}
            onClick={() => setSeverityFilter(opt.key)}
            className={cn(
              "font-mono text-[8px] uppercase tracking-wider px-2 py-0.5 border transition-colors",
              severityFilter === opt.key
                ? `${opt.color} border-current bg-[#ffffff05]`
                : "text-neutral-700 border-[#ffffff0a] hover:text-neutral-400"
            )}
          >
            {opt.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 border border-[#ffffff0a] px-2 py-0.5">
          <Search className="w-2.5 h-2.5 text-neutral-700" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="SEARCH EVENTS..."
            className="bg-transparent font-mono text-[8px] text-white placeholder:text-neutral-800 focus:outline-none w-32 uppercase"
          />
        </div>
      </div>

      {/* Log body */}
      {isLoading ? (
        <EmptyState icon={Activity} message="LOADING ACTIVITY LOG..." pulse />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Activity}
          message={logs.length === 0 ? "NO ACTIVITY RECORDED" : "NO EVENTS MATCH FILTER"}
          sub={logs.length === 0 ? "System events will appear here as operations are performed" : undefined}
        />
      ) : (
        <div className="border border-[#ffffff0a] atlas-panel divide-y divide-[#ffffff06]">
          {filtered.map((entry) => {
            const cfg = getEventConfig(entry.eventType);
            const Icon = cfg.icon;
            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-2.5 hover:bg-[#ffffff03] transition-colors",
                  cfg.bg
                )}
              >
                {/* Timestamp */}
                <div className="w-28 flex-shrink-0 pt-0.5">
                  <div className="font-mono text-[8px] text-neutral-700 tabular-nums">
                    {format(new Date(entry.createdAt), "yyyy-MM-dd")}
                  </div>
                  <div className="font-mono text-[7px] text-neutral-800 tabular-nums">
                    {format(new Date(entry.createdAt), "HH:mm:ss")}
                  </div>
                </div>

                {/* Severity bar */}
                <div className={cn(
                  "w-0.5 self-stretch flex-shrink-0 rounded-full",
                  cfg.severity === "error"   ? "bg-red-700/50" :
                  cfg.severity === "warn"    ? "bg-amber-600/40" :
                  cfg.severity === "success" ? "bg-green-600/40" :
                  "bg-neutral-800/40"
                )} />

                {/* Icon + badge */}
                <div className="flex-shrink-0 pt-0.5">
                  <div className={`flex items-center gap-1 ${cfg.color}`}>
                    <Icon className="w-3 h-3" />
                    <span className="font-mono text-[7px] uppercase tracking-widest opacity-70">
                      {cfg.label}
                    </span>
                  </div>
                </div>

                {/* Message */}
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] text-neutral-300 leading-relaxed">
                    {entry.message}
                  </div>
                  <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
                    {entry.caseId && (
                      <span className="font-mono text-[7px] text-neutral-800 border border-[#ffffff06] px-1">
                        CASE #{entry.caseId}
                      </span>
                    )}
                    {entry.documentId && (
                      <span className="font-mono text-[7px] text-neutral-800 border border-[#ffffff06] px-1">
                        DOC #{entry.documentId}
                      </span>
                    )}
                    {entry.entityId && (
                      <span className="font-mono text-[7px] text-neutral-800 border border-[#ffffff06] px-1">
                        ENTITY #{entry.entityId}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="font-mono text-[8px] text-neutral-800 uppercase tracking-widest text-right">
          {filtered.length} / {logs.length} EVENT{logs.length !== 1 ? "S" : ""} SHOWN
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, message, sub, pulse }: {
  icon: React.ElementType;
  message: string;
  sub?: string;
  pulse?: boolean;
}) {
  return (
    <div className="border border-dashed border-[#ffffff08] py-14 flex flex-col items-center justify-center gap-2">
      <Icon className={cn("w-5 h-5 text-neutral-800", pulse && "animate-pulse")} />
      <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">{message}</div>
      {sub && <div className="font-mono text-[8px] text-neutral-800 uppercase tracking-widest">{sub}</div>}
    </div>
  );
}
