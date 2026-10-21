import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseCsv } from "./lib/calculator";
import { resolveWorkbenchRepositoryRoot } from "./lib/workbench/repository-root";
import type {
  CapitalExecutionEvidence,
  CapitalResultArtifact,
  CapitalScenarioMetrics,
  CapitalSelectedFold,
  CapitalSelectedJob,
  CapitalTimeSeriesPoint,
  SupportedTransactionCostBps,
} from "./lib/workbench/execution-adapter";

interface Campaign {
  experiment_id: string;
  validation_mode: "traditional" | "nested";
  window_type: "rolling" | "expanding";
  dates: { start: string; end_exclusive: string };
  train_months: number;
  test_months: number;
  step_months: number;
  rebalance_frequency: "monthly" | "quarterly";
  recalibration_frequency: "monthly" | "quarterly" | "yearly" | "once";
  risk_asset: string;
  data_csv: string;
  data_sha256: string;
  selection_cost_bps: number;
  transaction_cost_bps: number[];
  warmup_rows: number;
  max_jobs: number;
  [key: string]: unknown;
}

interface CampaignRunResult {
  paused: boolean;
  new_jobs: number;
  reused_jobs: number;
  experiment_hash: string;
  summary?: {
    status: string;
    outer_oos: Array<Record<string, unknown> & { scenario: number }>;
    selected_by_fold: CapitalSelectedFold[];
    limitations: string[];
  };
}

type RunCampaign = (
  campaign: Campaign,
  rows: ReturnType<typeof parseCsv>,
  root: string,
  options: { code_hash: string },
) => CampaignRunResult;

// These fixed literal requires let esbuild bundle the certified TypeScript
// engine into the isolated worker. The local signatures keep the call typed
// while the API package's rootDir remains limited to src/ for strict tsc.
// No request value can influence either module path.
const { runCampaign, VERSION: ENGINE_VERSION } = require(
  "../../../research/capital/engine",
) as { runCampaign: RunCampaign; VERSION: string };
const { hash: engineHash } = require("../../../research/capital/spec") as {
  hash(value: unknown): string;
};

const ADAPTER_VERSION = "workbench-b1-capital-adapter-1.0.0" as const;
const PIT_CLASSIFICATION =
  "PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED" as const;
const STORAGE_STATUS = "TEMPORARY_RESEARCH_STORAGE" as const;
const REAL_MONEY_BOUNDARY = "RESEARCH_ONLY" as const;

const CAMPAIGN_PATH = "configs/capital-research/acceptance-traditional.json";
const DATA_PATH = "reports/cl02/adjusted-closes.csv";
const CAMPAIGN_SHA256 =
  "9ad484bc22d2120f583b08fe1a951d22ddb34525f8c89feee28a813a336c1c64";
const DATA_SHA256 =
  "b4a4fa0e0ddb6f639521acbe7398740904860a933391081d06e783339e6c7bc0";
const PARSED_DATA_HASH =
  "f7436db75e7c6ed35938e6248c48c162c051cd8a99457a5c386910b36f6c743e";
const CERTIFIED_CODE_HASH =
  "94a2c94f0cf7a096865a7d5a8284aa1141f23b62a49685e8d3e3502afd830dcf";
const CERTIFIED_EXPERIMENT_HASH =
  "803c0c5bbe79c9d47a72f7a22a6709b82a00eb34c5e83d79b44b9f988bc6ceef";
const EXPECTED_NEW_JOBS = 24;
const MAX_WORKER_RESULT_BYTES = 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;

type ExecuteMessage = {
  type: "execute-workbench-capital";
  protocol_version: 1;
  run_id: string;
  execution_attempt_id: string;
  transaction_cost_bps: SupportedTransactionCostBps;
};

const RUN_ID_PATTERN = /^rr_[0-9a-f]{64}$/;
const EXECUTION_ATTEMPT_ID_PATTERN =
  /^ea_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isExecuteMessage(value: unknown): value is ExecuteMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  const exactKeys = [
    "execution_attempt_id",
    "protocol_version",
    "run_id",
    "transaction_cost_bps",
    "type",
  ];
  if (Object.keys(message).sort().join("|") !== exactKeys.join("|")) return false;
  return (
    message.type === "execute-workbench-capital" &&
    message.protocol_version === 1 &&
    typeof message.run_id === "string" &&
    RUN_ID_PATTERN.test(message.run_id) &&
    typeof message.execution_attempt_id === "string" &&
    EXECUTION_ATTEMPT_ID_PATTERN.test(message.execution_attempt_id) &&
    (message.transaction_cost_bps === 0 || message.transaction_cost_bps === 5)
  );
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function codeHash(repositoryRoot: string): string {
  const capitalRoot = resolve(repositoryRoot, "research/capital");
  const paths = readdirSync(capitalRoot)
    .filter((name) => /\.(ts|py)$/.test(name))
    .sort()
    .map((name) => `research/capital/${name}`)
    .concat([
      "artifacts/api-server/src/lib/calculator.ts",
      "artifacts/api-server/src/lib/factor-library.ts",
      "artifacts/api-server/src/lib/d6-trace.ts",
      "artifacts/api-server/src/lib/calculator.a1.db-shim.ts",
    ]);
  const hashes = Object.fromEntries(
    paths.map((path) => [path, engineHash(readFileSync(resolve(repositoryRoot, path), "utf8"))]),
  );
  return engineHash(hashes);
}

