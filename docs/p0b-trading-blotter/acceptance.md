# Issue #5 acceptance evidence

All evidence is source-only. Synthetic fixtures are labelled and do not replace the excluded private historical dataset. Exact commands, results and case names are in `test-results.json`.

| Issue criterion | Evidence |
| --- | --- |
| 1. Determinism | Same source projection reproduces fill/lot/event IDs and all hashes. Distinct attempt IDs preserve source content hash while binding independent reporting identities. Source objects and financial hash are unchanged; projected evidence is defensively copied. |
| 2. Scheduled fills | Multi-ETF fixture has initial entries, later scheduled changes, both BUY/SELL and source-linked decision/session/cutoff records. |
| 3. HMM reduction/cash/re-entry | Actual existing engine ledger is projected at both 2.5% and 3% floors. Source capital signals retain their causal execution dates and frozen composition. The unchanged P0 91-test group also covers the genuine Gaussian HMM and next-close costs. |
| 4. Joint events | Joint scheduled construction/capital changes retain both causes. Optimized-exposure changes or an unbinding HMM change alone do not claim joint causation. No unique per-cause P&L is invented. |
| 5. FIFO lifecycle | Partial reduction, scale-in, full liquidation, re-entry, cross-month holding and an open final lot have exact known answers. Entry/exit fees and slippage reconcile; open exit fields remain null. Tiny-quantity/high-price regression prevents phantom residual lots. |
| 6. Drift | Daily quantity/price/weight evidence distinguishes drift from fills. Existing source P0 tests exercise drift through both 2.5% and 3% construction floors without forced trades. The new projection emits no fill on those days, and retains zero inventory through cash with unavailable prices explicitly null. |
| 7. Financial reconciliation | Fill prices/notionals, signed quantity/cash, daily charges, market P&L, cash income, net P&L and NAV reconcile to the unchanged source. Known-basis FIFO realized + unrealized net P&L + cash income reconciles to portfolio net P&L. Source engine/hash objects remain unchanged. |
| 8. Prices/time/units | `SIMULATED_ADJUSTED_CLOSE`, `NEXT_OBSERVED_CLOSE`, `NOT_AVAILABLE_EOD` and NAV/index units appear in UI/API/export. No broker/intraday timestamp or terminal close is fabricated. |
| 9. Legacy/access/export | Missing/ambiguous causes are UNCLASSIFIED; carried initial basis is unknown. Failed/pending attempts cannot supply a blotter. Attempt/run mismatches and inconsistent provenance fail closed. Actual authenticated route tests deny JSON/CSV without a token, reject a cross-run attempt and reject arbitrary query/path fields before result access. Client rejects foreign URLs before reading its token. |
| 10. Regression/UI/performance | P0 91/91 suite passes. Chromium exercises real component + authenticated route, signal/execution filtering, symbol/side/sort, CSV, FIFO links, open lots, drift and pagination over 1,601 fills. Widths 360/390/430/768/1440 have no page overflow; all three views captured at 390/1440. |
| 11. Private certification | Pending and separate: approved isolated Replit checkout/database, exact private user campaigns, actual PostgreSQL integrity/durability and production worker/runtime/browser validation on the reviewed feature SHA. No production database or Replit app was accessed. |

The browser harness mounts the actual component inside an isolated test page; it does not certify the entire deployed application shell. Production frontend/backend builds and project typechecks pass. Legacy source-only audit debt (the prior ledger snapshot text assertion) is documented in P0 and was not changed or presented as repaired by this feature.

No optimizer, risk, HMM, financial ledger, price dataset, transaction-cost convention, run identity, historical financial result or saved attempt was modified. There is no merge or deployment authorization.
