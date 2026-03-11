import React from "react";
import { Link, useLocation } from "wouter";
import { 
  Briefcase, 
  Users, 
  Files, 
  Activity, 
  Settings, 
  Search,
  Bell,
  ShieldAlert
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { icon: Briefcase, label: "Cases", href: "/" },
    { icon: Users, label: "Entities", href: "/entities" },
    { icon: Files, label: "Documents", href: "/documents" },
    { icon: Activity, label: "System Log", href: "/logs" },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-16 md:w-64 flex-shrink-0 border-r border-border bg-sidebar flex flex-col justify-between z-20 transition-all duration-300">
        <div>
          <div className="h-16 flex items-center justify-center md:justify-start md:px-6 border-b border-border">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-6 h-6 text-primary" />
              <span className="hidden md:block font-bold tracking-widest text-lg tracking-[0.2em] text-foreground">NEXUS</span>
            </div>
          </div>
          <nav className="p-2 md:p-4 space-y-2 mt-4">
            {navItems.map((item) => {
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href} className="block">
                  <Button
                    variant="ghost"
                    className={cn(
                      "w-full flex items-center justify-center md:justify-start gap-3 h-12 transition-all group relative",
                      isActive 
                        ? "bg-primary/10 text-primary hover:bg-primary/20" 
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full" />
                    )}
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    <span className="hidden md:block font-medium">{item.label}</span>
                  </Button>
                </Link>
              );
            })}
          </nav>
        </div>
        
        <div className="p-2 md:p-4 border-t border-border">
          <Button variant="ghost" className="w-full flex items-center justify-center md:justify-start gap-3 h-12 text-muted-foreground hover:text-foreground">
            <Settings className="w-5 h-5 flex-shrink-0" />
            <span className="hidden md:block font-medium">Settings</span>
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-background relative">
        <header className="h-16 flex-shrink-0 border-b border-border flex items-center justify-between px-6 bg-background/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-4 text-sm text-muted-foreground font-mono">
            <span>[ SYSTEM: ONLINE ]</span>
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <input 
                type="text" 
                placeholder="Global query..." 
                className="w-64 h-9 bg-input border border-border rounded-md pl-9 pr-4 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              />
            </div>
            <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" />
            </Button>
            <div className="w-8 h-8 rounded-md border border-border bg-muted flex items-center justify-center overflow-hidden ml-2">
              <img src={`${import.meta.env.BASE_URL}images/nexus-logo.png`} alt="User" className="w-full h-full object-cover opacity-80" />
            </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-6 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
