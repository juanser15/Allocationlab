import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { tmpdir } from "node:os";
import { type PriceRow } from "../calculator";
import { canonicalJson } from "./identity";
import { type CapitalExecutionEvidence, type CapitalSelectedJob, type CapitalTimeSeriesPoint } from "./execution-adapter";
import {
  ADAPTER_V2, campaignV2, loadDatasetV2, normalizedSpecV2, parseSubmissionV2, planCalendarV2, runIdV2, sha256,
  type EngineCampaign, type SubmissionV2, boundaryV2,
} from "./calendar-v2";

const { runCampaign, VERSION } = require("../../../../../research/capital/engine") as {
  runCampaign(c: EngineCampaign, rows: PriceRow[], root: string, options: { code_hash: string }): any;
  VERSION: string;
};
const { hash } = require("../../../../../research/capital/spec") as { hash(value: unknown): string };
export interface ExecutionV2Message {
  type: "execute-workbench-capital"; protocol_version: 2; run_id: string; execution_attempt_id: string;
  transaction_cost_bps: number; product_spec: SubmissionV2;
}
const inside = (parent: string, child: string) => { const rel = relative(parent, child); return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)); };
export function isExecutionV2Message(value: unknown): value is ExecutionV2Message {
  if (!value || typeof value !== "object") return false;
  const v = value as ExecutionV2Message;
  try {
    return Object.keys(v).sort().join("|") === "execution_attempt_id|product_spec|protocol_version|run_id|transaction_cost_bps|type" &&
      v.type === "execute-workbench-capital" && v.protocol_version === 2 && /^rr_[0-9a-f]{64}$/.test(v.run_id) &&
      /^ea_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.execution_attempt_id) &&
      parseSubmissionV2(v.product_spec).transaction_cost_bps === v.transaction_cost_bps;
  } catch { return false; }
}
function csvCells(line: string): string[] {
  const out: string[] = []; let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { if (quoted && line[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (line[i] === "," && !quoted) { out.push(cell); cell = ""; } else cell += line[i];
  }
  if (quoted) throw new Error("Malformed engine CSV");
  return [...out, cell];
}
function scenarioRows(text: string, scenario: number) {
  const [header, ...lines] = text.trimEnd().split(/\r?\n/);
  const selected = lines.filter(line => Number(csvCells(line)[0]) === scenario);
  return { lines: selected, sha256: sha256([header, ...selected].join("\r\n") + "\r\n") };
}
export function executeDynamicCampaign(message: ExecutionV2Message): CapitalExecutionEvidence {
  const dataset = loadDatasetV2();
  const request = parseSubmissionV2(message.product_spec);
  const normalized = normalizedSpecV2(request, dataset);
  assert.equal(runIdV2(normalized), message.run_id, "V2 identity must match worker source, calendar and data");
  const plan = planCalendarV2(request, dataset);
  const campaign = campaignV2(request, dataset);
  const configuredRoot = process.env.WORKBENCH_RUN_DIR;
  if (!configuredRoot || !isAbsolute(configuredRoot)) throw new Error("Unsafe temporary storage configuration");
  const root = realpathSync(configuredRoot);
  if (root === resolve("/") || root === realpathSync(tmpdir())) throw new Error("Unsafe temporary storage root");
  const attempt = resolve(root, "runs", message.run_id, "attempts", message.execution_attempt_id);
  if (!existsSync(attempt) || lstatSync(attempt).isSymbolicLink() || !inside(root, realpathSync(attempt))) throw new Error("Unsafe execution attempt");
  const engineRoot = resolve(attempt, "engine");
  if (existsSync(engineRoot)) throw new Error("Immutable engine output already exists");
  const result = runCampaign(campaign, dataset.rows, engineRoot, { code_hash: dataset.code_version });
  if (result.paused || result.summary?.status !== "COMPLETE" || result.reused_jobs !== 0) throw new Error("Dynamic campaign did not complete as a fresh execution");
  const selected = result.summary.selected_by_fold;
  assert.equal(selected.length, plan.folds.length);
  for (const [i, fold] of plan.folds.entries()) {
    assert.deepEqual([selected[i].train_start, selected[i].train_end, selected[i].test_start, selected[i].test_end],
      [fold.training_start, fold.training_end_exclusive, fold.oos_start, fold.oos_end_exclusive], "Plan/execution fold mismatch");
    assert.equal(selected[i].selection_cost_bps, request.selection_cost_bps);
  }
  const metrics = result.summary.outer_oos.find((item: any) => item.scenario === request.transaction_cost_bps);
  if (!metrics || metrics.observations < 1 || !Number.isFinite(metrics.final_index)) throw new Error("Missing OOS metrics");
  const jobs: CapitalSelectedJob[] = selected.map((fold: any, i: number) => {
    const artifact = `jobs/${fold.candidate_id}/outer-${fold.outer_fold}/inner-outer/scenario-${request.transaction_cost_bps}.json`;
    const envelope = JSON.parse(readFileSync(resolve(engineRoot, artifact), "utf8"));
    assert.equal(envelope.job_hash, hash(envelope.identity)); assert.equal(envelope.result_hash, hash(envelope.result));
    assert.equal(envelope.result.status, "VALID"); assert.equal(envelope.result.stage, "outer");
    assert.equal(envelope.result.targets.length, 1, "Exactly one rebalance signal in each OOS fold");
    for (const target of envelope.result.targets) {
      assert.equal(target.signalDate, plan.folds[i].decision_date);
      assert.equal(target.fit_information_cutoff, plan.folds[i].information_cutoff);
      assert.ok(target.fit_information_cutoff < plan.folds[i].oos_start);
      assert.ok(target.information_cutoff < target.signalDate);
    }
    return { outer_fold: fold.outer_fold, candidate_id: fold.candidate_id, scenario: request.transaction_cost_bps,
      job_hash: envelope.job_hash, result_hash: envelope.result_hash, fit_keys: envelope.result.fit_keys, targets: envelope.result.targets, artifact };
  });
  const equity = scenarioRows(readFileSync(resolve(engineRoot, "oos-equity.csv"), "utf8"), request.transaction_cost_bps);
  const ledger = scenarioRows(readFileSync(resolve(engineRoot, "oos-ledger.csv"), "utf8"), request.transaction_cost_bps);
  const timeSeries: CapitalTimeSeriesPoint[] = equity.lines.map(line => {
    const cells = csvCells(line);
    return { outer_fold: Number(cells[1]), candidate_id: cells[2], date: cells[3], index: Number(cells[4]), drawdown: Number(cells[5]), net_return: Number(cells[6]), exposure: Number(cells[7]) };
  });
  assert.equal(timeSeries.length, metrics.observations);
  assert.equal(new Set(timeSeries.map(point => point.date)).size, timeSeries.length, "OOS observations must not overlap");
  for (const point of timeSeries) {
    const fold = plan.folds[point.outer_fold]; assert.ok(point.date >= fold.oos_start && point.date < fold.oos_end_exclusive);
  }
  const artifactKinds: Record<string, string> = { "manifest.json": "ENGINE_MANIFEST", "summary.json": "ENGINE_SUMMARY", "campaign.frozen.json": "CAMPAIGN", "folds.csv": "FOLD_PLAN", "selected-by-fold.csv": "SELECTED_FOLDS", "oos-equity.csv": "OOS_EQUITY", "oos-ledger.csv": "OOS_LEDGER" };
  const artifacts = ["manifest.json", "summary.json", "campaign.frozen.json", "folds.csv", "selected-by-fold.csv", "oos-equity.csv", "oos-ledger.csv", ...jobs.map(job => job.artifact)]
    .map(path => ({ kind: artifactKinds[path] ?? "SELECTED_OUTER_JOB", path, sha256: sha256(readFileSync(resolve(engineRoot, path))),
      ...(path === "oos-equity.csv" || path === "oos-ledger.csv" ? { selector: `scenario=${request.transaction_cost_bps}`, selected_rows_sha256: path === "oos-equity.csv" ? equity.sha256 : ledger.sha256 } : {}) }));
  const financialHash = hash({ contract_version: "workbench-financial-result-2.0.0", run_id: message.run_id,
    engine_version: VERSION, experiment_hash: result.experiment_hash, scenario_metrics: metrics, selected_folds: selected,
    selected_jobs: jobs.map(job => ({ ...job, targets: hash(job.targets) })), equity_sha256: equity.sha256, ledger_sha256: ledger.sha256 });
  return { adapter_version: ADAPTER_V2, pit_classification: boundaryV2.pit_classification, storage_status: boundaryV2.storage_classification,
    real_money_boundary: boundaryV2.research_boundary, requested_transaction_cost_bps: request.transaction_cost_bps,
    engine: { engine_version: VERSION, experiment_id: campaign.experiment_id, experiment_hash: result.experiment_hash, code_hash: dataset.code_version,
      data_csv_sha256: dataset.snapshot.sha256, parsed_data_hash: dataset.snapshot.parsed_data_hash, campaign_config_sha256: sha256(canonicalJson(campaign)), new_jobs: result.new_jobs, reused_jobs: result.reused_jobs },
    scenario_metrics: metrics, selected_folds: selected, selected_jobs: jobs, time_series: timeSeries, result_artifacts: artifacts,
    financial_result_hash: financialHash, runtime_hash: sha256(readFileSync(resolve(engineRoot, "progress.json"))), warnings: [boundaryV2.pit_classification, ...result.summary.limitations], blockers: [] };
}
