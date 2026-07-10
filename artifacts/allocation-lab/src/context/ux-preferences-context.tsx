import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { localSettings } from "@/lib/local-settings";

interface UxPreferencesContextValue {
  demoMode: boolean;
  setDemoMode: (enabled: boolean) => void;
  tourOpen: boolean;
  openTour: () => void;
  closeTour: () => void;
  onboardingComplete: boolean;
  completeOnboarding: () => void;
}

const UxPreferencesContext = createContext<UxPreferencesContextValue | null>(null);

export function UxPreferencesProvider({ children }: { children: ReactNode }) {
  const [demoMode, setDemoModeState] = useState(() => localSettings.getDemoMode());
  const [onboardingComplete, setOnboardingCompleteState] = useState(() => localSettings.getOnboardingComplete());
  const [tourOpen, setTourOpen] = useState(() => !localSettings.getOnboardingComplete());

  const setDemoMode = useCallback((enabled: boolean) => {
    setDemoModeState(enabled);
    localSettings.setDemoMode(enabled);
  }, []);

  const completeOnboarding = useCallback(() => {
    setOnboardingCompleteState(true);
    localSettings.setOnboardingComplete(true);
    setTourOpen(false);
  }, []);

  const openTour = useCallback(() => setTourOpen(true), []);
  const closeTour = useCallback(() => {
    setTourOpen(false);
    if (!onboardingComplete) {
      completeOnboarding();
    }
  }, [onboardingComplete, completeOnboarding]);

  const value = useMemo<UxPreferencesContextValue>(() => ({
    demoMode,
    setDemoMode,
    tourOpen,
    openTour,
    closeTour,
    onboardingComplete,
    completeOnboarding,
  }), [demoMode, setDemoMode, tourOpen, openTour, closeTour, onboardingComplete, completeOnboarding]);

  return <UxPreferencesContext.Provider value={value}>{children}</UxPreferencesContext.Provider>;
}

export function useUxPreferences() {
  const ctx = useContext(UxPreferencesContext);
  if (!ctx) throw new Error("useUxPreferences must be used within UxPreferencesProvider");
  return ctx;
}
