import type { AllocationRequest } from "./allocation-b2";
import { runB3Validation, type B3Assumptions, type B3Result } from "./b3-policy";
import type { PreparedSnapshot } from "./prepared-inputs";

export interface C1PolicyPlan {
  label: string;
  excludedCandidateIds: string[];
  policyRequest: AllocationRequest;
}

export interface C1Metric {
  value: number | null;
  reason: string | null;
}

export interface C1AllocationDistance {
  date: string;
  distance: number;
}

export interface C1DistanceSummary {
  dateSeries: C1AllocationDistance[];
  mean: number | null;
  maximum: number | null;
  reason: string | null;
}

export interface C1ChildSummary {
  label: string;
  excludedCandidateIds: string[];
  status: B3Result["status"];
  reason: string | null;
  failureDate: string | null;
  turnoverConvention: string | null;
  metrics: Record<string, C1Metric>;
  deltaFullMinusVariant: Record<string, C1Metric>;
  comparisonAvailable: boolean;
  comparisonReason: string | null;
  alphaCapitalDistance: C1DistanceSummary;
  finalAssetAndCashDistance: C1DistanceSummary;
}

export interface C1ExperimentSummary {
  label: "Development comparison — no automatic selection.";
  deltaConvention: "Full set minus exclusion variant.";
  baselineCandidateIds: string[];
  baseline: C1ChildSummary;
  variants: C1ChildSummary[];
}

const METRIC_NAMES = [
  "cumulativeReturn",
  "annualizedReturn",
  "annualizedVolatility",
  "sharpe",
  "maximumDrawdown",
  "externalTradedNotional",
  "totalTransactionCosts",
  "averageCashExposure",
  "averageRiskyExposure",
] as const;

type MetricName = typeof METRIC_NAMES[number];

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function canonicalResolver(snapshot: PreparedSnapshot) {
  return (id: string): string => {
    const matches = snapshot.candidates.filter((candidate) =>
      candidate.candidateId === id || candidate.canonicalFingerprint === id);
    const canonicalIds = [...new Set(matches.map((candidate) => candidate.canonicalFingerprint))];
    if (canonicalIds.length !== 1 || !snapshot.candidates.some((candidate) =>
      candidate.candidateId === canonicalIds[0] && candidate.canonicalFingerprint === canonicalIds[0]))
      throw new Error(`Candidate ID or alias ${id} does not resolve to a canonical candidate in the frozen B1 snapshot.`);
    return canonicalIds[0];
  };
}

/**
 * Freeze full and explicit exclusion policy inputs. This creates plans only;
 * callers must execute every returned policy independently through B3.
 */
