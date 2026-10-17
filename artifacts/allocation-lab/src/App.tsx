import { Switch, Route, Redirect, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "@/pages/dashboard";
import PortfolioLab from "@/pages/portfolio-lab";
import InvestmentCommittee from "@/pages/investment-committee";
import EtfDetail from "@/pages/etf-detail";
import { SettingsDrawerProvider } from "@/context/settings-drawer-context";
import { SettingsDrawer } from "@/components/settings/SettingsDrawer";
import { UxPreferencesProvider } from "@/context/ux-preferences-context";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";

import CertifiedApp from "@/certified/CertifiedApp";

const CERTIFIED_PATHS = new Set(["/", "/risk-mandate", "/strategy-bank", "/allocation", "/research-engine", "/decision-trace", "/risk-performance", "/system-status"]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function Router() {
  const [location] = useLocation();
  if (CERTIFIED_PATHS.has(location)) return <CertifiedApp />;
  return (
    <AppLayout>
      <SettingsDrawer />
      <OnboardingTour />
      <Switch>
        <Route path="/legacy-dashboard" component={Dashboard} />
        <Route path="/portfolio-lab" component={PortfolioLab} />
        <Route path="/investment-committee" component={InvestmentCommittee} />
        <Route path="/etf/:ticker" component={EtfDetail} />

        {/* Legacy path redirects */}
        <Route path="/research-lab"><Redirect to="/portfolio-lab" /></Route>
        <Route path="/market-monitor"><Redirect to="/portfolio-lab" /></Route>
        <Route path="/market-intelligence"><Redirect to="/portfolio-lab" /></Route>
        <Route path="/settings"><Redirect to="/" /></Route>
        <Route path="/configuration"><Redirect to="/" /></Route>
        <Route path="/backtesting"><Redirect to="/portfolio-lab" /></Route>
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
        <SettingsDrawerProvider>
          <UxPreferencesProvider>
            <WouterRouter>
              <Router />
            </WouterRouter>
            <Toaster />
          </UxPreferencesProvider>
        </SettingsDrawerProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
