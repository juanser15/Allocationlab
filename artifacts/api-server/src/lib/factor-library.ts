import { db, configTable, priceDataTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

export type FactorRegime = "risk_on" | "neutral" | "risk_off";
export type FactorCalculationType =
  | "momentum" | "trend_quality" | "volatility" | "drawdown"
  | "mean_reversion" | "relative_strength" | "diversification_benefit"
  | "return_over_volatility" | "ma_distance" | "downside_beta"
  | "residual_momentum" | "correlation_stability" | "drawdown_recovery"
  | "unsupported";

export interface FactorDefinition {
  id: string;
  name: string;
  description: string;
  family: string;
  enabled: boolean;
  status: "active" | "candidate" | "disabled";
  inputSeries: string;
  calculationType: FactorCalculationType;
  formula: string;
  direction: "higher_is_better" | "lower_is_better";
  lookback: number;
  lag: number;
  normalization: "percentile_rank" | "z_score" | "robust_z_score";
  winsorizationLower: number;
  winsorizationUpper: number;
  missingDataTreatment: "exclude" | "cross_sectional_median";
  baseWeight: number;
  regimeWeights: { riskOn: number | null; neutral: number | null; riskOff: number | null };
  activeRegimes: FactorRegime[];
  dataSource: string;
  benchmarkTicker: string | null;
  currentCoverage: number;
  availabilityReason: string | null;
  version: string;
}

interface FactorSetVersion {
  version: string;
  createdAt: string;
  factors: FactorDefinition[];
}

interface StoredFactorLibrary {
  version: string;
  updatedAt: string;
  factors: FactorDefinition[];
  history: FactorSetVersion[];
}

const CONFIG_KEY = "factor_library";

const base = {
  enabled: true,
  status: "active" as const,
  inputSeries: "Adjusted close price",
  lag: 1,
  normalization: "percentile_rank" as const,
  winsorizationLower: 0.05,
  winsorizationUpper: 0.95,
  missingDataTreatment: "exclude" as const,
  activeRegimes: ["risk_on", "neutral", "risk_off"] as FactorRegime[],
  dataSource: "Latest persisted adjusted-close price dataset",
  currentCoverage: 0,
  availabilityReason: null,
  version: "v1.0",
};

export const DEFAULT_FACTORS: FactorDefinition[] = [
  { ...base, id: "momentum", name: "Momentum", description: "Medium-term total return over the configured lookback.", family: "Momentum", calculationType: "momentum", formula: "P(t-lag) / P(t-lag-lookback) - 1", direction: "higher_is_better", lookback: 120, baseWeight: 0.25, regimeWeights: { riskOn: 0.35, neutral: 0.25, riskOff: 0.10 }, benchmarkTicker: null },
  { ...base, id: "trend_quality", name: "Trend Quality", description: "Direction-preserving goodness of fit for log price regressed on time.", family: "Trend", calculationType: "trend_quality", formula: "sign(beta) × R² where log(P_t) = alpha + beta × t + epsilon_t", direction: "higher_is_better", lookback: 120, baseWeight: 0.20, regimeWeights: { riskOn: 0.30, neutral: 0.25, riskOff: 0.15 }, benchmarkTicker: null },
  { ...base, id: "volatility", name: "Volatility", description: "Annualized realized volatility; lower values receive stronger normalized scores.", family: "Risk", calculationType: "volatility", formula: "stdev(daily returns, lookback) × √252", direction: "lower_is_better", lookback: 60, baseWeight: 0.15, regimeWeights: { riskOn: 0.10, neutral: 0.20, riskOff: 0.30 }, benchmarkTicker: null },
  { ...base, id: "drawdown_risk_fit", name: "Drawdown / Risk Fit", description: "Maximum peak-to-trough loss over the configured lookback.", family: "Risk", calculationType: "drawdown", formula: "min(P(t) / running_max(P) - 1)", direction: "higher_is_better", lookback: 252, baseWeight: 0.15, regimeWeights: { riskOn: 0.10, neutral: 0.15, riskOff: 0.30 }, benchmarkTicker: null },
  { ...base, id: "mean_reversion", name: "Mean Reversion", description: "Short-term reversal measured as the negative configured-lookback total return.", family: "Reversal", calculationType: "mean_reversion", formula: "-return(lookback)", direction: "higher_is_better", lookback: 5, baseWeight: 0.05, regimeWeights: { riskOn: 0.05, neutral: 0.05, riskOff: 0.05 }, benchmarkTicker: null },
  { ...base, id: "relative_strength", name: "Relative Strength", description: "Return in excess of a configured benchmark over the same window.", family: "Relative Value", calculationType: "relative_strength", formula: "return(asset, lookback) - return(benchmark, lookback)", direction: "higher_is_better", lookback: 63, baseWeight: 0.10, regimeWeights: { riskOn: 0.05, neutral: 0.05, riskOff: 0.05 }, benchmarkTicker: "SPY" },
  { ...base, id: "diversification_benefit", name: "Diversification / Correlation Benefit", description: "Low average correlation to the rest of the investable universe.", family: "Diversification", calculationType: "diversification_benefit", formula: "1 - mean(correlation(asset, peers), lookback)", direction: "higher_is_better", lookback: 120, baseWeight: 0.10, regimeWeights: { riskOn: 0.05, neutral: 0.05, riskOff: 0.05 }, benchmarkTicker: null },
];

function defaultLibrary(): StoredFactorLibrary {
  const createdAt = new Date().toISOString();
  const factors = DEFAULT_FACTORS.map((factor) => ({ ...factor, regimeWeights: { ...factor.regimeWeights }, activeRegimes: [...factor.activeRegimes] }));
  return { version: "v1.0", updatedAt: createdAt, factors, history: [{ version: "v1.0", createdAt, factors }] };
}

function nextVersion(current: string): string {
  const match = current.match(/^v(\d+)\.(\d+)$/);
  return match ? `v${match[1]}.${Number(match[2]) + 1}` : "v1.1";
}

async function readStored(): Promise<StoredFactorLibrary> {
  const row = await db.select().from(configTable).where(eq(configTable.key, CONFIG_KEY)).then((rows) => rows[0]);
  if (!row) return defaultLibrary();
  try {
    return JSON.parse(row.value) as StoredFactorLibrary;
  } catch {
    return defaultLibrary();
  }
}

async function coverageFor(factor: FactorDefinition): Promise<{ coverage: number; reason: string | null }> {
  if (["unsupported", "residual_momentum", "correlation_stability"].includes(factor.calculationType)) {
    return { coverage: 0, reason: `Unsupported calculation type: ${factor.calculationType}.` };
  }
  if (factor.inputSeries.toLowerCase().includes("fundamental")) {
    return { coverage: 0, reason: "Factor unavailable: required input data is missing." };
  }
  const row = await db.select().from(priceDataTable).orderBy(desc(priceDataTable.uploadedAt)).limit(1).then((rows) => rows[0]);
  if (!row) return { coverage: 0, reason: "Factor unavailable: required input data is missing." };
  const requiredRows = factor.lookback + factor.lag + 1;
  if (row.rowCount < requiredRows) return { coverage: 0, reason: "Factor unavailable: required input data is missing." };
  const tickers = JSON.parse(row.tickers) as string[];
  if (factor.benchmarkTicker && !tickers.includes(factor.benchmarkTicker)) {
    return { coverage: 0, reason: "Factor unavailable: required input data is missing." };
  }
  return { coverage: tickers.length > 0 ? 1 : 0, reason: null };
}

async function enrich(library: StoredFactorLibrary) {
  const factors = await Promise.all(library.factors.map(async (factor) => {
    const { coverage, reason } = await coverageFor(factor);
    return { ...factor, currentCoverage: coverage, availabilityReason: reason };
  }));
  return {
    version: library.version,
    updatedAt: library.updatedAt,
    factors,
    history: library.history.map((entry) => ({
      version: entry.version,
      createdAt: entry.createdAt,
      activeFactorCount: entry.factors.filter((factor) => factor.enabled && factor.status === "active").length,
      factorCount: entry.factors.length,
    })),
  };
}

export async function getFactorLibrary() {
  return enrich(await readStored());
}

export async function getFactorSetSnapshot(): Promise<{ version: string; factors: FactorDefinition[] }> {
  const library = await getFactorLibrary();
  return { version: library.version, factors: library.factors };
}

export async function saveFactorLibrary(inputFactors: Omit<FactorDefinition, "currentCoverage" | "availabilityReason" | "version">[]) {
  const current = await readStored();
  const version = nextVersion(current.version);
  const updatedAt = new Date().toISOString();
  const factors: FactorDefinition[] = inputFactors.map((factor) => ({
    ...factor,
    currentCoverage: 0,
    availabilityReason: null,
    version,
  }));
  if (!factors.some((factor) => factor.enabled && factor.status === "active" && factor.baseWeight > 0)) {
    throw new Error("At least one active factor must have a positive weight.");
  }
  const ids = factors.map((factor) => factor.id);
  if (new Set(ids).size !== ids.length) throw new Error("Factor IDs must be unique.");
  const next: StoredFactorLibrary = {
    version,
    updatedAt,
    factors,
    history: [...current.history, { version, createdAt: updatedAt, factors }].slice(-50),
  };
  const value = JSON.stringify(next);
  const existing = await db.select().from(configTable).where(eq(configTable.key, CONFIG_KEY)).then((rows) => rows[0]);
  if (existing) await db.update(configTable).set({ value, updatedAt: new Date() }).where(eq(configTable.key, CONFIG_KEY));
  else await db.insert(configTable).values({ key: CONFIG_KEY, value });
  return enrich(next);
}

export async function restoreFactorLibrary(version: string) {
  const current = await readStored();
  const historical = current.history.find((entry) => entry.version === version);
  if (!historical) return null;
  return saveFactorLibrary(historical.factors.map(({ currentCoverage: _coverage, availabilityReason: _reason, version: _version, ...factor }) => factor));
}

export function regimeKey(label: string): FactorRegime {
  if (label === "Risk-On" || label === "Constructive") return "risk_on";
  if (label === "Risk-Off") return "risk_off";
  return "neutral";
}

export function configuredWeight(factor: FactorDefinition, regime: FactorRegime): number {
  if (!factor.activeRegimes.includes(regime)) return 0;
  const weight = regime === "risk_on" ? factor.regimeWeights.riskOn : regime === "risk_off" ? factor.regimeWeights.riskOff : factor.regimeWeights.neutral;
  return weight ?? 0;
}