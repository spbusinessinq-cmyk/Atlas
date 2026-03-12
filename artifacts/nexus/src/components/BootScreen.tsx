import React, { useEffect, useState } from "react";

const BOOT_MESSAGES = [
  { text: "BOOTING ATLAS CORE",             delay: 0 },
  { text: "LOADING INTELLIGENCE MODULES",   delay: 350 },
  { text: "SYNCHRONIZING ENTITY REGISTRY",  delay: 700 },
  { text: "INITIALIZING GRAPH ENGINE",      delay: 1050 },
  { text: "ATLAS CORE ONLINE",              delay: 1400 },
];

export function BootScreen({ onComplete }: { onComplete: () => void }) {
  const [visibleLines, setVisibleLines] = useState<number[]>([]);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    BOOT_MESSAGES.forEach((msg, i) => {
      timers.push(
        setTimeout(() => setVisibleLines((prev) => [...prev, i]), msg.delay)
      );
    });

    timers.push(setTimeout(() => setFading(true), 1900));
    timers.push(setTimeout(() => onComplete(), 2350));

    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center transition-opacity duration-400 ${fading ? "opacity-0" : "opacity-100"}`}
      style={{ transitionDuration: "450ms" }}
    >
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(#ff000030 1px, transparent 1px), linear-gradient(90deg, #ff000030 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Radar sweep */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative w-96 h-96 opacity-10">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <circle cx="100" cy="100" r="90" fill="none" stroke="#dc2626" strokeWidth="0.5" />
            <circle cx="100" cy="100" r="60" fill="none" stroke="#dc2626" strokeWidth="0.5" />
            <circle cx="100" cy="100" r="30" fill="none" stroke="#dc2626" strokeWidth="0.5" />
            <line x1="100" y1="100" x2="100" y2="10" stroke="#dc2626" strokeWidth="0.5" />
            <line x1="100" y1="100" x2="190" y2="100" stroke="#dc2626" strokeWidth="0.5" />
            <line x1="100" y1="100" x2="100" y2="190" stroke="#dc2626" strokeWidth="0.5" />
            <line x1="100" y1="100" x2="10" y2="100" stroke="#dc2626" strokeWidth="0.5" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-0.5 h-[50%] origin-bottom"
              style={{
                background: "linear-gradient(to top, #dc2626, transparent)",
                transformOrigin: "bottom center",
                position: "absolute",
                bottom: "50%",
                left: "50%",
                marginLeft: "-1px",
                animation: "atlas-radar-sweep 2s linear infinite",
              }}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 border border-red-600 flex items-center justify-center">
            <div className="w-3 h-3 bg-red-600 animate-pulse" />
          </div>
          <div>
            <div className="font-mono text-2xl font-bold text-white tracking-[0.3em]">ATLAS</div>
            <div className="font-mono text-[9px] text-red-600 uppercase tracking-[0.4em]">
              Intelligence Platform
            </div>
          </div>
        </div>

        {/* Boot messages */}
        <div className="w-80 space-y-1">
          {BOOT_MESSAGES.map((msg, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 transition-all duration-300 ${
                visibleLines.includes(i) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
              }`}
            >
              <span
                className={`text-[9px] font-mono flex-shrink-0 ${
                  i === BOOT_MESSAGES.length - 1 && visibleLines.includes(i)
                    ? "text-green-400"
                    : "text-red-700"
                }`}
              >
                {i === BOOT_MESSAGES.length - 1 && visibleLines.includes(i) ? "●" : "›"}
              </span>
              <span
                className={`font-mono text-[11px] uppercase tracking-widest ${
                  i === BOOT_MESSAGES.length - 1 && visibleLines.includes(i)
                    ? "text-green-400"
                    : "text-neutral-400"
                }`}
              >
                {msg.text}
              </span>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="w-80 h-px bg-neutral-900 overflow-hidden">
          <div
            className="h-full bg-red-600"
            style={{ animation: "atlas-boot-progress 2s linear forwards" }}
          />
        </div>
      </div>
    </div>
  );
}
