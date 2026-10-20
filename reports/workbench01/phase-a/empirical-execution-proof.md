# Empirical execution proof

## Scope and conclusion

The committed capital engine completed two independent executions of the same traditional rolling campaign. Each execution recalculated 24 jobs from committed source, configuration, and adjusted-close observations. Each campaign contains a paired 0-bps scenario (Run A) and 5-bps scenario (Run B). The scenario results differ because the engine applies the requested fee to actual traded notional.

This proves a configurable empirical execution path and deterministic rerun mechanics. It makes no economic claim.

## Committed input inventory

All local research inputs below were present in `git ls-tree -r HEAD` at commit `b9950f7cbe128f9d761597a5e216d777cc3059a3` before execution:

| Role | Path | Identity |
|---|---|---|
| Campaign configuration | `configs/capital-research/acceptance-traditional.json` | committed campaign `cl03-acceptance-traditional` |
| Historical observation snapshot | `reports/cl02/adjusted-closes.csv` | SHA-256 `b4a4fa0e0ddb6f639521acbe7398740904860a933391081d06e783339e6c7bc0` |
| Campaign engine | `research/capital/engine.ts` | included in code hash below |
| Campaign contract/hash | `research/capital/spec.ts` | included in code hash below |
| Model and policy registry | `research/capital/registry.ts` | included in code hash below |
| Metrics and persistence | `research/capital/metrics.ts`, `research/capital/storage.ts` | included in code hash below |
| Backtest and transitive local libraries | `artifacts/api-server/src/lib/calculator.ts`, `factor-library.ts`, `d6-trace.ts`, `calculator.a1.db-shim.ts` | included in code hash below |
| Dependency resolution | `pnpm-lock.yaml`, workspace/package manifests | committed; dependencies were already installed |

The execution wrapper inventories every `research/capital/*.{ts,py}` file plus the four local backtest/library files and derives code hash `94a2c94f0cf7a096865a7d5a8284aa1141f23b62a49685e8d3e3502afd830dcf`. The engine parsed 4,023 rows and derived data hash `f7436db75e7c6ed35938e6248c48c162c051cd8a99457a5c386910b36f6c743e`.

The exact repository paths included in that code inventory were all returned by `git ls-tree -r --name-only HEAD`:

```text
artifacts/api-server/src/lib/calculator.a1.db-shim.ts
artifacts/api-server/src/lib/calculator.ts
artifacts/api-server/src/lib/d6-trace.ts
artifacts/api-server/src/lib/factor-library.ts
research/capital/cli.ts
research/capital/engine.test.ts
research/capital/engine.ts
research/capital/finalize-validation.py
research/capital/hardening-regressions.test.ts
research/capital/metrics.ts
research/capital/oracle.ts
research/capital/qa-campaign.ts
research/capital/qa.ts
research/capital/registry.ts
research/capital/render.py
research/capital/replay.py
research/capital/spec.ts
research/capital/storage.ts
research/capital/validation.test.ts
```

The committed toolchain inventory was `package.json`, `scripts/package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`. Installed packages were already present and matched a successful `pnpm list --depth=0 --recursive`; no installation or lockfile rewrite occurred.

No UI-01 JSON, `/tmp` file, copied checkout, untracked input, or prior Phase A result was used as a research input. `DATABASE_URL` in the commands is an inert import-time placeholder; this execution performs no database read or query.

## Exact execution commands

Working directory for both commands: `/workspace/Allocationlab`.

Repetition 1:

```bash
WORKBENCH_RUN_ROOT=reports/workbench01/phase-a/executions/repetition-1 DATABASE_URL=postgresql://unused@127.0.0.1:1/unused scripts/node_modules/.bin/tsx -e 'import {readFileSync,readdirSync} from "node:fs"; import {parseCsv} from "./artifacts/api-server/src/lib/calculator"; import {runCampaign} from "./research/capital/engine"; import {hash} from "./research/capital/spec"; const configPath="configs/capital-research/acceptance-traditional.json"; const c=JSON.parse(readFileSync(configPath,"utf8")); const csv=readFileSync(c.data_csv,"utf8"); if(hash(csv)!==c.data_sha256) throw new Error("Input CSV hash mismatch"); const rows=parseCsv(csv); const codePaths=readdirSync("research/capital").filter(p=>/\.(ts|py)$/.test(p)).sort().map(p=>"research/capital/"+p).concat(["artifacts/api-server/src/lib/calculator.ts","artifacts/api-server/src/lib/factor-library.ts","artifacts/api-server/src/lib/d6-trace.ts","artifacts/api-server/src/lib/calculator.a1.db-shim.ts"]); const codeHashes=Object.fromEntries(codePaths.map(p=>[p,hash(readFileSync(p,"utf8"))])); const started=Date.now(); const result=runCampaign(c,rows,process.env.WORKBENCH_RUN_ROOT,{code_hash:hash(codeHashes)}); console.log(JSON.stringify({root:process.env.WORKBENCH_RUN_ROOT,configPath,dataPath:c.data_csv,dataSha256:c.data_sha256,codeHash:hash(codeHashes),parsedRows:rows.length,elapsedMs:Date.now()-started,result},null,2));'
```

