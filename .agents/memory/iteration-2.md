---
name: Allocation Lab Iteration tracking
description: Tracks which build iteration the app is on and what has been completed vs. planned
---

## Current state
Iteration 2 of 10 (max), completed 2026-07-09.

## Completed
1. Core UI scaffold & navigation
2. Price data upload & live Yahoo Finance integration
3. Factor computation engine (8 factors)
4. Regime estimation & allocation constructor
5. Results dashboard with factor heatmap
6. Report generation (CSV + PDF)
7. Session history & reporting
8. 10-component Market Health module + IC Summary + Watchlist

## Planned next (Iteration 3)
- Historical regime trend chart (rolling composite over time)
- Session comparison view (diff two runs)
- Dollar & Rates components (add DXY, IEF/TLT to universe)

## Architecture decisions made in Iteration 2
**Why:** `EnrichedRegimeScores` extends the old `RegimeScores` shape — existing DB sessions lack `components`, `confidence`, `drivers`. The `/results/latest` route back-fills these with safe defaults so old sessions don't crash. Re-running the pipeline produces full enriched data.

**How to apply:** If adding more fields to `RunResult`, always back-fill in the GET handler in `run.ts` to avoid breaking old sessions stored as JSON in `sessionsTable.resultJson`.
