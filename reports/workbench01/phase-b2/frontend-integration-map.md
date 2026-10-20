# Phase B2 frontend integration map

## Existing architecture reused

Phase B2 uses the existing `artifacts/allocation-lab` React, Vite and TypeScript application. Routing remains Wouter, server state remains TanStack React Query, response validation uses Zod, and charts use Recharts. No dependency, package manifest, lockfile, router, state library, CSS framework, or frontend project was added.

`/workbench` is an isolated outer route in `src/App.tsx`. All existing routes remain inside the unchanged legacy layout, including `/`; the Workbench does not replace or redirect the root route.

| Concern | Integration |
| --- | --- |
| Page | `src/pages/workbench.tsx` |
| Page styles | `src/pages/workbench.css` |
| Typed API and Zod schemas | `src/lib/workbench-api.ts` |
| Strict spec, polling and presentation helpers | `src/lib/workbench-state.ts` |
| Frontend contract tests | `src/lib/workbench.test.ts` |
| Route registration | `src/App.tsx` |
| Preview API guard | `artifacts/api-server/src/lib/workbench/preview-access.ts` |
| Guard mount | `artifacts/api-server/src/app.ts` |

## Data flow

The browser obtains a token from the owner and keeps it in `sessionStorage`. The typed client attaches it as a Bearer credential to same-origin `/api/workbench/**` requests. Capabilities are fetched and validated before the execution form is enabled. A submission contains only the five Phase B1 fields. Terminal results, attempt history, time series, folds and comparison values are rendered from API responses; the browser performs no financial calculations or run identity logic.

Polling is bounded to one request every two seconds while status is `PENDING` or `RUNNING`, stops on every terminal state, and stops after five minutes with a manual-refresh path. HTTP 429 never starts an automatic retry.

## Scope retained

The page exposes only `CAPITAL_MARKET_EXPOSURE`, `SPY`, `EMPIRICAL`, `TRADITIONAL_WALK_FORWARD`, the fixed 2020-01-01 to 2024-01-01 end-exclusive window, monthly rebalance, and transaction costs of 0 or 5 bps. Unavailable modes are summarized outside the primary workflow and have no decorative controls.
