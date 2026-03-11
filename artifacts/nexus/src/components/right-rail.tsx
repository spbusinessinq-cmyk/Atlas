import React from "react";
import { Activity, Database, FileText, Link2, Clock, Cpu } from "lucide-react";

interface RightRailProps {
  entities?: number;
  documents?: number;
  relationships?: number;
  timeline?: number;
  moneyFlows?: number;
  pendingMentions?: number;
  caseStatus?: string;
}

const STATUS_COLORS: Record<string, string> = {
  open: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  active: "text-red-500 bg-red-500/10 border-red-500/30",
  closed: "text-neutral-400 bg-neutral-500/10 border-neutral-500/30",
  archived: "text-amber-500 bg-amber-500/10 border-amber-500/30",
};

export function RightRail({
  entities = 0,
  documents = 0,
  relationships = 0,
  timeline = 0,
  moneyFlows = 0,
  pendingMentions = 0,
  caseStatus,
}: RightRailProps) {
  const metrics = [
    { icon: Database, label: "ENTITIES", value: entities, color: "text-cyan-500" },
    { icon: FileText, label: "DOCUMENTS", value: documents, color: "text-neutral-400" },
    { icon: Link2, label: "LINKS", value: relationships, color: "text-amber-500" },
    { icon: Clock, label: "TIMELINE", value: timeline, color: "text-purple-400" },
    { icon: Activity, label: "MONEY FLOWS", value: moneyFlows, color: "text-green-500" },
  ];

  return (
    <div className="w-56 flex-shrink-0 flex flex-col gap-3 hidden xl:flex">
      {/* Case Status */}
      <div className="nexus-panel rounded-none">
        <div className="nexus-header-strip">
          <span className="nexus-label">CASE STATUS</span>
        </div>
        <div className="p-3 space-y-1">
          {caseStatus && (
            <div className={`inline-flex items-center gap-1.5 px-2 py-1 border font-mono text-[9px] uppercase tracking-widest ${STATUS_COLORS[caseStatus] || STATUS_COLORS.open}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {caseStatus}
            </div>
          )}
          {metrics.map((m) => (
            <div
              key={m.label}
              className="flex items-center justify-between py-1.5 border-b border-[#ffffff05] last:border-0"
            >
              <div className="flex items-center gap-2">
                <m.icon className={`w-3 h-3 ${m.color}`} />
                <span className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest">
                  {m.label}
                </span>
              </div>
              <span className="font-mono text-[11px] font-bold text-white tabular-nums">
                {m.value.toString().padStart(2, "0")}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ATLAS Status */}
      {pendingMentions > 0 && (
        <div className="nexus-panel rounded-none border-orange-500/20">
          <div className="nexus-header-strip border-orange-500/10 bg-orange-500/5">
            <span className="nexus-label flex items-center gap-1.5 text-orange-500">
              <Cpu className="w-3 h-3" />
              ATLAS PENDING
            </span>
            <span className="font-mono text-[11px] font-bold text-orange-400 tabular-nums">
              {pendingMentions}
            </span>
          </div>
          <div className="px-3 py-2">
            <p className="font-mono text-[9px] text-neutral-600 uppercase tracking-wider leading-relaxed">
              Entity detections awaiting triage in Document Vault
            </p>
          </div>
        </div>
      )}

      {/* Feed empty state if nothing notable */}
      {pendingMentions === 0 && entities === 0 && documents === 0 && (
        <div className="nexus-panel rounded-none">
          <div className="nexus-header-strip">
            <span className="nexus-label">SIGNAL FEED</span>
          </div>
          <div className="px-3 py-6 text-center font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
            NO ACTIVITY
            <br />
            RECORDED
          </div>
        </div>
      )}
    </div>
  );
}
