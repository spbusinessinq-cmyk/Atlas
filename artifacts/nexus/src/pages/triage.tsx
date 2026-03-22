import React, { useState } from "react";
import { asArray } from "@/lib/as-array";
import { useQueryClient } from "@tanstack/react-query";
import { useListEntityMentions, useListCases, useListDocuments } from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle, XCircle, Clock, ChevronRight, Cpu, Filter, RefreshCw, X, ExternalLink, FileText, Globe, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

type MentionStatus = "pending" | "approved" | "rejected" | "held";

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return (
    <span className="flex items-center gap-1 font-mono text-[8px] text-green-500 uppercase tracking-widest">
      <CheckCircle className="w-2.5 h-2.5" /> APPROVED
    </span>
  );
  if (status === "rejected") return (
    <span className="flex items-center gap-1 font-mono text-[8px] text-red-600 uppercase tracking-widest">
      <XCircle className="w-2.5 h-2.5" /> REJECTED
    </span>
  );
  if (status === "held") return (
    <span className="flex items-center gap-1 font-mono text-[8px] text-violet-500 uppercase tracking-widest">
      <AlertTriangle className="w-2.5 h-2.5" /> HELD
    </span>
  );
  return (
    <span className="flex items-center gap-1 font-mono text-[8px] text-amber-500 uppercase tracking-widest animate-pulse">
      <Clock className="w-2.5 h-2.5" /> PENDING
    </span>
  );
}

const TYPE_COLORS: Record<string, string> = {
  PERSON: "text-cyan-500 border-cyan-900/40 bg-cyan-950/10",
  ORGANIZATION: "text-violet-400 border-violet-900/40 bg-violet-950/10",
  LOCATION: "text-emerald-500 border-emerald-900/40 bg-emerald-950/10",
  FINANCIAL_INSTRUMENT: "text-amber-400 border-amber-900/40 bg-amber-950/10",
  GOVERNMENT_BODY: "text-red-400 border-red-900/40 bg-red-950/10",
  GOVERNMENT_AGENCY: "text-red-400 border-red-900/40 bg-red-950/10",
  LEGAL_ENTITY: "text-orange-400 border-orange-900/40 bg-orange-950/10",
};

function TypeBadge({ type }: { type: string }) {
  const cls = TYPE_COLORS[type?.toUpperCase?.()] ?? "text-neutral-500 border-neutral-800 bg-neutral-900/20";
  return (
    <span className={cn("px-1.5 py-0.5 border font-mono text-[7px] uppercase tracking-widest", cls)}>
      {(type || "UNKNOWN").replace(/_/g, " ")}
    </span>
  );
}

type CredTier = "GOV" | "QUALITY-NEWS" | "LOCAL-NEWS" | "PR-WIRE" | "LOW-SRC" | null;
function getCredTier(domain: string | null | undefined): CredTier {
  if (!domain) return null;
  const d = domain.toLowerCase();
  if (d.endsWith(".gov") || d.includes(".ca.gov") || d.includes("senate.gov") || d.includes("house.gov")) return "GOV";
  const quality = ["latimes.com","nytimes.com","washingtonpost.com","propublica.org","apnews.com","reuters.com","bloomberg.com","calmatters.org","laist.com","kpcc.org","theguardian.com"];
  if (quality.some(q => d.includes(q))) return "QUALITY-NEWS";
  const local = ["patch.com","abc7.com","nbcla.com","ktla.com","kcal9.com","fox11.com","tribune","gazette","herald"];
  if (local.some(l => d.includes(l))) return "LOCAL-NEWS";
  const pr = ["prnewswire.com","businesswire.com","globenewswire.com","prweb.com"];
  if (pr.some(p => d.includes(p))) return "PR-WIRE";
  const low = ["reddit.com","twitter.com","x.com","facebook.com","tmz.com","buzzfeed.com"];
  if (low.some(l => d.includes(l))) return "LOW-SRC";
  return null;
}

const CRED_BADGE: Record<string, string> = {
  "GOV": "text-red-400 border-red-500/35",
  "QUALITY-NEWS": "text-cyan-500 border-cyan-500/30",
  "LOCAL-NEWS": "text-sky-600 border-sky-500/25",
  "PR-WIRE": "text-amber-700 border-amber-800/25",
  "LOW-SRC": "text-neutral-700 border-[#ffffff08]",
};

