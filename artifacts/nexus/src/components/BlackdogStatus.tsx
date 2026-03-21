import React, { useEffect, useState, useCallback } from "react";
import { ShieldCheck } from "lucide-react";

type BlackdogState = "online" | "degraded" | "offline" | "unconfigured" | "checking";

const PING_INTERVAL_MS = 20_000;
const PING_TIMEOUT_MS = 6_000;

function getEndpointUrl(): string | null {
  const envUrl = (import.meta as any).env?.VITE_BLACKDOG_URL;
  if (envUrl && envUrl.trim() && envUrl !== "undefined") return envUrl.trim();
  return null;
}

function statusColor(state: BlackdogState): string {
  switch (state) {
    case "online":       return "#22c55e";
    case "degraded":     return "#f59e0b";
    case "offline":      return "#ef4444";
    case "checking":     return "#6b7280";
    case "unconfigured": return "#374151";
  }
}

function statusLabel(state: BlackdogState): string {
  switch (state) {
    case "online":       return "CONNECTED";
    case "degraded":     return "DEGRADED";
    case "offline":      return "UNREACHABLE";
    case "checking":     return "CHECKING";
    case "unconfigured": return "NOT CONFIGURED";
  }
}

function usePing() {
  const [state, setState] = useState<BlackdogState>("checking");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const endpointUrl = getEndpointUrl();

  const ping = useCallback(async () => {
    if (!endpointUrl) { setState("unconfigured"); return; }
    setState("checking");
    const t0 = performance.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
      const resp = await fetch(endpointUrl, { method: "GET", signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      const ms = Math.round(performance.now() - t0);
      setLatencyMs(ms);
      setLastCheck(new Date());
      if (resp.ok) setState(ms > 3000 ? "degraded" : "online");
      else if (resp.status >= 500) setState("degraded");
      else setState("online");
    } catch {
      setLatencyMs(null);
      setLastCheck(new Date());
      setState("offline");
    }
  }, [endpointUrl]);

  useEffect(() => {
    if (!endpointUrl) { setState("unconfigured"); return; }
    ping();
    const interval = setInterval(ping, PING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [ping, endpointUrl]);

  return { state, latencyMs, lastCheck, ping };
}

// ── Header chip — goes in top-right header bar ────────────────────────────────
export function BlackdogHeaderChip() {
  const { state, latencyMs, ping } = usePing();
  const color = statusColor(state);
  const label = statusLabel(state);
  const tooltipText = `BLACKDOG — ${label}${latencyMs !== null ? ` · ${latencyMs}ms` : ""}`;

  return (
    <button
      onClick={ping}
      title={tooltipText}
      className="flex items-center gap-1.5 px-2 py-0.5 border border-[#ffffff06] bg-[#020406] hover:bg-[#040810] transition-colors"
      style={{ borderColor: `${color}18` }}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${state === "online" ? "animate-pulse" : state === "checking" ? "animate-ping" : ""}`}
        style={{ background: color, boxShadow: `0 0 5px ${color}60` }}
      />
      <span className="font-mono text-[8px] uppercase tracking-widest hidden sm:block" style={{ color: color === "#374151" ? "#4b5563" : color }}>
        BLACKDOG
      </span>
      <span className="font-mono text-[7px] text-neutral-700 hidden md:block">
        {label}
      </span>
    </button>
  );
}

// ── Sidebar full readout ──────────────────────────────────────────────────────
export function BlackdogStatus({ collapsed = false }: { collapsed?: boolean }) {
  const { state, latencyMs, lastCheck, ping } = usePing();
  const color = statusColor(state);
  const label = statusLabel(state);

  if (collapsed) {
    return (
      <button
        onClick={ping}
        className="flex items-center justify-center w-full py-1.5 group relative"
        title={`Protected by BLACKDOG — ${label}${latencyMs !== null ? ` (${latencyMs}ms)` : ""}`}
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${state === "online" ? "animate-pulse" : ""}`}
          style={{ background: color, boxShadow: `0 0 6px ${color}40` }}
        />
      </button>
    );
  }

  return (
    <button
      onClick={ping}
      className="w-full flex items-center gap-2 px-3 py-1.5 border border-[#ffffff05] bg-[#020408] hover:bg-[#060a10] transition-colors group"
      title="Click to re-check BLACKDOG connection"
    >
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${state === "online" ? "animate-pulse" : state === "checking" ? "animate-ping" : ""}`}
        style={{ background: color, boxShadow: `0 0 4px ${color}50` }}
      />
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-2.5 h-2.5 flex-shrink-0" style={{ color }} />
          <span className="font-mono text-[7px] uppercase tracking-widest" style={{ color }}>
            Protected by BLACKDOG
          </span>
        </div>
        <div className="font-mono text-[6px] text-neutral-700 mt-0.5 flex items-center gap-1">
          <span>{label}</span>
          {lastCheck && state !== "unconfigured" && (
            <span className="text-neutral-800">· {lastCheck.toLocaleTimeString()}</span>
          )}
        </div>
      </div>
    </button>
  );
}
