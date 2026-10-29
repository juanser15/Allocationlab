The backtest workspace lacked a verifiable fill and position-lifecycle view. This feature adds an Execution Blotter, FIFO Round-Trip Trade Blotter and Position Drill-down over the existing immutable daily ledger, with recorded causes distinguishing portfolio rebalances from HMM/capital exposure changes.

Implements source-only work for #5. Based on reviewed P0 commit `afead86bb66dff84eae19b855b9572ee726422c2`; this independent feature PR targets `fix/p0-cardinality-aware-optimizer`. PR #3, main and the active Replit application remain unchanged.

- Read-only, attempt-pinned authenticated JSON/CSV endpoint; explicit successful-attempt selection, filters, sorting, bounded pagination/export and linked FIFO/position inspection.
- Deterministic FIFO handles partial exits, scale-ins, liquidation/re-entry, open lots and unknown initial basis. Charges reconcile to daily totals; realized plus unrealized net P&L reconciles to equity price P&L less recorded fees/slippage, with cash income separate.
- Reasons use recorded event joins. Joint events retain both causes; missing historical causes remain UNCLASSIFIED. Adjusted-close prices and unavailable intraday time are explicit. Market drift creates no trade.
- Independent reporting version/hash binds the ledger, saved spec, run and attempt. No financial engine, optimizer, ledger, HMM, costs, original result or run identity was changed. All 1,201 other baseline files are byte-identical, including 169 financial/workbench source files.

Validation: **116 source-only tests passed**, including all existing P0 91/91 and 25 new reporting/API/UI tests. Chromium passed **18 checks** including 360/390/430/768/1440 widths, filtering, sorting, CSV, linked lots and 1,601-fill pagination. Backend/frontend typechecks and production builds pass. Existing bundle-size/sourcemap warnings remain.

Evidence: `docs/p0b-trading-blotter/{README.md,acceptance.md,test-results.json,browser-acceptance.json,preservation.json,screenshots/}`. Browser evidence uses the real component and authenticated route with synthetic data and an injected read-only store, not the deployed application. Private historical/PostgreSQL/worker/full Replit runtime certification remains separate. Prior P0 supplementary byte-comparison test debt is unchanged.

Draft for review only. No merge, deployment, live database writes, Replit change or private dataset publication.