Repetition 2:

```bash
WORKBENCH_RUN_ROOT=reports/workbench01/phase-a/executions/repetition-2 DATABASE_URL=postgresql://unused@127.0.0.1:1/unused scripts/node_modules/.bin/tsx -e 'import {readFileSync,readdirSync} from "node:fs"; import {parseCsv} from "./artifacts/api-server/src/lib/calculator"; import {runCampaign} from "./research/capital/engine"; import {hash} from "./research/capital/spec"; const configPath="configs/capital-research/acceptance-traditional.json"; const c=JSON.parse(readFileSync(configPath,"utf8")); const csv=readFileSync(c.data_csv,"utf8"); if(hash(csv)!==c.data_sha256) throw new Error("Input CSV hash mismatch"); const rows=parseCsv(csv); const codePaths=readdirSync("research/capital").filter(p=>/\.(ts|py)$/.test(p)).sort().map(p=>"research/capital/"+p).concat(["artifacts/api-server/src/lib/calculator.ts","artifacts/api-server/src/lib/factor-library.ts","artifacts/api-server/src/lib/d6-trace.ts","artifacts/api-server/src/lib/calculator.a1.db-shim.ts"]); const codeHashes=Object.fromEntries(codePaths.map(p=>[p,hash(readFileSync(p,"utf8"))])); const started=Date.now(); const result=runCampaign(c,rows,process.env.WORKBENCH_RUN_ROOT,{code_hash:hash(codeHashes)}); console.log(JSON.stringify({root:process.env.WORKBENCH_RUN_ROOT,configPath,dataPath:c.data_csv,dataSha256:c.data_sha256,codeHash:hash(codeHashes),parsedRows:rows.length,elapsedMs:Date.now()-started,result},null,2));'
```

Both commands exited 0. Wall runtimes recorded by the wrapper were 29,065 ms and 29,271 ms. Each `progress.json` reports `complete: true`, `new_jobs: 24`, and `reused_jobs: 0`; each `failures.csv` contains only its header. The second execution used a separate empty root, so no persisted job from the first execution could be reused.

## Normalized Run A and Run B

Both scenarios share:

- mode: `CAPITAL_MARKET_EXPOSURE`;
- operated risky sleeve: SPY;
- information universe: 22 explicitly listed symbols;
- campaign dates: 2020-01-01 through 2024-01-01, end exclusive;
- outer OOS dates: 2022-01-01 through 2024-01-01, end exclusive, in two independent annual sleeves;
- current-regime model, 252-row lookback, monthly rebalance/recalibration;
- selection metric: net Sharpe, with candidate selection at 5 bps;
- traditional rolling validation: 24 training months, 12 test months, 12 step months;
- strict previous-close information cutoff and next-close execution;
- zero slippage, zero cash yield, and zero reference yield;
- identical data snapshot, code commit, code hash, engine versions, candidates, constraints, targets, and selected candidates;
- random seed: `NOT_APPLICABLE`.

Each normalized spec also stores the committed configuration path and SHA-256, search method, budget, full ordered candidate bases and axes, both backend cost scenarios, inner-clock values configured but unused by traditional mode, warm-up rows and maximum-job bound. This expands every result-affecting default needed to reconstruct the containing campaign rather than relying on `candidate_space_hash` alone.

The normalized identity payloads differ in exactly one field: `transaction_cost_bps`, 0 for Run A and 5 for Run B. The stored spec documents also differ in their derived `run_id`. Display/storage metadata is excluded from canonical run identity.

| Evidence | Run A | Run B |
|---|---:|---:|
| ResearchRun ID | `rr_c79425cd86a09cb3e781cb321e0a214bdb0656aad55b385f840ccc8db9dd0b26` | `rr_55feebe25c27106d37f313091575a4e9ac9c38aa88c61c5e4bac1f4c6555658d` |
| Transaction cost | 0 bps | 5 bps |
| OOS observations | 501 | 501 |
| Actual-notional costs | 0 | 0.1130073297533634 |
| Final research index | 107.25445949277757 | 107.13006040048703 |
| Net Sharpe | 0.30496407414649523 | 0.3011888473152739 |
| CAGR | 0.035854467043460625 | 0.035249977711973246 |
| Maximum drawdown | -0.191148358059128 | -0.19162665108551424 |
| Annualized volatility | 0.1546685294257783 | 0.15466908349475517 |
| Annualized turnover | 1.1676793069979983 | 1.16726250335649 |

