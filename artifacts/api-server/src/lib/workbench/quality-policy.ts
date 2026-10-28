import { createHash } from "node:crypto";
import { canonicalJson } from "./identity";
/** Fixed structural policy, not the unrelated synthetic QA economic thresholds. */
export const STRUCTURAL_POLICY = Object.freeze({
  version: "STRUCTURAL_V1" as const,
  coverage: 1,
  ranking: "NONCONSTANT_FOR_MULTIASSET_SIGNAL_SELECTION",
  pca: "CROSS_SECTIONAL_ZSCORE_DDOF1_DIAGNOSTIC_ONLY",
  stability: "MEAN_SPEARMAN_PREVIOUS_3_REBALANCES_WITH_ALL_SCORE_DEPENDENCIES_WITHIN_TRAINING_WINDOW",
  rank_reversal: "WARNING_IF_MEAN_CORRELATION_BELOW_ZERO",
  missing_diagnostics: "EXPLICIT_NULL_WITH_REASON_NOT_ZERO",
  rejected_assignment: "STOP_RUN_NO_PORTFOLIO_OR_PERFORMANCE_SUBSTITUTION",
  economic_thresholds: "NONE",
  predictive_quality: "NOT_USED_NO_FUTURE_LABELS",
  execution: "NEXT_OBSERVED_CLOSE_AFTER_DECISION",
});
export const QUALITY_POLICY_HASH = createHash("sha256").update(canonicalJson(STRUCTURAL_POLICY)).digest("hex");