function validateCampaign(campaign: Campaign): void {
  if (
    campaign.experiment_id !== "cl03-acceptance-traditional" ||
    campaign.validation_mode !== "traditional" ||
    campaign.window_type !== "rolling" ||
    campaign.dates.start !== "2020-01-01" ||
    campaign.dates.end_exclusive !== "2024-01-01" ||
    campaign.train_months !== 24 ||
    campaign.test_months !== 12 ||
    campaign.step_months !== 12 ||
    campaign.rebalance_frequency !== "monthly" ||
    campaign.recalibration_frequency !== "monthly" ||
    campaign.risk_asset !== "SPY" ||
    campaign.data_csv !== DATA_PATH ||
    campaign.data_sha256 !== DATA_SHA256 ||
    campaign.selection_cost_bps !== 5 ||
    engineHash(campaign.transaction_cost_bps) !== engineHash([0, 5]) ||
    campaign.warmup_rows !== 252 ||
    campaign.max_jobs !== 2000
  ) throw new Error("Committed capital campaign invariants do not match Phase A");
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("Malformed CSV artifact");
  cells.push(cell);
  return cells;
}

function scenarioCsv(
  csv: string,
  scenario: SupportedTransactionCostBps,
): { selected: string; rows: string[] } {
  if (!csv.endsWith("\r\n")) throw new Error("Unexpected engine CSV line endings");
  const lines = csv.slice(0, -2).split("\r\n");
  const header = lines.shift();
  if (!header) throw new Error("Missing engine CSV header");
  const rows = lines.filter((line) => line.startsWith(`"${scenario}",`));
  return { selected: [header, ...rows].join("\r\n") + "\r\n", rows };
}

