export interface C3GroupingThresholds {
  returnCorrelation: number;
  rollingMedianCorrelation: number;
  exposureSimilarity: number;
  regimeCorrelation: number;
  minPairedObservations: number;
  minRollingWindows: number;
  minRegimeObservations: number;
  epsilon: number;
}

export interface C3SelectionInput {
  alphaIds: string[];
  dependence: any[];
  candidates: Array<{ id: string; developmentTurnover: number | null; coverage: number }>;
  thresholds: C3GroupingThresholds;
  manualOverrides: Record<string, string>;
}

export interface C3RedundancyGroup {
  id: string;
  memberIds: string[];
  representativeId: string;
  evidence: any[];
  selectionReason: string;
}

type PairEvidence = {
  alphaA: string;
  alphaB: string;
  fullSampleCorrelation: number | null;
  pairedObservations: number;
  rollingMedianCorrelation: number | null;
  rollingWindows: number;
  regimeCorrelations: any[];
  exposureSimilarityByRegime: any[];
  flag: string | null;
  eligible: boolean;
  rejectionReasons: string[];
  conditionalPerformanceByRegime: unknown;
  conditionalContributionByRegime: unknown;
};

function assertThresholds(thresholds: C3GroupingThresholds): void {
  for (const [name, value] of Object.entries({
    returnCorrelation: thresholds.returnCorrelation,
    rollingMedianCorrelation: thresholds.rollingMedianCorrelation,
    exposureSimilarity: thresholds.exposureSimilarity,
    regimeCorrelation: thresholds.regimeCorrelation,
  })) {
    if (!Number.isFinite(value) || value < -1 || value > 1)
      throw new Error(`${name} must be a finite correlation or similarity threshold in [-1, 1].`);
  }
  for (const [name, value] of Object.entries({
    minPairedObservations: thresholds.minPairedObservations,
    minRollingWindows: thresholds.minRollingWindows,
    minRegimeObservations: thresholds.minRegimeObservations,
  })) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`${name} must be a positive integer.`);
  }
  if (!Number.isFinite(thresholds.epsilon) || thresholds.epsilon < 0 || thresholds.epsilon > 1)
    throw new Error("epsilon must be a finite number in [0, 1].");
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pairKey(a: string, b: string): string {
  return JSON.stringify([a, b].sort());
}

function groupId(memberIds: string[]): string {
  return `redundancy:${JSON.stringify([...memberIds].sort())}`;
}

