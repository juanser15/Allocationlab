# ResearchRunSpec and ResearchRunResult contract

Contract version: `workbench-research-run-spec-1.0.0-draft` / `workbench-research-run-result-1.0.0-draft`
Backend checkpoint: `b9950f7cbe128f9d761597a5e216d777cc3059a3`

## Scope and support vocabulary

This contract records what the committed backend can accept and emit without implying that every research mode implements every field. The selected empirical mapping is `research/capital/engine.ts::runCampaign`, with positions, trades and fees produced by `artifacts/api-server/src/lib/calculator.ts::runBacktestEngine`. Mode-specific capability remains governed by `capability-map.json` and `blocked-modes.json`.

Support values mean:

- `SUPPORTED`: the committed backend produces or consumes the value directly.
- `SUPPORTED_WITH_LIMITS`: the mapping exists with the named limitation.
- `NOT_APPLICABLE`: the concept does not apply to that run and is recorded explicitly.
- `NOT_SUPPORTED`: the current backend does not produce or consume the concept.
- `FUTURE_NOT_IMPLEMENTED`: a reserved contract field with no current executable implementation.
- `BLOCKED_MISSING_<REASON>`: execution or an output is unavailable because a named input or contract is absent.

The presence of a field in either schema is not evidence that a mode implements it. An adapter must reject a request whose capability status does not support the requested behavior.

The committed backend has no native ResearchRun envelope. The Phase A documents therefore form a draft evidence contract. Scenario-level `run_id`, request/result timestamps, `requested_by`, and the final envelope mapping remain `FUTURE_NOT_IMPLEMENTED` in the backend; Phase A calculates or records only the values needed to prove this contract. The native campaign, job, result, cache and artifact identities remain preserved in provenance and are never replaced by the draft ID.

## ResearchRunSpec

Every result-affecting value is present in the normalized spec. There are no silent financial defaults. If transaction costs are zero, `transaction_cost_bps` is the number `0`.

