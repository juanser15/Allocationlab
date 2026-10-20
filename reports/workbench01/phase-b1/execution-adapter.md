# Workbench Phase B1 capital execution adapter

## Authorized path

The Phase B1 adapter supports exactly one empirical path:

- research mode: `CAPITAL_MARKET_EXPOSURE`;
- execution scope: `EMPIRICAL`;
- operated universe: `SPY`;
- validation protocol: `TRADITIONAL_WALK_FORWARD`;
- engine entry point: `research/capital/engine.ts::runCampaign`;
- adapter version: `workbench-b1-capital-adapter-1.0.0`.

The only editable economic field is `transaction_cost_bps`, with the exact allowed values `0` and `5`. The dates, information universe, candidates, selection rule, folds, clocks, yields, constraints, and execution convention remain those of the committed campaign. The adapter does not implement another research mode, universe, strategy, allocator, validation scheme, or financial formula.

Every result carries **`PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED`**, **`TEMPORARY_RESEARCH_STORAGE`**, and **`RESEARCH_ONLY`**. It never emits an unqualified point-in-time-safety label.

## Fixed worker architecture

`runCampaign` is synchronous and the certified campaign takes about 29 seconds. Calling it in the HTTP process would prevent status polling. The parent adapter therefore forks the fixed build artifact `workbench-run-worker.mjs` with:

- `process.execPath` through Node's `fork` API;
- no shell;
- no command-line arguments;
- an empty `execArgv`;
- piped, bounded stdout and stderr;
- one JSON IPC message with exact keys;
- a fixed executable path derived from the compiled module location.

The worker uses fixed literal module references to bundle and invoke the typed `runCampaign` function. No request value becomes an executable, module name, campaign path, data path, output-root path, shell fragment, or environment-variable name. `build.mjs` bundles the worker separately and aliases `@workspace/db` to the existing pure-calculator DB shim; the empirical path makes no database query.

The parent request and worker IPC message both require canonical `rr_<64 lowercase hex>` and `ea_<UUID-v4>` identifiers and a cost of exactly `0` or `5`. The worker IPC object must contain exactly `type`, `protocol_version`, `run_id`, `execution_attempt_id`, and `transaction_cost_bps`.

## Fixed committed inputs

Before each attempt, the worker resolves the repository root from its own fixed location and checks the committed inputs:

| Input | Required identity |
|---|---|
| Campaign | `configs/capital-research/acceptance-traditional.json` |
| Campaign SHA-256 | `9ad484bc22d2120f583b08fe1a951d22ddb34525f8c89feee28a813a336c1c64` |
| Dataset | `reports/cl02/adjusted-closes.csv` |
| Dataset SHA-256 | `b4a4fa0e0ddb6f639521acbe7398740904860a933391081d06e783339e6c7bc0` |
| Parsed rows | 4,023 |
| Parsed-data hash | `f7436db75e7c6ed35938e6248c48c162c051cd8a99457a5c386910b36f6c743e` |
| Certified source hash | `94a2c94f0cf7a096865a7d5a8284aa1141f23b62a49685e8d3e3502afd830dcf` |
| Expected experiment hash | `803c0c5bbe79c9d47a72f7a22a6709b82a00eb34c5e83d79b44b9f988bc6ceef` |
| Engine version | `capital-research-1.0.1` |

The source hash is recalculated from the sorted committed `research/capital/*.{ts,py}` inventory plus `calculator.ts`, `factor-library.ts`, `d6-trace.ts`, and `calculator.a1.db-shim.ts`. The config's content hash protects every campaign field; the worker additionally asserts the selected experiment, traditional rolling mode, 2020-01-01/2024-01-01 dates, 24/12/12 clocks, monthly cadence, SPY risky asset, dataset reference, cost array, selection cost, warm-up, and job ceiling.

The temporary root comes from server-owned `WORKBENCH_RUN_DIR`. Before `mkdir`, the adapter resolves the prospective real path through existing ancestors and rejects `/`, the shared temporary directory itself, and overlap with the repository in either direction. It rechecks after creation and rejects symbolic links. The engine root is then derived solely from validated IDs:

```text
<WORKBENCH_RUN_DIR>/runs/<run_id>/attempts/<execution_attempt_id>/engine
```

It must be absent. Each attempt therefore starts with a fresh output root and no shared `cache_root`.

## Dual-scenario execution semantics

The adapter deliberately does not replace the committed `transaction_cost_bps: [0, 5]` array with a singleton. Candidate selection is fixed at `selection_cost_bps: 5`, and the engine requires the selection scenario to be present. Changing that array or the selection cost would alter certified selection semantics.

Every Workbench attempt executes the complete committed `[0, 5]` campaign. After completion, the adapter maps only the scenario named by the normalized scalar `transaction_cost_bps` into the ResearchRunResult. Consequences:

