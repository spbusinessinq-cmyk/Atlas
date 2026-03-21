import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListEntityMentions, useListCases } from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle, XCircle, Clock, ChevronRight, Cpu, Filter, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

type MentionStatus = "pending" | "approved" | "rejected";

function StatusBadge({ status }: { status: MentionStatus }) {
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
  return (
    <span className="flex items-center gap-1 font-mono text-[8px] text-amber-500 uppercase tracking-widest animate-pulse">
      <Clock className="w-2.5 h-2.5" /> PENDING
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colours: Record<string, string> = {
    PERSON: "text-cyan-500 border-cyan-900/40 bg-cyan-950/10",
    ORGANIZATION: "text-violet-400 border-violet-900/40 bg-violet-950/10",
    LOCATION: "text-emerald-500 border-emerald-900/40 bg-emerald-950/10",
    FINANCIAL_INSTRUMENT: "text-amber-400 border-amber-900/40 bg-amber-950/10",
    GOVERNMENT_BODY: "text-red-400 border-red-900/40 bg-red-950/10",
    LEGAL_ENTITY: "text-orange-400 border-orange-900/40 bg-orange-950/10",
  };
  const cls = colours[type] ?? "text-neutral-500 border-neutral-800 bg-neutral-900/20";
  return (
    <span className={cn("px-1.5 py-0.5 border font-mono text-[7px] uppercase tracking-widest", cls)}>
      {type.replace(/_/g, " ")}
    </span>
  );
}

export default function TriagePage() {
  const [statusFilter, setStatusFilter] = useState<"pending" | "all">("pending");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const { data: mentions, isLoading } = useListEntityMentions(
    statusFilter === "pending" ? { status: "pending" } : {}
  );
  const { data: cases } = useListCases();

  const caseMap = React.useMemo(() => {
    const m: Record<number, string> = {};
    cases?.forEach(c => { m[c.id] = c.title; });
    return m;
  }, [cases]);

  const handleDecision = async (mentionId: number, decision: "approved" | "rejected") => {
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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const pending = mentions?.filter(m => m.status === "pending") ?? [];
  const total = mentions?.length ?? 0;

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
        ) : !mentions || mentions.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-3">
            <CheckCircle className="w-8 h-8 text-green-900" />
            <div className="font-mono text-[10px] text-neutral-600 uppercase tracking-widest">
              {statusFilter === "pending" ? "TRIAGE QUEUE CLEAR — NO PENDING MENTIONS" : "NO MENTIONS IN REGISTRY"}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[#ffffff04]">
            {/* Column headers */}
            <div className="hidden md:grid grid-cols-[1fr_120px_100px_100px_80px_180px] gap-3 px-4 py-1.5 bg-[#ffffff01]">
              {["ENTITY NAME", "TYPE", "CONFIDENCE", "CASE", "STATUS", "ACTIONS"].map(h => (
                <span key={h} className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest">{h}</span>
              ))}
            </div>

            {mentions.map(mention => (
              <div
                key={mention.id}
                className={cn(
                  "grid grid-cols-1 md:grid-cols-[1fr_120px_100px_100px_80px_180px] gap-2 md:gap-3 px-4 py-2.5 items-center hover:bg-[#ffffff02] transition-colors",
                  mention.status === "rejected" && "opacity-40"
                )}
              >
                {/* Name */}
                <div className="min-w-0">
                  <div className="font-mono text-[11px] text-white font-semibold uppercase truncate tracking-tight">
                    {mention.entityName}
                  </div>
                  {mention.context && (
                    <div className="font-mono text-[8px] text-neutral-700 mt-0.5 truncate">
                      {mention.context.slice(0, 90)}
                    </div>
                  )}
                </div>

                {/* Type */}
                <div>
                  <TypeBadge type={mention.entityType ?? "UNKNOWN"} />
                </div>

                {/* Confidence */}
                <div>
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
                <div>
                  {mention.caseId ? (
                    <Link href={`/cases/${mention.caseId}`}>
                      <span className="font-mono text-[8px] text-cyan-700 hover:text-cyan-400 uppercase tracking-wide flex items-center gap-1 cursor-pointer transition-colors">
                        <ChevronRight className="w-2.5 h-2.5" />
                        {caseMap[mention.caseId]?.slice(0, 18) ?? `CASE-${String(mention.caseId).padStart(6,"0")}`}
                      </span>
                    </Link>
                  ) : (
                    <span className="font-mono text-[8px] text-neutral-700">—</span>
                  )}
                </div>

                {/* Status */}
                <StatusBadge status={mention.status as MentionStatus} />

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  {mention.status === "pending" && (
                    <>
                      <button
                        onClick={() => handleDecision(mention.id, "approved")}
                        className="flex items-center gap-1 px-2 py-1 border border-green-900/50 bg-green-950/10 text-green-500 hover:bg-green-950/30 hover:border-green-700/50 font-mono text-[8px] uppercase tracking-widest transition-colors"
                      >
                        <CheckCircle className="w-2.5 h-2.5" /> CONFIRM
                      </button>
                      <button
                        onClick={() => handleDecision(mention.id, "rejected")}
                        className="flex items-center gap-1 px-2 py-1 border border-red-900/50 bg-red-950/10 text-red-600 hover:bg-red-950/30 hover:border-red-700/50 font-mono text-[8px] uppercase tracking-widest transition-colors"
                      >
                        <XCircle className="w-2.5 h-2.5" /> REJECT
                      </button>
                    </>
                  )}
                  {mention.status === "approved" && (
                    <button
                      onClick={() => handleDecision(mention.id, "rejected")}
                      className="flex items-center gap-1 px-2 py-1 border border-neutral-800 text-neutral-700 hover:text-red-600 hover:border-red-900/50 font-mono text-[8px] uppercase tracking-widest transition-colors"
                    >
                      <XCircle className="w-2.5 h-2.5" /> REVOKE
                    </button>
                  )}
                  {mention.status === "rejected" && (
                    <button
                      onClick={() => handleDecision(mention.id, "approved")}
                      className="flex items-center gap-1 px-2 py-1 border border-neutral-800 text-neutral-700 hover:text-green-500 hover:border-green-900/50 font-mono text-[8px] uppercase tracking-widest transition-colors"
                    >
                      <CheckCircle className="w-2.5 h-2.5" /> RESTORE
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer summary */}
        {mentions && mentions.length > 0 && (
          <div className="border-t border-[#ffffff06] px-4 py-2 flex items-center gap-4">
            <span className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest">
              SUMMARY:
            </span>
            {(["pending", "approved", "rejected"] as const).map(s => {
              const count = mentions.filter(m => m.status === s).length;
              const colors = { pending: "text-amber-600", confirmed: "text-green-600", rejected: "text-red-700" };
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
          ATLAS automatically extracts entities from ingested documents. The triage queue shows all extracted entity mentions
          awaiting analyst review. <span className="text-cyan-700">CONFIRM</span> to promote an entity into the active registry,
          or <span className="text-red-700">REJECT</span> to suppress it. Confirmed entities become available in the case graph
          and relationship analysis.
        </p>
      </div>
    </div>
  );
}
