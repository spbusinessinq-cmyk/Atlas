import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Briefcase,
  Files,
  Activity,
  Bell,
  Search,
  ChevronLeft,
  Database,
  Menu,
  LogOut,
  Cpu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useListCases, useListDocuments, useListEntities, useListEntityMentions } from "@workspace/api-client-react";
import { useAuth } from "@/context/auth-context";
import { BlackdogStatus } from "@/components/BlackdogStatus";

function AtlasRadar() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="8.5" stroke="white" strokeWidth="0.5" opacity="0.18" />
      <circle cx="10" cy="10" r="4.5" stroke="white" strokeWidth="0.4" opacity="0.10" />
      <line x1="10" y1="1" x2="10" y2="3" stroke="white" strokeWidth="0.6" opacity="0.22" />
      <line x1="10" y1="17" x2="10" y2="19" stroke="white" strokeWidth="0.6" opacity="0.22" />
      <line x1="1" y1="10" x2="3" y2="10" stroke="white" strokeWidth="0.6" opacity="0.22" />
      <line x1="17" y1="10" x2="19" y2="10" stroke="white" strokeWidth="0.6" opacity="0.22" />
      <line
        x1="10" y1="10" x2="16.5" y2="3.5"
        stroke="#06b6d4" strokeWidth="0.8" opacity="0.7"
        className="atlas-radar-sweep"
      />
      <path
        d="M 10 1.5 A 8.5 8.5 0 0 1 17.1 7.1"
        stroke="#06b6d4" strokeWidth="0.6" opacity="0.28"
        fill="none" className="atlas-radar-sweep"
      />
      <circle cx="10" cy="10" r="1.5" fill="#dc2626" />
    </svg>
  );
}

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { logout, operator } = useAuth();

  const { data: cases } = useListCases();
  const { data: documents } = useListDocuments();
  const { data: entities } = useListEntities();
  const { data: pendingMentions } = useListEntityMentions({ status: "pending" });

  const activeCaseCount = cases?.filter(c => c.status === "active" || c.status === "open").length ?? 0;
  const docCount = documents?.length ?? 0;
  const entityCount = entities?.length ?? 0;
  const flagCount = pendingMentions?.length ?? 0;

  const navItems = [
    { icon: Briefcase, label: "CASE CONTROL",    href: "/",          badge: null },
    { icon: Database,  label: "ENTITY REGISTRY", href: "/entities",  badge: null },
    { icon: Files,     label: "DOCUMENT VAULT",  href: "/documents", badge: null },
    { icon: Cpu,       label: "TRIAGE QUEUE",    href: "/triage",    badge: flagCount > 0 ? flagCount : null },
    { icon: Activity,  label: "SYSTEM LOG",      href: "/logs",      badge: null },
  ];

  return (
    <div className="flex h-screen w-full bg-[#06080b] text-foreground overflow-hidden font-sans">

      {/* ── Left Rail ───────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "flex-shrink-0 flex flex-col justify-between z-20 transition-all duration-300",
          "border-r border-[#ffffff0d] bg-[#030406]",
          "shadow-[inset_-1px_0_0_rgba(255,255,255,0.03)]",
          isCollapsed ? "w-12" : "w-56"
        )}
      >
        {/* Logo strip */}
        <div>
          <div className={cn(
            "h-8 flex items-center justify-between px-3 border-b border-[#ffffff0d]",
            "bg-gradient-to-b from-[#ffffff03] to-transparent"
          )}>
            {!isCollapsed && (
              <div className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-red-600" />
                <span className="font-mono text-[9px] text-red-700 uppercase tracking-[0.3em]">
                  SYS:ATLAS
                </span>
              </div>
            )}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="text-neutral-700 hover:text-neutral-300 transition-colors ml-auto focus:outline-none"
            >
              {isCollapsed ? <Menu className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
            </button>
          </div>

          {/* Nav items */}
          <nav className="p-1.5 space-y-0.5 mt-1">
            {navItems.map((item) => {
              const isActive =
                location === item.href ||
                (item.href !== "/" && location.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href} className="block outline-none focus:outline-none">
                  <div className={cn(
                    "w-full flex items-center px-2.5 py-2 transition-all cursor-pointer text-[10px] font-mono uppercase tracking-wider outline-none rounded-[2px]",
                    isActive
                      ? "atlas-nav-active text-white"
                      : "text-neutral-600 hover:text-neutral-300 hover:bg-[#ffffff05] border-l-2 border-transparent"
                  )}>
                    <item.icon className={cn(
                      "w-3.5 h-3.5 flex-shrink-0 transition-all",
                      !isCollapsed && "mr-2.5",
                      isActive ? "atlas-nav-icon text-red-500 drop-shadow-[0_0_4px_rgba(220,38,38,0.4)]" : "text-neutral-700 group-hover:text-neutral-400"
                    )} />
                    {!isCollapsed && <span className="flex-1">{item.label}</span>}
                    {!isCollapsed && item.badge != null && (
                      <span className="ml-1 px-1 py-0.5 bg-amber-500/20 border border-amber-600/40 font-mono text-[7px] text-amber-500 rounded-sm tabular-nums">
                        {item.badge}
                      </span>
                    )}
                    {isCollapsed && item.badge != null && (
                      <span className="absolute right-1 top-1 w-2 h-2 bg-amber-500 rounded-full" />
                    )}
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* BLACKDOG status */}
        <div className="border-t border-[#ffffff06]">
          <BlackdogStatus collapsed={isCollapsed} />
        </div>

        {/* Operator footer + logout */}
        <div className={cn(
          "border-t border-[#ffffff0d] bg-gradient-to-b from-transparent to-[#ffffff02]",
          isCollapsed ? "p-2" : "p-3"
        )}>
          {!isCollapsed && operator && (
            <div className="space-y-0.5 mb-2">
              <div className="font-mono text-[8px] text-neutral-700 uppercase tracking-widest">OPERATOR</div>
              <div className="font-mono text-[9px] text-neutral-500 uppercase">{operator.displayName}</div>
              <div className="font-mono text-[7px] text-neutral-800 uppercase">
                {new Date(operator.lastAuth).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                {new Date(operator.lastAuth).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} SESSION
              </div>
            </div>
          )}
          <button
            onClick={logout}
            title="End session"
            className={cn(
              "flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider",
              "text-neutral-800 hover:text-red-700 transition-colors",
              isCollapsed ? "w-full justify-center py-1" : "w-full px-0.5 py-1"
            )}
          >
            <LogOut className="w-3 h-3 flex-shrink-0" />
            {!isCollapsed && "END SESSION"}
          </button>

          {!isCollapsed && (
            <div className="mt-2 font-mono text-[7px] text-neutral-800 uppercase tracking-widest leading-relaxed border-t border-[#ffffff05] pt-2">
              // ATLAS-CORE V23 // RESTRICTED
            </div>
          )}
        </div>
      </aside>

      {/* ── Main Column ─────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#06080b] relative">

        {/* Top header bar */}
        <header className={cn(
          "h-7 flex-shrink-0 flex items-center justify-between px-3 z-10 w-full",
          "border-b border-[#ffffff10] bg-[#020305]",
          "shadow-[0_1px_0_rgba(220,38,38,0.07),0_2px_12px_rgba(0,0,0,0.5)]"
        )}>
          {/* Brand */}
          <div className="flex items-center gap-2">
            <AtlasRadar />
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-white tracking-[0.22em] text-[11px] font-mono" style={{ textShadow: "0 0 12px rgba(255,255,255,0.08)" }}>
                RSR // ATLAS
              </span>
              <span className="hidden md:block w-px h-2.5 bg-[#ffffff0a]" />
              <span className="hidden md:block font-mono text-[7px] text-neutral-800 uppercase tracking-widest">
                ADVANCED TRACKING &amp; LINK ANALYSIS
              </span>
            </div>
          </div>

          {/* Telemetry strip */}
          <div className="flex items-center gap-3 text-[8px] font-mono uppercase hidden md:flex tracking-widest">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" style={{ boxShadow: "0 0 5px rgba(34,197,94,0.7)" }} />
              <span className="text-green-700 tracking-[0.18em]">ONLINE</span>
            </div>
            <TelemetryPip label="CASES"    value={activeCaseCount} />
            <TelemetryPip label="FLAGS"    value={flagCount}       warn={flagCount > 0} />
            <TelemetryPip label="DOCS"     value={docCount}        />
            <TelemetryPip label="ENTITIES" value={entityCount}     />
          </div>

          {/* Right cluster */}
          <div className="flex items-center gap-2.5">
            <div className="relative group hidden sm:block">
              <input
                type="text"
                placeholder="SEARCH..."
                className="w-32 bg-transparent border-none text-[9px] font-mono text-white placeholder:text-neutral-800 focus:outline-none focus:ring-0 text-right pr-5 transition-all"
              />
              <Search className="w-3 h-3 absolute right-0 top-1/2 -translate-y-1/2 text-neutral-800 group-focus-within:text-cyan-600 transition-colors" />
            </div>
            <span className="w-px h-3 bg-[#ffffff08]" />
            <button className="text-neutral-700 hover:text-white transition-colors">
              <Bell className="w-3 h-3" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <div className={cn(
          "flex-1 overflow-auto text-foreground",
          /^\/cases\/\d/.test(location) ? "" : "p-4"
        )}>
          {children}
        </div>
      </main>
    </div>
  );
}

function TelemetryPip({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <>
      <span className="w-px h-2.5 bg-[#ffffff08]" />
      <span className="flex items-center gap-1">
        <span className="text-neutral-700 tracking-[0.14em]">{label}</span>
        <span className={cn(
          "tabular-nums font-bold tracking-normal",
          warn && value > 0 ? "text-amber-400" : value > 0 ? "text-neutral-300" : "text-neutral-700"
        )}>{value}</span>
      </span>
    </>
  );
}
