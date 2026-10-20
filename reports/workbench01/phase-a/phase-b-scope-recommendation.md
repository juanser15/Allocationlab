# Workbench-01 Phase B scope recommendation

## Recommended first mode

Build the first Workbench flow around the committed **capital / market-exposure** campaign in `research/capital/engine.ts`. It is the narrowest path that met the Phase A definition of executable empirical research: committed source recalculates from an explicit configuration, consumes a hash-identified adjusted-close snapshot, enforces dated training and OOS cutoffs, accepts an economic control, and emits auditable ledgers and time series.

This is a mechanics recommendation. The Phase A runs establish execution, provenance, cost accounting and reproducibility. They do not establish alpha, investment merit, production readiness or suitability for real money.

## Supported initial envelope

| Item | Phase B scope |
|---|---|
| Research mode | `CAPITAL_MARKET_EXPOSURE` |
| Operated instrument | `SPY` in the proven configuration |
| Information universe | The 22 tickers in `configs/capital-research/acceptance-traditional.json` |
| Dataset | `reports/cl02/adjusted-closes.csv`, SHA-256 `b4a4fa0e0ddb6f639521acbe7398740904860a933391081d06e783339e6c7bc0` |
| Dataset coverage | 2010-10-01 through 2026-09-30; a requested window must remain inside the snapshot and satisfy all lookback/fold requirements |
| Proven research dates | Campaign 2020-01-01 through 2024-01-01, with outer OOS 2022-01-01 through 2024-01-01 |
| First user control | `transaction_cost_bps`, explicit and non-negative; Phase A proved 0 and 5 bps |
| Additional engine-supported controls | Risk asset/reference universe, campaign dates, lookback, candidate transformations and exposure policies, rebalance frequency, walk-forward clocks and constraints. Expose each only after adapter-level validation against the existing Campaign contract. |
| Execution | Strict prior-close information cutoff and `next_close` fill |
| Validation | Traditional rolling walk-forward first: 24 training months, 12 test months, 12-month step. Nested walk-forward exists, but can follow after the first workflow is reviewed. |
| Outputs | Normalized spec, status/progress, selections, job/result identities, outer-OOS metrics, equity series, daily position/cash ledger, trades, actual-notional costs, targets, warnings, blockers and provenance hashes |
| PIT label | `PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED` until source authenticity, vintage history and historical universe/governance are independently established |

The first comparison should keep the dataset, dates, universe, candidate space, selection rule and validation clocks fixed while changing only `transaction_cost_bps`. The interface must show that both cost scenarios in the current backend belong to one campaign `experiment_hash`, while the normalized ResearchRun identity and scenario-level job identities change.

## Minimum backend adapter

Add one thin orchestration adapter around the existing exported `runCampaign` function in a later approved phase. Its responsibilities should be limited to:

1. validate a `ResearchRunSpec` against the Phase A schema and the existing Campaign contract;
2. expand every engine default into the normalized specification, including an explicit zero cost;
3. verify the configured dataset path is approved and its content hash matches the declared snapshot;
4. compute the deterministic ResearchRun identity from the normalized identity payload;
5. create an isolated immutable run root and call the existing engine without changing financial code;
6. map existing artifacts into `ResearchRunResult`, including explicit `NOT_SUPPORTED` values, warnings and blockers;
7. expose run status and artifact references without recomputing metrics in the adapter; and
8. compare two compatible runs by normalized-spec diff, provenance and result hashes.

The current committed acceptance campaign contains both 0 and 5 bps scenarios. The adapter must either form a single-scenario Campaign input using fields already supported by the Campaign contract or select the requested scenario from one newly executed campaign. It must never present an old scenario artifact as a newly executed run. Persisted campaign caching may be used only when the complete normalized identity matches, and the result must state whether jobs were new or reused.

## Minimum product workflow

The smallest useful workflow is:

1. **Configure:** load the documented baseline, show all expanded defaults, choose the supported dates within the snapshot, and set `transaction_cost_bps`.
2. **Run:** submit the immutable normalized spec and display stage, warnings, blockers and whether work was recalculated or reused.
3. **Inspect:** show provenance, validation folds, cost assumptions, aggregate metrics, the OOS equity series and the daily ledger. Label independent fold sleeves and the data-vintage limitation.
4. **Modify:** clone the completed spec and change one supported field, initially transaction cost.
5. **Rerun:** create a different ResearchRun identity and execute through the same adapter.
6. **Compare:** show the exact normalized-spec diff, compatible metrics/time series, costs and artifact hashes. Do not rank runs or turn mechanics evidence into a recommendation.

Keep risky-sleeve exposure separate from final NAV state; expected beta separate from realized beta; gross return separate from net return; training/validation/outer OOS separate; and empirical observations separate from synthetic certification fixtures.

## Explicitly deferred or blocked

- Factor allocation: empirical execution is blocked by `BLOCKED_MISSING_CANONICAL_FACTOR_ARTIFACTS` and point-in-time factor inputs.
- Strategy-stream allocation, Signal/Strategy Bank and Dynamic Active Set: empirical execution is blocked by `BLOCKED_MISSING_STRATEGY_HISTORY` and `BLOCKED_MISSING_HISTORICAL_PIT_GOVERNANCE`.
- Mean-variance and max-Sharpe paths that require forecasts: blocked by `BLOCKED_MISSING_PIT_EXPECTED_RETURNS` where applicable.
- Historical signal-quality gating: blocked by `BLOCKED_MISSING_LEGACY_NODE3_SOURCE`.
- Signed financing/exposure: blocked by `BLOCKED_BY_SIGNED_EXPOSURE_CONTROLLER_SCOPE`.
- PIPE-01/02 replays and UI-01 outputs remain replay or view evidence; they are not configurable empirical research entry points.
- Benchmark-relative alpha, DSR/significance, a continuously carried multi-fold portfolio, verified vendor lineage, independently verified data vintages, live orders and broker integration are outside this scope.
- Asset allocation in AL-07 also has an executable empirical path, but it should follow the capital workflow so Phase B remains one mode, one adapter and one comparison contract.

No Phase B implementation was performed in Phase A.
