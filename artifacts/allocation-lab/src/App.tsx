import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "@/pages/dashboard";
import PortfolioLab from "@/pages/portfolio-lab";
import ResearchLab from "@/pages/research-lab";
import InvestmentCommittee from "@/pages/investment-committee";
import Settings from "@/pages/settings";
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
        <Route path="/research-lab" component={ResearchLab} />
        <Route path="/investment-committee" component={InvestmentCommittee} />
        <Route path="/settings" component={Settings} />
        <Route path="/etf/:ticker" component={EtfDetail} />

        {/* Legacy path redirects */}
        <Route path="/market-monitor"><Redirect to="/research-lab" /></Route>
        <Route path="/market-intelligence"><Redirect to="/research-lab" /></Route>
        <Route path="/configuration"><Redirect to="/settings" /></Route>
        <Route path="/backtesting"><Redirect to="/research-lab" /></Route>
        <Route path="/reports"><Redirect to="/investment-committee" /></Route>
        <Route path="/archive"><Redirect to="/investment-committee" /></Route>

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
