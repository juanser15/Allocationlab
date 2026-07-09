---
name: Explicit date-range params alongside lookback defaults
description: Convention for adding optional startDate/endDate to endpoints that default to a rolling lookback window (e.g. lookbackDays)
---

When an endpoint defaults to a rolling lookback window (e.g. `lookbackDays=400` computed from "today"), add optional `startDate`/`endDate` (ISO date strings) as an alternative, not a replacement:

- Keep `lookbackDays` as the fallback when neither explicit date is provided.
- `endDate` defaults to "today" if only `startDate` is given; `startDate` is derived from `endDate - lookbackDays` if only `endDate` is given.
- Validate: reject invalid date strings, and reject `startDate >= endDate`, with 400s and clear messages.
- Frontend UX: show a "From"/"To" date pair next to the default action button, with a reset link ("Use default (last N days)") that clears both fields back to lookback behavior.

**Why:** This mirrors the pattern already used for backtest date filtering (`GET /api/backtest`), so the two date-range features (data download vs. backtest range) stay conceptually consistent without forcing users to always pick explicit dates.

**How to apply:** Applied to `POST /api/prices/live` (Allocation Lab) — `LivePricesFetchInput` schema in OpenAPI, `fetchLivePrices()` in `yahoo.ts`, and the Portfolio Construction "Refresh Market Data" UI.