These values document different computed artifacts. They are not an acceptance threshold or performance claim.

## Proof that the changed parameter was applied

The campaign produced 12 exact Run A/Run B job pairs. For every pair:

- identity fields other than the cost scenario are identical;
- candidate target paths and model-fit keys are identical;
- ledger lengths and trade-day counts are identical (207 trade days for each scenario across the outer folds);
- scenario-level `job_hash`, `result_hash`, and metrics differ;
- Run A costs are exactly zero;
- Run B costs are positive and reconcile to `absolute traded notional × 5 / 10,000`;
- no cost-reconciliation failure occurred.

For the two selected outer jobs, Run A job hashes are `a8fb23f245e6ffe5a310f469437083a5ec30f2cb8fdbaa9865d0c68f3f028ebb` and `395197080db418ddc362b9c98ce4a20a627a2fb19a0703dadaf3a93f2b90f74f`; Run B hashes are `2888c51b5b6a01eaf0f04b90ac4b20bfccefd65c9e954984ea5f33ac99639383` and `099f436164943ae4afb9a8cfe1c637b34619929ad08d140f73d74c7a3b833bc7`.

The engine did not ignore the parameter and did not return a stale result. Positions can diverge slightly after the first charged fee because the fee changes subsequent available NAV; this is expected path-dependent accounting.

## Identity boundary

The ResearchRun contract treats each scalar cost scenario as its own run, so its canonical `run_id` changes when `transaction_cost_bps` changes. The engine also gives every paired scenario job a different `job_hash`.

The engine-level `experiment_hash` remains `803c0c5bbe79c9d47a72f7a22a6709b82a00eb34c5e83d79b44b9f988bc6ceef` for both Run A and Run B because the committed campaign configuration contains both cost scenarios. It identifies the containing campaign, not an individual scenario. This shared campaign identity must not be read as a shared ResearchRun or job identity.

## PIT evidence and limits

Mechanical checks passed:

- 528 targets inspected; zero had `information_cutoff >= signalDate`;
- zero outer jobs had `fit_information_cutoff >= outer_oos_start`;
- fit rows are restricted to `[training_start, training_end)` and the fitted model is frozen through each OOS fold;
- every execution occurs on the next observed close after its signal date;
- data, experiment, candidate, job, result, equity, and ledger identities are persisted.

The evidence supports **`PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED`**, not unqualified `PIT_SAFE`. The adjusted-close vendor and vendor-vintage history are not independently verified, and historical universe/governance vintages are not present. Promotion and activation state are not applicable to this capital path.

## Reproducibility evidence

Both roots contain the same 165 relative file paths. Of these, 164 are byte-identical. The only differing file is `progress.json`, and its only differences are `telemetry.elapsed_ms` and `telemetry.peak_rss_kib`. Those operational telemetry fields are explicitly excluded from financial result identity.

The aggregate SHA-256 over every file except `progress.json` is identical in both roots:

`168921b82aeb09ec9d41559cdd4971c60c2717bf43832e00fa203109980f42a9`

Key byte-identical hashes include:

- `manifest.json`: `e5ab33b490b7c1d2bd4d26c649f951bdd951ce29b788bffd839b1713a856bfe2`
- `summary.json`: `b28ba1863c9c7273b67666b882b1ce2673235c44f81ae583b7b342cb0425ec5c`
- `oos-equity.csv`: `b7ff17df18b60dee9c8aca8fc0173d0eadcb167c61009480f93e8928309552e0`
- `oos-ledger.csv`: `98161b9a1721f0ebf14949fde6c5c651c91744515cadb40eb894d875887feeaf`
- `outer-results.csv`: `58359cabcbecfcdd8738e57d695577ac8cf96be377619a07586ac3d4f6ca5787`
- `candidate-rankings.csv`: `e27b4a448c4eee81828f2abf9d04bfbf22b99ca25c5eed67532cb110dda27fd8`
- `selected-by-fold.csv`: `a7e02d51dc1fc5d01efc476e2665b36ea1f153cb03ef32fea94a7ae5d89904bf`

Run identities, job/result hashes, selected candidates, time series, ledgers, metrics, costs, warnings, and blockers are identical across the two repetitions.

## Result artifacts

- Normalized specifications: `run-a-spec.json`, `run-b-spec.json`
- Contract result summaries: `run-a-result-summary.json`, `run-b-result-summary.json`
- Full independent campaign outputs: `executions/repetition-1/**`, `executions/repetition-2/**`
- Structured reproducibility proof: `reproducibility.json`

Result status: **SUCCESS** for execution mechanics, with the provenance and PIT qualifications stated above.
