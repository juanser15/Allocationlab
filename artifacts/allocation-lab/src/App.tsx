import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "@/pages/dashboard";
import PortfolioLab from "@/pages/portfolio-lab";
import MarketIntelligence from "@/pages/market-intelligence";
import Configuration from "@/pages/configuration";
import InvestmentCommittee from "@/pages/investment-committee";
import Reports from "@/pages/reports";
import HistoricalArchive from "@/pages/historical-archive";
import EtfDetail from "@/pages/etf-detail";

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
        <Route path="/" component={Dashboard} />
        <Route path="/portfolio-lab" component={PortfolioLab} />
        <Route path="/market-intelligence" component={MarketIntelligence} />
        <Route path="/configuration" component={Configuration} />
        <Route path="/etf/:ticker" component={EtfDetail} />
        <Route path="/investment-committee" component={InvestmentCommittee} />
        <Route path="/reports" component={Reports} />
        <Route path="/archive" component={HistoricalArchive} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
