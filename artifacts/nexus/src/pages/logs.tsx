import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, FileText, Globe, ScanLine, UserCheck, UserX, Link2, RefreshCw } from "lucide-react";
import { format } from "date-fns";

interface SystemLogEntry {
  id: number;
  eventType: string;
  message: string;
  caseId: number | null;
  entityId: number | null;
  documentId: number | null;
  createdAt: string;
}

const EVENT_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  document_ingested:   { icon: FileText,   color: "text-neutral-400",  label: "DOC INGESTED"     },
  web_source_ingested: { icon: Globe,      color: "text-cyan-500",     label: "WEB INGESTED"     },
  analysis_completed:  { icon: ScanLine,   color: "text-blue-400",     label: "ANALYSIS"         },
  entity_approved:     { icon: UserCheck,  color: "text-green-500",    label: "APPROVED"         },
  entity_rejected:     { icon: UserX,      color: "text-red-600",      label: "REJECTED"         },
  suggested_link:      { icon: Link2,      color: "text-cyan-700",     label: "LINK SUGGESTED"   },
};

function getEventConfig(eventType: string) {
  return EVENT_CONFIG[eventType] ?? { icon: Activity, color: "text-neutral-600", label: eventType.toUpperCase().replace(/_/g, " ") };
}

export default function SystemLog() {
  const { data: logs = [], isLoading, refetch } = useQuery<SystemLogEntry[]>({
    queryKey: ["/api/system-log"],
    queryFn: () => fetch("/api/system-log").then((r) => r.json()),
    refetchInterval: 15000,
  });

  return (
    <div className="max-w-4xl mx-auto space-y-3">
      <div className="border-b border-[#ffffff0d] pb-3 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white uppercase">
            SYSTEM LOG
          </h1>
          <p className="text-neutral-600 tracking-widest text-[9px] font-mono mt-0.5 uppercase">
            ATLAS-CORE // AUDIT &amp; ACTIVITY TRACE
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-neutral-600 hover:text-white font-mono text-[9px] uppercase tracking-widest transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          REFRESH
        </button>
      </div>

      {isLoading ? (
        <div className="border border-dashed border-[#ffffff0d] py-12 flex flex-col items-center justify-center gap-3">
          <Activity className="w-5 h-5 text-neutral-800 animate-pulse" />
          <div className="font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
            LOADING ACTIVITY LOG...
          </div>
        </div>
      ) : logs.length === 0 ? (
        <div className="border border-dashed border-[#ffffff0d] py-16 flex flex-col items-center justify-center gap-3">
          <Activity className="w-6 h-6 text-neutral-800" />
          <div className="font-mono text-[10px] text-neutral-600 uppercase tracking-widest">
            NO ACTIVITY RECORDED
          </div>
          <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
            System events will appear here as operations are performed
          </div>
        </div>
      ) : (
        <div className="space-y-0 border border-[#ffffff0d]">
          {logs.map((entry, idx) => {
            const cfg = getEventConfig(entry.eventType);
            const Icon = cfg.icon;
            const isLast = idx === logs.length - 1;
            return (
              <div
                key={entry.id}
                className={`flex items-start gap-3 px-4 py-3 hover:bg-[#ffffff03] transition-colors ${
                  !isLast ? "border-b border-[#ffffff06]" : ""
                }`}
              >
                {/* Timestamp col */}
                <div className="w-36 flex-shrink-0 pt-0.5">
                  <div className="font-mono text-[9px] text-neutral-700 tabular-nums">
                    {format(new Date(entry.createdAt), "yyyy-MM-dd")}
                  </div>
                  <div className="font-mono text-[8px] text-neutral-800 tabular-nums">
                    {format(new Date(entry.createdAt), "HH:mm:ss")}
                  </div>
                </div>

                {/* Icon + badge */}
                <div className="flex-shrink-0 pt-0.5">
                  <div className={`flex items-center gap-1.5 ${cfg.color}`}>
                    <Icon className="w-3 h-3" />
                    <span className="font-mono text-[8px] uppercase tracking-widest opacity-80">
                      {cfg.label}
                    </span>
                  </div>
                </div>

                {/* Message */}
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[11px] text-neutral-300 leading-relaxed">
                    {entry.message}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {entry.caseId && (
                      <span className="font-mono text-[8px] text-neutral-700">
                        CASE #{entry.caseId}
                      </span>
                    )}
                    {entry.documentId && (
                      <span className="font-mono text-[8px] text-neutral-700">
                        DOC #{entry.documentId}
                      </span>
                    )}
                    {entry.entityId && (
                      <span className="font-mono text-[8px] text-neutral-700">
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

      {logs.length > 0 && (
        <div className="font-mono text-[9px] text-neutral-800 uppercase tracking-widest text-right">
          {logs.length} EVENT{logs.length !== 1 ? "S" : ""} RECORDED
        </div>
      )}
    </div>
  );
}
