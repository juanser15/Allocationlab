/**
 * B2's existing feasibility tolerance also bounds its executable representation.
 * This only canonicalizes negative roundoff on nonnegative capital coordinates.
 * It does not accept an infeasible model, change signed coordinates, or solve again.
 * The caller MUST independently recertify all constraints and the original objective.
 */
export function canonicalizeLongOnlyCapital(
  original: number[], capitalCount: number, tolerance: number,
): { solution: number[]; maximumAdjustment: number } {
  if (original.some((value) => typeof value !== "number" || !Number.isFinite(value)))
    throw new Error("Nonfinite or nonnumeric solver coordinate.");
  if (original.slice(0, capitalCount).some((value) => value < -tolerance))
    throw new Error("Materially negative long-only capital coordinate.");
  const solution = [...original];
  if (!solution.slice(0, capitalCount).some((value) => value < 0))
    return { solution, maximumAdjustment: 0 };
  for (let i = 0; i < capitalCount; i++) if (solution[i] < 0) solution[i] = 0;
  // Restore the capital equality using its largest positive coordinate, not a
  // fabricated cash balance. Subsequent certification includes cash and all bounds.
  let largest = 0;
  for (let i = 1; i < capitalCount; i++) if (solution[i] > solution[largest]) largest = i;
  solution[largest] += 1 - solution.slice(0, capitalCount).reduce((sum, value) => sum + value, 0);
  const maximumAdjustment = Math.max(...solution.map((value, i) => Math.abs(value - original[i])));
  if (maximumAdjustment > tolerance || solution.slice(0, capitalCount).some((value) => value < 0))
    throw new Error("Long-only canonicalization exceeds the existing feasibility tolerance.");
  return { solution, maximumAdjustment };
}