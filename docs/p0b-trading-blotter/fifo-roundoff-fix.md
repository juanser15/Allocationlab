# PR #6 FIFO roundoff correction

Starting commit: `0617e7b565806bc17e86688bcfbf3d17eb700575`. This increment changes only the read-only FIFO projection, its tests and documentation. PR #3's engines, ledgers, financial result identities and private saved runs are untouched.

## Reproduction

The owner reported XLF `1.1102230246251565e-16` and XLY `1.3877787807814457e-17` shares against true zero closing inventory. The old final check multiplied these residuals by `1e-10`, producing tolerances of approximately `1.11e-26` and `1.39e-27`. A nonzero residual compared only with itself cannot pass such a relative check.

`node scripts/reproduce-p0b-fifo-roundoff.mjs` replays pinned pre-fix source with diagnostic observation immediately before its unchanged assertion. Invented target-quantity sequences reproduce both exact residual magnitudes and `FIFO open quantities do not reconcile.` See `fifo-roundoff-before.json`. These sequences do not reproduce or disclose the private backtests/prices. Before implementation, the two flat-book tests and a positive-tiny-inventory test failed against the prior implementation.

## Quantity policy

Reporting version is now `institutional-fifo-blotter-1.0.1`. Only derived blotter hashes/IDs change with this reporting version. The source run ID, attempt ID, code/data provenance, ledger checksum and original financial result hash remain unchanged.

For each ETF independently, track the initial source quantity and actual executed fill quantities, in chronological order:

- `Q = abs(initial quantity) + sum(abs(actual fill quantities))`, accumulated with Neumaier compensated summation.
- `P = max(initial quantity, actual beginning/ending inventory at traded sessions, absolute fill quantity)`.
- `n` is a conservative count: eight initial operations, eight per source fill, four per FIFO match, plus the active-lot summation allowance.
- With binary64 machine epsilon `eps`, `gamma = n*eps/(1 - n*eps)` and `quantity_tolerance = min(gamma*Q, 1e-10*P)`.

This uses a conservative standard forward-roundoff bound for accumulated quantity arithmetic, capped at the existing relative quantity margin on the actual peak book. No fixed absolute share allowance or one-share floor exists. The cap deliberately rejects uncertainty exceeding that margin rather than treating an arbitrarily long history as permission to absorb a large difference. An ETF cannot borrow another ETF's larger reference scale. Nonfinite/unavailable bounds fail closed.

The final comparison uses this recorded historical context, not the residual as its scale. Actual source ending quantity remains authoritative. Positive source inventory must still have positive FIFO inventory and is never normalized to zero merely because it is below a historical tolerance. Local epsilon consumption is restricted to an actual final SELL whose source session ends flat. This preserves partial exits and legitimate tiny holdings, including tiny quantities following a larger book.

## Flat-book normalization and accounting

At the final actual SELL for a symbol/session, a residual can be normalized only when the original ledger explicitly ends with zero inventory. Both the quantity bound and a separate monetary-materiality check must pass. Residual principal value and fees/slippage must be within the unchanged reporting money tolerance; high-price material differences fail even if their share count is small. Undersold/oversold material inventory continues to fail.

The correction empties only the reporting lot queue; it never changes a source fill, quantity, price, cash balance or NAV. Residual entry basis/cost is assigned to the same lot's match on the existing closing fill. If that match has not yet been represented, a separately identified roundoff match references that real closing fill and original lot. There is no new execution or invented closing date/reason. An excess-sell rounding remainder can only be absorbed into an existing match for that actual closing fill, with all recorded exit costs retained.

Every adjustment is exposed in `reconciliation.fifo_quantity_policy.adjustments`, including ETF, session, real fill/lot/match references, quantity allowance and remaining charges. Per-ETF evidence records the historical scale, peak, operation count, source ending quantity and FIFO ending quantity. Consequently FIFO lot allocations can differ from source fill quantities by the explicitly audited roundoff amount; execution rows remain exactly 1:1 with the unchanged source fills. Known-basis realized/unrealized P&L, allocated costs, cash and NAV retain the existing reconciliation checks. A material discrepancy is not hidden by normalization.

Normalization occurs at each confirmed flat close, so residuals cannot survive into a later re-entry. Nonzero closing inventory retains its open lots. Initial unknown cost basis remains unknown. The implementation does not clamp market drift, call an optimizer, change the trading clock or rerun a backtest.

## Regression evidence and private handoff

`fifo-roundoff-tests.json` records the new XLF/XLY regressions, full liquidation, oversell rounding, partial exit/re-entry, material quantity/monetary mismatch rejection, tiny/high-price holdings, independent per-ETF scales, 1,800 sessions and deterministic source preservation. All original P0B and P0 suites run alongside these cases. The authenticated existing endpoint is tested by reprojecting saved analytical results with submit/rerun methods forbidden.

Private acceptance remains with Replit: deploy/apply this reviewed reader correction only in the already-isolated validation environment, then GET the blotter for the two already-saved successful 2.5%/3% full-history attempts. Verify authenticated HTTP 200, no phantom open lots for source-flat XLF/XLY, per-ETF quantity evidence, fee/P&L reconciliation and source run/attempt/ledger/result identities. Follow with browser/CSV/pagination checks. **Do not rerun P0 backtests, migrate stored results, write to the live database or change PR #3.** No private runtime success is claimed by this source-only correction.
