import React, { useMemo, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useGetEntity } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  FileText,
  Globe,
  Calendar,
  Hash,
  Layers,
  Search,
  ExternalLink,
  Clock,
  ChevronRight,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
import { logEvent as sendLog } from "@/lib/log-event";

const TYPE_COLORS: Record<string, string> = {
  person: "text-cyan-500 border-cyan-500/30",
  organization: "text-amber-500 border-amber-500/30",
  company: "text-green-500 border-green-500/30",
  government_agency: "text-red-500 border-red-500/30",
  location: "text-purple-500 border-purple-500/30",
  event: "text-blue-500 border-blue-500/30",
  other: "text-neutral-400 border-neutral-500/30",
};

const TYPE_HEX: Record<string, string> = {
  person: "#06b6d4",
  organization: "#f59e0b",
  company: "#22c55e",
  government_agency: "#ef4444",
  location: "#a855f7",
  event: "#3b82f6",
  other: "#737373",
};

function generateExpansionSuggestions(name: string, type: string): string[] {
  const base = name.replace(/"/g, "");
  const suggestions: string[] = [];
  const nameLower = base.toLowerCase();

  if (nameLower.includes("hotel") || nameLower.includes("motel") || nameLower.includes("inn")) {
    suggestions.push(`"${base}" homelessness program`);
    suggestions.push(`"${base}" Project Homekey contract`);
    suggestions.push(`"${base}" interim housing Los Angeles`);
    suggestions.push(`"${base}" LAHSA contract`);
  } else if (
    nameLower.includes("homeless") ||
    nameLower.includes("lahsa") ||
    nameLower.includes("housing authority")
  ) {
    suggestions.push(`"${base}" hotel contracts`);
    suggestions.push(`"${base}" Project Homekey`);
    suggestions.push(`"${base}" interim housing providers`);
    suggestions.push(`"${base}" budget oversight`);
  } else if (nameLower.includes("project") || nameLower.includes("program")) {
    suggestions.push(`"${base}" Los Angeles funding`);
    suggestions.push(`"${base}" hotel acquisitions`);
    suggestions.push(`"${base}" budget recipients`);
    suggestions.push(`"${base}" accountability`);
  } else if (type === "government_agency" || nameLower.includes("department") || nameLower.includes("office")) {
    suggestions.push(`"${base}" contract`);
    suggestions.push(`"${base}" budget investigation`);
    suggestions.push(`"${base}" nonprofit`);
    suggestions.push(`"${base}" Los Angeles oversight`);
  } else {
    suggestions.push(`"${base}" Los Angeles`);
    suggestions.push(`"${base}" contract funding`);
    suggestions.push(`"${base}" investigation`);
    suggestions.push(`"${base}" nonprofit accountability`);
  }

  return suggestions.slice(0, 4);
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return format(new Date(d), "yyyy-MM-dd");
}

export default function EntityProfile() {
  const { id } = useParams();
  const entityId = parseInt(id || "0", 10);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useGetEntity(entityId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const entity = profile?.entity;
  const relationships: any[] = (profile as any)?.relationships || [];
  const timelineAppearances: any[] = (profile as any)?.timelineAppearances || [];
  const mentions: any[] = (profile as any)?.mentions || [];
  const mentionCounts = (profile as any)?.mentionCounts || { total: 0, approved: 0, pending: 0, rejected: 0 };
  const firstSeen = ((profile as any)?.firstSeen as string | null) ?? null;
  const lastSeen = ((profile as any)?.lastSeen as string | null) ?? null;
  const linkedDocuments: any[] = (profile as any)?.linkedDocuments || [];
  const coMentioned: { name: string; count: number; score: string }[] = (profile as any)?.coMentioned || [];
  const financialSignals: any[] = (profile as any)?.financialSignals || [];

  const expansionSuggestions = useMemo(
    () => entity ? generateExpansionSuggestions(entity.name, entity.type) : [],
    [entity?.name, entity?.type]
  );

  React.useEffect(() => {
    if (entity) {
      sendLog("info", `Dossier opened: ${entity.name}`, {
        caseId: entity.caseId ?? undefined,
        entityId: entity.id,
      });
    }
  }, [entity?.id]);

  if (isLoading) {
    return (
      <div className="p-8 text-orange-500 font-mono animate-pulse text-sm tracking-widest uppercase">
        COMPILING DOSSIER...
      </div>
    );
  }
  if (!profile || !entity) {
    return (
      <div className="p-8 text-red-500 font-mono text-sm">ERROR 404: IDENTITY EXPUNGED.</div>
    );
  }

  const approvedMentions = mentions.filter((m: any) => m.status === "approved");

  const color = TYPE_HEX[entity.type] || TYPE_HEX.other;
  const typeClass = TYPE_COLORS[entity.type] || TYPE_COLORS.other;

  const handleEntityDelete = async () => {
    setIsDeleting(true);
    try {
      await fetch(`/api/entities/${entity.id}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ["/api/entities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      const returnTo = entity.caseId ? `/cases/${entity.caseId}` : "/entities";
      navigate(returnTo);
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleExpand = (query: string) => {
    if (!entity.caseId) return;
    sendLog("info", `Expansion triggered: ${query}`, {
      caseId: entity.caseId,
      entityId: entity.id,
    });
    sessionStorage.setItem("atlas_expansion_query", query);
    navigate(`/cases/${entity.caseId}`);
  };

  const handleOpenDoc = (doc: any) => {
    if (!doc.caseId) return;
    sessionStorage.setItem("atlas_pending_doc", String(doc.id));
    navigate(`/cases/${doc.caseId}`);
  };

  const scoreColor = (s: string) =>
    s === "HIGH" ? "text-red-400" : s === "MEDIUM" ? "text-orange-400" : "text-neutral-600";
  const scoreBorder = (s: string) =>
    s === "HIGH" ? "border-red-500/20" : s === "MEDIUM" ? "border-orange-500/20" : "border-[#ffffff06]";

  const statusColor = (s: string) =>
    s === "approved" ? "text-green-500" : s === "rejected" ? "text-red-600" : "text-orange-500";

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-12">
      <Link href="/entities">
        <button className="text-[10px] font-mono text-neutral-600 hover:text-white uppercase tracking-widest flex items-center gap-2 transition-colors">
          <ArrowLeft className="w-3 h-3" /> RETURN TO REGISTRY
        </button>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* ── LEFT COLUMN (3 cols) ── */}
        <div className="lg:col-span-3 space-y-5">

          {/* Identity Header */}
          <div className="nexus-panel rounded-none">
            <div className="nexus-header-strip">
              <span className="nexus-label">// CLEARANCE: INTERNAL</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-neutral-600">
                  ID:{entity.id.toString().padStart(8, "0")}
                </span>
                {confirmDelete ? (
                  <div className="flex items-center gap-1 border border-red-800/50 bg-red-950/30 px-1.5 py-0.5">
                    <span className="font-mono text-[8px] text-red-400 uppercase tracking-wider">EXPUNGE?</span>
                    <button
                      onClick={handleEntityDelete}
                      disabled={isDeleting}
                      className="font-mono text-[8px] text-red-400 hover:text-red-300 uppercase px-1 hover:bg-red-500/20 transition-colors"
                    >
                      {isDeleting ? "…" : "CONFIRM"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="font-mono text-[8px] text-neutral-600 hover:text-neutral-400 uppercase px-1"
                    >
                      CANCEL
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="p-0.5 text-neutral-700 hover:text-red-500 transition-colors"
                    title="Expunge entity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            <div className="p-5">
              <div className="flex items-start gap-4 mb-4">
                <div
                  className="w-10 h-10 flex items-center justify-center text-lg font-bold border flex-shrink-0"
                  style={{ borderColor: `${color}40`, background: `${color}10`, color }}
                >
                  {entity.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-white uppercase leading-tight tracking-tight">
                    {entity.name}
                  </h1>
                  <span
                    className={`inline-block mt-1.5 text-[10px] font-mono uppercase px-2 py-0.5 border ${typeClass}`}
                  >
                    {entity.type.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
              <div className="text-sm text-neutral-500 leading-relaxed">
                {entity.description || "No supplemental intelligence recorded for this identity."}
              </div>
              {entity.aliases && entity.aliases.length > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="text-[9px] font-mono text-neutral-700 uppercase tracking-widest">
                    KNOWN ALIASES
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {entity.aliases.map((a: string) => (
                      <span
                        key={a}
                        className="px-2 py-0.5 bg-[#000] border border-[#ffffff10] text-[10px] font-mono text-neutral-400"
                      >
                        AKA: {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Dossier Summary Stats */}
          <div className="nexus-panel rounded-none">
            <div className="nexus-header-strip">
              <span className="nexus-label">DOSSIER SUMMARY</span>
            </div>
            <div className="grid grid-cols-4 divide-x divide-[#ffffff06]">
              {[
                { label: "TOTAL MENTIONS", value: mentionCounts.total, color: "text-white" },
                { label: "APPROVED", value: mentionCounts.approved, color: "text-green-500" },
                { label: "LINKED DOCS", value: linkedDocuments.length, color: "text-cyan-500" },
                { label: "PENDING", value: mentionCounts.pending, color: "text-orange-500" },
              ].map((stat) => (
                <div key={stat.label} className="p-3 text-center">
                  <div className={`font-mono text-xl font-bold tabular-nums ${stat.color}`}>
                    {stat.value.toString().padStart(2, "0")}
                  </div>
                  <div className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest mt-0.5">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Linked Documents */}
          <div className="nexus-panel rounded-none">
            <div className="nexus-header-strip">
              <span className="nexus-label">
                LINKED DOCUMENTS ({linkedDocuments.length})
              </span>
            </div>
            <div className="p-0">
              {linkedDocuments.length === 0 ? (
                <div className="p-5 text-[10px] font-mono text-neutral-700 uppercase tracking-widest">
                  NO LINKED DOCUMENTS YET
                </div>
              ) : (
                linkedDocuments.map((doc: any) => (
                  <div
                    key={doc.id}
                    className="flex items-start gap-3 px-4 py-3 border-b border-[#ffffff05] hover:bg-[#ffffff02] group"
                  >
                    {doc.ingestMethod === "web" ? (
                      <Globe className="w-3.5 h-3.5 text-cyan-700 mt-0.5 flex-shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-neutral-700 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium truncate leading-tight">
                        {doc.title}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {doc.sourceDomain && (
                          <span className="text-[9px] font-mono text-cyan-700">
                            {doc.sourceDomain}
                          </span>
                        )}
                        <span className="text-[9px] font-mono text-neutral-700">
                          {fmtDate(doc.uploadedAt)}
                        </span>
                        <span className="text-[9px] font-mono text-neutral-600">
                          {doc.mentionCount} MENTION{doc.mentionCount !== 1 ? "S" : ""}
                        </span>
                      </div>
                    </div>
                    {doc.caseId && (
                      <button
                        onClick={() => handleOpenDoc(doc)}
                        className="text-[9px] font-mono text-neutral-700 hover:text-white flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        OPEN <ChevronRight className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Mention Log */}
          <div className="nexus-panel rounded-none">
            <div className="nexus-header-strip">
              <span className="nexus-label">MENTION LOG ({mentions.length})</span>
            </div>
            <div className="p-0">
              {mentions.length === 0 ? (
                <div className="p-5 text-[10px] font-mono text-neutral-700 uppercase tracking-widest">
                  NO MENTIONS RECORDED
                </div>
              ) : (
                [...mentions]
                  .sort(
                    (a: any, b: any) =>
                      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                  )
                  .slice(0, 20)
                  .map((m: any) => {
                    const confPct = m.confidence ? Math.round(m.confidence * 100) : null;
                    const doc = linkedDocuments.find((d: any) => d.id === m.documentId);
                    return (
                      <div
                        key={m.id}
                        className="px-4 py-2.5 border-b border-[#ffffff04] space-y-1"
                      >
                        <div className="flex items-center gap-2">
                          {doc?.ingestMethod === "web" ? (
                            <Globe className="w-2.5 h-2.5 text-cyan-800 flex-shrink-0" />
                          ) : (
                            <FileText className="w-2.5 h-2.5 text-neutral-700 flex-shrink-0" />
                          )}
                          <span className="text-[10px] font-mono text-neutral-400 flex-1 truncate">
                            {doc?.title || `DOC-${m.documentId.toString().padStart(4, "0")}`}
                          </span>
                          {doc?.sourceDomain && (
                            <span className="text-[8px] font-mono text-cyan-800">
                              {doc.sourceDomain}
                            </span>
                          )}
                        </div>
                        {m.context && (
                          <div className="text-[9px] font-mono text-neutral-600 italic leading-relaxed line-clamp-2 pl-4">
                            &ldquo;{m.context}&rdquo;
                          </div>
                        )}
                        <div className="flex items-center gap-3 pl-4">
                          <span
                            className={`text-[8px] font-mono uppercase font-bold ${statusColor(m.status)}`}
                          >
                            {m.status}
                          </span>
                          {confPct !== null && (
                            <span className="text-[8px] font-mono text-neutral-700">
                              CONF: {confPct}%
                            </span>
                          )}
                          <span className="text-[8px] font-mono text-neutral-800 ml-auto">
                            {format(new Date(m.createdAt), "MM/dd/yyyy")}
                          </span>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          {/* Relationships */}
          <div className="nexus-panel rounded-none">
            <div className="nexus-header-strip">
              <span className="nexus-label">
                CONFIRMED RELATIONSHIPS ({relationships.length})
              </span>
            </div>
            <div className="p-0">
              {relationships.length === 0 ? (
                <div className="p-5 text-[10px] font-mono text-neutral-700 uppercase tracking-widest">
                  NO CONFIRMED RELATIONSHIPS RECORDED
                </div>
              ) : (
                relationships.map((rel: any) => {
                  const isA = rel.entityAId === entity.id;
                  const otherName = isA ? rel.entityBName : rel.entityAName;
                  const otherId = isA ? rel.entityBId : rel.entityAId;
                  return (
                    <div
                      key={rel.id}
                      className="flex items-center justify-between px-4 py-2.5 border-b border-[#ffffff05] hover:bg-[#ffffff02]"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-[9px] font-mono uppercase text-red-500 border border-red-500/30 px-1.5 py-0.5 bg-red-500/5">
                          {rel.relationshipType}
                        </span>
                        <span className="text-sm text-white font-medium uppercase">
                          {otherName}
                        </span>
                      </div>
                      <Link href={`/entities/${otherId}`}>
                        <button className="text-[9px] font-mono text-neutral-600 hover:text-white transition-colors">
                          VIEW →
                        </button>
                      </Link>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="nexus-panel rounded-none">
            <div className="nexus-header-strip">
              <span className="nexus-label">TIMELINE APPEARANCES ({timelineAppearances.length})</span>
            </div>
            <div className="p-4 space-y-3">
              {timelineAppearances.length === 0 ? (
                <div className="text-[10px] font-mono text-neutral-700 uppercase tracking-widest">
                  NO TIMELINE ACTIVITY RECORDED
                </div>
              ) : (
                timelineAppearances.map((t: any) => (
                  <div key={t.id} className="flex gap-3">
                    <div className="w-1.5 h-1.5 bg-red-600 rounded-full mt-1.5 shrink-0" />
                    <div>
                      <div className="text-[10px] font-mono text-red-500 mb-0.5">
                        {t.eventDate ? format(new Date(t.eventDate), "yyyy-MM-dd") : "DATE UNKNOWN"}
                      </div>
                      <div className="text-sm text-white">{t.title}</div>
                      {t.description && (
                        <div className="text-[10px] font-mono text-neutral-600 mt-0.5">
                          {t.description}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN (2 cols) ── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Metadata */}
          <div className="nexus-panel rounded-none">
            <div className="nexus-header-strip">
              <span className="nexus-label">METADATA</span>
            </div>
            <div className="p-4 space-y-2.5 font-mono text-[11px] uppercase">
              <div className="flex justify-between border-b border-[#ffffff08] pb-2">
                <span className="text-neutral-600">SYSTEM ID</span>
                <span className="text-white">{entity.id.toString().padStart(8, "0")}</span>
              </div>
              <div className="flex justify-between border-b border-[#ffffff08] pb-2">
                <span className="text-neutral-600">TYPE</span>
                <span className={typeClass.split(" ")[0]}>
                  {entity.type.replace(/_/g, " ")}
                </span>
              </div>
              {firstSeen && (
                <div className="flex justify-between border-b border-[#ffffff08] pb-2">
                  <span className="text-neutral-600">FIRST SEEN</span>
                  <span className="text-neutral-300 flex items-center gap-1">
                    <Calendar className="w-2.5 h-2.5" />
                    {fmtDate(firstSeen)}
                  </span>
                </div>
              )}
              {lastSeen && (
                <div className="flex justify-between border-b border-[#ffffff08] pb-2">
                  <span className="text-neutral-600">LAST SEEN</span>
                  <span className="text-neutral-300 flex items-center gap-1">
                    <Calendar className="w-2.5 h-2.5" />
                    {fmtDate(lastSeen)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-b border-[#ffffff08] pb-2">
                <span className="text-neutral-600">REGISTERED</span>
                <span className="text-neutral-300">{fmtDate(entity.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-600">PRIMARY OP</span>
                {entity.caseId ? (
                  <Link href={`/cases/${entity.caseId}`}>
                    <span className="text-red-500 hover:text-red-400 cursor-pointer">
                      OP_{entity.caseId.toString().padStart(4, "0")}
                    </span>
                  </Link>
                ) : (
                  <span className="text-neutral-700">UNLINKED</span>
                )}
              </div>
            </div>
          </div>

          {/* Related Signal */}
          <div className="nexus-panel rounded-none">
            <div className="nexus-header-strip">
              <span className="nexus-label">RELATED SIGNAL ({coMentioned.length})</span>
            </div>
            <div className="p-0">
              {coMentioned.length === 0 ? (
                <div className="p-4 text-[10px] font-mono text-neutral-700 uppercase tracking-widest">
                  NO CO-MENTION DATA YET
                </div>
              ) : (
                coMentioned.map((ce) => (
                  <div
                    key={ce.name}
                    className={`flex items-center gap-2.5 px-3 py-2 border-b border-[#ffffff04] ${scoreBorder(ce.score)}`}
                  >
                    <div
                      className={`text-[8px] font-mono uppercase font-bold px-1.5 py-0.5 border flex-shrink-0 ${scoreColor(ce.score)} ${scoreBorder(ce.score)}`}
                    >
                      {ce.score}
                    </div>
                    <span className="text-[10px] font-mono text-white flex-1 truncate uppercase">
                      {ce.name}
                    </span>
                    <span className="text-[9px] font-mono text-neutral-700 flex-shrink-0">
                      {ce.count}×
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Financial Signals */}
          {financialSignals.length > 0 && (
            <div className="nexus-panel rounded-none">
              <div className="nexus-header-strip">
                <span className="nexus-label">FINANCIAL SIGNALS ({financialSignals.length})</span>
                <span className="font-mono text-[8px] text-green-500 uppercase">AUTO-DETECTED</span>
              </div>
              <div className="p-0">
                {financialSignals.map((sig: any) => (
                  <div key={sig.id} className="px-3 py-2.5 border-b border-[#ffffff04] space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 border border-[#ffffff10] text-neutral-500">
                        {sig.signalType?.replace(/_/g, " ") || "SIGNAL"}
                      </span>
                      {sig.amountRaw && (
                        <span className="text-sm font-bold text-green-400 font-mono ml-auto">
                          {sig.currency || "USD"}&nbsp;{sig.amountRaw}
                        </span>
                      )}
                    </div>
                    {sig.eventSummary && (
                      <p className="text-[10px] text-neutral-500 leading-relaxed">{sig.eventSummary}</p>
                    )}
                    {sig.documentTitle && (
                      <div className="font-mono text-[8px] text-neutral-700 uppercase">
                        SRC: {sig.documentTitle}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Expansion Suggestions */}
          {entity.caseId && (
            <div className="nexus-panel rounded-none">
              <div className="nexus-header-strip">
                <span className="nexus-label flex items-center gap-1.5">
                  <Search className="w-3 h-3" />
                  EXPANSION SUGGESTIONS
                </span>
              </div>
              <div className="p-3 space-y-2">
                <div className="text-[9px] font-mono text-neutral-700 uppercase tracking-widest">
                  CLICK TO LAUNCH TARGETED SEARCH
                </div>
                {expansionSuggestions.map((query, i) => (
                  <button
                    key={i}
                    onClick={() => handleExpand(query)}
                    className="w-full text-left flex items-center gap-2 p-2.5 border border-[#ffffff08] hover:border-cyan-500/30 hover:bg-cyan-500/5 group transition-all"
                  >
                    <Search className="w-2.5 h-2.5 text-neutral-700 group-hover:text-cyan-600 flex-shrink-0" />
                    <span className="text-[10px] font-mono text-neutral-500 group-hover:text-cyan-400 flex-1 transition-colors leading-relaxed">
                      {query}
                    </span>
                    <ChevronRight className="w-3 h-3 text-neutral-800 group-hover:text-cyan-600 flex-shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
