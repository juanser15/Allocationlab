import { sourceOnlyDataset } from "./optimizer-test-fixtures";
import type { P0Dataset } from "../../artifacts/api-server/src/lib/workbench/p0-calendar";
import { COORDINATED_SPEC, CURRENT_CASH_POLICY } from "../../artifacts/api-server/src/lib/workbench/coordinated-contract";

/** Deterministic TEST_ONLY prices; never stored or represented as vendor data. */
export function clockData(): P0Dataset {
  const rows = [];
  for (let t = Date.parse("2021-01-01"), i = 0; t <= Date.parse("2024-06-01"); t += 86400000) {
    const day = new Date(t);
    if ([0, 6].includes(day.getUTCDay())) continue;
    rows.push({ date: day.toISOString().slice(0, 10), prices: {
      SPY: 100 * Math.exp(.0006 * i + .006 * Math.sin(i)),
      EFA: 100 * Math.exp(.0005 * i + .008 * Math.cos(i)),
      IEF: 100 * Math.exp(.0001 * i + .002 * Math.sin(.3 * i)),
    } });
    i++;
  }
  const binding = { dataset_id: `internal_${"0".repeat(64)}`, dataset_version: 1, dataset_hash: "0".repeat(64), dataset_source: "TEST_ONLY" };
  return { ...sourceOnlyDataset(rows), binding };
}
export function clockRequest(scope = "PORTFOLIO", clock: "DAILY" | "REBALANCE_ONLY" | undefined = "DAILY"): any {
  return {
    contract_version: COORDINATED_SPEC, dataset_id: `internal_${"0".repeat(64)}`,
    cash_policy: CURRENT_CASH_POLICY, slippage_bps: 5,
    evaluation_start: "2024-01-22", evaluation_end_exclusive: "2024-02-09",
    training_window_months: 6, window_type: "ROLLING", rebalance_frequency: "MONTHLY",
    transaction_cost_bps: 10, control_mode: "MAX_EXPOSURE", maximum_exposure: 1, risk_budget: .1,
    regime_model: "HMM", regime_response: "ADAPTIVE", defensive_multiplier: 0,
    research_scope: scope,
    ...(clock ? { capital_signal_frequency: clock } : {}),
    ...(scope === "PORTFOLIO" ? { etfs: ["SPY", "EFA", "IEF"], maximum_etf_weight: .7,
      risk_aversion: .1, covariance_shrinkage: .2, quality_control: { enabled: true, policy_version: "STRUCTURAL_V1" } } : {}),
  };
}
export function legacyCases() {
  return ["PORTFOLIO", "CAPITAL_EXPOSURE"].flatMap(scope =>
    ["MONTHLY", "QUARTERLY"].flatMap(cadence => ["FIXED", "ADAPTIVE"].map(response => {
      const request = clockRequest(scope, "REBALANCE_ONLY");
      delete request.capital_signal_frequency;
      return { name: `${scope}-${cadence}-${response}`, request: {
        ...request, rebalance_frequency: cadence, regime_response: response,
        evaluation_end_exclusive: "2024-03-01", defensive_multiplier: .5,
      } };
    })));
}
