# P0B Institutional Trading Blotter

Contract: [Issue #5](https://github.com/juanser15/Allocationlab/issues/5). Starting commit: `afead86bb66dff84eae19b855b9572ee726422c2`. Independent feature branch: `feat/p0b-institutional-blotter`; integration base is `fix/p0-cardinality-aware-optimizer` at the reviewed P0 tip. PR #3 and its evidence are unchanged. This feature is a read-only projection, not an execution change.

The backtest workspace now has a **Blotter** tab, also reachable from Results, History and Audit, for both portfolios and independent SPY/cash studies. It exposes Execution Blotter, Round-Trip Trade Blotter and daily Position Drill-down. Attempts are selected explicitly; a failed/latest incomplete attempt never silently displays an earlier successful blotter. Successful earlier attempts remain available through the selector.

Tables have contained scrolling, 50-row pages, bounded server pagination, symbol search, side/reason/status filters, signal or execution-session date filtering, sorting and filtered CSV export. Execution details link to their FIFO lots. Position details link to recorded fills for that session; drift alone produces none. Recorded HMM state/probability/multiplier, strategic target, effective target, realized weight and cutoff holdings are shown where available. IDs and original event records remain under expanded audit details.

## Reporting methodology

- Each nonzero immutable `ledger.trades[]` entry becomes exactly one fill, identified by run, attempt, ledger checksum, day index and trade index. Zero observations never become fills.
- Price is signed notional divided by signed quantity. It is cross-checked against the recorded ending position close where available and against daily mark-to-market reconciliation. A full exit may have only its recorded notional/quantity ratio; `price_verification` states this explicitly. No OHLC, raw-price, market-open or broker fill is reconstructed.
- Price basis is the existing `SIMULATED_ADJUSTED_CLOSE` / `NEXT_OBSERVED_CLOSE` research convention. Clock time is `NOT_AVAILABLE_EOD`. Price units are adjusted-price units. Cash, costs and P&L use simulated NAV/index units, starting at 100, never an assumed currency.
- Each day's recorded fee and slippage totals are allocated by absolute actual traded notional. The largest-notional fill receives the floating-point residual; the first such fill wins a tie. No cost rate or trading cost is changed.
- FIFO creates a new lot for each BUY. SELL fills consume oldest lots first and may produce several matched records. Scale-ins, partial exits, liquidation and re-entry retain separate identities. Entry charges are apportioned to matched quantity; final consumption absorbs its remaining charges. Exit charges similarly reconcile to their source fill. The implementation uses queue cursors rather than repeated array shifts.
- Closed gross P&L is `matched quantity * (exit price - entry price)`. Net P&L deducts allocated entry/exit fees and slippage. Open gross unrealized P&L uses the last recorded adjusted close; net unrealized deducts remaining entry charges only, with no assumed liquidation cost. Open exits remain null.
- Net return on invested cost divides net matched/open P&L by entry notional plus entry fees/slippage. It is neither daily portfolio return nor alpha. Holding sessions count observed ledger intervals; calendar days use session-date differences, not fabricated intraday times.
- Pre-existing inventory without original entry evidence has `UNKNOWN_INITIAL_BASIS`: entry date/price, entry costs and related P&L remain null. Quantity/cash/NAV reconciliation still runs. A full FIFO P&L claim is `NOT_SUPPORTED_UNKNOWN_INITIAL_BASIS`.
- Quantity accounting uses the history-scaled forward-roundoff policy described in `fifo-roundoff-fix.md`, capped at the existing `1e-10` relative peak-book margin. True-zero closing inventory can absorb explicitly audited dust; positive inventory is never erased by a local epsilon. Financial comparisons use `1e-8 * max(1, abs(a), abs(b))`. Original fills and ledger numbers are never rounded or changed.

## Verifiable reasons

Reasons join `executionSignalDate` to a unique recorded capital signal with the matching execution session and a prior information cutoff, plus the matching scheduled decision. They are never assigned from BUY/SELL direction alone. Scheduled first entry is `INITIAL_ALLOCATION`; subsequent scheduled changes are `SCHEDULED_REBALANCE`. Capital-only changes use HMM reduction/increase/exit/re-entry codes for saved HMM runs and `CAPITAL_RULE_*` otherwise.

`JOINT_REBALANCE_AND_EXPOSURE` requires recorded portfolio construction and an operative capital change on that decision. Changes in optimized exposure alone, or unbinding HMM probability changes, do not establish joint causation. Joint events retain both causes and do not allocate P&L to a unique hypothetical cause. Missing/ambiguous historical provenance is `UNCLASSIFIED`. Market/NAV drift is an observed position state, never an invented execution reason.

Strategic construction limits remain scoped to scheduled pre-HMM NAV targets. The blotter distinguishes these from commanded effective targets, source-cutoff holdings, previous-close holdings and realized positions. It neither corrects drift nor issues any order.

## Source binding and preservation

`institutional-fifo-blotter-1.0.1` has an independent ledger checksum, projection-content hash and source-bound blotter hash. Re-projecting identical input reproduces all rows and hashes. A different execution attempt has different fill/lot identities and blotter hash, while the same source spec/ledger/evidence has the same content hash. Stored source run/result hashes remain unchanged. Mismatched result run/attempt, recorded engine or dataset identities fail closed.

Only the existing route-registration file and frontend workspace integration are edited; new reporting modules are not imported by run normalization, financial execution or the worker. The engine, optimizer, capital clock, ledgers, costs, existing source configurations, datasets and historical evidence remain byte-identical to the reviewed baseline. See `preservation.json`.

## API and access

`GET /api/workbench/p0/runs/:runId/attempts/:attemptId/blotter`

Allowed query fields: `view=executions|lots|positions`, `page`, `page_size` (1–100), `symbol` (substring), `side`, `reason`, `status`, `from`, `to`, `date_field=signal_date|execution_session_date` (executions only), `fill_id` (FIFO lots only), `sort`, `direction=asc|desc`, `format=json|csv`. Unsupported fields/combinations fail with 400. Lot date filters use exit session for closed lots and entry session for open lots. Unknown dates cannot satisfy a date filter. CSV exports all matching records, not just the visible page.

The endpoint verifies attempt membership and SUCCESS status, then reads the existing integrity-checked immutable result. It does not start a worker, submit a run, migrate evidence, write a sidecar, query market data or write database records. It inherits the existing preview access gate; source tests use injected tokens and disable the existing explicit open-preview mode. Both JSON and CSV require the same access. The client sends bearer tokens only in headers to its fixed same-origin path and rejects foreign URLs before reading the token.

Reporting capacity: at most 50,000 ledger days, 250,000 fills/position rows, page size 100, JSON/CSV responses at most 12 MiB, CSV at most 50,000 rows. Linked lot previews are limited to 100; the linked FIFO filter provides full pagination/export. No queue or new persistence service is introduced.

## Validation and limits

```sh
node scripts/test-p0b-blotter.mjs
node scripts/test-p0b-browser.mjs /tmp/allocationlab-p0b-browser
node scripts/test-optimizer-repair.mjs
node scripts/test-capital-clock.mjs
node scripts/test-backtest-range.mjs
node scripts/test-execution-runtime.mjs
```

The browser harness mounts the real component and calls the real authenticated route against explicitly synthetic immutable fixtures and an injected read-only store. It is not a replacement frontend or a claim about the deployed Replit app. The 1,601-fill scenario checks real pagination. Screenshots are labelled synthetic and contain no owner token or private prices. See `test-results.json`, `browser-acceptance.json` and `acceptance.md`.

Private historical 22-ETF, PostgreSQL/production-worker and complete deployed-app certification remain separate. Apply only the reviewed repair/feature delta to an approved isolated copy of the original Replit lineage after owner approval. Never merge the source-only snapshot wholesale or modify the active application/database as part of this feature.

The incremental FIFO correction and its current test evidence are in `fifo-roundoff-fix.md` and `fifo-roundoff-tests.json`. Original `test-results.json` remains the historical feature baseline.
