import { createHash, randomUUID } from "node:crypto";
import {
  readFile,
  lstat,
  realpath,
  mkdir,
  writeFile,
  link,
  unlink,
} from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { readFileSync } from "node:fs";
import {
  beta,
  conditionalMetrics,
  regression,
  DEFAULT_REGRESSION,
  mean,
  type Pair,
} from "../allocation-core/risk-analytics/analytics";
import {
  capitalEfficiency,
  ratio,
} from "../allocation-core/risk-analytics/diagnostics";
import { canonicalJson } from "./identity";
import {
  loadDatasetV2,
  campaignV2,
  type NormalizedSpecV2,
  type PlannedFoldV2,
} from "./calendar-v2";
import { WorkbenchRunStore } from "./run-store";
import { resolveWorkbenchRepositoryRoot } from "./repository-root";
import { exposureModelDefinition } from "./exposure-model-definition";
import {
  controlTrack,
  matchBeta,
  AttributionError,
  BENCHMARK_METHODOLOGY_VERSION,
  type ControlDay,
} from "./exposure-controls";

interface Observation {
  date: string;
  net_return: number;
  turnover: number;
  costs: number;
  exposure: number;
}
interface Performance {
  observations: number;
  cagr: number;
  net_sharpe: number | null;
  max_drawdown: number;
  volatility: number;
  turnover: number;
  costs: number;
  exposure: number;
  final_index: number;
}
const { summarize } = require("../../../../../research/capital/metrics") as {
  summarize(rows: Observation[], reference: number): Performance;
};
const { hash, generateCandidates } =
  require("../../../../../research/capital/spec") as {
    hash(v: unknown): string;
    generateCandidates(c: any): {
      candidates: Array<{
        candidate_id: string;
        spec: {
          exposure_policy: string;
          exposure_parameters: Record<string, number>;
        };
      }>;
    };
  };
const sha = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
const assertInput = (ok: unknown, message: string) => {
  if (!ok) throw new AttributionError("ATTRIBUTION_INPUT_MISMATCH", message);
};
interface DynamicResult {
  run_id: string;
  execution_attempt_id: string;
  status: string;
  financial_result_hash: string;
  metrics: {
    cagr: number;
    final_research_index: number;
    observations: number;
    [key: string]: unknown;
  };
  time_series: {
    points: Array<{
      date: string;
      index: number;
      drawdown: number;
      net_return: number;
      exposure: number;
      outer_fold: number;
    }>;
  };
  validation_diagnostics: {
    exact_fold_plan: PlannedFoldV2[];
    outer_folds: Array<{
      outer_fold: number;
      score: number;
      selection_metric: string;
    }>;
    selected_jobs: Array<{
      outer_fold: number;
      candidate_id: string;
      job_hash: string;
      result_hash: string;
      fit_keys: string[];
      artifact: string;
    }>;
  };
  result_artifacts: Array<{ path: string; sha256: string }>;
}
interface Ledger {
  date: string;
  intervalStart: string;
  beginningNav: number;
  beginningCash: number;
  beginningPositions: Array<{
    marketValue: number;
    quantity: number;
    ticker: string;
  }>;
  transactionCosts: number;
  netPnl: number;
  etfPnl: number;
  cashPnl: number;
  endingNav: number;
  trades: Array<{ notional: number }>;
}

