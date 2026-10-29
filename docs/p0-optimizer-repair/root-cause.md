# P0 optimizer repair: source audit and implementation

Implementation baseline: `90b7b7e2e7ff0a04364be58f8f59cfd801a8e382`, branch `source/replit-code-baseline-20261028`. Contract: [Issue #2](https://github.com/juanser15/Allocationlab/issues/2), including the [owner-approved construction/overlay amendment](https://github.com/juanser15/Allocationlab/issues/2#issuecomment-6490494153). Phase 0 is resolved. This is a source-only repair, not certification of the private Replit runtime.

## Before repair

The snapshot's optimizer solved a continuous mean–variance problem with L1 trading costs, long-only boxes, an exposure ceiling and an optional volatility ceiling. It did not receive minimum holdings, maximum holdings or minimum positive NAV weight. `institutional.ts::validateTargets` checked these only after optimization. A second integration defect was that `requestFromSpec` reconstructed the older coordinated request and omitted the institutional mandate before the engine invoked the optimizer.

The snapshot's enable-mandate action used minimum holdings of one, but it could create a mandate even with no selected candidates. Invalid subsequent edits (including a blank, zero or fractional minimum) did not disable Run because that control did not incorporate the shared local feasibility result. Such drafts could reach initiation, although backend parsing could reject them. The screenshot alone does not establish how the owner's invalid value was entered.

`scripts/reproduce-optimizer-baseline.mjs` compiles the pinned public snapshot's code using Git blobs. It reproduces the three failures with explicitly synthetic analytical inputs: invalid zero minimum holdings; a positive 0.1% weight rejected by a 3% mandate; and eleven approximately equal holdings rejected by a 1–10 mandate. See `before-repair.json`. No private observations are used or reconstructed.

## Repair

- A mandate-aware support optimizer enforces cardinality and weight floors inside each continuous subproblem. Every changed support is re-optimized. No output pruning, uplifting, rounding or renormalization is used to pass a validator.
- The engine passes the frozen institutional mandate explicitly. No-mandate calls retain the original continuous solver.
- The default minimum holding count is valid. Integer inputs are not silently rounded or clamped. UI Run gating and backend parsing use the same feasibility contract.
- Static portfolio incompatibilities fail before run creation. Calendar, dataset membership and causal warmup failures use a separate `DATA_COVERAGE` category and preserve requested dates.
- Final target validation remains an assertion. A breach is a `NUMERICAL_FAILURE` with mandate audit evidence, not a normal portfolio-construction step.
- Successful invested decisions record support, optimized NAV weights, effective overlay weights, objective, convergence certificate, exposure/risk/weight/cardinality residuals and the frozen mandate.
- The new solver version and source files enter the existing code-based identity. Existing stored runs are not rewritten or migrated. New runs use the repaired code identity.

## Independent capital and composition clocks

At scheduled allocation dates the solver produces composition under the baseline capital policy. Daily capital monitoring applies the existing causal overlay to that frozen composition. Cash-to-invested transitions reuse it; the overlay does not trigger optimization. Explicit zero-risk cash is exempt from positive holdings in both daily and rebalance-only monitoring.

The previous `55abe601` implementation incorrectly re-applied construction floors to effective overlay targets. The owner-approved correction applies cardinality and per-asset weight bounds only to strategic total-NAV targets at scheduled rebalances, before capital scaling in either monitoring mode. Positive effective weights below those floors and later market drift are permitted. Separate execution safety checks preserve funding, universe, exposure/risk policy and timing; no extra allocation solve or drift-correction trade is introduced. See `strategic-target-correction.md`.

The HMM fitter, regime calculations, capital-clock formulas, next-close ledger, cost/slippage mathematics and cash-yield accounting are unchanged. Tests cover genuine Gaussian-HMM repeated intramonth cash transitions as well as a separately labelled controlled clock-stress fixture with more than 85 daily signals. Future-price perturbations cannot alter earlier decisions. Existing public synthetic capital-clock financial goldens reproduce.

## Evidence boundary

The HTTP acceptance harness runs real routing, authentication, parsing, planning, normalization, constrained optimization, engine and result mapping against synthetic data and an injected in-memory store. It does not test PostgreSQL durability or production worker IPC. Private-data golden regressions and the original user workspace remain pending in Replit. See `issue-acceptance.md`, `replit-verification.md` and `correction-test-results.json`.