| Field | Type / required | Financial meaning and source | Validation, backend mapping, current support |
|---|---|---|---|
| `contract_version` | string / required | Interchange contract version. `EXPLICIT_ENGINE_DEFAULT`. | Exact draft value; adapter metadata; `SUPPORTED`. |
| `run_id` | `rr_` + 64 lowercase hex / required | Deterministic identity of the normalized request. `DERIVED`. | Hash procedure below; adapter identity distinct from engine `job_hash`; `FUTURE_NOT_IMPLEMENTED` in the backend and calculated only for this Phase A contract proof. |
| `created_at` | UTC date-time / required | Audit creation time with no economic effect. `DERIVED`. | RFC 3339 UTC; excluded from identity; captured by the Phase A evidence record, while backend persistence is `FUTURE_NOT_IMPLEMENTED`. |
| `research_mode` | enum / required | Requested financial research domain. `USER_SUPPLIED`. | Capability-gated enum. `CAPITAL_MARKET_EXPOSURE` maps to `runCampaign`; support varies by mode. |
| `execution_scope` | `EMPIRICAL`, `SYNTHETIC_TEST`, or `FROZEN_REPLAY` / required | Nature of the evidence. `USER_SUPPLIED`. | `EMPIRICAL` requires all ten Phase A empirical conditions; `SUPPORTED`. |
| `universe` | object / required | Separates operated instruments from the information universe. `USER_SUPPLIED`. | Capital maps `operated` to `risk_asset` and `information` to `reference_universe`; explicit unique arrays; `SUPPORTED_WITH_MODE_SPECIFIC_LIMITS`. |
| `start_date` | date / required | Inclusive start of the requested validation schedule. `USER_SUPPLIED`. | Maps to `Campaign.dates.start`; capital requires a month start; `SUPPORTED`. |
| `end_date` | date / required | Exclusive end of the validation schedule. `USER_SUPPLIED`. | Maps to `Campaign.dates.end_exclusive`; capital requires a month start; `SUPPORTED`. |
| `information_cutoff_policy` | object / required | Visibility, fitting and execution rules. `SAVED_CONFIGURATION`. | Maps to predictor/fit cutoffs and calculator execution timing; current proof is `PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED`; `SUPPORTED_WITH_LIMITS`. |
| `benchmark` | string or object / required | Explicit benchmark definition. `USER_SUPPLIED`. | The capital proof stores `NOT_SUPPORTED`; benchmark-relative output is not produced. |
| `strategy_or_allocator_id` | string / required | Stable implementation identifier or declared contract label. `DERIVED`. | `capital-research-grid-selector` is a derived label for the committed campaign selector; selected candidate IDs remain separate Result fields. |
| `strategy_or_allocator_version` | string / required | Version of the executing financial implementation. `DERIVED`. | Maps to capital `ENGINE_VERSION`; `SUPPORTED`. |
| `parameters` | object / required | Complete mode-specific model, policy and economic parameters. `USER_SUPPLIED`. | Maps to the candidate specification, transformations, policies, selection, yields, slippage and fold initialization. Defaults must be expanded; `SUPPORTED_WITH_MODE_SPECIFIC_VALIDATION`. |
| `rebalance_frequency` | enum / required | Target refresh cadence. `USER_SUPPLIED`. | Capital candidates accept `monthly` or `quarterly`; other schema values require a supporting mode; `SUPPORTED_WITH_MODE_SPECIFIC_VALUES`. |
| `transaction_cost_bps` | nonnegative number / required | One-way fee on absolute traded notional. `USER_SUPPLIED`. | Maps to capital job `scenario` and calculator `transactionCostBps`; numeric zero is explicit; `SUPPORTED`. |
| `expected_return_method` | object or sentinel / required | Expected-return estimator where an objective requires it. `USER_SUPPLIED`. | `NOT_APPLICABLE` for capital. PIT expected returns are absent for objectives that require them; mode-specific. |
| `covariance_method` | object or sentinel / required | Covariance estimator and version where applicable. `USER_SUPPLIED`. | `NOT_APPLICABLE` for capital; allocation modes require their committed PIT covariance mapping. |
| `risk_mandate` | object or sentinel / required | Versioned risk limits, cash rules and exposure rules. `USER_SUPPLIED`. | Capital uses exposure-policy parameters rather than allocation-core `RiskMandate`; `NOT_APPLICABLE` for the proof. |
| `constraints` | object / required | Candidate acceptance or allocation feasibility bounds. `USER_SUPPLIED`. | Maps to `Campaign.constraints` or allocation-core constraints; units and active values explicit; `SUPPORTED_WITH_MODE_SPECIFIC_VALIDATION`. |
| `validation_protocol` | object / required | Keeps fitting, selection, validation/inner OOS and outer OOS distinct. `SAVED_CONFIGURATION`. | Maps to capital validation mode, window type, folds and selection basis; traditional and nested are implemented. |
| `walk_forward_configuration` | object or sentinel / required | Window lengths, step and recalibration cadence. `USER_SUPPLIED`. | Maps to capital train/test/step months and recalibration frequency; overlapping tests are rejected; `SUPPORTED`. |
| `random_seed` | string, number, or sentinel / required | Seed for stochastic search or execution. `USER_SUPPLIED`. | Required for capital random search; `NOT_APPLICABLE` for the deterministic grid proof; included in identity when used. |
| `data_snapshot` | object / required | Immutable bytes, parsed identity, coverage and provenance qualification of historical input. `SAVED_CONFIGURATION`. | Maps to committed CSV, configured SHA-256 and parser result. `as_of_status` records that the CL-02 freeze time is external metadata and is not engine-bound; vendor authenticity remains unverified. |
| `engine_versions` | string map / required | Versions of every contributing engine, model and policy, plus code identity. `DERIVED`. | Maps to engine and registry versions and aggregate code hash; `SUPPORTED`. |
| `code_commit` | 40 lowercase hex / required | Git commit supplying source and committed inputs. `DERIVED`. | Full `git rev-parse HEAD`; `SUPPORTED`. |
| `requested_by` | string / required | Audit identity of the requester; no economic effect. `USER_SUPPLIED`. | Explicit nonempty value; excluded from identity; Phase A evidence capture only and `FUTURE_NOT_IMPLEMENTED` in the backend. |
| `storage_policy` | object / required | Immutable evidence roots and reuse policy; no economic effect. `USER_SUPPLIED`. | Maps to the `runCampaign` root and immutable store; excluded from run identity; `SUPPORTED`. |

`$schema` is optional display metadata, `DERIVED`, and excluded from run identity. Nested properties inherit their parent source unless the schema says otherwise. Every optional engine concept is materialized as an object or an explicit sentinel before normalization.

### Normalization and run identity

The Phase A contract specifies hashing but does not add production hashing code.

