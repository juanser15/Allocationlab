import { computeFactors, parseCsv, type PriceRow } from "./calculator";
import type { FactorDefinition } from "./factor-library";
import type { PreparedSnapshot } from "./prepared-inputs";

export type SignalRidgeExecutionTiming = "same_close" | "next_close";

/** All B1 stages are retained. `transformedValue` is B1's direction-applied value. */
export interface SignalRidgeFeatureStages {
  rawValue: number | null;
  transformedValue: number | null;
  winsorizedValue: number | null;
  orientedValue: number | null;
  normalizedValue: number | null;
  imputed: boolean;
}

/** One asset's values and post-execution outcome for a hypothetical decision date. */
export interface SignalRidgePanelRow {
  signalDate: string;
  informationCutoff: string;
  calendarIndex: number;
  ticker: string;
  peerUniverse: string[];
  features: Record<string, SignalRidgeFeatureStages>;
  featureVector: Array<number | null>;
  executionDate: string | null;
  labelStart: string | null;
  labelEnd: string | null;
  excessReturnLabel: number | null;
  labelStatus: "MATURED" | "PENDING" | "UNAVAILABLE";
}

export interface SignalRidgeExcludedTrainingDate {
  signalDate: string;
  informationCutoff: string;
  calendarIndex: number;
  reasons: string[];
}

export interface SignalRidgePanel {
  schemaVersion: 1;
  horizon: "one close-to-close interval after execution close";
  labelDefinition: "asset arithmetic close-to-close return minus daily cash return over the same interval";
  source: { datasetHash: string; factorSetVersion: string; priceConvention: string };
  asOfCutoff: string;
  executionTiming: SignalRidgeExecutionTiming;
  dailyCashReturn: number;
  assetTickers: string[];
  peerUniverse: string[];
  requestedFactorIds: string[];
  canonicalFactorIds: string[];
  factorAliases: Record<string, string>;
  /** Feature rows include the current as-of decision; only fully matured historical rows train. */
  panelRows: SignalRidgePanelRow[];
  trainingRows: SignalRidgePanelRow[];
  excludedTrainingDates: SignalRidgeExcludedTrainingDate[];
  currentSignalDate: string;
  currentSignalIsVirtual: boolean;
  declaredDecisionDate: string | null;
  currentRows: SignalRidgePanelRow[];
}

const SUPPORTED_CALCULATIONS = new Set([
  "momentum", "trend_quality", "volatility", "drawdown", "mean_reversion",
  "relative_strength", "diversification_benefit", "return_over_volatility",
  "ma_distance", "downside_beta", "drawdown_recovery",
]);

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function executableDefinition(factor: FactorDefinition): unknown {
  return {
    inputSeries: factor.inputSeries,
    calculationType: factor.calculationType,
    formula: factor.formula,
    direction: factor.direction,
    lookback: factor.lookback,
    lag: factor.lag,
    normalization: factor.normalization,
    winsorizationLower: factor.winsorizationLower,
    winsorizationUpper: factor.winsorizationUpper,
    missingDataTreatment: factor.missingDataTreatment,
    benchmarkTicker: factor.benchmarkTicker?.toUpperCase() ?? null,
  };
}