function makePairEvidence(
  row: any | undefined,
  alphaA: string,
  alphaB: string,
  thresholds: C3GroupingThresholds,
): PairEvidence {
  const rejectionReasons: string[] = [];
  const fullCorrelation = row?.fullSample?.correlation;
  const pairedObservations = row?.fullSample?.pairedObservations;
  if (!finite(fullCorrelation) || !Number.isSafeInteger(pairedObservations) ||
      pairedObservations < thresholds.minPairedObservations ||
      fullCorrelation < thresholds.returnCorrelation)
    rejectionReasons.push("Full-sample return correlation is below threshold or lacks sufficient paired observations.");

  const rollingPoints = Array.isArray(row?.rollingCorrelation?.series)
    ? row.rollingCorrelation.series.filter((point: any) =>
      point?.status === "AVAILABLE" && finite(point?.value))
    : [];
  const rollingMedian = finite(row?.rollingCorrelation?.summary?.median)
    ? row.rollingCorrelation.summary.median
    : median(rollingPoints.map((point: any) => point.value));
  const reportedWindows = row?.rollingCorrelation?.summary?.validWindows;
  const rollingWindows = Number.isSafeInteger(reportedWindows)
    ? Math.min(reportedWindows, rollingPoints.length)
    : rollingPoints.length;
  if (rollingWindows < thresholds.minRollingWindows || !finite(rollingMedian) ||
      rollingMedian < thresholds.rollingMedianCorrelation)
    rejectionReasons.push("Rolling median correlation is below threshold or lacks sufficient valid windows.");

  const exposure = Array.isArray(row?.exposureSimilarityByRegime) ? row.exposureSimilarityByRegime : [];
  const regimeCorrelations = Array.isArray(row?.regimeCorrelation) ? row.regimeCorrelation : [];
  const regimeNames = regimeCorrelations.map((item: any) => item?.regime).filter((name: unknown) =>
    typeof name === "string");
  const exposureNames = exposure.map((item: any) => item?.regime).filter((name: unknown) =>
    typeof name === "string");
  if (regimeCorrelations.length < 2 || new Set(regimeNames).size !== regimeCorrelations.length ||
      new Set(exposureNames).size !== exposure.length ||
      [...regimeNames].sort().join("|") !== [...exposureNames].sort().join("|") ||
      regimeCorrelations.some((item: any) =>
    item?.status !== "AVAILABLE" || !Number.isSafeInteger(item?.pairedObservations) ||
    item.pairedObservations < thresholds.minRegimeObservations || !finite(item?.correlation) ||
    item.correlation < thresholds.regimeCorrelation))
    rejectionReasons.push("At least two matching regimes are required, and each must have sufficient observations and meet the regime-correlation threshold.");

  if (!exposure.length || exposure.some((item: any) =>
    item?.status !== "AVAILABLE" || !Number.isSafeInteger(item?.observations) ||
    item.observations < thresholds.minRegimeObservations || !finite(item?.meanSimilarity) ||
    item.meanSimilarity < thresholds.exposureSimilarity))
    rejectionReasons.push("Underlying-exposure similarity is unavailable or below threshold in one or more regimes.");

  const flag = typeof row?.flag === "string" ? row.flag : null;
  if (flag === "REGIME_DIVERGENCE_OBSERVED")
    rejectionReasons.push("REGIME_DIVERGENCE_OBSERVED: both alphas must be preserved.");
  else if (flag === "INSUFFICIENT_REGIME_EVIDENCE")
    rejectionReasons.push("C2 reports insufficient regime evidence for redundancy grouping.");

  return {
    alphaA, alphaB,
    fullSampleCorrelation: finite(fullCorrelation) ? fullCorrelation : null,
    pairedObservations: Number.isSafeInteger(pairedObservations) ? pairedObservations : 0,
    rollingMedianCorrelation: finite(rollingMedian) ? rollingMedian : null,
    rollingWindows,
    regimeCorrelations: structuredClone(regimeCorrelations),
    exposureSimilarityByRegime: structuredClone(exposure),
    flag,
    eligible: rejectionReasons.length === 0,
    rejectionReasons,
    conditionalPerformanceByRegime: row?.conditionalPerformanceByRegime ?? null,
    conditionalContributionByRegime: row?.conditionalContributionByRegime ?? null,
  };
}

function makePairMap(
  alphaIds: string[],
  dependence: any[],
  thresholds: C3GroupingThresholds,
): Map<string, PairEvidence> {
  const selected = new Set(alphaIds);
  const rows = new Map<string, any>();
  for (const row of dependence) {
    if (!row || typeof row.alphaA !== "string" || typeof row.alphaB !== "string" ||
        row.alphaA === row.alphaB || !selected.has(row.alphaA) || !selected.has(row.alphaB)) continue;
    rows.set(pairKey(row.alphaA, row.alphaB), row);
  }
  const result = new Map<string, PairEvidence>();
  for (let left = 0; left < alphaIds.length; left++) {
    for (let right = left + 1; right < alphaIds.length; right++) {
      const a = alphaIds[left], b = alphaIds[right];
      const row = rows.get(pairKey(a, b));
      const orientedA = row && row.alphaA === a ? a : b;
      const orientedB = orientedA === a ? b : a;
      result.set(pairKey(a, b), makePairEvidence(row, orientedA, orientedB, thresholds));
    }
  }
  return result;
}

function automaticRepresentative(
  memberIds: string[],
  candidateById: Map<string, C3SelectionInput["candidates"][number]>,
): { id: string; reason: string } {
  const candidates = memberIds.map((id) => candidateById.get(id));
  if (candidates.some((candidate) => !candidate ||
      !finite(candidate.coverage) || candidate.coverage <= 0 || candidate.coverage > 1 ||
      !finite(candidate.developmentTurnover) || candidate.developmentTurnover < 0))
    throw new Error("Representative selection requires positive valid-data coverage and development turnover for every group member.");
  candidates.sort((left, right) => {
    const turnoverDifference = left!.developmentTurnover! - right!.developmentTurnover!;
    if (Math.abs(turnoverDifference) > 1e-8) return turnoverDifference;
    const coverageDifference = right!.coverage - left!.coverage;
    if (Math.abs(coverageDifference) > 1e-8) return coverageDifference;
    return left!.id.localeCompare(right!.id);
  });
  const chosen = candidates[0]!;
  return {
    id: chosen.id,
    reason: `Lowest median development traded notional (${chosen.developmentTurnover}); ties within 1e-8 use higher valid-data coverage (${chosen.coverage}), then canonical alpha ID.`,
  };
}

