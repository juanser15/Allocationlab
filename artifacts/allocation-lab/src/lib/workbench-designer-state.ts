import {
  DESIGN_FIELDS,
  SPEC_V2,
  submissionV2Schema,
  type CapabilitiesV2,
  type DetailV2,
  type FoldV2,
  type PlanV2,
  type SubmissionV2,
} from "./workbench-v2-api";

export type DesignForm = Record<(typeof DESIGN_FIELDS)[number], string>;
export const emptyDesign = (): DesignForm =>
  Object.fromEntries(DESIGN_FIELDS.map((field) => [field, ""])) as DesignForm;
export const FIELD_LABELS: Record<keyof DesignForm, string> = {
  evaluation_start: "From",
  evaluation_end_exclusive: "To",
  window_type: "Type",
  training_window_months: "Training Window",
  rebalance_frequency: "Rebalance",
  transaction_cost_bps: "Trading Costs",
  selection_cost_bps: "Candidate-ranking cost (advanced)",
};
export function readDesign(
  form: DesignForm,
  caps: CapabilitiesV2,
): { request?: SubmissionV2; errors: string[] } {
  const errors: string[] = [];
  for (const field of DESIGN_FIELDS)
    if (!form[field].trim()) errors.push(`${FIELD_LABELS[field]} is required.`);
  if (errors.length) return { errors };
  const parsed = submissionV2Schema.safeParse({
    ...form,
    contract_version: SPEC_V2,
    research_mode: "CAPITAL_MARKET_EXPOSURE",
    execution_scope: "EMPIRICAL",
    universe: "SPY",
    validation_protocol: "TRADITIONAL_WALK_FORWARD",
    training_window_months: Number(form.training_window_months),
    transaction_cost_bps: Number(form.transaction_cost_bps),
    selection_cost_bps: Number(form.selection_cost_bps),
  });
  if (!parsed.success)
    return {
      errors: parsed.error.issues.map(
        (i) =>
          `${FIELD_LABELS[i.path[0] as keyof DesignForm] ?? i.path[0]}: ${i.message}`,
      ),
    };
  const r = parsed.data;
  for (const key of ["evaluation_start", "evaluation_end_exclusive"] as const) {
    const d = r[key];
    if (
      !Number.isFinite(Date.parse(d)) ||
      new Date(d).toISOString().slice(0, 10) !== d
    )
      errors.push(`${FIELD_LABELS[key]} must be a valid date.`);
    if (caps.date_rules.month_start_required && !d.endsWith("-01"))
      errors.push(
        `${FIELD_LABELS[key]} must be a month start. Dates are never moved automatically.`,
      );
    if (
      r.rebalance_frequency === "QUARTERLY" &&
      caps.date_rules.quarterly_start === "CALENDAR_QUARTER_START" &&
      (Number(d.slice(5, 7)) - 1) % caps.timing_semantics.quarterly_months !== 0
    )
      errors.push(`${FIELD_LABELS[key]} must be a calendar-quarter start.`);
  }
  if (r.evaluation_start >= r.evaluation_end_exclusive)
    errors.push("To (not included) must follow From.");
  if (
    r.evaluation_start < caps.supported_evaluation_start_min ||
    r.evaluation_end_exclusive > caps.supported_evaluation_end_max
  )
    errors.push(
      "Requested evaluation dates are outside the dataset-supported boundaries shown below.",
    );
  if (r.training_window_months > caps.training_window_rules.maximum_months)
    errors.push(
      `Training Window exceeds ${caps.training_window_rules.maximum_months} months. Actual history is checked by the plan.`,
    );
  if (
    !caps.supported_window_types.includes(r.window_type) ||
    !caps.supported_rebalance_frequencies.includes(r.rebalance_frequency)
  )
    errors.push("This window or cadence is not supported by the service.");
  for (const key of caps.transaction_cost_rules.fields as Array<
    "transaction_cost_bps" | "selection_cost_bps"
  >)
    if (r[key] < caps.transaction_cost_rules.minimum)
      errors.push(
        `${FIELD_LABELS[key]} must be at least ${caps.transaction_cost_rules.minimum} bps.`,
      );
  return errors.length ? { errors } : { request: r, errors };
}
/** Standard product mapping. The API retains distinct cost fields. Both are
 * explicitly derived from the single cost value the user entered. */
