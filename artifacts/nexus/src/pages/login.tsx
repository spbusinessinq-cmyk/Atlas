import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

function ScanlineOverlay() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px)`,
        backgroundSize: "100% 4px",
      }}
    />
  );
}

function GridOverlay() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        backgroundImage: `linear-gradient(rgba(6,182,212,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.025) 1px, transparent 1px)`,
        backgroundSize: "48px 48px",
      }}
    />
  );
}

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const [operatorId, setOperatorId] = useState("");
  const [password, setPassword]     = useState("");
  const [status, setStatus]         = useState<"idle" | "checking" | "error" | "ok">("idle");
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  const [blink, setBlink]           = useState(true);

  useEffect(() => {
    if (isAuthenticated) navigate("/");
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    const t = setInterval(() => setBlink(b => !b), 530);
    return () => clearInterval(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorId.trim() || !password) return;
    setStatus("checking");
    setErrorMsg(null);
    const result = await login(operatorId, password);
    if (result.ok) {
      setStatus("ok");
      setTimeout(() => navigate("/"), 600);
    } else {
      setStatus("error");
      setErrorMsg(result.error ?? "ACCESS DENIED");
    }
  };

  return (
    <div className="fixed inset-0 bg-[#02040a] flex items-center justify-center overflow-hidden">
      <ScanlineOverlay />
      <GridOverlay />

      {/* Ambient glow pools */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-red-900/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-cyan-900/10 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm mx-4">
        {/* Header brand */}
        <div className="text-center mb-8 space-y-1">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="w-px h-4 bg-red-800/60" />
            <span className="font-mono text-[9px] text-red-700 uppercase tracking-[0.35em]">RSR // ATLAS</span>
            <div className="w-px h-4 bg-red-800/60" />
          </div>
          <h1 className="font-mono text-2xl font-bold text-white tracking-[0.2em] uppercase">INTERNAL</h1>
          <h2 className="font-mono text-2xl font-bold text-white tracking-[0.2em] uppercase">ACCESS GATE</h2>
          <p className="font-mono text-[9px] text-neutral-600 uppercase tracking-widest mt-2">
            CLASSIFIED CASE ENVIRONMENT
          </p>
        </div>

        {/* Login card */}
        <div
          className={cn(
            "relative border bg-[#04060c]/80 backdrop-blur-md",
            status === "error"
              ? "border-red-800/50 shadow-[0_0_24px_rgba(185,28,28,0.12)]"
              : "border-[#ffffff10] shadow-[0_0_32px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.04)]"
          )}
        >
          {/* top glow line */}
          <div className={cn(
            "absolute top-0 left-0 right-0 h-px",
            status === "error" ? "bg-red-700/40" : "bg-cyan-500/15"
          )} />

          <div className="p-6 space-y-4">
            {/* Status strip */}
            <div className="flex items-center gap-2 pb-3 border-b border-[#ffffff08]">
              <span className={cn(
                "w-1.5 h-1.5 rounded-full",
                status === "checking" ? "bg-amber-500 animate-pulse" :
                status === "ok"       ? "bg-green-500 animate-pulse" :
                status === "error"    ? "bg-red-600" :
                "bg-green-500/60 animate-pulse"
              )} />
              <span className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest">
                {status === "checking" ? "AUTHENTICATING..." :
                 status === "ok"       ? "ACCESS GRANTED" :
                 status === "error"    ? "AUTHENTICATION FAILED" :
                 "AUTH NODE / INTERNAL / ENCRYPTED SESSION"}
              </span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest block">
                  OPERATOR ID
                </label>
                <input
                  type="text"
                  value={operatorId}
                  onChange={e => { setOperatorId(e.target.value); setStatus("idle"); setErrorMsg(null); }}
                  placeholder="ENTER OPERATOR ID"
                  autoComplete="username"
                  autoFocus
                  disabled={status === "checking" || status === "ok"}
                  className={cn(
                    "w-full bg-[#080c15] border font-mono text-[11px] text-white placeholder:text-neutral-800 px-3 py-2 focus:outline-none transition-colors uppercase tracking-wider",
                    status === "error"
                      ? "border-red-800/50 focus:border-red-700/60"
                      : "border-[#ffffff10] focus:border-cyan-800/50"
                  )}
                />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[8px] text-neutral-600 uppercase tracking-widest block">
                  ACCESS CODE
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setStatus("idle"); setErrorMsg(null); }}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  disabled={status === "checking" || status === "ok"}
                  className={cn(
                    "w-full bg-[#080c15] border font-mono text-[11px] text-white placeholder:text-neutral-700 px-3 py-2 focus:outline-none transition-colors",
                    status === "error"
                      ? "border-red-800/50 focus:border-red-700/60"
                      : "border-[#ffffff10] focus:border-cyan-800/50"
                  )}
                />
              </div>

              {errorMsg && (
                <div className="border border-red-900/50 bg-red-950/20 px-3 py-2">
                  <p className="font-mono text-[9px] text-red-600 uppercase tracking-wider">{errorMsg}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={!operatorId.trim() || !password || status === "checking" || status === "ok"}
                className={cn(
                  "w-full font-mono text-[10px] uppercase tracking-[0.25em] py-2.5 border transition-all duration-200 mt-1",
                  status === "ok"
                    ? "border-green-800/50 bg-green-950/30 text-green-400"
                    : status === "error"
                    ? "border-red-800/50 bg-red-950/20 text-red-600 hover:bg-red-950/30"
                    : "border-cyan-900/50 bg-cyan-950/10 text-cyan-600 hover:bg-cyan-950/20 hover:border-cyan-800/50 hover:text-cyan-400 disabled:opacity-30 disabled:cursor-not-allowed"
                )}
              >
                {status === "checking" ? (
                  <span>AUTHENTICATING{blink ? "..." : "   "}</span>
                ) : status === "ok" ? (
                  "ACCESS GRANTED"
                ) : (
                  "ACCESS ATLAS"
                )}
              </button>
            </form>
          </div>

          {/* bottom metadata */}
          <div className="border-t border-[#ffffff06] px-6 py-2 flex items-center justify-between">
            <span className="font-mono text-[7px] text-neutral-800 uppercase tracking-widest">
              ATLAS-CORE v23
            </span>
            <span className="font-mono text-[7px] text-neutral-800 uppercase tracking-widest">
              SESSION ENCRYPTED
            </span>
          </div>
        </div>

        <p className="text-center font-mono text-[7px] text-neutral-800 uppercase tracking-widest mt-4">
          UNAUTHORIZED ACCESS IS PROHIBITED AND MONITORED
        </p>
      </div>
    </div>
  );
}
