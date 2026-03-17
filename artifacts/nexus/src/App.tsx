import { useState } from "react";
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

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [location] = useLocation();
  if (!isAuthenticated && location !== "/login") {
    return <Redirect to="/login" />;
  }
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/">
        <AuthGate>
          <Layout><Dashboard /></Layout>
        </AuthGate>
      </Route>
      <Route path="/cases/:id">
        <AuthGate>
          <Layout><CaseDetail /></Layout>
        </AuthGate>
      </Route>
      <Route path="/entities">
        <AuthGate>
          <Layout><EntityList /></Layout>
        </AuthGate>
      </Route>
      <Route path="/entities/:id">
        <AuthGate>
          <Layout><EntityProfile /></Layout>
        </AuthGate>
      </Route>
      <Route path="/documents">
        <AuthGate>
          <Layout><DocumentLibrary /></Layout>
        </AuthGate>
      </Route>
      <Route path="/logs">
        <AuthGate>
          <Layout><SystemLog /></Layout>
        </AuthGate>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [booted, setBooted] = useState(() => {
    try { return sessionStorage.getItem("atlas-booted") === "1"; } catch { return true; }
  });

  const handleBootComplete = () => {
    try { sessionStorage.setItem("atlas-booted", "1"); } catch { /* ignore */ }
    setBooted(true);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          {!booted && <BootScreen onComplete={handleBootComplete} />}
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