function buildGroups(
  alphaIds: string[],
  pairEvidence: Map<string, PairEvidence>,
  candidateById: Map<string, C3SelectionInput["candidates"][number]>,
  manualOverrides: Record<string, string>,
): C3RedundancyGroup[] {
  const clusters: string[][] = [...alphaIds].sort().map((id) => [id]);
  const canMerge = (left: string[], right: string[]) =>
    left.every((a) => right.every((b) => pairEvidence.get(pairKey(a, b))?.eligible === true));

  // Deterministic complete linkage: only merge clusters when every cross-pair
  // satisfies all frozen C2 evidence gates. Lexical order resolves merge ties.
  while (true) {
    let merge: [number, number] | null = null;
    for (let left = 0; left < clusters.length && !merge; left++) {
      for (let right = left + 1; right < clusters.length; right++) {
        if (canMerge(clusters[left], clusters[right])) {
          merge = [left, right];
          break;
        }
      }
    }
    if (!merge) break;
    const [left, right] = merge;
    clusters[left] = [...clusters[left], ...clusters[right]].sort();
    clusters.splice(right, 1);
    clusters.sort((a, b) => a[0].localeCompare(b[0]));
  }

  const groups = clusters.filter((members) => members.length >= 2).map((memberIds) => {
    const id = groupId(memberIds);
    const automatic = automaticRepresentative(memberIds, candidateById);
    const override = manualOverrides[id];
    if (override !== undefined && !memberIds.includes(override))
      throw new Error(`Manual representative override for ${id} must identify one of its group members.`);
    const representativeId = override ?? automatic.id;
    const evidence = memberIds.flatMap((alphaA, index) => memberIds.slice(index + 1)
      .map((alphaB) => pairEvidence.get(pairKey(alphaA, alphaB))!));
    return {
      id, memberIds, representativeId, evidence,
      selectionReason: override
        ? `Explicit pre-evaluation manual override selected ${override}; automatic rule: ${automatic.reason}`
        : automatic.reason,
    };
  });
  const knownGroupIds = new Set(groups.map((group) => group.id));
  for (const id of Object.keys(manualOverrides))
    if (!knownGroupIds.has(id))
      throw new Error(`Manual representative override references unknown redundancy group ${id}.`);
  return groups;
}

function assignment(groups: C3RedundancyGroup[], alphaIds: string[]) {
  const byAlpha = new Map<string, string>();
  for (const group of groups) for (const id of group.memberIds) byAlpha.set(id, group.id);
  return Object.fromEntries(alphaIds.map((id) => [id, byAlpha.get(id) ?? "standalone"]));
}

