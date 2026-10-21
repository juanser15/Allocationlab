# ResearchRunSpec V2 calendar and cost contract

## Required wire fields

The ordinary `/api/workbench/runs` and `/api/workbench/plan` endpoints require a strict JSON object containing all of:

```json
{
  "contract_version": "workbench-research-run-spec-2.0.0",
  "research_mode": "CAPITAL_MARKET_EXPOSURE",
  "execution_scope": "EMPIRICAL",
  "universe": "SPY",
  "validation_protocol": "TRADITIONAL_WALK_FORWARD",
  "evaluation_start": "2022-01-01",
  "evaluation_end_exclusive": "2022-03-01",
  "window_type": "ROLLING",
  "training_window_months": 24,
  "rebalance_frequency": "MONTHLY",
  "transaction_cost_bps": 0,
  "selection_cost_bps": 2.5
}
```

These dates and numbers are an example request, never inserted as defaults. `evaluation_start` is the inclusive requested OUT-OF-SAMPLE start. Training begins before it. `evaluation_end_exclusive` is the exclusive requested OUT-OF-SAMPLE end. Both are valid ISO month starts. Quarterly starts must be calendar-quarter starts because the existing calculator groups signals by calendar quarter. No request is shifted or shortened.

`window_type` is `ROLLING` or `EXPANDING`. `training_window_months` is a positive integer, bounded at 1200 as an operational parsing guard and further restricted by actual data history. `rebalance_frequency` is `MONTHLY` or `QUARTERLY`. The two cost fields are explicit finite nonnegative numbers in basis points, with no rounding or 0/5 allowlist. Unsupported fields, including independent `test_months`, `step_months` or `recalibration_frequency`, are rejected.

## Derived campaign and fold authority

The API constructs a fresh run-specific campaign, preserving only the declared existing model definition from the committed fixture. Campaign start is `evaluation_start - training_window_months`. The generic committed `research/capital/spec.ts::makeFolds` is the sole fold generator used by preflight and by `runCampaign`.

For MONTHLY, test horizon, step and recalibration are one month. For QUARTERLY, they are three months. Each OOS fold contains exactly one rebalance signal on the first observed date in the period, with execution on the next observed close. A calendar boundary can be a holiday; `decision_date` records the actual observed signal date, while `oos_start` records the calendar boundary. `information_cutoff` is the last observation strictly before the training end/OOS boundary.

Rolling training is `[t - training_window_months, t)`. Expanding training starts at the initial preceding training start and ends at each new `t`. OOS intervals are `[t, next rebalance boundary)`, disjoint and covering the entire requested interval. An incomplete final period is rejected.

The selected model/configuration is frozen for its OOS interval. The current regime model is stateless: its fit artifact does not represent a newly invented learned estimator. Candidate reselection and the final fit boundary still occur for every outer fold. Previous OOS rows become eligible for later training only after those dates are historical relative to that later cutoff.

## Training and warmup

The committed current-regime `fit` is stateless and has no learned-model training minimum. Its 252-row indicator history is a separate warmup requirement, not a minimum number of observations inside the user's training window. The training-score selection requires at least two actual returns and a defined net-Sharpe score; the unchanged engine determines candidate eligibility. A one-month training request is retained as one month when its data requirements pass.

Separately, the existing model requires 252 complete information rows before training begins so its training-score simulation does not start after an implicit warmup delay. The entire training and OOS slices must contain valid prices for the fixed information universe. The committed dataset begins before some information symbols exist, so its first SPY date alone does not establish the earliest supported training date.

Insufficient user training returns `INSUFFICIENT_TRAINING_HISTORY` with requested months, interval, model row requirement and available observations. Missing/incomplete indicator history returns `INSUFFICIENT_MODEL_WARMUP_HISTORY`. Neither case automatically enlarges training or moves evaluation dates.

Capabilities derives first/last observations from the committed CSV. Its earliest evaluation date is conditional on training length and cadence; `/plan` is authoritative for the actual request. The latest evaluation boundary is the end of the last complete observed month. Snapshot identity is verified by SHA-256 before planning/execution.

## Selection versus evaluation costs

`selection_cost_bps` determines which training-scenario metrics rank candidates. `transaction_cost_bps` determines the selected-candidate OOS scenario returned as the requested result. The engine computes the sorted unique union of the two scenarios. Changing selection cost may change candidate selection, so it is an independent financial identity field. No hidden five-basis-point selection assumption remains in V2.

## Identity, outputs and compatibility

V2 retains the existing canonical JSON hashing function unchanged, adds `identity_namespace=workbench-research-run-spec-2.0.0`, and includes all user fields, expanded fixed model terms, identified data snapshot, engine versions and a content hash of the Workbench/engine source. The certified engine commit is retained separately. Fold visualization and display timestamps are derived and do not independently affect identity. V1 identity remains unchanged and cannot collide with V2.

Results reuse actual engine output mapping and add explicit evaluation dates, fold count, window type, training months and cadence to metric metadata. They include the exact pre-run fold plan, real fit keys, selected job hashes, result hashes and actual OOS observations. Ephemeral progress timestamps/memory remain outside the financial hash.

The engine still resets each sleeve to NAV=100 cash and compounds disjoint outer daily returns into a research index. No holdings are carried between folds, and no terminal liquidation is invented. Performance mathematics is unchanged. `PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED`, `RESEARCH_ONLY` and temporary-storage labels remain mandatory.

The original `/api/workbench/v1/**` route exposes only the historical V1 certification fixture. The ordinary endpoints require V2. The B2 UI's capability validation prevents it from executing against the incompatible V2 response. No B3B UI is implemented.
