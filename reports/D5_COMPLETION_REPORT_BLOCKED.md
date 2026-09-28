# D5 COMPLETION REPORT — **BLOCKED**

D5 is implemented as an opt-in path, but it does **not** meet the document’s closure gates. I stopped after the specified implementation pass, one targeted repair pass, and bounded verification. D4 and legacy paths were kept separate.

**Objective and accounting.** The solver adds the full sum of absolute *net underlying-asset trades* to the daily nominal or exact D4 robust regularized mean-variance objective. Estimated fee and slippage cost is a one-time NAV fraction; it and the separate turnover-preference penalty are divided by the explicit positive amortization value \(h\) in the objective. Preference is not charged to cash. Holdings are explicit quantities and cash valued at the decision cutoff against positive pre-trade NAV; held assets outside the candidates receive zero targets and liquidation trades. A1 charges execution fees and slippage once and retains its legacy convention for old runs.

**Solver evidence and analytical check.** The implementation reports solver version, objective terms, feasibility, and optimality residuals. In the one-asset fixture starting at 40% exposure, 500 bps produced a no-trade 40% optimum. At 100 bps, the analytical optima were 70% for \(h=1\) and 75% for \(h=2\); their tested daily fee terms were 0.003 and 0.00175. **T3 failed:** the signed/netting fixture returned `NUMERICAL_FAILURE` because independent scaled KKT stationarity was **0.0546345635286938**, above the **0.000001** acceptance threshold. It cannot be labelled a solved optimum.

| Gate | Observed |
|---|---|
| T1 zero-cost identity | Capital identity test passed; the full capital/signed × nominal/robust matrix was not independently established. |
| T2 analytical optimum | Passed the no-trade, trading, two-\(h\), and preference-only focused checks. |
| T3 netting | **Failed** at the optimality residual above; this is the primary numerical blocker. |
| T4 actual holdings/timing | Focused carried-holdings and price-gap reconciliation test passed. |
| T5 robust constraints/failures | Focused robust and invalid-input checks passed; full acceptance coverage remains incomplete. |
| T6 B3 comparison | Focused paired-ledger/two-execution check passed; browser validation did not complete. |
| T7 replay | In-memory zero-cost paired ledgers matched exactly; saved-run reload after changed drafts was **not measured**. |
| T8 browser | **Blocked.** No fresh retained eight-stream fixture was available, so no qualifying UI-created Optimize/Validate/replay sequence or IDs were produced. The app itself loaded at its root preview; the tester’s initial `/allocation-lab/` route returned 404. |

**Regression run:** workspace typecheck passed and workflows started cleanly. Across the final test logs, **158 passed, 5 failed, 1 skipped**. Besides T3, the A2.1 cases lacked price data, the C3 fixture seeder lacked its required prior descriptor, and the allocation route test had an unresolved test-runner module import. These are not counted as passes. Maximum full accounting and persisted-replay differences, and UI-created allocation/validation IDs, are **not available** because those gates did not complete; the focused zero-cost paired ledgers were exactly equal.

**Final revision:** uncommitted working tree based on `2281f5c`; D5 source-change fingerprint `4ab52f9a8cbae1bddf3d01f676338508d6031654795004747572cc75416a5b1d`.

**Exact closure blocker:** T3’s failed independent optimality check. T7 and T8 also remain unverified. **D5 is BLOCKED, not CLOSED.**