export function planC1Policies(
  policySnapshot: PreparedSnapshot,
  policyRequest: AllocationRequest,
  assumptions: B3Assumptions,
  input: {
    mode: "single" | "group" | "pair";
    exclusionSets: string[][];
    holdoutStartDate?: string;
  },
): C1PolicyPlan[] {
  if (policyRequest.representation !== "alpha_streams" || policySnapshot.representation !== "alpha_streams")
    throw new Error("C1 is supported only for frozen alpha_streams policies.");
  if (!Array.isArray(policyRequest.candidateIds) || !policyRequest.candidateIds.length)
    throw new Error("C1 requires a nonempty baseline candidate set.");
  if (!validDate(assumptions.evaluationStartDate) || !validDate(assumptions.evaluationEndDate) ||
    assumptions.evaluationStartDate > assumptions.evaluationEndDate)
    throw new Error("C1 development dates must be valid YYYY-MM-DD values with start no later than end.");
  if (input.holdoutStartDate !== undefined &&
    (!validDate(input.holdoutStartDate) || assumptions.evaluationEndDate >= input.holdoutStartDate))
    throw new Error("C1 development must end before the reserved holdout start date.");

  const resolve = canonicalResolver(policySnapshot);
  const baseline = policyRequest.candidateIds.map(resolve);
  if (new Set(baseline).size !== baseline.length)
    throw new Error("C1 baseline candidate IDs must resolve to unique canonical B1 candidates.");
  const baselineSet = new Set(baseline);
  const canonicalRequest = structuredClone(policyRequest);
  canonicalRequest.candidateIds = baseline;
  const remapBounds = (bounds: AllocationRequest["constraints"]["candidateBounds"]) => {
    if (!bounds) return undefined;
    const mapped: NonNullable<AllocationRequest["constraints"]["candidateBounds"]> = {};
    for (const [id, value] of Object.entries(bounds)) {
      const canonicalId = resolve(id);
      if (mapped[canonicalId] && JSON.stringify(mapped[canonicalId]) !== JSON.stringify(value))
        throw new Error(`Conflicting candidate bounds resolve to canonical candidate ${canonicalId}.`);
      mapped[canonicalId] = structuredClone(value);
    }
    return mapped;
  };
  if (policyRequest.constraints.candidateBounds)
    canonicalRequest.constraints.candidateBounds = remapBounds(policyRequest.constraints.candidateBounds);
  else
    delete canonicalRequest.constraints.candidateBounds;
  if (policyRequest.constraints.groupCaps) {
    canonicalRequest.constraints.groupCaps = policyRequest.constraints.groupCaps.map((group) => ({
      ...structuredClone(group),
      candidateIds: [...new Set(group.candidateIds.map(resolve))],
    }));
  } else {
    delete canonicalRequest.constraints.groupCaps;
  }
  for (const id of Object.keys(canonicalRequest.constraints.candidateBounds ?? {}))
    if (!baselineSet.has(id))
      throw new Error(`Candidate bounds reference ${id}, which is not in the baseline policy.`);
  for (const group of canonicalRequest.constraints.groupCaps ?? [])
    if (group.candidateIds.some((id) => !baselineSet.has(id)))
      throw new Error(`Group cap ${group.name} references a candidate outside the baseline policy.`);

  if (!Array.isArray(input.exclusionSets) || !input.exclusionSets.length)
    throw new Error("C1 requires at least one explicit exclusion set.");
  if (input.mode === "pair" && (input.exclusionSets.length !== 1 || input.exclusionSets[0].length !== 2))
    throw new Error("Pair mode requires exactly one two-candidate exclusion set.");
  const variants: string[][] = [];
  const seen = new Set<string>();
  for (const rawSet of input.exclusionSets) {
    if (!Array.isArray(rawSet) || !rawSet.length)
      throw new Error("C1 exclusion sets must be nonempty.");
    const set = [...new Set(rawSet.map(resolve))].sort();
    if (input.mode === "single" && set.length !== 1)
      throw new Error("Single mode accepts only one-candidate exclusion sets.");
    if (input.mode === "group" && set.length < 2)
      throw new Error("Group mode accepts only multi-candidate exclusion sets.");
    if (input.mode === "pair" && set.length !== 2)
      throw new Error("Pair mode requires exactly two distinct canonical candidates.");
    if (set.some((id) => !baselineSet.has(id)))
      throw new Error("Every excluded candidate must belong to the frozen baseline policy.");
    const key = JSON.stringify(set);
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push(set);
  }
  const expanded = input.mode === "pair"
    ? [ [variants[0][0]], [variants[0][1]], variants[0] ]
    : variants;
  const distinctPolicies = new Set([JSON.stringify([]), ...expanded.map((ids) => JSON.stringify(ids))]);
  if (distinctPolicies.size > 6)
    throw new Error(`C1 supports at most six distinct policies per experiment; requested ${distinctPolicies.size}.`);
  if (expanded.some((ids) => ids.length >= baseline.length))
    throw new Error("C1 cannot exclude all baseline candidates.");

  const buildPolicy = (excluded: string[]): AllocationRequest => {
    const excludedSet = new Set(excluded);
    const remaining = baseline.filter((id) => !excludedSet.has(id));
    const constraints = structuredClone(canonicalRequest.constraints);
    if (constraints.candidateBounds)
      constraints.candidateBounds = Object.fromEntries(Object.entries(constraints.candidateBounds)
        .filter(([id, bound]) => remaining.includes(id) || (bound.min ?? 0) > 0));
    if (constraints.groupCaps)
      constraints.groupCaps = constraints.groupCaps.map((group) => ({
        ...group,
        candidateIds: group.candidateIds.filter((id) => remaining.includes(id)),
      }));
    return { ...structuredClone(canonicalRequest), candidateIds: remaining, constraints };
  };
  const plans: C1PolicyPlan[] = [{
    label: "Baseline (full candidate set)",
    excludedCandidateIds: [],
    policyRequest: buildPolicy([]),
  }];
  for (const excluded of expanded) {
    plans.push({
      label: `Exclude ${excluded.join(", ")}`,
      excludedCandidateIds: [...excluded],
      policyRequest: buildPolicy(excluded),
    });
  }
  return plans;
}

