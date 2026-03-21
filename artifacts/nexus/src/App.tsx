import { useState, Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { AuthProvider, useAuth } from "@/context/auth-context";
import { Layout } from "@/components/layout";
import { BootScreen } from "@/components/BootScreen";
import Dashboard from "@/pages/dashboard";
import CaseDetail from "@/pages/case-detail";
import EntityList from "@/pages/entities";
import EntityProfile from "@/pages/entity-profile";
import DocumentLibrary from "@/pages/documents";
import SystemLog from "@/pages/logs";
import TriagePage from "@/pages/triage";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// ── Top-Level Error Boundary ─────────────────────────────────────────────────

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  info: ErrorInfo | null;
  layer: string;
}

class AtlasErrorBoundary extends Component<
  { children: ReactNode; layer?: string },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode; layer?: string }) {
    super(props);
    this.state = { hasError: false, error: null, info: null, layer: props.layer ?? "APP" };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    console.error("[ATLAS ERROR BOUNDARY]", this.props.layer, error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const layer = this.props.layer ?? "APP";
    const msg = this.state.error?.message ?? "Unknown error";
    const isRoute = layer === "ROUTE";

    return (
      <div
        style={{
          minHeight: isRoute ? "200px" : "100vh",
          background: isRoute ? "transparent" : "#020409",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          padding: "2rem",
        }}
      >
        <div
          style={{
            border: "1px solid #dc2626",
            background: "#0a0f1a",
            padding: "2rem",
            maxWidth: "600px",
            width: "100%",
          }}
        >
          <div style={{ color: "#dc2626", fontSize: "10px", letterSpacing: "0.15em", marginBottom: "0.75rem" }}>
            ██ RSR // ATLAS — {layer} FAULT
          </div>
          <div style={{ color: "#f97316", fontSize: "14px", fontWeight: 700, letterSpacing: "0.1em", marginBottom: "0.5rem" }}>
            {isRoute ? "ROUTE CRASH — CONTAINED" : "FATAL RENDER FAILURE"}
          </div>
          <div style={{ color: "#94a3b8", fontSize: "11px", marginBottom: "1.5rem", wordBreak: "break-word" }}>
            {msg}
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button
              onClick={() => window.location.href = "/"}
              style={{
                background: "transparent",
                border: "1px solid #dc2626",
                color: "#dc2626",
                padding: "0.4rem 1rem",
                fontSize: "10px",
                letterSpacing: "0.1em",
                cursor: "pointer",
              }}
            >
              RETURN TO CASE CONTROL
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "transparent",
                border: "1px solid #334155",
                color: "#94a3b8",
                padding: "0.4rem 1rem",
                fontSize: "10px",
                letterSpacing: "0.1em",
                cursor: "pointer",
              }}
            >
              RELOAD APP
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// ── Route-level error boundary wrapper ───────────────────────────────────────

function RouteShell({ children }: { children: ReactNode }) {
  return (
    <AtlasErrorBoundary layer="ROUTE">
      {children}
    </AtlasErrorBoundary>
  );
}

// ── Auth Gate ────────────────────────────────────────────────────────────────

function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [location] = useLocation();
  if (!isAuthenticated && location !== "/login") {
    return <Redirect to="/login" />;
  }
  return <>{children}</>;
}

// ── Router ───────────────────────────────────────────────────────────────────

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/">
        <AuthGate>
          <Layout>
            <RouteShell><Dashboard /></RouteShell>
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/cases/:id">
        <AuthGate>
          <Layout>
            <RouteShell><CaseDetail /></RouteShell>
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/entities">
        <AuthGate>
          <Layout>
            <RouteShell><EntityList /></RouteShell>
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/entities/:id">
        <AuthGate>
          <Layout>
            <RouteShell><EntityProfile /></RouteShell>
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/documents">
        <AuthGate>
          <Layout>
            <RouteShell><DocumentLibrary /></RouteShell>
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/logs">
        <AuthGate>
          <Layout>
            <RouteShell><SystemLog /></RouteShell>
          </Layout>
        </AuthGate>
      </Route>
      <Route path="/triage">
        <AuthGate>
          <Layout>
            <RouteShell><TriagePage /></RouteShell>
          </Layout>
        </AuthGate>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

// ── Root App ─────────────────────────────────────────────────────────────────

function App() {
  const [booted, setBooted] = useState(() => {
    try { return sessionStorage.getItem("atlas-booted") === "1"; } catch { return true; }
  });

  const handleBootComplete = () => {
    try { sessionStorage.setItem("atlas-booted", "1"); } catch { /* ignore */ }
    setBooted(true);
  };

  return (
    <AtlasErrorBoundary layer="PROVIDER">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AtlasErrorBoundary layer="AUTH">
            <AuthProvider>
              {!booted && <BootScreen onComplete={handleBootComplete} />}
              <AtlasErrorBoundary layer="ROUTER">
                <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                  <Router />
                </WouterRouter>
              </AtlasErrorBoundary>
              <Toaster />
            </AuthProvider>
          </AtlasErrorBoundary>
        </TooltipProvider>
      </QueryClientProvider>
    </AtlasErrorBoundary>
  );
}

export default App;
