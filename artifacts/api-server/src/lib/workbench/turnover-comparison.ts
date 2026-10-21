import { WorkbenchRunStore, WorkbenchRunStoreError } from "./run-store";
import { canonicalJson } from "./identity";
import { boundaryV2, sha256 } from "./calendar-v2";
import { PRODUCT_SPEC } from "./turnover-product";
import { methodologyOf } from "./turnover-evidence";
export function versionedSpecDifferences(left: unknown, right: unknown, path = ""): Array<{ path: string; left: unknown; right: unknown }> {
  // Absence is explicit across versioned schemas; canonical JSON still rejects
  // undefined in run identity. Comparison does not normalize/migrate either run.
  const l = left === undefined ? "NOT_PRESENT" : left, r = right === undefined ? "NOT_PRESENT" : right;
  if (canonicalJson(l) === canonicalJson(r)) return [];
  if (l && r && typeof l === "object" && typeof r === "object" && !Array.isArray(l) && !Array.isArray(r)) {
    const a = l as Record<string, unknown>, b = r as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap(k => versionedSpecDifferences(a[k], b[k], `${path}/${k.replaceAll("~", "~0").replaceAll("/", "~1")}`));
  }
  return [{ path, left: l, right: r }];
}
export async function compareTurnoverRuns(store: WorkbenchRunStore, leftId: string, rightId: string) {
  const [left,right] = await Promise.all([store.getRun(leftId),store.getRun(rightId)]);
  const specs = [left.normalized_spec, right.normalized_spec] as any[];
  if (specs.some(s => !["workbench-research-run-spec-2.0.0",PRODUCT_SPEC].includes(s.contract_version))) throw new WorkbenchRunStoreError("INVALID_CONTRACT_VERSION", "Only versioned dynamic-calendar runs can be compared here.");
  if (!left.latest_successful_attempt || !right.latest_successful_attempt) throw new WorkbenchRunStoreError("COMPARE_REQUIRES_SUCCESS", "Compare requires two successful immutable attempts.");
  const refs = [left,right].map((v,i) => ({runId: i === 0 ? leftId : rightId, executionAttemptId: v.latest_successful_attempt!.attempt.execution_attempt_id}));
  const [a,b] = await Promise.all(refs.map(ref => store.readResult(ref))) as any[];
  const values = [a,b].flatMap(r => [r.metrics?.observations,r.metrics?.final_research_index,r.costs?.transaction_cost_bps,r.costs?.realized_transaction_cost]);
  if (values.some(v => typeof v !== "number" || !Number.isFinite(v))) throw new WorkbenchRunStoreError("COMPARE_RESULT_INCOMPLETE", "Compare inputs lack finite supported financial outputs.");
  const lv = methodologyOf(specs[0]), rv = methodologyOf(specs[1]);
  const fields = ["evaluation_start","evaluation_end_exclusive","window_type","training_window_months","rebalance_frequency","transaction_cost_bps","selection_cost_bps"];
  const differences = fields.filter(k => specs[0][k] !== specs[1][k]).map(k => ({path:`/${k}`,left:specs[0][k],right:specs[1][k]}));
  if (lv !== rv) differences.push({path:"/turnover_constraint_methodology_version",left:lv,right:rv});
  return { ...boundaryV2, contract_version: "workbench-comparison-2.0.0", comparison_id: `cmp_${sha256(canonicalJson(refs))}`,
    calculation: "READ_ONLY_NO_RECALCULATION", left: {run_id:leftId,execution_attempt_id:refs[0].executionAttemptId,financial_result_hash:a.financial_result_hash},
    right: {run_id:rightId,execution_attempt_id:refs[1].executionAttemptId,financial_result_hash:b.financial_result_hash},
    spec_differences: versionedSpecDifferences(specs[0],specs[1]), financial_input_differences: differences,
    transaction_cost_difference_bps: b.costs.transaction_cost_bps-a.costs.transaction_cost_bps,
    oos_observation_difference: b.metrics.observations-a.metrics.observations,
    final_research_index_difference: b.metrics.final_research_index-a.metrics.final_research_index,
    realized_cost_difference: b.costs.realized_transaction_cost-a.costs.realized_transaction_cost,
    turnover_methodologies: {left:lv,right:rv},
    warnings: [boundaryV2.pit_classification,"Comparison reports mechanical differences and does not rank, recommend, or declare a winner.",
      ...(lv!==rv ? ["TURNOVER_METHODOLOGY_DIFFERS","The runs apply different candidate-eligibility definitions. Performance differences may reflect both strategy selection and turnover methodology."] : []),
      ...(specs[0].evaluation_start !== specs[1].evaluation_start || specs[0].evaluation_end_exclusive !== specs[1].evaluation_end_exclusive ? ["Evaluation periods differ; OOS tracks are not temporally equivalent."] : [])] };
}