export function readStandardDesign(form: DesignForm, caps: CapabilitiesV2) {
  const parsed = readDesign(
    { ...form, selection_cost_bps: form.transaction_cost_bps },
    caps,
  );
  return {
    ...parsed,
    errors: parsed.errors.filter(
      (e) => !e.startsWith(FIELD_LABELS.selection_cost_bps),
    ),
  };
}
export const sameRequest = (a: SubmissionV2, b: SubmissionV2) =>
  Object.keys(submissionV2Schema.shape).every(
    (key) => a[key as keyof SubmissionV2] === b[key as keyof SubmissionV2],
  );
export function sameFolds(a: FoldV2[], b: FoldV2[]): boolean {
  return (
    a.length === b.length &&
    a.every((fold, i) =>
      Object.keys(fold).every(
        (key) => fold[key as keyof FoldV2] === b[i]?.[key as keyof FoldV2],
      ),
    )
  );
}
export function planMatchesRequest(
  plan: PlanV2,
  request: SubmissionV2,
): boolean {
  // Validate the returned plan's internal consistency, without generating any
  // calendar or fitting a second frontend model of the engine.
  return (
    sameRequest(plan.normalized_request, request) &&
    plan.number_of_folds === plan.folds.length &&
    !plan.blockers.length &&
    plan.first_oos_date === request.evaluation_start &&
    plan.folds[0]?.oos_start === request.evaluation_start &&
    plan.folds.at(-1)?.oos_end_exclusive === request.evaluation_end_exclusive &&
    plan.folds.every(
      (fold, i) =>
        fold.window_type === request.window_type &&
        fold.rebalance_frequency === request.rebalance_frequency &&
        fold.training_start < fold.training_end_exclusive &&
        fold.training_end_exclusive === fold.oos_start &&
        fold.information_cutoff < fold.oos_start &&
        fold.decision_date >= fold.oos_start &&
        fold.decision_date < fold.oos_end_exclusive &&
        fold.oos_start < fold.oos_end_exclusive &&
        (i === 0 || plan.folds[i - 1].oos_end_exclusive === fold.oos_start),
    )
  );
}
export function canRunPlan(
  plan: PlanV2 | undefined,
  request: SubmissionV2 | undefined,
  current: boolean,
  accepted: boolean,
  busy: boolean,
): boolean {
  return (
    !!plan &&
    !!request &&
    current &&
    accepted &&
    !busy &&
    planMatchesRequest(plan, request)
  );
}
export function latestSuccess(detail: DetailV2 | undefined) {
  return detail && typeof detail.latest_successful_result !== "string"
    ? detail.latest_successful_result
    : undefined;
}
export type ExpectedPlanV2 = {
  folds: FoldV2[];
  normalized_request: SubmissionV2;
};
export function executionMatchesPlan(
  detail: DetailV2,
  expected: ExpectedPlanV2,
): boolean {
  const result = latestSuccess(detail);
  if (!sameRequest(detail.spec, expected.normalized_request)) return false;
  if (
    !result ||
    result.execution_attempt_id !== detail.latest_attempt?.execution_attempt_id
  )
    return true; // the new attempt is still pending/failed
  return (
    typeof result.validation_diagnostics !== "string" &&
    sameFolds(expected.folds, result.validation_diagnostics.exact_fold_plan)
  );
}
export function derivedTiming(c: CapabilitiesV2, cadence: string) {
  if (
    !c.supported_rebalance_frequencies.includes(
      cadence as SubmissionV2["rebalance_frequency"],
    )
  )
    return undefined;
  const months =
    cadence === "MONTHLY"
      ? c.timing_semantics.monthly_months
      : c.timing_semantics.quarterly_months;
  return {
    oosMonths: months,
    stepMonths: months,
    recalibration: cadence.toLowerCase(),
  };
}
// Geometry only. Dates are the backend's exact fold boundaries; no folds are calculated here.
export function foldGeometry(folds: FoldV2[]) {
  const first = Math.min(...folds.map((f) => Date.parse(f.training_start)));
  const last = Math.max(...folds.map((f) => Date.parse(f.oos_end_exclusive)));
  const x = (d: string) =>
    115 + ((Date.parse(d) - first) / (last - first)) * 980;
  return folds.map((fold) => ({
    fold,
    trainingX: x(fold.training_start),
    trainingWidth: x(fold.training_end_exclusive) - x(fold.training_start),
    oosX: x(fold.oos_start),
    oosWidth: x(fold.oos_end_exclusive) - x(fold.oos_start),
    decisionX: x(fold.decision_date),
  }));
}
export function temporallyComparable(left: DetailV2, right: DetailV2): boolean {
  return (
    left.spec.evaluation_start === right.spec.evaluation_start &&
    left.spec.evaluation_end_exclusive === right.spec.evaluation_end_exclusive
  );
}
