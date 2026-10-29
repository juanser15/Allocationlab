/** Stable public categories. Specific codes and bounded evidence remain separate. */
export type ResearchFailureCategory = "PORTFOLIO_CONSTRAINT" | "DATA_COVERAGE" | "SOLVER_INFEASIBLE" | "NUMERICAL_FAILURE";
export function researchFailureCategory(code: string): ResearchFailureCategory | undefined {
  if (["PORTFOLIO_CONSTRAINT", "PORTFOLIO_CONSTRAINT_CONFLICT"].includes(code)) return "PORTFOLIO_CONSTRAINT";
  if (["DATA_COVERAGE", "SIGNAL_HISTORY_REQUIRED", "SIGNAL_UNIVERSE_REQUIRED", "FORECAST_TRAINING_REQUIRED", "HMM_HISTORY_REQUIRED", "REGIME_FEATURE_HISTORY_REQUIRED", "INSUFFICIENT_TRAINING_HISTORY"].includes(code)) return "DATA_COVERAGE";
  if (["SOLVER_INFEASIBLE", "OPTIMIZATION_INFEASIBLE", "FROZEN_COMPOSITION_EXPOSURE_CONFLICT"].includes(code)) return "SOLVER_INFEASIBLE";
  if (["NUMERICAL_FAILURE", "MANDATE_BREACH", "OPTIMIZER_NOT_CONVERGED", "OPTIMIZATION_INVALID_RISK", "HMM_NUMERICAL_FAILURE", "HMM_DEGENERATE", "HMM_NOT_CONVERGED", "FORECAST_NUMERICAL_FAILURE"].includes(code)) return "NUMERICAL_FAILURE";
  return undefined;
}
export function researchFailureAction(category: ResearchFailureCategory | undefined): string | undefined {
  if (category === "PORTFOLIO_CONSTRAINT") return "Correct the conflicting mandate fields before submitting a new run.";
  if (category === "DATA_COVERAGE") return "Review the requested training and feature dates against the selected dataset. No dates were changed.";
  if (category === "SOLVER_INFEASIBLE") return "Inspect the affected decision's exposure, support and risk constraints. No compliant allocation was published and no constraints were relaxed.";
  if (category === "NUMERICAL_FAILURE") return "Ask the owner to inspect the solver convergence and residual evidence before rerunning. Do not interpret this as a successful or statically infeasible portfolio.";
  return undefined;
}
/** Only engine-owned stage identifiers can override the last progress label. */
export function researchFailureStage(details: Record<string, unknown>, progressStage?: string): string {
  const stage = details.failed_stage;
  return stage === "PORTFOLIO_OPTIMIZATION" || stage === "CAPITAL_OVERLAY"
    ? stage : progressStage ?? "PREPARING_DATA";
}