function metric(value: number | null | undefined, reason?: string | null): C1Metric {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? { value, reason: null }
    : { value: null, reason: reason ?? "Metric is undefined in the B3 result." };
}

function resultMetrics(result: B3Result): Record<MetricName, C1Metric> {
  if (result.status !== "completed" || !result.metrics) {
    const reason = result.reason ?? "B3 result did not complete.";
    return Object.fromEntries(METRIC_NAMES.map((name) => [name, metric(null, reason)])) as Record<MetricName, C1Metric>;
  }
  const ledger = result.dailyLedger;
  const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const cash = avg(ledger.map((entry) => entry.endingNav > 0 ? entry.endingCash / entry.endingNav : NaN)
    .filter(Number.isFinite));
  const risky = avg(ledger.map((entry) => entry.endingNav > 0
    ? entry.endingPositions.reduce((sum, position) => sum + position.marketValue, 0) / entry.endingNav : NaN)
    .filter(Number.isFinite));
  return {
    cumulativeReturn: metric(result.metrics.cumulativeReturn),
    annualizedReturn: metric(result.metrics.annualizedReturn),
    annualizedVolatility: metric(result.metrics.annualizedVolatility, result.metrics.volatilityReason),
    sharpe: metric(result.metrics.sharpe, result.metrics.sharpeReason),
    maximumDrawdown: metric(result.metrics.maximumDrawdown),
    externalTradedNotional: metric(result.metrics.externalTradedNotional),
    totalTransactionCosts: metric(result.metrics.totalTransactionCosts),
    averageCashExposure: metric(cash, "No valid daily ending-cash observations are available."),
    averageRiskyExposure: metric(risky, "No valid daily ending-position observations are available."),
  };
}

function unavailableDistance(reason: string): C1DistanceSummary {
  return { dateSeries: [], mean: null, maximum: null, reason };
}

function distanceSummary(values: C1AllocationDistance[]): C1DistanceSummary {
  if (!values.length) return unavailableDistance("No matched B3 decision dates are available.");
  return {
    dateSeries: values,
    mean: values.reduce((sum, item) => sum + item.distance, 0) / values.length,
    maximum: Math.max(...values.map((item) => item.distance)),
    reason: null,
  };
}

function distance(a: number[], b: number[]): number {
  return 0.5 * a.reduce((sum, value, index) => sum + Math.abs(value - (b[index] ?? 0)), 0);
}

function unavailableChild(
  child: { label: string; excludedCandidateIds: string[]; result: B3Result },
  baselineMetrics: Record<MetricName, C1Metric>,
  reason: string,
): C1ChildSummary {
  const metrics = resultMetrics(child.result);
  const deltas = Object.fromEntries(METRIC_NAMES.map((name) => {
    const full = baselineMetrics[name], variant = metrics[name];
    return [name, full.value !== null && variant.value !== null
      ? metric(full.value - variant.value)
      : metric(null, `Delta unavailable: ${full.reason ?? variant.reason ?? reason}`)];
  })) as Record<MetricName, C1Metric>;
  return {
    label: child.label, excludedCandidateIds: [...child.excludedCandidateIds],
    status: child.result.status, reason: child.result.reason ?? null,
    failureDate: child.result.failureDate ?? null,
    turnoverConvention: child.result.metrics?.turnoverConvention ?? null,
    metrics, deltaFullMinusVariant: deltas,
    comparisonAvailable: false, comparisonReason: reason,
    alphaCapitalDistance: unavailableDistance(reason),
    finalAssetAndCashDistance: unavailableDistance(reason),
  };
}

/**
 * Summarize independently executed C1 B3 children. Deltas use full minus
 * variant; allocation distances use matched decision-date B3 target weights.
 */
