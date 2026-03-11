import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  Briefcase, 
  Files, 
  Activity, 
  Bell,
  Search,
  ShieldAlert,
  ChevronLeft,
  Database,
  Menu
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const navItems = [
    { icon: Briefcase, label: "CASE CONTROL", href: "/" },
    { icon: Database, label: "ENTITY REGISTRY", href: "/entities" },
    { icon: Files, label: "DOCUMENT VAULT", href: "/documents" },
    { icon: Activity, label: "SYSTEM LOG", href: "/logs" },
  ];

  return (
    <div className="flex h-screen w-full bg-[#080a0d] text-foreground overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className={cn(
        "flex-shrink-0 border-r border-[#ffffff0d] bg-black flex flex-col justify-between z-20 transition-all duration-300",
        isCollapsed ? "w-16" : "w-64"
      )}>
        <div>
          <div className="h-8 flex items-center justify-between px-4 border-b border-[#ffffff0d]">
            {!isCollapsed && <span className="font-mono text-[10px] text-red-600 uppercase tracking-widest">SYS:NEXUS</span>}
            <button onClick={() => setIsCollapsed(!isCollapsed)} className="text-muted-foreground hover:text-white transition-colors ml-auto">
              {isCollapsed ? <Menu className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
            </button>
          </div>
          <nav className="p-2 space-y-1 mt-2">
            {navItems.map((item) => {
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href} className="block">
                  <div
                    className={cn(
                      "w-full flex items-center px-3 py-2.5 transition-all group relative cursor-pointer text-xs font-mono uppercase tracking-wider",
                      isActive 
                        ? "bg-[#dc262610] text-primary border-l-2 border-red-600" 
                        : "text-muted-foreground hover:text-foreground hover:bg-[#ffffff05] border-l-2 border-transparent"
                    )}
                  >
                    <item.icon className="w-4 h-4 flex-shrink-0 mr-3" />
                    {!isCollapsed && <span>{item.label}</span>}
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>
        
        <div className="p-4 border-t border-[#ffffff0d] flex flex-col gap-2">
          {!isCollapsed && (
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest leading-tight">
              // NEXUS-CORE v1.0<br />
              // RESTRICTED
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#080a0d] relative">
        {/* TOP BAR */}
        <header className="h-8 flex-shrink-0 border-b border-[#ffffff0d] flex items-center justify-between px-4 bg-black z-10 w-full">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-600" />
            <span className="font-bold text-white tracking-widest text-xs">NEXUS</span>
          </div>
          
          <div className="flex items-center gap-4 text-[10px] font-mono uppercase text-muted-foreground hidden md:flex tracking-widest">
            <div className="flex items-center gap-2">
              <span>[ NEXUS CORE: ONLINE ]</span>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            </div>
            <div className="w-px h-3 bg-[#ffffff0d]" />
            <span>ACTIVE DOSSIERS: N</span>
            <div className="w-px h-3 bg-[#ffffff0d]" />
            <span>OPEN FLAGS: 0</span>
            <div className="w-px h-3 bg-[#ffffff0d]" />
            <span>DOC INGEST: N</span>
            <div className="w-px h-3 bg-[#ffffff0d]" />
            <span>ENTITY REGISTRY: N</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative group">
              <input 
                type="text" 
                placeholder="SEARCH..." 
                className="w-32 md:w-48 bg-transparent border-none text-[10px] font-mono text-white placeholder:text-muted-foreground focus:outline-none focus:ring-0 text-right pr-6 transition-all"
              />
              <Search className="w-3 h-3 absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
            </div>
            <div className="w-px h-3 bg-[#ffffff0d]" />
            <button className="text-muted-foreground hover:text-white relative">
              <Bell className="w-3 h-3" />
            </button>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-4 md:p-6 text-foreground">
          {children}
        </div>
      </main>
    </div>
  );
}