function sensitivity(
  alphaIds: string[],
  pairEvidenceByThreshold: (thresholds: C3GroupingThresholds) => Map<string, PairEvidence>,
  candidates: Map<string, C3SelectionInput["candidates"][number]>,
  baseGroups: C3RedundancyGroup[],
  baseThresholds: C3GroupingThresholds,
  manualOverrides: Record<string, string>,
) {
  const baseAssignment = assignment(baseGroups, alphaIds);
  const baseRepresentatives = Object.fromEntries(baseGroups.map((group) => [group.id, group.representativeId]));
  const cases = [-1, 0, 1].map((offset) => {
    const thresholds = offset === 0 ? { ...baseThresholds } : {
      ...baseThresholds,
      returnCorrelation: Math.max(-1, Math.min(1, baseThresholds.returnCorrelation + offset * baseThresholds.epsilon)),
      rollingMedianCorrelation: Math.max(-1, Math.min(1, baseThresholds.rollingMedianCorrelation + offset * baseThresholds.epsilon)),
      exposureSimilarity: Math.max(-1, Math.min(1, baseThresholds.exposureSimilarity + offset * baseThresholds.epsilon)),
      regimeCorrelation: Math.max(-1, Math.min(1, baseThresholds.regimeCorrelation + offset * baseThresholds.epsilon)),
    };
    let groups = baseGroups;
    if (offset !== 0) {
      const perturbedPairs = pairEvidenceByThreshold(thresholds);
      const perturbedGroups = buildGroups(alphaIds, perturbedPairs, candidates, {});
      // An override belongs to its frozen group ID. When sensitivity dissolves
      // that group, report the changed assignment instead of rejecting the
      // otherwise valid base policy as an unknown override.
      const survivingIds = new Set(perturbedGroups.map((group) => group.id));
      const survivingOverrides = Object.fromEntries(
        Object.entries(manualOverrides).filter(([id]) => survivingIds.has(id)),
      );
      groups = Object.keys(survivingOverrides).length
        ? buildGroups(alphaIds, perturbedPairs, candidates, survivingOverrides)
        : perturbedGroups;
    }
    const currentAssignment = assignment(groups, alphaIds);
    const currentRepresentatives = Object.fromEntries(groups.map((group) => [group.id, group.representativeId]));
    const changedAssignments = alphaIds.filter((id) => baseAssignment[id] !== currentAssignment[id]);
    const groupIds = new Set([...Object.keys(baseRepresentatives), ...Object.keys(currentRepresentatives)]);
    const changedRepresentatives = [...groupIds].filter((id) =>
      baseRepresentatives[id] !== currentRepresentatives[id]);
    return {
      offset,
      thresholds,
      groupCount: groups.length,
      groups: groups.map(({ id, memberIds, representativeId }) => ({ id, memberIds, representativeId })),
      membershipChanges: changedAssignments,
      representativeChanges: changedRepresentatives,
      assignmentChangePercent: alphaIds.length ? changedAssignments.length / alphaIds.length * 100 : 0,
    };
  });
  return { epsilon: baseThresholds.epsilon, cases };
}

export function buildC3Selection(input: C3SelectionInput): {
  groups: C3RedundancyGroup[];
  standaloneIds: string[];
  preservedPairs: any[];
  sensitivity: ReturnType<typeof sensitivity>;
} {
  assertThresholds(input.thresholds);
  if (!Array.isArray(input.alphaIds) || !input.alphaIds.length ||
      input.alphaIds.some((id) => typeof id !== "string" || !id) ||
      new Set(input.alphaIds).size !== input.alphaIds.length)
    throw new Error("C3 requires a nonempty list of unique canonical alpha IDs.");
  if (!Array.isArray(input.dependence) || !Array.isArray(input.candidates))
    throw new Error("C3 requires frozen C2 pairwise dependence and development candidate evidence.");
  const candidateById = new Map<string, C3SelectionInput["candidates"][number]>();
  for (const candidate of input.candidates) {
    if (!candidate || typeof candidate.id !== "string" || candidateById.has(candidate.id))
      throw new Error("C3 development candidate IDs must be unique.");
    candidateById.set(candidate.id, candidate);
  }
  if (input.alphaIds.some((id) => !candidateById.has(id)))
    throw new Error("C3 requires development turnover and valid-data coverage for every selected alpha.");
  const alphaIds = [...input.alphaIds].sort();
  const pairEvidence = makePairMap(alphaIds, input.dependence, input.thresholds);
  const groups = buildGroups(alphaIds, pairEvidence, candidateById, input.manualOverrides ?? {});
  const grouped = new Set(groups.flatMap((group) => group.memberIds));
  const preservedPairs = [...pairEvidence.values()]
    .filter((pair) => pair.flag === "REGIME_DIVERGENCE_OBSERVED")
    .map((pair) => ({
      alphaA: pair.alphaA,
      alphaB: pair.alphaB,
      reason: "High aggregate dependence is not sufficient to collapse this pair: C2 observed materially divergent regime behavior. Both candidates are preserved.",
      fullSampleCorrelation: pair.fullSampleCorrelation,
      pairedObservations: pair.pairedObservations,
      regimeCorrelations: pair.regimeCorrelations,
      conditionalPerformanceByRegime: pair.conditionalPerformanceByRegime,
      conditionalContributionByRegime: pair.conditionalContributionByRegime,
      exposureSimilarityByRegime: pair.exposureSimilarityByRegime,
    }));
  const getPairEvidence = (thresholds: C3GroupingThresholds) =>
    makePairMap(alphaIds, input.dependence, thresholds);
  return {
    groups,
    standaloneIds: alphaIds.filter((id) => !grouped.has(id)),
    preservedPairs,
    sensitivity: sensitivity(alphaIds, getPairEvidence, candidateById, groups,
      input.thresholds, input.manualOverrides ?? {}),
  };
}