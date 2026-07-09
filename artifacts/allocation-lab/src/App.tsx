import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/AppLayout";
import InvestmentCommittee from "@/pages/investment-committee";
import PortfolioConstruction from "@/pages/portfolio-construction";
import ResultsDashboard from "@/pages/results-dashboard";
import Reports from "@/pages/reports";
import Methodology from "@/pages/methodology";
import PortfolioDiagnostics from "@/pages/diagnostics";
import EtfDetail from "@/pages/etf-detail";
import Backtesting from "@/pages/backtesting";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={InvestmentCommittee} />
        <Route path="/portfolio" component={PortfolioConstruction} />
        <Route path="/results" component={ResultsDashboard} />
        <Route path="/diagnostics" component={PortfolioDiagnostics} />
        <Route path="/etf/:ticker" component={EtfDetail} />
        <Route path="/backtesting" component={Backtesting} />
        <Route path="/reports" component={Reports} />
        <Route path="/methodology" component={Methodology} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