async function safeRead(root: string, path: string, maxBytes: number) {
  const rel = relative(root, path);
  assertInput(
    rel && !isAbsolute(rel) && !rel.split(sep).some((p) => p === ".."),
    "Attribution input must stay inside its temporary store.",
  );
  let parent = root;
  for (const part of rel.split(sep)) {
    parent = resolve(parent, part);
    const info = await lstat(parent);
    assertInput(
      !info.isSymbolicLink(),
      "Symlinks cannot be used for attribution artifacts.",
    );
  }
  const info = await lstat(path);
  assertInput(
    info.isFile() && info.size <= maxBytes,
    "Attribution artifact is not a bounded regular file.",
  );
  assertInput(
    (await realpath(path)).startsWith(root + sep),
    "Attribution artifact escaped its store.",
  );
  return readFile(path);
}
function codeIdentity() {
  const root = resolveWorkbenchRepositoryRoot({ moduleUrl: import.meta.url });
  return hash(
    Object.fromEntries(
      [
        "exposure-controls.ts",
        "exposure-model-definition.ts",
        "exposure-attribution.ts",
      ].map((p) => [
        p,
        sha(
          readFileSync(
            resolve(root, "artifacts/api-server/src/lib/workbench", p),
          ),
        ),
      ]),
    ),
  );
}
function metricsFor(
  observations: Observation[],
  days: ControlDay[],
  history: Array<{ date: string; adjusted_close: number }>,
  rf: number,
) {
  const p: Pair[] = observations.map((o, i) => ({
    date: o.date,
    portfolio: o.net_return,
    market: days[i].market_return,
    rf: days[i].cash_return,
  }));
  const performance = summarize(observations, rf);
  const cutoff = days.at(-1)!.date;
  const marketRisk = conditionalMetrics(p, history, cutoff);
  const capm = regression(p, "CAPM", cutoff, DEFAULT_REGRESSION);
  return {
    observations: performance.observations,
    cagr: performance.cagr,
    annualized_volatility: performance.volatility,
    max_drawdown: performance.max_drawdown,
    net_sharpe: performance.net_sharpe,
    final_research_index: performance.final_index,
    average_risky_exposure: performance.exposure,
    average_cash_allocation: mean(observations.map((o) => 1 - o.exposure)),
    gross_turnover: performance.turnover,
    realized_simulated_cost: performance.costs,
    full_sample_beta: marketRisk.full_beta,
    upside_beta: marketRisk.upside_beta,
    downside_beta: marketRisk.downside_beta,
    drawdown_beta: marketRisk.drawdown_beta,
    tail_beta: marketRisk.tail_beta,
    upside_capture: marketRisk.upside_capture,
    downside_capture: marketRisk.downside_capture,
    risk_methodology_version: marketRisk.methodology_version,
    risk_configuration_hash: marketRisk.configuration_hash,
    performance_methodology:
      "Certified capital summarize: 252 / OOS observations annualization and sample-variance net Sharpe; independent-sleeve returns compounded.",
    capm_alpha_diagnostic: {
      ...capm,
      standard_error_daily: capm.standard_errors?.[0] ?? "NOT_SUPPORTED",
      standard_error_annualized: capm.standard_errors
        ? capm.standard_errors[0] * 252
        : "NOT_SUPPORTED",
      annualization:
        "Daily intercept and its standard error multiplied by 252; t-statistic unchanged.",
      claim: "DIAGNOSTIC_ONLY_NO_AUTOMATIC_ALPHA_CLAIM",
    },
    capital_efficiency: {
      ...capitalEfficiency(
        performance.cagr,
        performance.volatility,
        marketRisk.full_beta.value !== null && marketRisk.full_beta.value > 0
          ? marketRisk.full_beta.value
          : NaN,
      ),
      cagr_per_average_spy_exposure: ratio(
        performance.cagr,
        performance.exposure,
      ),
      beta_denominator: "REALIZED_FULL_SAMPLE_BETA_NOT_EXPECTED_BETA",
      explanation:
        "Lower average exposure may release capital for other independent strategies. This does not by itself establish market-timing skill.",
    },
  };
}