interface Mention {
  id: number;
  entityName: string;
  entityType?: string | null;
  confidence?: number | null;
  status: string;
  caseId?: number | null;
  documentId?: number | null;
  context?: string | null;
  role?: string | null;
  offTopicScore?: number | null;
  normalizedName?: string | null;
}

interface DetailPanelProps {
  mention: Mention;
  caseTitle: string | null;
  caseExists: boolean;
  document: { title?: string; sourceDomain?: string | null; sourceUrl?: string | null } | null;
  onDecision: (id: number, decision: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}

function TriageDetailPanel({ mention, caseTitle, caseExists, document, onDecision, onDelete, onClose }: DetailPanelProps) {
  const [, navigate] = useLocation();
  const [delConfirm, setDelConfirm] = useState(false);
  const [working, setWorking] = useState(false);

  const conf = mention.confidence ?? 0;
  const credTier = getCredTier(document?.sourceDomain);

  const withWorking = async (fn: () => Promise<void>) => {
    setWorking(true);
    try { await fn(); } finally { setWorking(false); }
  };

  const whyHeld: string[] = [];
  if ((mention.offTopicScore ?? 0) > 0.4) whyHeld.push("HIGH OFF-TOPIC SCORE");
  if (conf < 0.65) whyHeld.push("LOW CONFIDENCE");
  if (mention.entityType === "LOCATION") whyHeld.push("LOCATION TYPE — LOW INVESTIGATIVE VALUE");
  if (mention.status === "held") whyHeld.push("SINGLE-DOCUMENT ENTITY — REQUIRES CROSS-DOC CONFIRMATION");
  if (mention.status === "rejected") whyHeld.push("MANUALLY REJECTED BY ANALYST");

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[420px] bg-[#030508] border-l border-amber-500/20 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-amber-500/15 bg-amber-500/[0.02]">
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-amber-400" />
          <span className="font-mono text-[9px] text-amber-400 uppercase tracking-widest">TRIAGE ITEM DETAIL</span>
        </div>
        <button onClick={onClose} className="p-1 text-neutral-700 hover:text-white transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Entity core */}
        <div className="px-4 py-4 border-b border-[#ffffff06]">
          <div className="font-mono text-[18px] font-bold text-white uppercase tracking-tight leading-tight mb-1">
            {mention.entityName}
          </div>
          {mention.normalizedName && mention.normalizedName !== mention.entityName && (
            <div className="font-mono text-[8px] text-neutral-600 uppercase tracking-wider mb-2">
              NORMALIZED: {mention.normalizedName}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <TypeBadge type={mention.entityType ?? "UNKNOWN"} />
            <StatusBadge status={mention.status} />
            {mention.role && (
              <span className="px-1.5 py-0.5 border border-[#ffffff0a] font-mono text-[7px] text-neutral-600 uppercase tracking-widest">
                {mention.role}
              </span>
            )}
          </div>
        </div>

        {/* Confidence */}
        <div className="px-4 py-3 border-b border-[#ffffff05]">
          <div className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest mb-2">CONFIDENCE ASSESSMENT</div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-neutral-900 overflow-hidden">
              <div
                className={cn("h-full transition-all", conf >= 0.75 ? "bg-green-600" : conf >= 0.5 ? "bg-amber-600" : "bg-red-700")}
                style={{ width: `${Math.round(conf * 100)}%` }}
              />
            </div>
            <span className={cn("font-mono text-[11px] font-bold tabular-nums", conf >= 0.75 ? "text-green-400" : conf >= 0.5 ? "text-amber-400" : "text-red-500")}>
              {Math.round(conf * 100)}%
            </span>
          </div>
          {(mention.offTopicScore ?? 0) > 0.2 && (
            <div className="mt-2 font-mono text-[8px] text-amber-700 uppercase tracking-widest">
              OFF-TOPIC SIGNAL: {Math.round((mention.offTopicScore ?? 0) * 100)}%
            </div>
          )}
        </div>

        {/* Source context */}
        {(mention.context || document) && (
          <div className="px-4 py-3 border-b border-[#ffffff05]">
            <div className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest mb-2">SOURCE CONTEXT</div>
            {document && (
              <div className="flex items-center gap-2 mb-2">
                {document.sourceUrl ? (
                  <Globe className="w-2.5 h-2.5 text-neutral-700 flex-shrink-0" />
                ) : (
                  <FileText className="w-2.5 h-2.5 text-neutral-700 flex-shrink-0" />
                )}
                <span className="font-mono text-[9px] text-neutral-500 truncate">{document.title || "UNTITLED DOCUMENT"}</span>
                {credTier && (
                  <span className={cn("flex-shrink-0 px-1 py-px border font-mono text-[7px] uppercase tracking-widest", CRED_BADGE[credTier] ?? "text-neutral-700 border-[#ffffff08]")}>
                    {credTier}
                  </span>
                )}
              </div>
            )}
            {document?.sourceDomain && (
              <div className="font-mono text-[8px] text-neutral-700 mb-2">{document.sourceDomain}</div>
            )}
            {mention.context && (
              <div className="font-mono text-[9px] text-neutral-500 leading-relaxed bg-[#ffffff02] border border-[#ffffff05] px-3 py-2">
                {mention.context.slice(0, 300)}
                {mention.context.length > 300 && "..."}
              </div>
            )}
            {document?.sourceUrl && (
              <a
                href={document.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex items-center gap-1 font-mono text-[8px] text-cyan-700 hover:text-cyan-400 uppercase tracking-widest transition-colors"
              >
                <ExternalLink className="w-2.5 h-2.5" /> OPEN SOURCE
              </a>
            )}
          </div>
        )}

        {/* Why held/rejected */}
        {(whyHeld.length > 0 || mention.status === "held" || mention.status === "rejected") && (
          <div className="px-4 py-3 border-b border-[#ffffff05]">
            <div className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest mb-2">ANALYST FLAGS</div>
            {whyHeld.length > 0 ? (
              <div className="space-y-1">
                {whyHeld.map((flag, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-700 flex-shrink-0 mt-px" />
                    <span className="font-mono text-[8px] text-amber-800 uppercase tracking-wider">{flag}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="font-mono text-[8px] text-neutral-700">No flags recorded.</div>
            )}
          </div>
        )}

        {/* Linked case */}
        <div className="px-4 py-3 border-b border-[#ffffff05]">
          <div className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest mb-2">LINKED INVESTIGATION</div>
          {mention.caseId ? (
            caseExists ? (
              <button
                onClick={() => navigate(`/cases/${mention.caseId}`)}
                className="flex items-center gap-2 font-mono text-[9px] text-cyan-500 hover:text-cyan-300 uppercase tracking-wide transition-colors"
              >
                <ChevronRight className="w-3 h-3" />
                {caseTitle ?? `CASE-${String(mention.caseId).padStart(6, "0")}`}
              </button>
            ) : (
              <div className="flex items-center gap-2 font-mono text-[9px] text-neutral-700 uppercase tracking-wide">
                <AlertTriangle className="w-3 h-3 text-amber-700" />
                CASE NOT FOUND — LINKED CASE MAY HAVE BEEN DELETED
              </div>
            )
          ) : (
            <span className="font-mono text-[8px] text-neutral-700">No linked case.</span>
          )}
        </div>
      </div>

      {/* Action strip */}
      <div className="border-t border-[#ffffff08] p-4 space-y-2 flex-shrink-0">
        <div className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest mb-3">ANALYST ACTIONS</div>

        {mention.status !== "approved" && (
          <button
            disabled={working}
            onClick={() => withWorking(() => onDecision(mention.id, "approved"))}
            className="w-full flex items-center justify-center gap-2 py-2 border border-green-900/60 bg-green-950/15 text-green-500 hover:bg-green-950/30 hover:border-green-700/60 font-mono text-[9px] uppercase tracking-widest transition-colors disabled:opacity-40"
          >
            <CheckCircle className="w-3 h-3" /> APPROVE — ADD TO ENTITY REGISTRY
          </button>
        )}
        {mention.status !== "rejected" && (
          <button
            disabled={working}
            onClick={() => withWorking(() => onDecision(mention.id, "rejected"))}
            className="w-full flex items-center justify-center gap-2 py-2 border border-red-900/60 bg-red-950/15 text-red-600 hover:bg-red-950/30 hover:border-red-700/60 font-mono text-[9px] uppercase tracking-widest transition-colors disabled:opacity-40"
          >
            <XCircle className="w-3 h-3" /> REJECT — SUPPRESS FROM REGISTRY
          </button>
        )}
        {mention.status !== "pending" && (
          <button
            disabled={working}
            onClick={() => withWorking(() => onDecision(mention.id, "pending"))}
            className="w-full flex items-center justify-center gap-2 py-2 border border-neutral-800 text-neutral-600 hover:text-neutral-400 hover:border-neutral-600 font-mono text-[9px] uppercase tracking-widest transition-colors disabled:opacity-40"
          >
            <Clock className="w-3 h-3" /> RETURN TO PENDING REVIEW
          </button>
        )}

        {/* Delete (admin) */}
        {!delConfirm ? (
          <button
            onClick={() => setDelConfirm(true)}
            className="w-full flex items-center justify-center gap-2 py-1.5 text-neutral-800 hover:text-red-700 font-mono text-[8px] uppercase tracking-widest transition-colors mt-1"
          >
            <Trash2 className="w-2.5 h-2.5" /> DELETE MENTION (ADMIN)
          </button>
        ) : (
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => withWorking(() => onDelete(mention.id))}
              className="flex-1 py-1.5 border border-red-800/60 bg-red-950/20 text-red-500 font-mono text-[8px] uppercase tracking-widest hover:bg-red-950/40 transition-colors"
            >
              CONFIRM DELETE
            </button>
            <button
              onClick={() => setDelConfirm(false)}
              className="flex-1 py-1.5 border border-[#ffffff0a] text-neutral-700 font-mono text-[8px] uppercase tracking-widest hover:text-neutral-400 transition-colors"
            >
              CANCEL
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TriagePage() {
  const [statusFilter, setStatusFilter] = useState<"pending" | "all">("pending");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedMentionId, setSelectedMentionId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: mentions, isLoading } = useListEntityMentions(
    statusFilter === "pending" ? { status: "pending" } : {}
  );
  const { data: cases } = useListCases();
  const { data: documents } = useListDocuments();

  const caseMap = React.useMemo(() => {
    const m: Record<number, string> = {};
    asArray(cases).forEach(c => { m[c.id] = c.title; });
    return m;
  }, [cases]);

  const caseIds = React.useMemo(() => new Set(asArray(cases).map(c => c.id)), [cases]);

  const docMap = React.useMemo(() => {
    const m: Record<number, { title?: string; sourceDomain?: string | null; sourceUrl?: string | null }> = {};
    asArray(documents).forEach(d => {
      const ext = d as any;
      m[d.id] = { title: d.title, sourceDomain: ext.sourceDomain, sourceUrl: ext.sourceUrl };
    });
    return m;
  }, [documents]);

  const handleDecision = async (mentionId: number, decision: string) => {
    try {
      await fetch(`/api/entity-mentions/${mentionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: decision }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
    } catch (err) {
      console.error("Triage decision failed:", err);
    }
  };

  const handleDelete = async (mentionId: number) => {
    try {
      await fetch(`/api/entity-mentions/${mentionId}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
      setSelectedMentionId(null);
    } catch (err) {
      console.error("Mention delete failed:", err);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const mentionsArr = asArray(mentions);
  const pending = mentionsArr.filter(m => m.status === "pending");
  const total = mentionsArr.length;
  const selectedMention = mentionsArr.find(m => m.id === selectedMentionId) ?? null;

  return (
    <div className="space-y-0 max-w-7xl mx-auto">
      {/* Header */}
      <div className="border border-amber-500/20 bg-amber-500/[0.02] mb-5">
        <div className="nexus-header-strip border-b border-amber-500/15">
          <div className="flex items-center gap-2 font-mono text-[9px] text-amber-400 uppercase tracking-widest">
            <Cpu className="w-3 h-3" />
            TRIAGE QUEUE
          </div>
          <div className="flex items-center gap-3">
            {statusFilter === "pending" && pending.length > 0 && (
              <span className="font-mono text-[8px] text-amber-600 uppercase tracking-widest animate-pulse">
                {pending.length} AWAITING REVIEW
              </span>
            )}
            <button
              onClick={handleRefresh}
              className="p-1 text-neutral-700 hover:text-amber-400 transition-colors"
              title="Refresh queue"
            >
              <RefreshCw className={cn("w-3 h-3", isRefreshing && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Filter strip */}
        <div className="px-4 py-2 border-b border-[#ffffff06] flex items-center gap-3">
          <Filter className="w-3 h-3 text-neutral-700" />
          <span className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest">FILTER:</span>
          {(["pending", "all"] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                "font-mono text-[8px] uppercase tracking-widest px-2 py-0.5 border transition-colors",
                statusFilter === f
                  ? "border-amber-700/50 text-amber-400 bg-amber-950/20"
                  : "border-[#ffffff08] text-neutral-700 hover:text-neutral-400"
              )}
            >
              {f === "pending" ? "PENDING ONLY" : "ALL MENTIONS"}
            </button>
          ))}
          <span className="ml-auto font-mono text-[8px] text-neutral-800 uppercase tracking-widest">
            {total} RECORD{total !== 1 ? "S" : ""}
          </span>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="p-4 space-y-1">
            {[1,2,3,4].map(i => (
              <div key={i} className="h-8 bg-[#ffffff02] animate-pulse border border-[#ffffff04]" />
            ))}
          </div>
        ) : mentionsArr.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-3">
            <CheckCircle className="w-8 h-8 text-green-900" />
            <div className="font-mono text-[10px] text-neutral-600 uppercase tracking-widest">
              {statusFilter === "pending" ? "TRIAGE QUEUE CLEAR — NO PENDING MENTIONS" : "NO MENTIONS IN REGISTRY"}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[#ffffff04]">
            {/* Column headers */}
            <div className="hidden md:grid grid-cols-[1fr_110px_90px_90px_75px_160px] gap-3 px-4 py-1.5 bg-[#ffffff01]">
              {["ENTITY NAME", "TYPE", "CONFIDENCE", "CASE", "STATUS", "QUICK ACTIONS"].map(h => (
                <span key={h} className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest">{h}</span>
              ))}
            </div>

            {mentionsArr.map(mention => {
              const isSelected = selectedMentionId === mention.id;
              return (
                <div
                  key={mention.id}
                  className={cn(
                    "grid grid-cols-1 md:grid-cols-[1fr_110px_90px_90px_75px_160px] gap-2 md:gap-3 px-4 py-2.5 items-center transition-colors cursor-pointer",
                    mention.status === "rejected" && "opacity-40",
                    isSelected ? "bg-amber-500/[0.05] border-l-2 border-amber-500/50" : "hover:bg-[#ffffff02]"
                  )}
                  onClick={() => setSelectedMentionId(isSelected ? null : mention.id)}
                >
                  {/* Name */}
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] text-white font-semibold uppercase truncate tracking-tight flex items-center gap-1.5">
                      {mention.entityName}
                      {isSelected && <ChevronRight className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                    </div>
                    {mention.context && (
                      <div className="font-mono text-[8px] text-neutral-700 mt-0.5 truncate">
                        {mention.context.slice(0, 80)}
                      </div>
                    )}
                  </div>

                  {/* Type */}
                  <div onClick={e => e.stopPropagation()}>
                    <TypeBadge type={(mention as any).entityType ?? "UNKNOWN"} />
                  </div>

                  {/* Confidence */}
                  <div onClick={e => e.stopPropagation()}>
                    {typeof mention.confidence === "number" ? (
                      <div className="flex flex-col gap-0.5">
                        <div className="h-1 bg-neutral-900 overflow-hidden w-16">
                          <div
                            className={cn(
                              "h-full transition-all",
                              mention.confidence >= 0.75 ? "bg-green-600" :
                              mention.confidence >= 0.5 ? "bg-amber-600" : "bg-red-700"
                            )}
                            style={{ width: `${Math.round(mention.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-[7px] text-neutral-600 tabular-nums">
                          {Math.round(mention.confidence * 100)}%
                        </span>
                      </div>
                    ) : (
                      <span className="font-mono text-[8px] text-neutral-700">—</span>
                    )}
                  </div>

                  {/* Case */}
                  <div onClick={e => e.stopPropagation()}>
                    {mention.caseId ? (
                      caseIds.has(mention.caseId) ? (
                        <Link href={`/cases/${mention.caseId}`}>
                          <span className="font-mono text-[8px] text-cyan-700 hover:text-cyan-400 uppercase tracking-wide flex items-center gap-1 cursor-pointer transition-colors">
                            <ChevronRight className="w-2.5 h-2.5" />
                            {caseMap[mention.caseId]?.slice(0, 14) ?? `CASE-${String(mention.caseId).padStart(6,"0")}`}
                          </span>
                        </Link>
                      ) : (
                        <span className="font-mono text-[8px] text-amber-800 uppercase tracking-wide flex items-center gap-1" title="Linked case not found">
                          <AlertTriangle className="w-2.5 h-2.5" /> NOT FOUND
                        </span>
                      )
                    ) : (
                      <span className="font-mono text-[8px] text-neutral-700">—</span>
                    )}
                  </div>

                  {/* Status */}
                  <div onClick={e => e.stopPropagation()}>
                    <StatusBadge status={mention.status} />
                  </div>

                  {/* Quick actions */}
                  <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    {mention.status === "pending" && (
                      <>
                        <button
                          onClick={() => handleDecision(mention.id, "approved")}
                          className="flex items-center gap-1 px-2 py-1 border border-green-900/50 bg-green-950/10 text-green-500 hover:bg-green-950/30 hover:border-green-700/50 font-mono text-[7px] uppercase tracking-widest transition-colors"
                        >
                          <CheckCircle className="w-2.5 h-2.5" /> OK
                        </button>
                        <button
                          onClick={() => handleDecision(mention.id, "rejected")}
                          className="flex items-center gap-1 px-2 py-1 border border-red-900/50 bg-red-950/10 text-red-600 hover:bg-red-950/30 hover:border-red-700/50 font-mono text-[7px] uppercase tracking-widest transition-colors"
                        >
                          <XCircle className="w-2.5 h-2.5" /> NO
                        </button>
                      </>
                    )}
                    {mention.status === "approved" && (
                      <button
                        onClick={() => handleDecision(mention.id, "rejected")}
                        className="flex items-center gap-1 px-2 py-1 border border-neutral-800 text-neutral-700 hover:text-red-600 hover:border-red-900/50 font-mono text-[7px] uppercase tracking-widest transition-colors"
                      >
                        <XCircle className="w-2.5 h-2.5" /> REVOKE
                      </button>
                    )}
                    {mention.status === "rejected" && (
                      <button
                        onClick={() => handleDecision(mention.id, "approved")}
                        className="flex items-center gap-1 px-2 py-1 border border-neutral-800 text-neutral-700 hover:text-green-500 hover:border-green-900/50 font-mono text-[7px] uppercase tracking-widest transition-colors"
                      >
                        <CheckCircle className="w-2.5 h-2.5" /> RESTORE
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedMentionId(isSelected ? null : mention.id)}
                      className="flex items-center gap-1 px-2 py-1 border border-amber-900/30 text-amber-700 hover:text-amber-400 hover:border-amber-700/40 font-mono text-[7px] uppercase tracking-widest transition-colors"
                      title="Open detail view"
                    >
                      <ChevronRight className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer summary */}
        {mentionsArr.length > 0 && (
          <div className="border-t border-[#ffffff06] px-4 py-2 flex items-center gap-4">
            <span className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest">SUMMARY:</span>
            {(["pending", "approved", "rejected", "held"] as const).map(s => {
              const count = mentionsArr.filter(m => m.status === s).length;
              const colors: Record<string, string> = {
                pending: "text-amber-600", approved: "text-green-600",
                rejected: "text-red-700", held: "text-violet-500"
              };
              return count > 0 ? (
                <span key={s} className={cn("font-mono text-[7px] uppercase tracking-widest", colors[s])}>
                  {count} {s}
                </span>
              ) : null;
            })}
          </div>
        )}
      </div>

      {/* Help text */}
      <div className="border border-[#ffffff06] bg-[#ffffff01] px-4 py-3">
        <div className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest mb-1">ABOUT THE TRIAGE QUEUE</div>
        <p className="font-mono text-[9px] text-neutral-600 leading-relaxed">
          ATLAS automatically extracts entities from ingested documents. Click any row to open the full analyst console.{" "}
          <span className="text-cyan-700">APPROVE</span> to promote into the entity registry,{" "}
          <span className="text-red-700">REJECT</span> to suppress, or{" "}
          <span className="text-amber-600">HOLD</span> for later review.
          Case links are validated — invalid links show a warning instead of a dead link.
        </p>
      </div>

      {/* Detail Panel */}
      {selectedMention && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setSelectedMentionId(null)}
          />
          <TriageDetailPanel
            mention={selectedMention as Mention}
            caseTitle={selectedMention.caseId ? (caseMap[selectedMention.caseId] ?? null) : null}
            caseExists={selectedMention.caseId ? caseIds.has(selectedMention.caseId) : false}
            document={selectedMention.documentId ? (docMap[selectedMention.documentId] ?? null) : null}
            onDecision={handleDecision}
            onDelete={handleDelete}
            onClose={() => setSelectedMentionId(null)}
          />
        </>
      )}
    </div>
  );
}