export function summarizeC1Experiment(
  children: Array<{ label: string; excludedCandidateIds: string[]; result: B3Result }>,
  baselineCandidateIds: string[],
): C1ExperimentSummary {
  if (!children.length) throw new Error("C1 summary requires the baseline B3 child.");
  const baselineChild = children[0];
  const baselineIds = [...baselineCandidateIds];
  const baselineMetrics = resultMetrics(baselineChild.result);
  const baselineSummary = unavailableChild(baselineChild, baselineMetrics,
    baselineChild.result.status === "completed" ? "Baseline does not have an exclusion comparison." :
      baselineChild.result.reason ?? "Baseline B3 result did not complete.");
  baselineSummary.comparisonAvailable = false;
  baselineSummary.deltaFullMinusVariant = Object.fromEntries(METRIC_NAMES.map((name) => [
    name, metric(null, "No exclusion variant applies to the baseline."),
  ])) as Record<MetricName, C1Metric>;
  const variants = children.slice(1).map((child) => {
    if (baselineChild.result.status !== "completed" || child.result.status !== "completed")
      return unavailableChild(child, baselineMetrics,
        baselineChild.result.status !== "completed"
          ? `Baseline B3 failed: ${baselineChild.result.reason ?? "no reason supplied."}`
          : `Variant B3 failed: ${child.result.reason ?? "no reason supplied."}`);
    const full = baselineChild.result;
    const variant = child.result;
    const fullDates = full.dailyLedger.map((entry) => entry.date);
    const variantDates = variant.dailyLedger.map((entry) => entry.date);
    if (JSON.stringify(fullDates) !== JSON.stringify(variantDates))
      return unavailableChild(child, baselineMetrics, "B3 daily ledger dates do not match; shorter-period comparison is prohibited.");
    const fullDecisions = full.decisions, variantDecisions = variant.decisions;
    if (JSON.stringify(fullDecisions.map((item) => item.decisionDate)) !==
      JSON.stringify(variantDecisions.map((item) => item.decisionDate)))
      return unavailableChild(child, baselineMetrics, "B3 decision dates do not match.");
    const excluded = new Set(child.excludedCandidateIds);
    const shared = baselineIds.filter((id) => !excluded.has(id));
    for (let index = 0; index < fullDecisions.length; index++) {
      const a = fullDecisions[index], b = variantDecisions[index];
      if (JSON.stringify(a.estimationDates) !== JSON.stringify(b.estimationDates))
        return unavailableChild(child, baselineMetrics, `Shared candidates have mismatched estimation history at ${a.decisionDate}.`);
      for (const id of shared) {
        if (!Object.hasOwn(a.candidateWeights, id) || !Object.hasOwn(b.candidateWeights, id))
          return unavailableChild(child, baselineMetrics, `Shared candidate ${id} is absent from matched decisions.`);
      }
    }
    const variantMetrics = resultMetrics(variant);
    const deltas = Object.fromEntries(METRIC_NAMES.map((name) => {
      const a = baselineMetrics[name], b = variantMetrics[name];
      return [name, a.value !== null && b.value !== null ? metric(a.value - b.value)
        : metric(null, `Delta unavailable: ${a.reason ?? b.reason ?? "one or both metrics are undefined."}`)];
    })) as Record<MetricName, C1Metric>;
    const alphaDistances: C1AllocationDistance[] = fullDecisions.map((a, index) => {
      const b = variantDecisions[index];
      const aWeights = [...baselineIds.map((id) => a.candidateWeights[id] ?? 0), a.masterCash];
      const bWeights = [...baselineIds.map((id) => b.candidateWeights[id] ?? 0), b.masterCash];
      return { date: a.decisionDate, distance: distance(aWeights, bWeights) };
    });
    const assetDistances: C1AllocationDistance[] = fullDecisions.map((a, index) => {
      const b = variantDecisions[index];
      const tickers = [...new Set([...Object.keys(a.targetAssetWeights), ...Object.keys(b.targetAssetWeights)])].sort();
      const aWeights = [...tickers.map((ticker) => a.targetAssetWeights[ticker] ?? 0), a.totalCash];
      const bWeights = [...tickers.map((ticker) => b.targetAssetWeights[ticker] ?? 0), b.totalCash];
      return { date: a.decisionDate, distance: distance(aWeights, bWeights) };
    });
    return {
      label: child.label, excludedCandidateIds: [...child.excludedCandidateIds], status: variant.status,
      reason: variant.reason ?? null, failureDate: variant.failureDate ?? null,
      turnoverConvention: variant.metrics?.turnoverConvention ?? null,
      metrics: variantMetrics, deltaFullMinusVariant: deltas, comparisonAvailable: true, comparisonReason: null,
      alphaCapitalDistance: distanceSummary(alphaDistances),
      finalAssetAndCashDistance: distanceSummary(assetDistances),
    };
  });
  return {
    label: "Development comparison — no automatic selection.",
    deltaConvention: "Full set minus exclusion variant.",
    baselineCandidateIds: baselineIds,
    baseline: baselineSummary,
    variants,
  };
}