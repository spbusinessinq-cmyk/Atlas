import React from "react";
import { Activity } from "lucide-react";

export default function SystemLog() {
  return (
    <div className="max-w-7xl mx-auto space-y-3">
      <div className="border-b border-[#ffffff0d] pb-3">
        <h1 className="text-xl font-bold tracking-tight text-white uppercase">
          SYSTEM LOG
        </h1>
        <p className="text-neutral-600 tracking-widest text-[9px] font-mono mt-0.5 uppercase">
          ATLAS-CORE // AUDIT &amp; ACTIVITY TRACE
        </p>
      </div>

      <div className="border border-dashed border-[#ffffff0d] py-16 flex flex-col items-center justify-center gap-3">
        <Activity className="w-6 h-6 text-neutral-800" />
        <div className="font-mono text-[10px] text-neutral-600 uppercase tracking-widest">
          NO ACTIVITY RECORDED
        </div>
        <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
          System events will appear here as operations are performed
        </div>
      </div>
    </div>
  );
}
