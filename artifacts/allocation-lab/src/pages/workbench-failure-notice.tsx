import {
  safeFailureSchema,
  failureContextSchema,
  failureConstraintsSchema,
} from "@/lib/workbench-failure";
export function FailureNotice({
  failure,
  constraints,
}: {
  failure: unknown;
  constraints?: unknown;
}) {
  const parsed = safeFailureSchema.safeParse(failure);
  if (!parsed.success)
    return (
      <div className="wd-error" role="alert">
        <strong>Detailed failure evidence is unavailable</strong>
        <p>
          The failed attempt is preserved. Refresh status; if diagnostic
          evidence remains unavailable, the preview owner must inspect its
          private record before rerunning.
        </p>
        <p>No dates or training windows were changed automatically.</p>
      </div>
    );
  const f = parsed.data;
  const context = failureContextSchema.safeParse(failure);
  const limits = failureConstraintsSchema.safeParse(constraints);
  const candidates = context.success
    ? (context.data.failure_diagnostic?.candidates ??
      context.data.candidates ??
      [])
    : [];
  const percent = new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: 2,
  });
  const resource = f.error_class === "INTERACTIVE_EXECUTION_CAPACITY_EXCEEDED";
  const title = resource ? "Backtest exceeds current execution capacity" : f.error_class === "NO_VALID_CANDIDATE" ? "No eligible exposure policy" : "Backtest needs attention";
  const action = resource ? "Ask the preview owner about extended-run capacity, or explicitly preview a smaller design." : f.error_class === "NO_VALID_CANDIDATE" ? "Review the rejected constraint and preview an explicitly revised design." : f.suggested_user_action;
  return (
    <div className="wd-error wd-failure-notice" role="alert">
      <strong>{title}</strong>
      <p>{f.safe_message}</p>
      {resource && <p>No execution attempt was created. Candidate eligibility has not been established by the plan.</p>}
      <p><strong>Next action:</strong> {action}</p>
      <details className="workbench-audit"><summary>SHOW TECHNICAL DETAILS</summary>
      <p>
        <code>{f.error_class}</code> ·{" "}
        {f.failed_stage.replaceAll("_", " ").toLowerCase()}
      </p>
      {f.failed_fold_id !== null && (
        <p>
          Fold {f.failed_fold_id} · Decision date:{" "}
          {f.failed_decision_date ?? "Not available"}
        </p>
      )}
      <p>{f.actionable_explanation}</p>
      {context.success && context.data.capacity && <dl>{Object.entries(context.data.capacity).map(([key,value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>)}</dl>}
      {candidates.length > 0 && (
        <ul className="list-disc pl-5 my-3 space-y-2">
          {candidates.map((c, i) => (
            <li key={i}>
              <strong>
                {c.exposure_policy === "constant"
                  ? typeof c.parameters?.risk === "number"
                    ? `Constant SPY ${percent.format(c.parameters.risk)}`
                    : "Constant exposure (parameters not returned)"
                  : typeof c.parameters?.cash_min === "number" &&
                      typeof c.parameters?.cash_max === "number"
                    ? `Cash ${percent.format(c.parameters.cash_min)}–${percent.format(c.parameters.cash_max)}`
                    : "Cash-band policy"}
              </strong>
              {" — "}Annualized {c.turnover_constraint_metric === "annualized_recurring_turnover" ? "recurring" : "total (including implementation)"} turnover
              {c.annualized_turnover_lower_bound !== undefined
                ? " at least"
                : ""}
              :{" "}
              {typeof c.annualized_recurring_turnover === "number" && c.turnover_constraint_metric === "annualized_recurring_turnover"
                ? c.annualized_recurring_turnover.toFixed(6)
                : typeof c.annualized_turnover === "number"
                ? c.annualized_turnover.toFixed(6)
                : (c.annualized_turnover_lower_bound?.toFixed(6) ??
                  "NOT_SUPPORTED")}
              . Maximum:{" "}
              {c.turnover_constraint_limit ?? c.maximum_annualized_turnover ??
                (limits.success ? limits.data.max_turnover : undefined) ??
                "Not returned"}
              .
              {c.initial_implementation_turnover !== undefined && <p>Initial implementation: {c.initial_implementation_turnover.toFixed(6)}. Recurring: {c.recurring_gross_turnover?.toFixed(6)}. Total: {c.total_gross_turnover?.toFixed(6)}. Simulated cost: {c.realized_simulated_cost?.toFixed(6)}.</p>}
              {c.violated_constraints?.length
                ? ` Rejected: ${c.violated_constraints.map((r) => r.replaceAll("_", " ").toLowerCase()).join(", ")}.`
                : c.annualized_turnover_lower_bound !== undefined
                  ? " Required entry already exceeds the limit."
                  : " See the verified failure class above."}
            </li>
          ))}
        </ul>
      )}
      <p>No dates or training windows were changed automatically.</p>
      <details className="workbench-audit">
        <summary>Diagnostic reference</summary>
        <code>{f.diagnostic_reference}</code>
        <p>
          Full internal diagnostics remain private in the temporary immutable
          attempt store.
        </p>
      </details>
      </details>
    </div>
  );
}