function sameExecutableDefinition(left: FactorDefinition, right: FactorDefinition): boolean {
  return JSON.stringify(executableDefinition(left)) === JSON.stringify(executableDefinition(right));
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

function hasB1History(rows: PriceRow[], peerUniverse: string[], factor: FactorDefinition): boolean {
  const requiredRows = factor.lookback + factor.lag + 1;
  if (rows.length < requiredRows) return false;
  return rows.slice(-requiredRows).every((row) => peerUniverse.every((ticker) =>
    Number.isFinite(row.prices[ticker]) && row.prices[ticker] > 0));
}

function featureStages(
  rowsBeforeSignal: PriceRow[],
  peerUniverse: string[],
  factor: FactorDefinition,
): Map<string, SignalRidgeFeatureStages> {
  const empty = new Map<string, SignalRidgeFeatureStages>();
  if (!hasB1History(rowsBeforeSignal, peerUniverse, factor)) return empty;
  const data = computeFactors(rowsBeforeSignal, peerUniverse, { factors: [factor] });
  const output = new Map<string, SignalRidgeFeatureStages>();
  for (const ticker of peerUniverse) {
    const contribution = data.find((item) => item.ticker === ticker)?.factorContributions
      .find((item) => item.factorId === factor.id);
    const rawValue = finiteOrNull(contribution?.rawValue);
    const transformedValue = finiteOrNull(contribution?.transformedValue);
    const orientedValue = rawValue === null ? null
      : factor.direction === "lower_is_better" ? -rawValue : rawValue;
    output.set(ticker, {
      rawValue,
      transformedValue,
      winsorizedValue: finiteOrNull(contribution?.winsorizedValue),
      // computeFactors applies direction before winsorization and normalization.
      // Keep this explicit B1 stage for audit; do not orient it again downstream.
      orientedValue,
      normalizedValue: finiteOrNull(contribution?.normalizedValue),
      imputed: contribution?.calculationStatus === "imputed",
    });
  }
  return output;
}

function findClose(rows: PriceRow[], ticker: string, dateIndex: number): number | null {
  const value = rows[dateIndex]?.prices[ticker];
  return Number.isFinite(value) && value > 0 ? value : null;
}

function csvCalendarDates(csvContent: string, endDate: string): string[] {
  const lines = csvContent.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const dates = new Set<string>();
  for (const line of lines.slice(1)) {
    const date = line.trim().split(",")[0]?.trim().replace(/"/g, "");
    if (date && validDate(date) && (!endDate || date <= endDate)) dates.add(date);
  }
  return [...dates].sort((a, b) => a.localeCompare(b));
}

/**
 * Reconstructs B1's point-in-time factor panel solely from a frozen asset-return
 * preparation's CSV and factor set. Signal features at date i use exactly
 * `rows.slice(0, i)`; the signal date's prices never enter its own features.
 * Training labels are exposed only after their complete post-execution interval
 * has matured by `asOfCutoff`. A missing current feature throws instead of
 * manufacturing a zero or silently dropping an asset/factor.
 */
export function buildSignalRidgePanel(input: {
  snapshot: PreparedSnapshot;
  factorIds: string[];
  assetTickers: string[];
  asOfCutoff: string;
  decisionDate?: string;
  executionTiming: SignalRidgeExecutionTiming;
  dailyCashReturn: number;
}): SignalRidgePanel {
  const { snapshot, asOfCutoff, executionTiming, dailyCashReturn } = input;
  if (!snapshot || snapshot.representation !== "asset_returns")
    throw new Error("Signal Ridge panel requires a frozen asset_returns PreparedSnapshot.");
  if (!snapshot.dataset.csvContent || !snapshot.factorSet?.factors)
    throw new Error("Signal Ridge panel requires frozen CSV content and a frozen factor set.");
  if (!validDate(asOfCutoff)) throw new Error("asOfCutoff must be a valid YYYY-MM-DD date.");
  if (input.decisionDate !== undefined &&
      (!validDate(input.decisionDate) || input.decisionDate <= asOfCutoff))
    throw new Error("decisionDate must be a valid YYYY-MM-DD date strictly after asOfCutoff.");
  if (!["same_close", "next_close"].includes(executionTiming))
    throw new Error("Signal Ridge supports only same_close or next_close execution timing.");
  if (!Number.isFinite(dailyCashReturn) || dailyCashReturn <= -1)
    throw new Error("dailyCashReturn must be finite and greater than -1.");

  const assetTickers = [...new Set(input.assetTickers.map((ticker) => ticker.trim().toUpperCase()))];
  if (!assetTickers.length || assetTickers.some((ticker) => !ticker) ||
      assetTickers.length !== input.assetTickers.length)
    throw new Error("Candidate asset tickers must be nonempty and unique.");
  const availableTickers = new Set(snapshot.dataset.tickers.map((ticker) => ticker.toUpperCase()));
  const missingAssets = assetTickers.filter((ticker) => !availableTickers.has(ticker));
  if (missingAssets.length) throw new Error(`Candidate assets are absent from the frozen dataset: ${missingAssets.join(", ")}.`);
  if (!input.factorIds.length) throw new Error("Select at least one canonical factor ID.");
  if (new Set(input.factorIds).size !== input.factorIds.length)
    throw new Error("Selected factor IDs must be unique before exact-definition alias canonicalization.");

  const factorById = new Map<string, FactorDefinition>();
  for (const factor of snapshot.factorSet.factors) {
    if (factorById.has(factor.id)) throw new Error(`Frozen factor set contains duplicate factor ID ${factor.id}.`);
    factorById.set(factor.id, factor);
  }
  const selected = input.factorIds.map((id) => {
    const factor = factorById.get(id);
    if (!factor) throw new Error(`Selected canonical factor ID ${id} is missing from the frozen factor set.`);
    if (!factor.enabled || factor.status !== "active")
      throw new Error(`Selected factor ${id} is not enabled and active in the frozen factor set.`);
    if (!SUPPORTED_CALCULATIONS.has(factor.calculationType))
      throw new Error(`Selected factor ${id} uses unsupported calculation ${factor.calculationType}.`);
    if (!Number.isInteger(factor.lookback) || factor.lookback < 1 ||
        !Number.isInteger(factor.lag) || factor.lag < 0)
      throw new Error(`Selected factor ${id} has invalid lookback or lag settings.`);
    if (factor.benchmarkTicker && !assetTickers.includes(factor.benchmarkTicker.toUpperCase()))
      throw new Error(`Selected factor ${id} requires benchmark ${factor.benchmarkTicker} in the candidate asset universe.`);
    return factor;
  });

  const canonicalFactors: FactorDefinition[] = [];
  const factorAliases: Record<string, string> = {};
  for (const factor of selected) {
    const exact = canonicalFactors.find((candidate) => sameExecutableDefinition(candidate, factor));
    const canonical = exact?.id ?? factor.id;
    if (!exact) canonicalFactors.push(factor);
    factorAliases[factor.id] = canonical;
  }
  const canonicalFactorIds = canonicalFactors.map((factor) => factor.id);

  let parsed: PriceRow[];
  try {
    parsed = parseCsv(snapshot.dataset.csvContent);
  } catch (error) {
    throw new Error(`Frozen asset-return CSV could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  // A prepared snapshot may itself have a frozen data cutoff even if its source
  // CSV contains later lines. Never expand that prepared coverage.
  const frozenEnd = snapshot.dataset.endDate;
  const rows = parsed.filter((row) => !frozenEnd || row.date <= frozenEnd);
  const calendarDates = csvCalendarDates(snapshot.dataset.csvContent, frozenEnd);
  const calendarIndexes = new Map(calendarDates.map((date, index) => [date, index]));
  const cutoffIndex = rows.findIndex((row) => row.date === asOfCutoff);
  if (cutoffIndex < 0) throw new Error(`asOfCutoff ${asOfCutoff} is not an observation date in the frozen dataset.`);
  if (snapshot.dataset.startDate && asOfCutoff < snapshot.dataset.startDate)
    throw new Error("asOfCutoff precedes the frozen dataset coverage.");
  const currentSignalIndex = cutoffIndex + 1;
  const hasFollowingSignalObservation = rows[currentSignalIndex] !== undefined;
  const currentSignalIsVirtual = !hasFollowingSignalObservation;
  if (hasFollowingSignalObservation && input.decisionDate !== undefined &&
      rows[currentSignalIndex].date !== input.decisionDate)
    throw new Error(`Declared decisionDate ${input.decisionDate} does not match the frozen following observation ${rows[currentSignalIndex].date}.`);
  if (currentSignalIsVirtual && input.decisionDate === undefined)
    throw new Error(`No following signal date exists after as-of cutoff ${asOfCutoff}; declare decisionDate to create a point-in-time current row.`);
  const currentSignalDate = hasFollowingSignalObservation
    ? rows[currentSignalIndex].date : input.decisionDate!;
  const virtualCalendarIndex = calendarIndexes.get(currentSignalDate) ??
    calendarDates.filter((date) => date < currentSignalDate).length;
  if (executionTiming === "next_close" &&
      (!hasFollowingSignalObservation || rows[currentSignalIndex + 1] === undefined))
    throw new Error(`next_close execution after decisionDate ${currentSignalDate} is unavailable because no following trading-calendar observation exists.`);
  const peerUniverse = [...assetTickers];
  const panelRows: SignalRidgePanelRow[] = [];

  // The feature loop's upper bound uses only date-calendar metadata. Its price
  // values are never passed to computeFactors: each call receives rows.slice(0, i).
  const signalIndexes = [
    ...Array.from({ length: cutoffIndex }, (_, index) => index + 1),
    currentSignalIndex,
  ];
  for (const i of signalIndexes) {
    const isVirtualCurrent = currentSignalIsVirtual && i === currentSignalIndex;
    const informationCutoff = rows[i - 1].date;
    if (informationCutoff > asOfCutoff) break;
    const prefix = rows.slice(0, i);
    const byFactor = new Map<string, Map<string, SignalRidgeFeatureStages>>();
    for (const factor of canonicalFactors)
      byFactor.set(factor.id, featureStages(prefix, peerUniverse, factor));

    const executionIndex = i + (executionTiming === "same_close" ? 0 : 1);
    const labelEndIndex = executionIndex + 1;
    const executionDate = isVirtualCurrent
      ? currentSignalDate
      : rows[executionIndex]?.date ?? null;
    const labelStart = executionDate;
    const labelEnd = isVirtualCurrent ? null : rows[labelEndIndex]?.date ?? null;
    const labelMatured = labelEnd !== null && labelEnd <= asOfCutoff;

    for (const ticker of assetTickers) {
      const features: Record<string, SignalRidgeFeatureStages> = {};
      const featureVector: Array<number | null> = [];
      for (const factor of canonicalFactors) {
        const stages = byFactor.get(factor.id)?.get(ticker) ?? {
          rawValue: null, transformedValue: null, winsorizedValue: null,
          orientedValue: null, normalizedValue: null, imputed: false,
        };
        features[factor.id] = stages;
        featureVector.push(stages.normalizedValue);
      }

      let excessReturnLabel: number | null = null;
      let labelStatus: SignalRidgePanelRow["labelStatus"] = labelEnd === null
        ? isVirtualCurrent && executionTiming === "same_close" ? "PENDING" : "UNAVAILABLE"
        : "PENDING";
      if (labelMatured) {
        const startPrice = findClose(rows, ticker, executionIndex);
        const endPrice = findClose(rows, ticker, labelEndIndex);
        if (startPrice !== null && endPrice !== null) {
          excessReturnLabel = endPrice / startPrice - 1 - dailyCashReturn;
          labelStatus = Number.isFinite(excessReturnLabel) ? "MATURED" : "UNAVAILABLE";
          if (!Number.isFinite(excessReturnLabel)) excessReturnLabel = null;
        } else {
          labelStatus = "UNAVAILABLE";
        }
      }
      panelRows.push({
        signalDate: isVirtualCurrent ? currentSignalDate : rows[i].date,
        informationCutoff,
        calendarIndex: isVirtualCurrent
          ? virtualCalendarIndex
          : calendarIndexes.get(rows[i].date) ?? i,
        ticker,
        peerUniverse: [...peerUniverse],
        features,
        featureVector,
        executionDate,
        labelStart,
        labelEnd,
        excessReturnLabel,
        labelStatus,
      });
    }
  }

  const currentRows = panelRows.filter((row) => row.signalDate === currentSignalDate);
  const missingCurrent = currentRows.flatMap((row) => canonicalFactorIds.flatMap((factorId, featureIndex) =>
    row.featureVector[featureIndex] === null
      ? [`${row.ticker}/${factorId}`]
      : []));
  if (missingCurrent.length)
    throw new Error(`Current as-of features are missing for ${missingCurrent.join(", ")}; no forecast row was fabricated.`);

  const trainingRows: SignalRidgePanelRow[] = [];
  const excludedTrainingDates: SignalRidgeExcludedTrainingDate[] = [];
  const historicalDates = [...new Set(panelRows.filter((row) => row.informationCutoff < asOfCutoff)
    .map((row) => row.signalDate))];
  for (const signalDate of historicalDates) {
    const dateRows = panelRows.filter((row) => row.signalDate === signalDate);
    const reasons: string[] = [];
    const missingFeatures = dateRows.flatMap((row) => canonicalFactorIds.flatMap((factorId, featureIndex) =>
      row.featureVector[featureIndex] === null ? [`${row.ticker}/${factorId}`] : []));
    if (missingFeatures.length) reasons.push(`incomplete_features:${missingFeatures.join(",")}`);
    const notMatured = dateRows.filter((row) => row.labelStatus === "PENDING");
    if (notMatured.length) reasons.push("label_not_matured_by_fit_cutoff");
    const unavailable = dateRows.filter((row) => row.labelStatus === "UNAVAILABLE");
    if (unavailable.length) reasons.push(`label_unavailable:${unavailable.map((row) => row.ticker).join(",")}`);
    if (reasons.length) {
      excludedTrainingDates.push({
        signalDate,
        informationCutoff: dateRows[0].informationCutoff,
        calendarIndex: dateRows[0].calendarIndex,
        reasons,
      });
    } else {
      trainingRows.push(...dateRows);
    }
  }

  return {
    schemaVersion: 1,
    horizon: "one close-to-close interval after execution close",
    labelDefinition: "asset arithmetic close-to-close return minus daily cash return over the same interval",
    source: {
      datasetHash: snapshot.dataset.sha256,
      factorSetVersion: snapshot.factorSet.version,
      priceConvention: snapshot.dataset.priceConvention,
    },
    asOfCutoff,
    executionTiming,
    dailyCashReturn,
    assetTickers,
    peerUniverse,
    requestedFactorIds: [...input.factorIds],
    canonicalFactorIds,
    factorAliases,
    panelRows,
    trainingRows,
    excludedTrainingDates,
    currentSignalDate,
    currentSignalIsVirtual,
    declaredDecisionDate: input.decisionDate ?? null,
    currentRows,
  };
}