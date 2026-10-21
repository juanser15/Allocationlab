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
  return (
    <div className="wd-error wd-failure-notice" role="alert">
      <strong>{f.safe_message}</strong>
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
              {" — "}Annualized turnover
              {c.annualized_turnover_lower_bound !== undefined
                ? " at least"
                : ""}
              :{" "}
              {typeof c.annualized_turnover === "number"
                ? c.annualized_turnover.toFixed(6)
                : (c.annualized_turnover_lower_bound?.toFixed(6) ??
                  "NOT_SUPPORTED")}
              . Maximum:{" "}
              {c.maximum_annualized_turnover ??
                (limits.success ? limits.data.max_turnover : undefined) ??
                "Not returned"}
              .
              {c.violated_constraints?.length
                ? ` Rejected: ${c.violated_constraints.map((r) => r.replaceAll("_", " ").toLowerCase()).join(", ")}.`
                : c.annualized_turnover_lower_bound !== undefined
                  ? " Required entry already exceeds the limit."
                  : " See the verified failure class above."}
            </li>
          ))}
        </ul>
      )}
      <p>
        <strong>Next action:</strong> {f.suggested_user_action}
      </p>
      <p>No dates or training windows were changed automatically.</p>
      <details className="workbench-audit">
        <summary>Diagnostic reference</summary>
        <code>{f.diagnostic_reference}</code>
        <p>
          Full internal diagnostics remain private in the temporary immutable
          attempt store.
        </p>
      </details>
    </div>
  );
}
