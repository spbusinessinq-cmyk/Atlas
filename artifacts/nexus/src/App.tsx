import { useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

// Layout & Pages
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import CaseDetail from "@/pages/case-detail";
import EntityList from "@/pages/entities";
import EntityProfile from "@/pages/entity-profile";
import DocumentLibrary from "@/pages/documents";
import SystemLog from "@/pages/logs";
import NotFound from "@/pages/not-found";
import { BootScreen } from "@/components/BootScreen";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/cases/:id" component={CaseDetail} />
      <Route path="/entities" component={EntityList} />
      <Route path="/entities/:id" component={EntityProfile} />
      <Route path="/documents" component={DocumentLibrary} />
      <Route path="/logs" component={SystemLog} />
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
        {!booted && <BootScreen onComplete={handleBootComplete} />}
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Layout>
            <Router />
          </Layout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