async function calculate(
  result: DynamicResult,
  spec: NormalizedSpecV2,
  store: WorkbenchRunStore,
) {
  const dataset = loadDatasetV2(),
    folds = result.validation_diagnostics.exact_fold_plan;
  const root = store.root;
  const prefix = `runs/${result.run_id}/attempts/${result.execution_attempt_id}/engine/`;
  const observations: Observation[] = [],
    ledger: Ledger[] = [],
    policies: unknown[] = [];
  const candidates = generateCandidates(campaignV2(spec, dataset)).candidates;
  for (const job of result.validation_diagnostics.selected_jobs) {
    assertInput(
      job.artifact.startsWith(prefix) && !job.artifact.includes(".."),
      "Selected job artifact has an invalid attempt reference.",
    );
    const artifact = result.result_artifacts.find(
      (a) => a.path === job.artifact,
    );
    assertInput(
      artifact,
      "Selected job is not in the sealed result artifacts.",
    );
    const bytes = await safeRead(
      root,
      resolve(root, job.artifact),
      store.limits.maxEngineOutputBytes,
    );
    assertInput(
      sha(bytes) === artifact!.sha256,
      "Selected job artifact hash changed.",
    );
    const envelope = JSON.parse(bytes.toString());
    assertInput(
      hash(envelope.identity) === job.job_hash &&
        hash(envelope.result) === job.result_hash &&
        envelope.result.status === "VALID",
      "Selected job financial hashes do not reconcile.",
    );
    const selection = result.validation_diagnostics.outer_folds.find(
      (f) => f.outer_fold === job.outer_fold,
    );
    const candidate = candidates.find(
        (c) => c.candidate_id === job.candidate_id,
      ),
      fold = folds.find((f) => f.fold_id === job.outer_fold);
    assertInput(
      candidate && fold && selection?.selection_metric === "net_sharpe",
      "Selected policy metadata is not available from the actual engine result.",
    );
    const rows = envelope.result.observations as Observation[];
    const book = envelope.result.ledger as Ledger[];
    assertInput(
      rows.length === book.length && envelope.result.targets.length === 1,
      "The actual fold ledger is incomplete.",
    );
    const target = envelope.result.targets[0];
    assertInput(
      target.information_cutoff < target.signalDate &&
        target.fit_information_cutoff < fold!.oos_start,
      "Dynamic decision cutoff is invalid.",
    );
    observations.push(...rows);
    ledger.push(...book);
    policies.push({
      fold: job.outer_fold,
      decision_date: fold!.decision_date,
      information_cutoff: fold!.information_cutoff,
      training_start: fold!.training_start,
      training_end_exclusive: fold!.training_end_exclusive,
      oos_start: fold!.oos_start,
      oos_end_exclusive: fold!.oos_end_exclusive,
      selected_exposure_policy: candidate!.spec.exposure_policy,
      parameters: candidate!.spec.exposure_parameters,
      training_net_sharpe: selection!.score,
      average_oos_spy_exposure: envelope.result.metrics.exposure,
      average_oos_cash: mean(book.map((d) => d.beginningCash / d.beginningNav)),
      realized_turnover: envelope.result.metrics.turnover,
      realized_simulated_cost: envelope.result.metrics.costs,
      oos_observations: rows.length,
      target_spy_exposure: target.risk_target,
      target_cash_allocation: target.cash_target,
      regime_score: target.output?.state?.composite ?? "NOT_SUPPORTED",
      audit: {
        candidate_id: job.candidate_id,
        fit_keys: job.fit_keys,
        job_hash: job.job_hash,
        result_hash: job.result_hash,
      },
    });
  }
  assertInput(
    observations.length === result.metrics.observations &&
      observations.length === result.time_series.points.length,
    "Dynamic sample counts differ.",
  );
  const byDate = new Map(dataset.rows.map((r) => [r.date, r]));
  const offsets = new Map<number, number>();
  const days: ControlDay[] = observations.map((o, i) => {
    const p = result.time_series.points[i],
      book = ledger[i],
      fold = folds.find((f) => f.fold_id === p.outer_fold)!;
    assertInput(
      o.date === p.date &&
        o.net_return === p.net_return &&
        book.date === p.date &&
        p.date >= fold.oos_start &&
        p.date < fold.oos_end_exclusive,
      "Dynamic observation/ledger alignment failed.",
    );
    const prior = byDate.get(book.intervalStart),
      current = byDate.get(book.date);
    assertInput(
      prior && current && prior.prices.SPY > 0 && current.prices.SPY > 0,
      "Aligned SPY data is missing.",
    );
    const offset = offsets.get(p.outer_fold) ?? 0;
    offsets.set(p.outer_fold, offset + 1);
    return {
      date: p.date,
      fold_id: p.outer_fold,
      market_return:
        (current!.prices.SPY - prior!.prices.SPY) / prior!.prices.SPY,
      cash_return: dataset.fixture.cash_yield.daily,
      fold_offset: offset,
      fold_last: result.time_series.points[i + 1]?.outer_fold !== p.outer_fold,
    };
  });
  const history = dataset.rows
    .filter((r) => r.date <= days.at(-1)!.date)
    .map((r) => ({ date: r.date, adjusted_close: r.prices.SPY }));
  const dynamicPoints = days.map((d, i) => ({
    ...d,
    net_return: observations[i].net_return,
    index: result.time_series.points[i].index,
    drawdown: result.time_series.points[i].drawdown,
    spy_exposure: observations[i].exposure,
    cash_allocation: ledger[i].beginningCash / ledger[i].beginningNav,
    turnover: observations[i].turnover,
    realized_cost: observations[i].costs,
  }));
  const passivePoints = controlTrack(days, 1, spec.transaction_cost_bps);
  const matched = matchBeta(
    days,
    observations.map((o) => o.net_return),
    spec.transaction_cost_bps,
  );
  const matchedPoints = Array.isArray(matched.track)
    ? matched.track
    : undefined;
  const toObservations = (points: typeof passivePoints) =>
    points.map((p) => ({
      date: p.date,
      net_return: p.net_return,
      exposure: p.spy_exposure,
      turnover: p.turnover,
      costs: p.realized_cost,
    }));
  const dynamicMetrics = metricsFor(
    observations,
    days,
    history,
    dataset.fixture.cash_yield.reference_daily,
  );
  assertInput(
    dynamicMetrics.cagr === result.metrics.cagr &&
      dynamicMetrics.final_research_index ===
        result.metrics.final_research_index,
    "Post-processing changed the dynamic financial result.",
  );
  const passiveMetrics = metricsFor(
    toObservations(passivePoints),
    days,
    history,
    dataset.fixture.cash_yield.reference_daily,
  );
  const matchedMetrics = matchedPoints
    ? metricsFor(
        toObservations(matchedPoints),
        days,
        history,
        dataset.fixture.cash_yield.reference_daily,
      )
    : "NOT_SUPPORTED";
  const bindings = {
    benchmark_methodology_version: BENCHMARK_METHODOLOGY_VERSION,
    benchmark_code_sha256: codeIdentity(),
    dynamic_financial_result_hash: result.financial_result_hash,
    data_snapshot_sha256: dataset.snapshot.sha256,
  };
  const passiveHash = hash({
    ...bindings,
    points: passivePoints,
    metrics: passiveMetrics,
  });
  const { track: _track, ...matchedDiagnostic } = matched;
  const matchedHash = hash({
    ...bindings,
    diagnostic: matchedDiagnostic,
    points: matchedPoints ?? "NOT_SUPPORTED",
    metrics: matchedMetrics,
  });
  const comparison = (a: number, b: number) => a - b;
  const available =
    matched.status === "MATCHED" && typeof matchedMetrics !== "string";
  const values = available
    ? {
        total_dynamic_effect_cagr_difference: comparison(
          dynamicMetrics.cagr,
          passiveMetrics.cagr,
        ),
        exposure_level_effect_cagr_difference: comparison(
          matchedMetrics.cagr,
          passiveMetrics.cagr,
        ),
        timing_residual_cagr_difference: comparison(
          dynamicMetrics.cagr,
          matchedMetrics.cagr,
        ),
        total_dynamic_effect_total_return_difference: comparison(
          dynamicMetrics.final_research_index / 100 - 1,
          passiveMetrics.final_research_index / 100 - 1,
        ),
        exposure_level_effect_total_return_difference: comparison(
          matchedMetrics.final_research_index / 100 - 1,
          passiveMetrics.final_research_index / 100 - 1,
        ),
        timing_residual_total_return_difference: comparison(
          dynamicMetrics.final_research_index / 100 - 1,
          matchedMetrics.final_research_index / 100 - 1,
        ),
      }
    : "NOT_SUPPORTED";
  const attribution = {
    status: available ? "AVAILABLE" : matched.status,
    units:
      "Differences of separately compounded CAGR/total returns; not a tradable long-short portfolio.",
    values,
    definitions: {
      total_dynamic_effect:
        "Dynamic minus passive: combines exposure reduction and timing.",
      exposure_level_effect: "Matched-beta control minus passive SPY.",
      timing_residual:
        "Dynamic minus matched-beta control at comparable realized market beta.",
    },
    explanation:
      "A positive timing residual is not automatically statistical alpha.",
    alpha_claim: "NONE",
    benchmark_methodology_version: BENCHMARK_METHODOLOGY_VERSION,
  };
  const attributionHash = hash({
    ...bindings,
    passive_control_hash: passiveHash,
    matched_beta_control_hash: matchedHash,
    attribution,
  });
  return {
    ...bindings,
    model_definition: exposureModelDefinition(dataset),
    selected_policy_by_fold: policies,
    benchmark_tracks: {
      DYNAMIC_EXPOSURE: {
        label: "Dynamic exposure",
        status: "AVAILABLE",
        fold_boundaries: folds,
        points: dynamicPoints,
        hash: result.financial_result_hash,
      },
      PASSIVE_SPY: {
        label: "Passive SPY",
        status: "AVAILABLE",
        fold_boundaries: folds,
        points: passivePoints,
        hash: passiveHash,
      },
      STATIC_MATCHED_BETA: {
        label: "Retrospective matched-beta diagnostic",
        status: matched.status,
        fold_boundaries: folds,
        points: matchedPoints ?? [],
        hash: matchedHash,
      },
    },
    benchmark_metrics: {
      DYNAMIC_EXPOSURE: dynamicMetrics,
      PASSIVE_SPY: passiveMetrics,
      STATIC_MATCHED_BETA: matchedMetrics,
    },
    matched_beta_diagnostic: matchedDiagnostic,
    attribution,
    passive_control_hash: passiveHash,
    matched_beta_control_hash: matchedHash,
    attribution_hash: attributionHash,
    accounting_convention: {
      fold_start: "Independent NAV=100 cash at each fold",
      execution:
        "Signal on first observed fold day; enter at next observed close. No terminal liquidation.",
      passive:
        "Enter 100% SPY net of actual entry-notional costs; hold for the fold.",
      matched:
        "One retrospective constant target lambda; daily close maintenance charges actual traded notional. No maintenance on the final fold day. Beginning exposure is lambda after initial next-close entry.",
      initial_lag:
        "Both control tracks remain in cash on the signal day and until the next-close fill, exactly like the dynamic engine.",
      beta_reference:
        "Raw adjusted-close SPY returns on every exact aligned OOS date, including entry-lag rows.",
      cash_return_daily: dataset.fixture.cash_yield.daily,
      cost_bps: spec.transaction_cost_bps,
      slippage_bps: 0,
    },
    benchmark_reproducibility: {
      dynamic_financial_result_hash: result.financial_result_hash,
      passive_control_hash: passiveHash,
      matched_beta_control_hash: matchedHash,
      attribution_hash: attributionHash,
      ephemeral_fields_excluded: true,
    },
    research_boundary: "RESEARCH_ONLY",
    pit_classification: "PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED",
    storage_classification: "TEMPORARY_RESEARCH_STORAGE",
  };
}

