/** Maximum absolute difference between corresponding finite numeric fields of two frozen results. */
export function maximumNumericDifference(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number")
    return Number.isFinite(left) && Number.isFinite(right) ? Math.abs(left - right) : 0;
  if (Array.isArray(left) && Array.isArray(right)) {
    let maximum = 0;
    for (let i = 0; i < Math.min(left.length, right.length); i++)
      maximum = Math.max(maximum, maximumNumericDifference(left[i], right[i]));
    return maximum;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    let maximum = 0;
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    for (const key of Object.keys(a))
      if (Object.hasOwn(b, key))
        maximum = Math.max(maximum, maximumNumericDifference(a[key], b[key]));
    return maximum;
  }
  return 0;
}