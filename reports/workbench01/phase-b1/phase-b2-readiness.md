# Workbench Phase B2 readiness

## Readiness decision

Phase B1 provides the server contract needed for one narrow research-only UI workflow:

`CONFIGURE -> SUBMIT -> RUN -> POLL -> INSPECT -> MODIFY COST -> RERUN -> COMPARE`

The executable mode is `CAPITAL_MARKET_EXPOSURE` for SPY using the committed traditional walk-forward campaign. Phase B2 may build a UI against the routes below. It must preserve `RESEARCH_ONLY`, `TEMPORARY_RESEARCH_STORAGE`, and `PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED` in the user-visible workflow.

This report defines the UI boundary. It does not design or implement frontend code.

## What the UI may do

| UI action | API operation | Supported behavior |
|---|---|---|
| Retrieve capabilities | `GET /api/workbench/capabilities` | Read the supported mode, universe, validation method, editable and fixed fields, data coverage, engine identity, resource limits, blocked modes, storage status, PIT classification, and real-money boundary. |
| Configure a run | Local form state based on capabilities | Require `transaction_cost_bps` and allow exactly numeric `0` or `5`. Show the fixed fields described below without making them editable. |
| Submit a run | `POST /api/workbench/runs` | Send the strict five-field request. Receive deterministic `run_id`, immutable `execution_attempt_id`, status, stage, and idempotency information. |
| Poll status | `GET /api/workbench/runs/:runId` | Display `PENDING`, `RUNNING`, `SUCCESS`, `FAILED`, or `BLOCKED`, the latest attempt, immutable attempt history, warnings, blockers, and safe failure information. |
| List runs | `GET /api/workbench/runs` | Show the bounded set of temporary run records and their latest and latest-successful attempt identifiers. |
| Inspect a result | `GET /api/workbench/runs/:runId` | Show the normalized specification, actual OOS metrics, research-index series, cost output, selected candidates, fold evidence, job/result/fit hashes, artifact references, provenance, reproducibility hashes, warnings, and limitations that the server returns. |
| Rerun an experiment | `POST /api/workbench/runs/:runId/rerun` with an empty body | Preserve the same `run_id`, create a new immutable `execution_attempt_id`, and show the new attempt separately from all earlier evidence. |
| Compare two successful runs | `GET /api/workbench/compare?leftRunId=...&rightRunId=...` | Read immutable successful artifacts without recalculation. Show the exact normalized-spec differences and the reported observation, research-index, and realized-cost differences. Do not rank the runs. |

The submission body is exactly:

```json
{
  "research_mode": "CAPITAL_MARKET_EXPOSURE",
  "execution_scope": "EMPIRICAL",
  "universe": "SPY",
  "validation_protocol": "TRADITIONAL_WALK_FORWARD",
  "transaction_cost_bps": 0
}
```

The last value may be `0` or `5`. Every field is required. The UI must not send display metadata, paths, commands, extra configuration keys, or omitted defaults.

## Supported financial scope

| Concern | Phase B2 UI contract |
|---|---|
| Research mode | Fixed: `CAPITAL_MARKET_EXPOSURE` |
| Execution scope | Fixed: `EMPIRICAL` |
| Operated universe | Fixed: SPY |
| Validation | Fixed: `TRADITIONAL_WALK_FORWARD` |
| Editable financial input | `transaction_cost_bps`, allowed values `0` and `5` |
| Research dates | Fixed: start `2020-01-01`, end exclusive `2024-01-01` |
| Rebalance frequency | Fixed: monthly |
| Selector | Fixed: `capital-research-grid-selector` |
| Selection cost | Fixed: 5 bps |
| Benchmark | `NOT_SUPPORTED` |
| Historical snapshot | `cl02-adjusted-closes-b4a4fa0e0ddb`, 4,023 adjusted-close observations covering `2010-10-01` through `2026-09-30` |
| Engine | `research/capital/engine.ts::runCampaign`, version `capital-research-1.0.1` |

