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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useListCases, useListDocuments, useListEntities, useListEntityMentions } from "@workspace/api-client-react";

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
        x1="10"
        y1="10"
        x2="16.5"
        y2="3.5"
        stroke="#06b6d4"
        strokeWidth="0.8"
        opacity="0.7"
        className="atlas-radar-sweep"
      />
      <path
        d="M 10 1.5 A 8.5 8.5 0 0 1 17.1 7.1"
        stroke="#06b6d4"
        strokeWidth="0.6"
        opacity="0.28"
        fill="none"
        className="atlas-radar-sweep"
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

  const { data: cases } = useListCases();
  const { data: documents } = useListDocuments();
  const { data: entities } = useListEntities();
  const { data: pendingMentions } = useListEntityMentions({ status: "pending" });

  const activeCaseCount = cases?.filter(c => c.status === "active" || c.status === "open").length ?? 0;
  const docCount = documents?.length ?? 0;
  const entityCount = entities?.length ?? 0;
  const flagCount = pendingMentions?.length ?? 0;

  const navItems = [
    { icon: Briefcase, label: "CASE CONTROL", href: "/" },
    { icon: Database, label: "ENTITY REGISTRY", href: "/entities" },
    { icon: Files, label: "DOCUMENT VAULT", href: "/documents" },
    { icon: Activity, label: "SYSTEM LOG", href: "/logs" },
  ];

  return (
    <div className="flex h-screen w-full bg-[#080a0d] text-foreground overflow-hidden font-sans">
      <aside
        className={cn(
          "flex-shrink-0 border-r border-[#ffffff0d] bg-[#040507] flex flex-col justify-between z-20 transition-all duration-300",
          isCollapsed ? "w-12" : "w-56"
        )}
      >
        <div>
          <div className="h-8 flex items-center justify-between px-3 border-b border-[#ffffff0d]">
            {!isCollapsed && (
              <span className="font-mono text-[10px] text-red-600 uppercase tracking-widest">
                SYS:ATLAS
              </span>
            )}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="text-neutral-600 hover:text-white transition-colors ml-auto focus:outline-none"
            >
              {isCollapsed ? (
                <Menu className="w-3 h-3" />
              ) : (
                <ChevronLeft className="w-3 h-3" />
              )}
            </button>
          </div>
          <nav className="p-1.5 space-y-0.5 mt-1">
            {navItems.map((item) => {
              const isActive =
                location === item.href ||
                (item.href !== "/" && location.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href} className="block outline-none focus:outline-none">
                  <div
                    className={cn(
                      "w-full flex items-center px-2.5 py-2 transition-all cursor-pointer text-[10px] font-mono uppercase tracking-wider outline-none",
                      isActive
                        ? "bg-[#dc262608] text-primary border-l-2 border-red-600"
                        : "text-neutral-600 hover:text-neutral-300 hover:bg-[#ffffff04] border-l-2 border-transparent"
                    )}
                  >
                    <item.icon className="w-3.5 h-3.5 flex-shrink-0 mr-2.5" />
                    {!isCollapsed && <span>{item.label}</span>}
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-3 border-t border-[#ffffff0d]">
          {!isCollapsed && (
            <div className="text-[9px] font-mono text-neutral-700 uppercase tracking-widest leading-relaxed">
              // ATLAS-CORE V1.0
              <br />
              // RESTRICTED
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-[#080a0d] relative">
        <header className="h-7 flex-shrink-0 border-b border-[#ffffff0d] flex items-center justify-between px-3 bg-[#040507] z-10 w-full">
          <div className="flex items-center gap-2">
            <AtlasRadar />
            <span className="font-bold text-white tracking-widest text-[11px] font-mono">
              RSR // ATLAS
            </span>
          </div>

          <div className="flex items-center gap-3 text-[9px] font-mono uppercase text-neutral-600 hidden md:flex tracking-widest">
            <div className="flex items-center gap-1.5">
              <span className="text-neutral-500">[ ATLAS CORE: ONLINE ]</span>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            </div>
            <span className="w-px h-3 bg-[#ffffff08]" />
            <span>
              DOSSIERS:{" "}
              <span className="text-white">{activeCaseCount}</span>
            </span>
            <span className="w-px h-3 bg-[#ffffff08]" />
            <span>
              FLAGS:{" "}
              <span className={flagCount > 0 ? "text-amber-400" : "text-white"}>
                {flagCount}
              </span>
            </span>
            <span className="w-px h-3 bg-[#ffffff08]" />
            <span>
              DOC INGEST: <span className="text-white">{docCount}</span>
            </span>
            <span className="w-px h-3 bg-[#ffffff08]" />
            <span>
              ENTITY REG: <span className="text-white">{entityCount}</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative group hidden sm:block">
              <input
                type="text"
                placeholder="SEARCH..."
                className="w-36 bg-transparent border-none text-[9px] font-mono text-white placeholder:text-neutral-700 focus:outline-none focus:ring-0 text-right pr-5 transition-all"
              />
              <Search className="w-3 h-3 absolute right-0 top-1/2 -translate-y-1/2 text-neutral-700 group-focus-within:text-primary transition-colors" />
            </div>
            <span className="w-px h-3 bg-[#ffffff08]" />
            <button className="text-neutral-600 hover:text-white transition-colors">
              <Bell className="w-3 h-3" />
            </button>
          </div>
        </header>

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
