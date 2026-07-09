import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/AppLayout";
import CommandCenter from "@/pages/command-center";
import SetupData from "@/pages/setup-data";
import PortfolioConstruction from "@/pages/portfolio-construction";
import ResultsDashboard from "@/pages/results-dashboard";
import ResearchLab from "@/pages/research-lab";
import InvestmentCommittee from "@/pages/investment-committee";
import Reports from "@/pages/reports";
import HistoricalArchive from "@/pages/historical-archive";
import Methodology from "@/pages/methodology";
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
        <Route path="/" component={CommandCenter} />
        <Route path="/setup-data" component={SetupData} />
        <Route path="/portfolio-construction" component={PortfolioConstruction} />
        <Route path="/results" component={ResultsDashboard} />
        <Route path="/research-lab" component={ResearchLab} />
        <Route path="/etf/:ticker" component={EtfDetail} />
        <Route path="/investment-committee" component={InvestmentCommittee} />
        <Route path="/reports" component={Reports} />
        <Route path="/archive" component={HistoricalArchive} />
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