function finiteNumber(value: string, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Nonfinite ${field} in engine artifact`);
  return number;
}

function timeSeriesFromRows(rows: string[]): CapitalTimeSeriesPoint[] {
  return rows.map((line) => {
    const cells = parseCsvLine(line);
    if (cells.length !== 8) throw new Error("Unexpected OOS equity artifact shape");
    return {
      outer_fold: finiteNumber(cells[1], "outer_fold"),
      candidate_id: cells[2],
      date: cells[3],
      index: finiteNumber(cells[4], "index"),
      drawdown: finiteNumber(cells[5], "drawdown"),
      net_return: finiteNumber(cells[6], "net_return"),
      exposure: finiteNumber(cells[7], "exposure"),
    };
  });
}

function assertScenarioMetrics(
  value: unknown,
  scenario: SupportedTransactionCostBps,
): asserts value is CapitalScenarioMetrics {
  if (!value || typeof value !== "object") throw new Error("Missing scenario metrics");
  const metrics = value as Record<string, unknown>;
  const numeric = [
    "observations",
    "cagr",
    "net_sharpe",
    "max_drawdown",
    "return_drawdown_ratio",
    "volatility",
    "turnover",
    "turnover_annualized",
    "costs",
    "exposure",
    "final_index",
  ];
  if (
    metrics.scenario !== scenario ||
    numeric.some((field) => typeof metrics[field] !== "number" || !Number.isFinite(metrics[field]))
  ) throw new Error("Invalid scenario metrics");
}

function artifact(
  engineRoot: string,
  kind: string,
  path: string,
  selector?: string,
  selectedRowsSha256?: string,
): CapitalResultArtifact {
  const absolute = resolve(engineRoot, path);
  if (!isWithin(engineRoot, absolute) || !existsSync(absolute)) {
    throw new Error(`Missing engine artifact: ${path}`);
  }
  return {
    kind,
    path,
    sha256: sha256(readFileSync(absolute)),
    ...(selector ? { selector } : {}),
    ...(selectedRowsSha256 ? { selected_rows_sha256: selectedRowsSha256 } : {}),
  };
}

function execute(message: ExecuteMessage): CapitalExecutionEvidence {
  const repositoryRoot = resolveWorkbenchRepositoryRoot({ moduleUrl: import.meta.url });
  const configuredRoot = process.env.WORKBENCH_RUN_DIR ?? "/tmp/allocationlab-workbench-runs";
  if (!isAbsolute(configuredRoot) || !existsSync(configuredRoot)) {
    throw new Error("Unsafe temporary run-store root");
  }
  const storageRoot = realpathSync(configuredRoot);
  if (
    storageRoot === "/" ||
    storageRoot === realpathSync(tmpdir()) ||
    isWithin(repositoryRoot, storageRoot) ||
    isWithin(storageRoot, repositoryRoot)
  ) {
    throw new Error("Temporary run store overlaps the repository");
  }
  const attemptRoot = resolve(
    storageRoot,
    "runs",
    message.run_id,
    "attempts",
    message.execution_attempt_id,
  );
  if (
    !existsSync(attemptRoot) ||
    lstatSync(attemptRoot).isSymbolicLink() ||
    !isWithin(storageRoot, realpathSync(attemptRoot))
  ) throw new Error("Immutable execution-attempt directory is unsafe or missing");
  const engineRoot = resolve(attemptRoot, "engine");
  if (!isWithin(storageRoot, engineRoot) || existsSync(engineRoot)) {
    throw new Error("Immutable engine attempt path is unsafe or already exists");
  }

  const campaignFile = resolve(repositoryRoot, CAMPAIGN_PATH);
  const campaignText = readFileSync(campaignFile, "utf8");
  if (sha256(campaignText) !== CAMPAIGN_SHA256) {
    throw new Error("Committed capital campaign hash mismatch");
  }
  const campaign = JSON.parse(campaignText) as Campaign;
  validateCampaign(campaign);

  const dataFile = resolve(repositoryRoot, DATA_PATH);
  const csv = readFileSync(dataFile, "utf8");
  if (sha256(csv) !== DATA_SHA256 || engineHash(csv) !== campaign.data_sha256) {
    throw new Error("Committed empirical data hash mismatch");
  }
  const rows = parseCsv(csv);
  if (rows.length !== 4_023 || engineHash(rows) !== PARSED_DATA_HASH) {
    throw new Error("Parsed empirical data identity mismatch");
  }

  const calculatedCodeHash = codeHash(repositoryRoot);
  if (calculatedCodeHash !== CERTIFIED_CODE_HASH) {
    throw new Error("Certified capital-engine source hash mismatch");
  }
  const result = runCampaign(campaign, rows, engineRoot, {
    code_hash: calculatedCodeHash,
  });
  if (
    result.paused ||
    result.summary?.status !== "COMPLETE" ||
    result.new_jobs !== EXPECTED_NEW_JOBS ||
    result.reused_jobs !== 0 ||
    result.experiment_hash !== CERTIFIED_EXPERIMENT_HASH
  ) throw new Error("Capital campaign did not complete as a fresh certified execution");

  const scenario = result.summary.outer_oos.find(
    (entry: { scenario: number }) => entry.scenario === message.transaction_cost_bps,
  );
  assertScenarioMetrics(scenario, message.transaction_cost_bps);

  const selectedFolds = result.summary.selected_by_fold as CapitalSelectedFold[];
  if (
    selectedFolds.length !== 2 ||
    selectedFolds.some((fold) => fold.status !== "SELECTED")
  ) throw new Error("Capital campaign did not produce the expected selected folds");

  const selectedJobs: CapitalSelectedJob[] = selectedFolds.map((fold) => {
    const relativePath =
      `jobs/${fold.candidate_id}/outer-${fold.outer_fold}/inner-outer/` +
      `scenario-${message.transaction_cost_bps}.json`;
    const envelope = JSON.parse(
      readFileSync(resolve(engineRoot, relativePath), "utf8"),
    ) as {
      job_hash: string;
      result_hash: string;
      identity: Record<string, unknown>;
      result: {
        status: string;
        stage: string;
        scenario: number;
        outer_fold: number;
        candidate_id: string;
        targets: Record<string, unknown>[];
        fit_keys: string[];
      };
    };
    if (
      envelope.result.status !== "VALID" ||
      envelope.result.stage !== "outer" ||
      envelope.result.scenario !== message.transaction_cost_bps ||
      envelope.result.outer_fold !== fold.outer_fold ||
      envelope.result.candidate_id !== fold.candidate_id ||
      envelope.job_hash !== engineHash(envelope.identity) ||
      envelope.result_hash !== engineHash(envelope.result)
    ) throw new Error("Selected outer job identity/integrity mismatch");
    return {
      outer_fold: fold.outer_fold,
      candidate_id: fold.candidate_id,
      scenario: message.transaction_cost_bps,
      job_hash: envelope.job_hash,
      result_hash: envelope.result_hash,
      fit_keys: envelope.result.fit_keys,
      targets: envelope.result.targets,
      artifact: relativePath,
    };
  });

  const equityCsv = readFileSync(resolve(engineRoot, "oos-equity.csv"), "utf8");
  const ledgerCsv = readFileSync(resolve(engineRoot, "oos-ledger.csv"), "utf8");
  const selectedEquity = scenarioCsv(equityCsv, message.transaction_cost_bps);
  const selectedLedger = scenarioCsv(ledgerCsv, message.transaction_cost_bps);
  const timeSeries = timeSeriesFromRows(selectedEquity.rows);
  if (timeSeries.length !== scenario.observations) {
    throw new Error("Scenario time-series count does not match summary metrics");
  }
  const equityHash = sha256(selectedEquity.selected);
  const ledgerHash = sha256(selectedLedger.selected);

  const artifacts: CapitalResultArtifact[] = [
    artifact(engineRoot, "ENGINE_MANIFEST", "manifest.json"),
    artifact(engineRoot, "ENGINE_SUMMARY", "summary.json", `outer_oos[scenario=${message.transaction_cost_bps}]`),
    artifact(engineRoot, "SELECTED_FOLDS", "selected-by-fold.csv"),
    artifact(engineRoot, "OOS_EQUITY", "oos-equity.csv", `scenario=${message.transaction_cost_bps}`, equityHash),
    artifact(engineRoot, "OOS_LEDGER", "oos-ledger.csv", `scenario=${message.transaction_cost_bps}`, ledgerHash),
    ...selectedJobs.map((job) => artifact(engineRoot, "SELECTED_OUTER_JOB", job.artifact)),
  ];

  const financialResultHash = engineHash({
    engine_version: ENGINE_VERSION,
    experiment_hash: result.experiment_hash,
    code_hash: calculatedCodeHash,
    data_sha256: DATA_SHA256,
    transaction_cost_bps: message.transaction_cost_bps,
    scenario_metrics: scenario,
    selected_folds: selectedFolds,
    selected_jobs: selectedJobs.map((job) => ({
      outer_fold: job.outer_fold,
      candidate_id: job.candidate_id,
      job_hash: job.job_hash,
      result_hash: job.result_hash,
      fit_keys: job.fit_keys,
      targets_hash: engineHash(job.targets),
    })),
    selected_equity_rows_sha256: equityHash,
    selected_ledger_rows_sha256: ledgerHash,
  });
  const progress = readFileSync(resolve(engineRoot, "progress.json"));

  return {
    adapter_version: ADAPTER_VERSION,
    pit_classification: PIT_CLASSIFICATION,
    storage_status: STORAGE_STATUS,
    real_money_boundary: REAL_MONEY_BOUNDARY,
    requested_transaction_cost_bps: message.transaction_cost_bps,
    engine: {
      engine_version: ENGINE_VERSION,
      experiment_id: campaign.experiment_id,
      experiment_hash: result.experiment_hash,
      code_hash: calculatedCodeHash,
      data_csv_sha256: DATA_SHA256,
      parsed_data_hash: PARSED_DATA_HASH,
      campaign_config_sha256: CAMPAIGN_SHA256,
      new_jobs: result.new_jobs,
      reused_jobs: result.reused_jobs,
    },
    scenario_metrics: scenario,
    selected_folds: selectedFolds,
    selected_jobs: selectedJobs,
    time_series: timeSeries,
    result_artifacts: artifacts,
    financial_result_hash: financialResultHash,
    runtime_hash: sha256(progress),
    warnings: [
      PIT_CLASSIFICATION,
      "The adjusted-close data vendor and historical data vintages have not been independently verified.",
      ...result.summary.limitations,
    ],
    blockers: [],
  };
}

function diagnostic(error: unknown): string {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  return Buffer.from(detail).subarray(0, MAX_DIAGNOSTIC_BYTES).toString("utf8");
}

function send(message: unknown): void {
  const encoded = JSON.stringify(message);
  if (Buffer.byteLength(encoded) > MAX_WORKER_RESULT_BYTES) {
    const fallback = {
      type: "workbench-capital-error",
      protocol_version: 1,
      error_class: "WORKER_RESULT_LIMIT_EXCEEDED",
      safe_message: "The empirical worker result exceeded its bounded response size.",
      diagnostic: "",
    };
    process.send?.(fallback, () => process.disconnect?.());
    return;
  }
  process.send?.(message, () => process.disconnect?.());
}

process.once("message", (message: unknown) => {
  try {
    if (!isExecuteMessage(message)) throw new Error("Invalid fixed worker protocol message");
    send({
      type: "workbench-capital-result",
      protocol_version: 1,
      result: execute(message),
    });
  } catch (error) {
    send({
      type: "workbench-capital-error",
      protocol_version: 1,
      error_class: "CAPITAL_ENGINE_EXECUTION_FAILED",
      safe_message: "The committed capital research engine could not complete this attempt.",
      diagnostic: diagnostic(error),
    });
  }
});

process.once("disconnect", () => {
  process.exitCode = 0;
});
