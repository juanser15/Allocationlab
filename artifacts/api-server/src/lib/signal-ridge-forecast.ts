import type { PreparedSnapshot } from "./prepared-inputs";
import type { ForecastModelConfig, ForecastResult } from "./forecast-d3";
import { fitSignalRidge, predictSignalRidge, type SignalRidgeTrainingRow } from "./signal-ridge";
import { buildSignalRidgePanel } from "./signal-ridge-panel";

export const SIGNAL_RIDGE_ENGINE_VERSION = "D6.1.0" as const;

/**
 * Shared B2/B3 provider. Its only sources are the frozen B1 snapshot and the
 * point-in-time cutoff; it never reads the latest factor settings or dataset.
 */
export function buildSignalRidgeForecast(input: {
  snapshot: PreparedSnapshot;
  config: Extract<ForecastModelConfig, { type: "SIGNAL_RIDGE" }>;
  candidateIds: string[];
  assetTickers: string[];
  informationCutoff: string;
  decisionDate: string;
  dailyCashYield: number;
  sigma: number[][];
}): ForecastResult {
  const { config } = input;
  if (!Array.isArray(config.factorIds) || !config.factorIds.length ||
    !Number.isFinite(config.lambdaSignal) || config.lambdaSignal <= 0 ||
    !Number.isInteger(config.trainingWindowDates) || config.trainingWindowDates < 2 ||
    !Number.isInteger(config.minTrainingDates) || config.minTrainingDates < 2 ||
    !Number.isInteger(config.hacBandwidth) || config.hacBandwidth < 0 ||
    !["same_close", "next_close"].includes(config.executionTiming))
    throw new Error("SIGNAL_RIDGE requires selected factors, positive lambda, integer training window/minimum, nonnegative integer HAC bandwidth, and supported execution timing.");
  if (input.candidateIds.length !== input.assetTickers.length ||
    new Set(input.candidateIds).size !== input.candidateIds.length)
    throw new Error("SIGNAL_RIDGE candidate IDs and assets must have the same unique order.");
  const panel = buildSignalRidgePanel({
    snapshot: input.snapshot, factorIds: config.factorIds, assetTickers: input.assetTickers,
    asOfCutoff: input.informationCutoff, executionTiming: config.executionTiming,
    dailyCashReturn: input.dailyCashYield, decisionDate: input.decisionDate,
  });
  const minimum = Math.max(60, 5 * (panel.canonicalFactorIds.length + 1));
  if (config.minTrainingDates < minimum)
    throw new Error(`SIGNAL_RIDGE minimum training dates cannot be below ${minimum} for this factor set.`);
  if (config.trainingWindowDates < config.minTrainingDates)
    throw new Error("SIGNAL_RIDGE training window cannot be shorter than the minimum complete dates.");
  const completeDates = [...new Set(panel.trainingRows.map((row) => row.signalDate))].sort();
  const chosenDates = completeDates.slice(-config.trainingWindowDates);
  if (chosenDates.length < config.minTrainingDates || chosenDates.length <= config.hacBandwidth)
    throw new Error(`SIGNAL_RIDGE is not ready: ${chosenDates.length} complete mature dates, need at least ${Math.max(config.minTrainingDates, config.hacBandwidth + 1)}.`);
  const included = new Set(chosenDates);
  const training = panel.trainingRows.filter((row) => included.has(row.signalDate));
  if (training.length !== chosenDates.length * input.candidateIds.length)
    throw new Error("SIGNAL_RIDGE requires a balanced asset-by-date training panel.");
  const toFeatures = (row: typeof training[number]) =>
    Object.fromEntries(panel.canonicalFactorIds.map((id, i) => [id, row.featureVector[i]])) as Record<string, number>;
  const rows: SignalRidgeTrainingRow[] = training.map((row) => {
    if (row.excessReturnLabel === null || row.featureVector.some((value) => value === null))
      throw new Error("SIGNAL_RIDGE incomplete training row passed balanced-panel validation.");
    return { date: row.signalDate, asset: row.ticker, features: toFeatures(row), y: row.excessReturnLabel };
  });
  const fit = fitSignalRidge(rows, panel.canonicalFactorIds, config.lambdaSignal,
    config.hacBandwidth, [...new Set(panel.panelRows.map((row) => row.signalDate))].sort());
  const current = input.assetTickers.map((ticker) => {
    const row = panel.currentRows.find((item) => item.ticker === ticker);
    if (!row) throw new Error(`SIGNAL_RIDGE missing current asset ${ticker}.`);
    return { asset: ticker, features: toFeatures(row) };
  });
  const prediction = predictSignalRidge(fit, current);
  const muHat = prediction.predictions.map((row) => row.excessPrediction + input.dailyCashYield);
  const standardErrors = prediction.V_mu.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  const displayZ = config.displayZ ?? 1.96;
  if (!Number.isFinite(displayZ) || displayZ < 0)
    throw new Error("SIGNAL_RIDGE display z must be finite and nonnegative.");
  const forecastRows = prediction.predictions.map((row, index) => {
    const source = panel.currentRows.find((item) => item.ticker === row.asset)!;
    return {
      ...row, candidateId: input.candidateIds[index], signalDate: source.signalDate,
      informationCutoff: source.informationCutoff, executionDate: source.executionDate,
      labelStart: source.labelStart, labelEnd: source.labelEnd,
      labelStatus: source.labelStatus, actualMaturedLabel: source.excessReturnLabel,
      featureStages: source.features, forecastStandardError: standardErrors[index],
      grossPrediction: muHat[index],
    };
  });
  return {
    status: "OK", engineVersion: SIGNAL_RIDGE_ENGINE_VERSION, estimator: "SIGNAL_RIDGE",
    mode: "CAPITAL_LONG_ONLY", returnConvention: "DAILY_DECIMAL_GROSS",
    candidateIds: input.candidateIds.slice(), dates: chosenDates, observationCount: chosenDates.length,
    startDate: chosenDates[0], endDate: chosenDates[chosenDates.length - 1],
    decisionCutoff: input.informationCutoff, sigma: input.sigma,
    sampleMeans: [], sampleStandardDeviations: [], muHat, V_mu: prediction.V_mu,
    standardErrors, signalToNoise: muHat.map(() => null),
    intervals: muHat.map((value, i) => ({
      lower: value - displayZ * standardErrors[i], upper: value + displayZ * standardErrors[i],
    })),
    intervalLabel: "Approximate fitted-forecast sampling-uncertainty interval; NOT a future-return prediction interval.",
    displayZ, priorMean: null, priorUncertainty: null, tau: null, shrinkage: null,
    shrinkageDelta: null,
    uncertaintyAssumption: "Date-aggregated Bartlett HAC sandwich covariance conditional on fixed ridge penalty and train-only scaler; excludes shrinkage bias, omitted-model/regime uncertainty, and future residual return noise. Not a calibrated confidence guarantee.",
    P: [], q: [], Omega: [], views: [], viewSetStatus: "NOT_APPLICABLE", stability: null,
    ridge: {
      schemaVersion: 1, engineVersion: SIGNAL_RIDGE_ENGINE_VERSION, target: panel.labelDefinition,
      horizon: panel.horizon, source: panel.source, executionTiming: panel.executionTiming,
      requestedFactorIds: panel.requestedFactorIds, factorIds: panel.canonicalFactorIds,
      factorAliases: panel.factorAliases, peerUniverse: panel.peerUniverse, assetTickers: panel.assetTickers,
      trainingWindowDates: config.trainingWindowDates, minTrainingDates: config.minTrainingDates,
      trainingRowCount: fit.trainingRowCount, trainingDateCount: fit.trainingDateCount,
      trainingRows: training.map((row) => ({
        signalDate: row.signalDate, informationCutoff: row.informationCutoff, ticker: row.ticker,
        executionDate: row.executionDate, labelStart: row.labelStart, labelEnd: row.labelEnd,
        excessReturnLabel: row.excessReturnLabel, features: row.features,
      })),
      excludedTrainingDates: panel.excludedTrainingDates, scaler: fit.scaler,
      lambdaSignal: fit.lambda, hacBandwidth: fit.bandwidth, intercept: fit.intercept,
      slopes: fit.slopes, dateScores: fit.dateScores, coefficientCovariance: fit.coefficientCovariance,
      muHat, V_mu: prediction.V_mu, dailyCashYield: input.dailyCashYield,
      informationCutoff: input.informationCutoff, predictions: forecastRows,
      uncertaintyLabel: prediction.uncertaintyLabel,
    },
  };
}