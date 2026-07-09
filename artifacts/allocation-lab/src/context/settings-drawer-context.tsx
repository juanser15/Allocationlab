import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";

export type SettingsSectionId =
  | "data-sources"
  | "universe"
  | "constraints"
  | "previous-weights"
  | "execution"
  | "model-factors"
  | "benchmarks"
  | "reporting"
  | "governance";

export interface SectionStatus {
  dirty: boolean;
  errorCount: number;
}

interface SettingsDrawerState {
  isOpen: boolean;
  activeSection: SettingsSectionId;
  openSettings: (section?: SettingsSectionId) => void;
  requestClose: () => void;
  confirmDiscardAndClose: () => void;
  cancelCloseRequest: () => void;
  showCloseConfirm: boolean;
  sectionStatuses: Record<string, SectionStatus>;
  reportSectionStatus: (id: SettingsSectionId, status: SectionStatus) => void;
  hasUnsavedChanges: boolean;
  totalErrors: number;
  restoreDefaultsSignal: number;
  triggerRestoreDefaults: () => void;
}

const SettingsDrawerContext = createContext<SettingsDrawerState | null>(null);

export function SettingsDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("data-sources");
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [sectionStatuses, setSectionStatuses] = useState<Record<string, SectionStatus>>({});
  const [restoreDefaultsSignal, setRestoreDefaultsSignal] = useState(0);

  const openSettings = (section?: SettingsSectionId) => {
    if (section) setActiveSection(section);
    setIsOpen(true);
  };

  const hasUnsavedChanges = useMemo(
    () => Object.values(sectionStatuses).some((s) => s.dirty),
    [sectionStatuses]
  );
  const totalErrors = useMemo(
    () => Object.values(sectionStatuses).reduce((sum, s) => sum + s.errorCount, 0),
    [sectionStatuses]
  );

  const requestClose = () => {
    if (hasUnsavedChanges) {
      setShowCloseConfirm(true);
    } else {
      setIsOpen(false);
    }
  };
  const confirmDiscardAndClose = () => {
    setShowCloseConfirm(false);
    setIsOpen(false);
  };
  const cancelCloseRequest = () => setShowCloseConfirm(false);

  const reportSectionStatus = useCallback((id: SettingsSectionId, status: SectionStatus) => {
    setSectionStatuses((prev) => {
      const existing = prev[id];
      if (existing && existing.dirty === status.dirty && existing.errorCount === status.errorCount) return prev;
      return { ...prev, [id]: status };
    });
  }, []);

  const triggerRestoreDefaults = () => setRestoreDefaultsSignal((n) => n + 1);

  return (
    <SettingsDrawerContext.Provider
      value={{
        isOpen,
        activeSection,
        openSettings,
        requestClose,
        confirmDiscardAndClose,
        cancelCloseRequest,
        showCloseConfirm,
        sectionStatuses,
        reportSectionStatus,
        hasUnsavedChanges,
        totalErrors,
        restoreDefaultsSignal,
        triggerRestoreDefaults,
      }}
    >
      {children}
    </SettingsDrawerContext.Provider>
  );
}

export function useSettingsDrawer() {
  const ctx = useContext(SettingsDrawerContext);
  if (!ctx) throw new Error("useSettingsDrawer must be used within SettingsDrawerProvider");
  return ctx;
}
