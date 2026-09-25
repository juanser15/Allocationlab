import {
  summarizeC1Experiment,
  type C1ExperimentSummary,
} from "./c1-contribution";
import type { B3Result } from "./b3-policy";

export interface C1IntegrityDifference {
  field: string;
  expected: unknown;
  observed: unknown;
}

export interface C1SummaryChild {
  label: string;
  excludedCandidateIds: string[];
  result: B3Result;
}

export interface C1SummaryIntegrity {
  recomputedSummary: C1ExperimentSummary;
  differences: C1IntegrityDifference[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function display(value: unknown): string {
  if (value === undefined) return "undefined";
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

/**
 * Compare persisted evidence without omitting any keys or normalizing identity,
 * date, exclusion, status, or observation-plan values. Numeric tolerance is
 * opt-in so callers can reserve it for replayed financial results/summaries.
 */
export function differenceObjects(
  expected: unknown,
  observed: unknown,
  options: { numericTolerance?: number | ((field: string) => number); root?: string } = {},
): C1IntegrityDifference[] {
  const root = options.root ?? "value";
  const differences: C1IntegrityDifference[] = [];

  const visit = (left: unknown, right: unknown, field: string) => {
    if (typeof left === "number" && typeof right === "number") {
      const tolerance = typeof options.numericTolerance === "function"
        ? options.numericTolerance(field) : options.numericTolerance ?? 0;
      if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > tolerance)
        differences.push({ field, expected: left, observed: right });
      return;
    }
    if (Object.is(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length)
        differences.push({ field: `${field}.length`, expected: left.length, observed: right.length });
      for (let index = 0; index < Math.min(left.length, right.length); index++)
        visit(left[index], right[index], `${field}[${index}]`);
      return;
    }
    if (isRecord(left) && isRecord(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys) {
        const leftHasKey = Object.hasOwn(left, key);
        const rightHasKey = Object.hasOwn(right, key);
        if (!leftHasKey || !rightHasKey) {
          differences.push({
            field: `${field}.${key}`,
            expected: leftHasKey ? left[key] : undefined,
            observed: rightHasKey ? right[key] : undefined,
          });
        } else {
          visit(left[key], right[key], `${field}.${key}`);
        }
      }
      return;
    }
    differences.push({ field, expected: left, observed: right });
  };

  visit(expected, observed, root);
  return differences;
}

/** Compare an ordered C1 child collection, allowing tolerance only in result copies. */
export function compareC1ReplayChildren(
  expected: readonly Record<string, unknown>[],
  observed: readonly Record<string, unknown>[],
): C1IntegrityDifference[] {
  const differences = differenceObjects(expected.length, observed.length, { root: "children.length" });
  for (let index = 0; index < Math.min(expected.length, observed.length); index++) {
    const expectedChild = expected[index];
    const observedChild = observed[index];
    const expectedMetadata = { ...expectedChild };
    const observedMetadata = { ...observedChild };
    delete expectedMetadata.result;
    delete observedMetadata.result;
    differences.push(...differenceObjects(expectedMetadata, observedMetadata, {
      root: `children[${index}]`,
    }));
    if (Object.hasOwn(expectedChild, "result") || Object.hasOwn(observedChild, "result"))
      differences.push(...differenceObjects(expectedChild.result, observedChild.result, {
        root: `children[${index}].result`,
        numericTolerance: (field) =>
          /\.result\.(decisions|dailyLedger|metrics)\./.test(field) ||
          /\.result\.diagnostics\.maximumReconciliationDifference$/.test(field) ? 1e-8 : 0,
      }));
  }
  return differences;
}

/**
 * Rebuild C1 metrics, deltas and allocation distances solely from verified B3
 * replay outputs, then compare every saved summary field to that reconstruction.
 */
export function recomputeAndCompareC1Summary(
  verifiedChildren: readonly C1SummaryChild[],
  baselineCandidateIds: string[],
  savedSummary: unknown,
): C1SummaryIntegrity {
  const recomputedSummary = summarizeC1Experiment(
    verifiedChildren.map((child) => ({
      label: child.label,
      excludedCandidateIds: child.excludedCandidateIds,
      result: child.result,
    })),
    baselineCandidateIds,
  );
  return {
    recomputedSummary,
    differences: differenceObjects(recomputedSummary, savedSummary, {
      root: "summary",
      numericTolerance: 1e-8,
    }),
  };
}

export function formatC1IntegrityDifference(difference: C1IntegrityDifference): string {
  return `${difference.field}: expected=${display(difference.expected)}, observed=${display(difference.observed)}`;
}