- Run A and Run B have different deterministic Workbench `run_id` values;
- their requested scenario jobs and scenario financial hashes differ;
- the engine experiment hash is intentionally common because it identifies the containing dual-scenario campaign;
- each explicit rerun uses a fresh directory and must report 24 new jobs and 0 reused jobs;
- Run A is a 0-bps cost sensitivity of candidates selected under the committed 5-bps selection rule, not a separate 0-bps reselection.

The worker accepts success only if the campaign is unpaused, its summary is `COMPLETE`, the experiment hash matches, `new_jobs` equals 24, and `reused_jobs` equals 0.

## Actual-output mapping

The adapter maps existing engine outputs; it does not calculate new financial metrics for presentation. It exposes:

- the requested scenario's actual `observations`, CAGR, net Sharpe, maximum drawdown, return/drawdown ratio, volatility, turnover, annualized turnover, costs, exposure, and final index from `summary.outer_oos`;
- the actual selected-fold records;
- each selected outer job's `job_hash`, `result_hash`, `fit_keys`, targets, candidate, scenario, fold, and artifact reference;
- the 501 requested-scenario rows parsed from `oos-equity.csv`;
- immutable references and hashes for `manifest.json`, `summary.json`, `selected-by-fold.csv`, `oos-equity.csv`, `oos-ledger.csv`, and the selected outer-job files;
- engine, campaign, source, and data identities;
- actual `new_jobs` and `reused_jobs` counts;
- engine limitations and the mandatory data-vintage warning.

The worker verifies each selected job envelope by recalculating its job identity and result hash. It also verifies that the filtered time-series count equals the scenario observation count. Artifact references returned to the API are attempt-relative identifiers; clients never supply artifact paths.

Unavailable beta, benchmark, DSR, and other unsupported output families remain explicit `NOT_SUPPORTED` values in the ResearchRunResult mapping.

## Scenario financial hash and runtime hash

The adapter's scenario-level `financial_result_hash` hashes canonical actual evidence:

- engine version, experiment hash, certified code hash, and data SHA-256;
- requested transaction-cost scenario;
- scenario aggregate metrics;
- selected folds;
- ordered selected-job candidate/fold, job hash, result hash, fit keys, and target hash;
- selected scenario rows from `oos-equity.csv` and `oos-ledger.csv`.

It excludes run and attempt timestamps, attempt ID, process identity, paths, logs, elapsed time, memory readings, and `progress.json`. The separate `runtime_hash` is the SHA-256 of `progress.json`; it is expected to change when runtime telemetry changes.

The run store independently calculates a full-campaign artifact-manifest hash. Because every attempt executes both scenarios, that full-campaign hash is distinct in scope from the scenario-level adapter hash used for Run A/Run B comparison.

## Resource controls and failures

| Control | Implemented value |
|---|---:|
| Concurrent executions | 1, enforced by service/store lease and parent adapter guard |
| Execution timeout | 120 seconds |
| Engine-output limit | 64 MiB, checked during and after execution |
| Output polling interval | 250 ms |
| Captured stdout/stderr | 1 MiB |
| Worker IPC result | 1 MiB |
| Worker diagnostic sent by IPC | 64 KiB |
| Store artifact count | 512 files |

On timeout or a bound violation, the parent sends `SIGTERM` and then `SIGKILL` after two seconds if required. After a success message it closes IPC and gives the child a bounded two-second exit window; the process-local guard and filesystem lease are retained until child exit is observed. Invalid protocol, child startup failure, early or delayed exit, unsafe storage, existing engine evidence, excessive output/logs, and campaign failure have stable error classes. Client responses receive safe messages. The service persists bounded internal diagnostics, partial attempt evidence where present, the normalized spec, timestamps, provenance, and a terminal failed result with an attempt-relative diagnostic reference; it never substitutes a prior success for the failed attempt.

A second different request while the lease is occupied is stored as `BLOCKED_EXECUTION_CAPACITY`. A matching running request reuses the existing attempt. No execution is silently retried.

## Certified acceptance behavior

The Phase B1 API acceptance reproduced the Phase A values through the production route, service, fixed worker, committed engine, and temporary store:

| Evidence | Run A, 0 bps | Run B, 5 bps |
|---|---:|---:|
| OOS observations | 501 | 501 |
| Final research index | 107.25445949277757 | 107.13006040048703 |
| Realized transaction cost | 0 | 0.1130073297533634 |
| New jobs | 24 | 24 |
| Reused jobs | 0 | 0 |

The Run A rerun retained the same run ID, received a different attempt ID, recalculated 24 jobs in a fresh root, and reproduced the same scenario financial hash. This is mechanical execution and reproducibility evidence only. It makes no alpha, profitability, allocation, production-readiness, investment, or real-money claim.