The broader snapshot coverage does not make the configured research dates editable. Phase B1 intentionally fixes the certified campaign windows.

## Run and storage behavior the UI must represent

- The same normalized specification always has the same `run_id`.
- An accepted new execution or explicit rerun has a new `execution_attempt_id` and never overwrites an earlier attempt; repeated pressure against the same active capacity blocker reuses one bounded `BLOCKED` attempt.
- A duplicate submission returns a matching running attempt, or the latest successful attempt by default, without starting uncontrolled duplicate work.
- Only one empirical execution may run at a time. Another execution request can return `BLOCKED` with `BLOCKED_EXECUTION_CAPACITY` and HTTP 429.
- A run stores at most 100 immutable attempts; the UI must show the safe 429 bound instead of retrying automatically.
- A failed rerun remains the latest attempt and retains safe client errors plus an attempt-relative private-diagnostic reference. Any earlier successful result remains separately identifiable.
- Comparison reads existing successful evidence and reports `READ_ONLY_NO_RECALCULATION`.
- Storage is filesystem-backed temporary research storage, defaults to `/tmp/allocationlab-workbench-runs`, and has no durability claim. The UI must not describe it as a saved project, durable archive, database record, or permanent research history.
- A lease left by a server-process crash requires explicit owner recovery. The UI must not clear it, silently retry, or claim high availability.

## Mandatory labels and interpretation

Every Workbench view must display or otherwise preserve:

- `RESEARCH_ONLY`
- `TEMPORARY_RESEARCH_STORAGE`
- `PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED`

The last label means the engine enforces the audited training, information-cutoff, and OOS mechanics, while the adjusted-close vendor authenticity and historical data vintages have not been independently verified. The UI may not replace it with an unqualified point-in-time-safety claim or imply independently verified historical vintages.

A successful run establishes execution mechanics and reproducibility under the declared inputs. It does not establish alpha, superior performance, robust profitability, production readiness, real-money readiness, or a recommended allocation.

## What the UI may not offer

The Phase B2 UI may not expose:

- editable dates, universe, information universe, benchmark, validation protocol, rebalance frequency, candidate budget, candidate definitions, selector, selection cost, risk target, objective, concentration limits, lookback, or random seed;
- nested walk-forward, asset allocation, factor allocation, strategy-stream allocation, Signal/Strategy Bank execution, Dynamic Active Set execution, signal-quality replay, or configurable end-to-end pipeline execution;
- synthetic modes or frozen replay as executable empirical choices;
- arbitrary paths, uploaded campaign files, command fragments, executable names, environment variables, or output-directory controls;
- a broker route, order object, trade button, approved size, live execution state, capital authorization, or investment recommendation;
- a winner, preferred configuration, promotion decision, activation decision, allocation authorization, or implication that `SUCCESS` means `PROMOTED`, `ACTIVE`, `ALLOCATED`, or `AUTHORIZED`;
- an unqualified point-in-time-safety badge, durable-storage claim, benchmark-relative alpha, DSR significance, expected beta, or realized beta where the result says `NOT_SUPPORTED`;
- any control for a field absent from the machine-readable editable-field allowlist.

## Narrow Phase B2 implementation scope

The smallest conforming Phase B2 is one capabilities-driven page or flow that:

1. loads capabilities before enabling submission;
2. renders the fixed experiment context and a required 0/5-bps cost control;
3. submits the strict request and retains both returned identifiers;
4. polls and renders the five-state status model;
5. inspects the actual result, provenance, warnings, blockers, and artifact references;
6. performs an explicit rerun and keeps attempt history visible;
7. compares two successful immutable attempts and presents neutral differences;
8. keeps the mandatory research, storage, and PIT limitations visible throughout.

Adding another mode, another financial control, durable persistence, or real-money functionality requires a later owner-approved phase and a matching implemented backend contract.
