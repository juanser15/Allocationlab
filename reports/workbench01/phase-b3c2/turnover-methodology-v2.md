# Turnover selection methodology V2

The ordinary Workbench uses `RECURRING_TURNOVER_EXCLUDING_INITIAL_V2`, fixed by the model definition. It is explicit in request contract `workbench-research-run-spec-2.1.0`, capabilities, normalized identity, plan, result, provenance and candidate evidence. The six-field primary design form has no methodology control.

`TOTAL_TURNOVER_INCLUDING_INITIAL_V1` remains available through explicit spec `workbench-research-run-spec-2.0.0` on the existing dynamic-calendar API. Existing normalized specs, identity code, engine, calendar, worker and stored results are unchanged. `/api/workbench/v1` remains the separate original fixed-calendar certification contract. No stored run is migrated. B3C.1 evidence remains valid under total-turnover V1.

For each independent training ledger, let `N` be the number of actual observed ledger/return rows, including entry-lag and no-trade rows. For row `d`, `A_d = sum(abs(trade.notional))` and `V_d = beginningNav + etfPnl + cashPnl`, the certified pre-cost NAV. Turnover is `A_d / V_d`. Implementation is the first row with nonzero actual fill notional, identified once; zero-target or unfilled decisions are not trades. All following fills are recurring.

- `initial_implementation_turnover`: first actual entry's normalized notional.
- `recurring_gross_turnover`: sum of every subsequent normalized actual fill.
- `total_gross_turnover = initial_implementation_turnover + recurring_gross_turnover`.
- `annualized_total_turnover = total_gross_turnover * 252 / N`.
- `annualized_recurring_turnover = recurring_gross_turnover * 252 / N`.

Both annualized measures use exactly the same complete observed interval. There is no shortened denominator. Reconciliation uses absolute/relative floating-point tolerance `1e-10 * max(1, total)`.

V1 compares annualized total turnover with 8. V2 compares annualized recurring turnover with the same fixed limit 8. Drawdown, mean-exposure constraints, net Sharpe, and tie breaking remain unchanged. Ties still use **annualized total turnover**, then complexity, then candidate ID.

Every actual fill still pays `abs(notional) * cost_bps / 10000`, including implementation. Selection net returns/Sharpe and OOS returns retain all fees. Implementation costs plus recurring costs reconcile to realized simulated costs. Each OOS fold remains an independent all-cash NAV-100 sleeve; its entry is real, costed and reported. No terminal liquidation is invented. Passive and matched-beta controls keep their certified methodology and costs.

A candidate with no later actual portfolio change has zero recurring turnover and `NO_RECURRING_REBALANCE_OBSERVED`. The warning says the constraint is not informative for that candidate. It neither blocks an otherwise valid candidate nor establishes low-turnover skill.

## Explicit preservation boundary

The old source-byte identity covers the original capital engine and adapter modules. Editing those would invalidate historical IDs. Therefore the new orchestration is a separately versioned snapshot at `research/workbench/recurring-turnover-engine.ts`, with the exact diff recorded in `orchestration-diff.txt`. The fit, ledger, cost/PIT and OOS aggregation bodies are mechanically checked against the unchanged certified engine. It reuses the same calculator, registry, policies, storage and performance functions. Only eligibility, turnover evidence, version identity and operational-budget separation differ.

The existing parent process adapter is unchanged. A fixed built worker dispatcher verifies the immutable normalized spec, bridges its existing transport envelope, and dispatches either the unchanged legacy worker or the new version. It never infers methodology from a mutable environment variable, cost, date or UI label. The financial adapter version is verified/restored before storing the result. No arbitrary executable, path or shell fragment is accepted.

The new content-addressed `code_version` includes the unchanged legacy source identity and all new execution/selection modules. The spec's `code_commit` records the engine's starting checkpoint, not a claim that the new adapter was already present there; the publication commit is recorded with this phase. Display metadata and capacity settings do not enter identity. Changing methodology changes run ID even when all user financial inputs match.

Cross-version comparison is read-only. It reports absent versioned fields explicitly and warns `TURNOVER_METHODOLOGY_DIFFERS`: “The runs apply different candidate-eligibility definitions. Performance differences may reflect both strategy selection and turnover methodology.” No winner or recommendation is produced.

All results remain `RESEARCH_ONLY`, `TEMPORARY_RESEARCH_STORAGE`, and `PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED`.

Ordinary OOS folds span one rebalance interval, so each independent dynamic OOS sleeve generally has its costed entry and no later rebalance. Recurring turnover is still exercised in multi-month **training** ledgers (case D includes selected policies with nonzero recurring turnover). The reporting does not relabel the next fold’s entry as a recurring trade in the previous book.
