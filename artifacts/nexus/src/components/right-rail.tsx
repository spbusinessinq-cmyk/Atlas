import React from "react";
import { Activity, FileText, Users, AlertTriangle, PenTool } from "lucide-react";

export function RightRail() {
  const activities = [
    { type: 'DOC_INGEST', desc: 'File "Bank_Statement_Q3.pdf" attached to operation', time: '10:42 AM', icon: FileText, color: 'text-[#0891b2]' },
    { type: 'ENTITY_LINKED', desc: 'New association identified: VICTOR_K', time: '09:15 AM', icon: Users, color: 'text-[#16a34a]' },
    { type: 'ORION_MATCH', desc: 'Cross-reference detected in ORION global feed', time: 'YESTERDAY', icon: Activity, color: 'text-[#dc2626]' },
    { type: 'NOTE_UPDATE', desc: 'Analyst logs updated by SYSTEM_ADMIN', time: 'YESTERDAY', icon: PenTool, color: 'text-muted-foreground' },
    { type: 'FLAG', desc: 'Confidence threshold below 40% on relation', time: '2 DAYS AGO', icon: AlertTriangle, color: 'text-[#d97706]' },
  ];

  return (
    <div className="w-72 flex-shrink-0 flex flex-col gap-4 hidden xl:flex">
      <div className="nexus-panel rounded-none flex-1">
        <div className="nexus-header-strip">
          <span className="nexus-label">// CASE SIGNALS</span>
          <Activity className="w-3 h-3 text-muted-foreground" />
        </div>
        <div className="p-3 space-y-3">
          {activities.map((act, i) => (
            <div key={i} className="flex flex-col gap-1 pb-3 border-b border-[#ffffff0d] last:border-0 last:pb-0">
              <div className="flex items-center justify-between">
                <div className={`flex items-center gap-1.5 font-mono text-[10px] ${act.color}`}>
                  <act.icon className="w-3 h-3" />
                  {act.type}
                </div>
                <span className="font-mono text-[9px] text-muted-foreground">{act.time}</span>
              </div>
              <div className="text-xs text-neutral-400 leading-snug">{act.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
