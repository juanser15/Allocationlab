// Client-persisted settings for config sections that have no dedicated backend table.
// These are real, user-editable, persisted values (localStorage) — not mocked data.
// They seed default values used elsewhere in the app (Research Lab backtest config,
// report builder, etc.) rather than existing purely for display.

export interface ExecutionAssumptions {
  executionTiming: "next_close" | "next_open";
  transactionCostBps: number;
  slippageBps: number;
  cashYieldAnnualPct: number;
  rebalanceFrequency: "monthly" | "quarterly";
}

export interface ModelFactorsInfo {
  modelVersion: string;
}

export interface BenchmarksSettings {
  defaultBenchmark: string;
  customBenchmarks: string[];
}

export interface ReportingDefaults {
  reportTitle: string;
  reportSubtitle: string;
  portfolioName: string;
  dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
  disclaimerText: string;
  exportFormat: "pdf" | "csv" | "png";
}

export interface GovernanceSettings {
  parameterVersion: string;
  archiveAutomatically: boolean;
}

export const DEFAULT_EXECUTION_ASSUMPTIONS: ExecutionAssumptions = {
  executionTiming: "next_close",
  transactionCostBps: 5,
  slippageBps: 3,
  cashYieldAnnualPct: 4.5,
  rebalanceFrequency: "monthly",
};

export const DEFAULT_BENCHMARKS_SETTINGS: BenchmarksSettings = {
  defaultBenchmark: "SPY",
  customBenchmarks: [],
};

export const DEFAULT_REPORTING_DEFAULTS: ReportingDefaults = {
  reportTitle: "Monthly Allocation Committee Report",
  reportSubtitle: "Systematic Factor-Based Sector Allocation",
  portfolioName: "Sector Rotation Portfolio",
  dateFormat: "MM/DD/YYYY",
  disclaimerText:
    "This report is generated for internal investment committee use only and does not constitute investment advice. Past performance is not indicative of future results.",
  exportFormat: "pdf",
};

export const DEFAULT_GOVERNANCE_SETTINGS: GovernanceSettings = {
  parameterVersion: "1.0.0",
  archiveAutomatically: true,
};

const KEYS = {
  execution: "allocation-lab.settings.execution",
  benchmarks: "allocation-lab.settings.benchmarks",
  reporting: "allocation-lab.settings.reporting",
  governance: "allocation-lab.settings.governance",
} as const;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const localSettings = {
  getExecutionAssumptions: () => load(KEYS.execution, DEFAULT_EXECUTION_ASSUMPTIONS),
  setExecutionAssumptions: (v: ExecutionAssumptions) => save(KEYS.execution, v),

  getBenchmarksSettings: () => load(KEYS.benchmarks, DEFAULT_BENCHMARKS_SETTINGS),
  setBenchmarksSettings: (v: BenchmarksSettings) => save(KEYS.benchmarks, v),

  getReportingDefaults: () => load(KEYS.reporting, DEFAULT_REPORTING_DEFAULTS),
  setReportingDefaults: (v: ReportingDefaults) => save(KEYS.reporting, v),

  getGovernanceSettings: () => load(KEYS.governance, DEFAULT_GOVERNANCE_SETTINGS),
  setGovernanceSettings: (v: GovernanceSettings) => save(KEYS.governance, v),

  resetAllLocalSettings: () => {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  },
};
