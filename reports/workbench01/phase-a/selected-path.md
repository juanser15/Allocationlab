# Selected empirical path

## Decision

The selected Phase A path is the committed capital / market-exposure campaign implemented by `research/capital/engine.ts::runCampaign`, using `configs/capital-research/acceptance-traditional.json` and the frozen adjusted-close snapshot `reports/cl02/adjusted-closes.csv`.

Classification: **`EXECUTABLE_EMPIRICAL`**, with the qualified PIT statement **“PIT mechanics enforced; data-vintage PIT unverified.”**

This classification is limited to execution mechanics. It does not establish vendor authenticity, investability, alpha, economic superiority, production readiness, or suitability for real money.

## Why this path was selected

The capital path is the narrowest path that meets the Phase A empirical definition:

1. It consumes 4,023 committed adjusted-close observations covering 2010-10-01 through 2026-09-30 rather than a generated test fixture.
2. It executes committed source through the exported `runCampaign` entry point.
3. It accepts an explicit campaign configuration and recalculates candidates, fits, predictions, targets, fills, costs, ledgers, selections, and OOS summaries.
4. The configuration contains meaningful financial controls, including the risky asset, information universe, cost scenarios, exposure-policy bounds, lookback, selection metric, constraints, rebalance frequency, and walk-forward clocks.
5. It enforces strict prior-close information cutoffs and next-close execution. The proof inspected 528 targets and found no cutoff violation.
6. It writes auditable job, ledger, equity, selection, metric, manifest, and progress artifacts with deterministic identities and content hashes.
7. Its CL-03/CL-04 source includes mechanical certification for resume behavior, cache identity, future-data traps, accounting, fee reconciliation, and an independent oracle.

The proof uses traditional rolling validation because it is the smallest committed acceptance configuration. The engine also implements nested validation, but nested validation adds inner-fold orchestration that is unnecessary to prove the first empirical workbench path.

## Supported controls on the selected backend path

The committed `Campaign` contract accepts:

- campaign start and end-exclusive dates;
- traditional or nested validation;
- rolling or expanding windows;
- train, test, step, inner-train, inner-test, and inner-step month counts;
- rebalance and recalibration frequency;
- model family, information set, transformations, model parameters, and exposure-policy parameters;
- grid candidate definitions and candidate budget;
- selection metric and feasibility constraints;
- one or more explicit transaction-cost scenarios and a selection-cost scenario;
- constant cash and reference yields;
- operated risky asset and reference universe;
- warm-up rows and maximum jobs.

Phase A changes only `transaction_cost_bps`: Run A is 0 bps and Run B is 5 bps. Both scenario subruns use the same selected candidates, dates, targets, folds, data, code, and engine versions. Candidate selection is explicitly performed at 5 bps, so Run A is a cost-sensitivity evaluation of the 5-bps-selected candidate rather than an independent 0-bps reselection.

## Why other paths were not selected

| Candidate | Reason not selected |
|---|---|
| AL-07 ASSETS allocation | It is also executable against committed historical observations for `EQUAL_WEIGHT`, `MIN_VARIANCE`, and `ERC`, including costs and traditional/nested walk-forward. It has more dependencies (CL-02 prices, AL-03 PIT snapshots, risk mandate, allocation and gate layers) than the capital path, so it is not the narrowest proof. |
| AL-03 historical allocation replay | It recalculates a fixed historical snapshot set, but its replay surface is less suitable for a one-field workbench comparison than the capital campaign contract. |
| PIPE-01 end-to-end replay | It recomputes frozen AL-07 books, but its CLI accepts no financial control; it is `REPLAY_OF_FROZEN_EMPIRICAL_ARTIFACT`. |
| CL-02 research runner | It consumes existing ledgers and summaries rather than rerunning the upstream financial engine; it is `REPLAY_OF_FROZEN_EMPIRICAL_ARTIFACT`. |
| Factor allocation | The executable coverage is synthetic. Empirical execution is blocked by missing canonical PIT factor artifacts. |
| Strategy-stream allocation | The executable coverage is synthetic. Empirical execution is blocked by missing strategy history, maps, and PIT risk/governance bundles. |
| Signal / Strategy Bank | Its mechanics are deterministic and PIT-aware, but its committed inputs are synthetic; empirical execution is blocked by missing strategy history and historical promotion governance. |
| Dynamic Active Set | The committed integration consumes synthetic BANK and allocator fixtures; historical strategy/governance inputs are absent. |
| Standalone calculator | It is callable source, but no canonical committed ResearchRun configuration and provenance contract maps the general calculator surface to an empirical workbench run. |

## Exact limitations

- The committed CSV declares adjusted closes and is treated by the engine as an empirical snapshot, but vendor authenticity and historical vendor vintages are not independently established.
- Historical universe-membership and governance vintages are absent. The proof therefore does not use the unqualified label `PIT_SAFE`.
- Traditional selection ranks candidates on training scores. It is not inner-OOS model selection.
- Each outer fold is an independent sleeve initialized at NAV 100. The aggregate OOS index concatenates fold returns and is not one continuously carried portfolio.
- DSR/significance is `NOT_IMPLEMENTED`.
- A benchmark-relative result is `NOT_SUPPORTED`.
- The proof operates SPY as the risky sleeve. The 22-symbol reference universe supplies information features; it is not a 22-asset final portfolio.
- The reported metrics are execution evidence only and support no performance or allocation recommendation.

## Evidence

- Source entry point: `research/capital/engine.ts`
- Contract and hashing: `research/capital/spec.ts`
- Model/policy registry: `research/capital/registry.ts`
- Storage and immutable identity: `research/capital/storage.ts`
- Financial backtester: `artifacts/api-server/src/lib/calculator.ts`
- Committed configuration: `configs/capital-research/acceptance-traditional.json`
- Committed data snapshot: `reports/cl02/adjusted-closes.csv`
- Run specifications: `reports/workbench01/phase-a/run-a-spec.json`, `run-b-spec.json`
- Result summaries: `reports/workbench01/phase-a/run-a-result-summary.json`, `run-b-result-summary.json`
- Independent repetitions: `reports/workbench01/phase-a/executions/repetition-1`, `repetition-2`