1. Validate the request against `research-run-spec.schema.json` and the selected mode's backend validation. Reject unsupported fields rather than ignoring them.
2. Expand every result-affecting explicit engine default. In particular, zero fees, zero slippage, yield assumptions, validation clocks, constraints and seed applicability are materialized.
3. Build the identity payload from the validated spec after removing only `$schema`, `contract_version`, `run_id`, `created_at`, `requested_by`, and `storage_policy`. These fields describe presentation, contract transport, request audit, or persistence and do not alter the calculation.
4. Preserve all array order. The committed capital canonicalizer hashes arrays in supplied order; universe and fold arrays are therefore never silently reordered. Duplicate universe members are rejected. An adapter may sort a set before creating the normalized spec, but it must do so before identity calculation and persist the sorted form.
5. Sort every object key recursively in ascending JavaScript/Unicode UTF-16 code-unit order, matching `research/capital/spec.ts::canonical` for the current ASCII field names.
6. Serialize dates as `YYYY-MM-DD`; serialize timestamps in UTC RFC 3339 form with `Z`. Date ranges are half-open wherever an `_end_exclusive` field is used.
7. Serialize finite IEEE-754 numbers using the shortest JSON round-trip representation used by `JSON.stringify`; normalize negative zero to `0`. Reject `NaN`, positive/negative infinity, and numeric strings where a number is required. Do not round financial values for identity.
8. Preserve explicit `null`. JSON `undefined` is prohibited. Omit a field only when the schema marks it optional; required inapplicable values use an explicit sentinel.
9. Preserve enum casing exactly as declared. Contract lifecycle/scope/sentinel enums are uppercase. Engine-native validation modes, frequencies and execution rules remain lowercase.
10. UTF-8 encode the whitespace-free canonical JSON, compute SHA-256, lowercase the hex digest, and prefix it with `rr_`.

The identity payload therefore includes the normalized configuration, data snapshot hashes, code commit, engine versions, and the random seed when applicable. Display-only metadata cannot change identity.

For the proof runs, changing only `transaction_cost_bps` changes the contract `run_id` and every paired engine `job_hash`. The capital `experiment_hash` remains the same because the committed campaign contains both cost scenarios; it identifies the common campaign, not one scenario-level ResearchRun.

## ResearchRunResult

Every output family is required. A mode that cannot produce one records `NOT_SUPPORTED`, `NOT_APPLICABLE`, `FUTURE_NOT_IMPLEMENTED`, or `BLOCKED_MISSING_<REASON>`. A required output never disappears silently.

| Field | Type / required | Meaning and source | Validation, backend mapping, current support |
|---|---|---|---|
| `contract_version` | string / required | Result-envelope version. `DERIVED`. | Adapter metadata; `SUPPORTED`. |
| `run_id` | contract run ID / required | Links result to exactly one normalized spec. `DERIVED`. | Must equal `input_spec_reference.run_id`; `SUPPORTED`. |
| `status` | `PENDING`, `RUNNING`, `SUCCESS`, `FAILED`, or `BLOCKED` / required | Execution state. `DERIVED`. | Translated from engine state. `SUCCESS` is mechanical, never an economic recommendation. |
| `started_at` | UTC timestamp or sentinel / required | Process start time. `DERIVED`. | Capital backend does not persist it, so the proof records `FUTURE_NOT_IMPLEMENTED`. |
| `completed_at` | UTC timestamp or sentinel / required | Process completion time. `DERIVED`. | Capital backend does not persist it, so the proof records `FUTURE_NOT_IMPLEMENTED`. |
| `input_spec_reference` | string / required | Immutable spec artifact reference. `DERIVED`. | Evidence path; `SUPPORTED`. |
| `stage` | string / required | Most specific represented engine stage. `DERIVED`. | Capital proof uses `OUTER_OOS_AGGREGATE`; `SUPPORTED`. |
| `result_artifacts` | array / required | Paths, hashes and selectors for auditable outputs. `DERIVED`. | Persisted campaign/job files. Empty only when errors/blockers explain why. |
| `metrics` | object or sentinel / required | Mode-specific financial and mechanical metrics. `DERIVED`. | Capital maps to `research/capital/metrics.ts`; `SUPPORTED_WITH_MODE_SPECIFIC_FIELDS`. |
| `time_series` | artifact reference or sentinel / required | Dated research index or other series. `DERIVED`. | Capital maps to selected rows of `oos-equity.csv`; `SUPPORTED`. |
| `weights_or_positions` | ledger reference or sentinel / required | Dated risky-sleeve weights or final NAV positions, with meaning stated. `DERIVED`. | Capital emits SPY positions and cash in `oos-ledger.csv`; `SUPPORTED_WITH_LIMITS`. |
| `trades_or_rebalances` | ledger reference or sentinel / required | Executed trades or target refresh events. `DERIVED`. | Capital daily ledger with `next_close`; `SUPPORTED`. |
| `costs` | object or sentinel / required | Assumption and realized actual-notional costs. `DERIVED`. | Capital fee ledger; zero remains numeric zero; `SUPPORTED`. |
| `risk_diagnostics` | object or sentinel / required | Drawdown, volatility, exposure and mode-specific risk output. `DERIVED`. | Capital supports those three; expected and realized beta are both `NOT_SUPPORTED`. |
| `validation_diagnostics` | object or sentinel / required | Stage-separated selection, folds, hashes and PIT checks. `DERIVED`. | Capital selections/jobs/folds; `SUPPORTED`. |
| `warnings` | string array / required | Non-fatal limits on interpretation. `DERIVED`. | Engine and adapter qualifications; `SUPPORTED`. |
| `blockers` | blocker array / required | Exact reasons execution or interpretation is blocked. `DERIVED`. | Stable `BLOCKED_*` codes; a successful proof has an empty array. |
| `error_class` | string or null / required | Stable category for failed execution. `DERIVED`. | Nonempty for `FAILED`, null for `SUCCESS`; `SUPPORTED`. |
| `error_message` | string or null / required | Human-readable failure detail. `DERIVED`. | Nonempty for `FAILED`, null for `SUCCESS`; `SUPPORTED`. |
| `provenance` | object / required | Code, data, engine and campaign identities. `DERIVED`. | Campaign manifest/config, Git and data hashes; `SUPPORTED`. |
| `reproducibility` | object or sentinel / required | Repeat-run equality and named nondeterministic fields. `DERIVED`. | Independent output roots and artifact hashes; `SUPPORTED`. |
| `execution` | object / optional | Exit code, runtime and new/reused-job telemetry. `DERIVED`. | Shell/progress evidence; excluded from run identity; `SUPPORTED`. |

