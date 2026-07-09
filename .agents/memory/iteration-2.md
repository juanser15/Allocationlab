---
name: Allocation Lab Iteration tracking
description: Tracks which build iteration the app is on and what has been completed vs. planned
---

## Current state
Iteration 8 of 10, completed 2026-07-09. (Note: an earlier memory entry said "5 of 5, extended" — the roadmap cap is 10, not 5; trust `CURRENT_ITERATION`/`MAX_ITERATIONS` constants in investment-committee.tsx and methodology.tsx as the source of truth if this drifts again.)

## Completed
1. Core UI scaffold & navigation
2. Price data upload & live Yahoo Finance integration
3. Factor computation engine (8 factors)
4. Regime estimation & allocation constructor
5. Results dashboard with factor heatmap
6. Report generation (CSV + PDF)
7. Session history & reporting
8. 10-component Market Health module + IC Summary + Watchlist
9. Portfolio Diagnostics (vol, HHI, ENB, risk contributions, correlation heatmap, tracking error)
10. ETF Explorer (price chart, factor breakdown, score history, IC narrative, clickable links)
11. Backtesting workspace (equity curve, return/vol/Sharpe/drawdown/turnover, monthly returns, benchmark comparison, contribution summary)
12. Committee Report Builder: editable title/subtitle/date/portfolio/note, quality checklist, preview mode, one-page landscape PDF/PNG/CSV export
13. PM Decision Room: Market View/Key Risks/Portfolio Actions/Watchlist/Trade List cards with per-trade rationale generated from factor+regime data, plus an auditable Decision Log (draft/under_review/approved workflow, JSONB content snapshot)
14. Historical Archive: browse every saved rebalance (list + filters by date/regime/status/portfolio name), open one in full detail, compare any two side by side (cash, regime, turnover, realized return, per-ticker weight/factor deltas with rationale), export PDF/PNG/portfolio CSV/changes CSV

## Planned next
- Dollar & Rates components (add DXY, IEF/TLT to universe)
- Live regime alerts & notification rules

## Decision Log design note
**Why:** the Decision Log must be an audit trail, not a live view — content is generated once (via `buildDecisionLogContent` in calculator.ts) and persisted as a JSONB snapshot on first GET for a session, then never regenerated automatically.
**How to apply:** if allocation/rationale logic changes later, existing decision logs will keep their original snapshot; only new sessions get the updated rationale. Status transitions are restricted (draft→under_review→approved, with a manual revert-to-draft escape hatch) — see `FORWARD_TRANSITIONS` in `artifacts/api-server/src/routes/decision-log.ts`.

## Backtesting design note
**Why:** all sessions are run "now" against uploaded historical CSV data, so no price data exists after the last session — scoping the backtest window to dates ≥ first session's runAt yields 0 tradeable days. Fix: use the entire uploaded price history and backdate the earliest session's weights to pre-existing dates, disclosed via an explicit `methodologyNote` in the API response.

**How to apply:** when adding any new time-series analytics tied to session run timestamps, check whether price data actually postdates the sessions before assuming a "run date forward" window will have data.

## Architecture decisions made in Iteration 2
**Why:** `EnrichedRegimeScores` extends the old `RegimeScores` shape — existing DB sessions lack `components`, `confidence`, `drivers`. The `/results/latest` route back-fills these with safe defaults so old sessions don't crash. Re-running the pipeline produces full enriched data.

**How to apply:** If adding more fields to `RunResult`, always back-fill in the GET handler in `run.ts` to avoid breaking old sessions stored as JSON in `sessionsTable.resultJson`.