async function enrichment(
  value: unknown,
  spec: NormalizedSpecV2,
  store: WorkbenchRunStore,
) {
  if (
    !value ||
    typeof value !== "object" ||
    (value as DynamicResult).status !== "SUCCESS"
  )
    return value;
  const result = value as DynamicResult;
  try {
    const code = codeIdentity();
    const ref = {
      runId: result.run_id,
      executionAttemptId: result.execution_attempt_id,
    };
    await store.getAttempt(ref);
    const dir = resolve(
      store.root,
      "runs",
      ref.runId,
      "attempts",
      ref.executionAttemptId,
      "attribution",
      BENCHMARK_METHODOLOGY_VERSION,
    );
    const file = resolve(dir, `${code}.json`);
    let payload: Awaited<ReturnType<typeof calculate>>;
    try {
      const cached = JSON.parse(
        (
          await safeRead(store.root, file, store.limits.maxEngineOutputBytes)
        ).toString(),
      );
      assertInput(
        hash(cached.payload) === cached.sha256 &&
          cached.payload.dynamic_financial_result_hash ===
            result.financial_result_hash &&
          cached.payload.benchmark_code_sha256 === code,
        "Immutable attribution cache hash differs.",
      );
      payload = cached.payload;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      payload = await calculate(result, spec, store);
      // Check each parent before creating the next; never follow an existing
      // attribution-directory symlink while recursively creating descendants.
      let parent = store.root;
      for (const p of relative(store.root, dir).split(sep)) {
        assertInput(
          !(await lstat(parent)).isSymbolicLink(),
          "Unsafe attribution output parent.",
        );
        parent = resolve(parent, p);
        try {
          await mkdir(parent, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        const info = await lstat(parent);
        assertInput(
          info.isDirectory() && !info.isSymbolicLink(),
          "Unsafe attribution output directory.",
        );
      }
      const bytes = Buffer.from(
        canonicalJson({ sha256: hash(payload), payload }),
      );
      assertInput(
        bytes.length <= store.limits.maxEngineOutputBytes,
        "Attribution output exceeds its bounded size.",
      );
      const temporary = resolve(dir, `.pending-${randomUUID()}`);
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      try {
        await link(temporary, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        assertInput(
          (
            await safeRead(store.root, file, store.limits.maxEngineOutputBytes)
          ).equals(bytes),
          "Immutable attribution evidence differs across concurrent readers.",
        );
      } finally {
        await unlink(temporary);
      }
    }
    return {
      ...result,
      ...payload,
      attribution_artifact: relative(store.root, file),
      // The original dynamic contract and hash are preserved exactly.
      financial_result_hash: result.financial_result_hash,
    };
  } catch (error) {
    const code =
      error instanceof AttributionError
        ? error.code
        : "ATTRIBUTION_POSTPROCESSING_FAILED";
    return {
      ...result,
      benchmark_methodology_version: BENCHMARK_METHODOLOGY_VERSION,
      model_definition: exposureModelDefinition(),
      selected_policy_by_fold: "NOT_SUPPORTED",
      benchmark_tracks: "NOT_SUPPORTED",
      benchmark_metrics: "NOT_SUPPORTED",
      matched_beta_diagnostic: { status: "BLOCKED", code },
      attribution: {
        status: "BLOCKED",
        code,
        explanation:
          "Benchmark attribution is unavailable. The original dynamic result and its immutable evidence are preserved.",
        alpha_claim: "NONE",
      },
    };
  }
}
/** Response enrichment only: original result.json, engine tree and identity are
 * never rewritten. Latest failures remain distinct from earlier successes. */
export async function enrichExposureRun<
  T extends {
    spec: unknown;
    latest_result: unknown;
    latest_successful_result: unknown;
  },
>(run: T, store: WorkbenchRunStore) {
  const spec = run.spec as NormalizedSpecV2;
  const success = await enrichment(run.latest_successful_result, spec, store);
  const latest =
    typeof run.latest_result === "object" &&
    run.latest_result &&
    typeof run.latest_successful_result === "object" &&
    run.latest_successful_result &&
    (run.latest_result as DynamicResult).execution_attempt_id ===
      (run.latest_successful_result as DynamicResult).execution_attempt_id
      ? success
      : await enrichment(run.latest_result, spec, store);
  return { ...run, latest_result: latest, latest_successful_result: success };
}
