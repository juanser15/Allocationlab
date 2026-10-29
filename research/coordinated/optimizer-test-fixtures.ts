/** Source-only mathematical fixtures. These are invented deterministic test
 * observations, never empirical data, never persisted or exposed by production.
 * The public campaign supplies schema metadata only; its private CSV is not read. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { PriceRow } from "../../artifacts/api-server/src/lib/calculator";
import type { P0Dataset } from "../../artifacts/api-server/src/lib/workbench/p0-calendar";
import { COORDINATED_SPEC, CURRENT_CASH_POLICY } from "../../artifacts/api-server/src/lib/workbench/coordinated-contract";

export function sourceOnlyDataset(rows: PriceRow[]): P0Dataset {
  const digest = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const fixture = JSON.parse(readFileSync("configs/capital-research/acceptance-traditional.json", "utf8"));
  const binding = { dataset_id: `internal_${"0".repeat(64)}`, dataset_version: 1, dataset_hash: digest, dataset_source: "SYNTHETIC_TEST_ONLY" };
  return { rows, fixture: { ...fixture, data_csv: "SYNTHETIC_TEST_ONLY_NO_FILE", data_sha256: digest, data_provenance: "Deterministic mathematical fixture; not historical/vendor observations" }, binding,
    snapshot: { path: "SYNTHETIC_TEST_ONLY_NO_FILE", sha256: digest, parsed_data_hash: digest, observations: rows.length, data_first_observation: rows[0].date, data_last_observation: rows.at(-1)!.date },
    code_version: "SYNTHETIC_TEST_ONLY_PUBLIC_SOURCE_METADATA" };
}
export function optimizerTestData(assetCount = 12): P0Dataset {
  const symbols = ["SPY", ...Array.from({ length: assetCount - 1 }, (_, i) => `ETF${i + 1}`)];
  const rows: PriceRow[] = [];
  for (let time = Date.parse("2021-01-01"), i = 0; time <= Date.parse("2024-06-01"); time += 86400000) {
    const d = new Date(time);
    if ([0, 6].includes(d.getUTCDay())) continue;
    rows.push({ date: d.toISOString().slice(0, 10), prices: Object.fromEntries(symbols.map((ticker, j) => [ticker, 100 * Math.exp((.0005 + .00001 * j) * i + (.004 + .0002 * j) * Math.sin(i * (.3 + .07 * j)))])) });
    i++;
  }
  return sourceOnlyDataset(rows);
}
export function optimizerTestRequest(patch: Record<string, unknown> = {}): any {
  return {
    contract_version: COORDINATED_SPEC, dataset_id: `internal_${"0".repeat(64)}`,
    cash_policy: CURRENT_CASH_POLICY, slippage_bps: 5,
    evaluation_start: "2024-01-22", evaluation_end_exclusive: "2024-02-09",
    training_window_months: 6, window_type: "ROLLING", rebalance_frequency: "MONTHLY",
    transaction_cost_bps: 10, control_mode: "MAX_EXPOSURE", maximum_exposure: 1, risk_budget: .1,
    regime_model: "HMM", regime_response: "ADAPTIVE", defensive_multiplier: 0,
    research_scope: "PORTFOLIO", capital_signal_frequency: "DAILY",
    etfs: ["SPY", ...Array.from({ length: 11 }, (_, i) => `ETF${i + 1}`)], maximum_etf_weight: .25,
    risk_aversion: .1, covariance_shrinkage: .2,
    quality_control: { enabled: false, policy_version: "STRUCTURAL_V1" },
    mandate: { minimum_positions: 1, maximum_positions: 10, minimum_weight: .03 },
    ...patch,
  };
}