### Status and error rules

- `SUCCESS` requires null `error_class`, null `error_message`, and no blockers.
- `FAILED` requires nonempty `error_class` and `error_message`.
- `BLOCKED` requires at least one precise blocker.
- `PENDING` and `RUNNING` may use explicit unavailable sentinels for result families that have not been produced yet.
- A performance metric does not determine status. Status describes execution and contract completion.

## Point-in-time evidence contract

PIT evidence is recorded at the finest applicable decision or fold grain. The following fields are mandatory when they apply:

| PIT field | Rule and current mapping |
|---|---|
| `decision_date` | Date the target is formed. Capital maps to each target's `signalDate`. |
| `information_cutoff` | Latest permitted information; it must be strictly earlier than `decision_date` for the proven capital path. |
| `training_start` | Inclusive first observation eligible for fitting. |
| `training_end_exclusive` | Exclusive fit boundary. It must not cross the validation or outer-OOS start. |
| `validation_start` | Inclusive validation/inner-OOS start for nested selection; `NOT_APPLICABLE` for traditional selection. |
| `validation_end_exclusive` | Exclusive validation/inner-OOS end; `NOT_APPLICABLE` for traditional selection. |
| `outer_oos_start` | Inclusive outer evaluation start. The selected model is already fixed at this boundary. |
| `outer_oos_end_exclusive` | Exclusive outer evaluation end. |
| `data_snapshot_as_of` | Timestamp qualifying the historical snapshot's recorded vintage. It does not prove vendor authenticity by itself. |
| `promotion_state_as_of` | Required for Bank/governance modes; `NOT_APPLICABLE` for capital. |
| `activation_state_as_of` | Required for Dynamic Active Set/governance modes; `NOT_APPLICABLE` for capital. |

The result must expose these fields directly in `validation_diagnostics` or reference a hashed artifact containing them. All input observations used for a decision must satisfy the declared cutoff rule. The execution convention must be recorded, and a fill cannot earn return before it occurs.

A result may use `PIT_SAFE` only when every applicable field is present, interval relations pass, the historical data vintage is verified, and promotion/activation state is versioned where relevant. Missing applicable evidence yields `NOT_PIT_SAFE` or `BLOCKED_MISSING_<REASON>`. The Phase A capital proof passes the mechanical cutoff checks but its adjusted-close vendor authenticity and vintage history are not independently verified, so its only permitted label is `PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED`.

## Financial distinctions preserved by the contract

| Distinction | Contract treatment |
|---|---|
| Risky-sleeve weights versus final NAV weights | `weights_or_positions.meaning` states which representation is present; they cannot share an unlabeled field. |
| Expected beta versus realized beta | Separate diagnostic keys; each may independently be `NOT_SUPPORTED`. |
| Promoted versus active versus allocated | Governance state, active-set membership and capital allocation are separate dated outputs. |
| Gross return versus net return | Costs are explicit and net metrics are labeled; equality at zero fees does not merge the concepts. |
| In-sample versus validation versus outer OOS | `validation_protocol` and PIT intervals keep each stage separate. |
| Risk-management benefit versus alpha | Neither is inferred from return metrics. Benchmark-relative alpha is unsupported in the selected path. |
| Signal versus strategy instance | Model/signal identity remains separate from the strategy or allocator instance and version. |
| Historical empirical result versus synthetic fixture | `execution_scope` is mandatory and capability-gated. |

The Phase A proof validates execution mechanics, data boundaries, costs, identity and reproducibility. It makes no alpha, profitability, production-readiness, real-money, or recommended-allocation claim.
