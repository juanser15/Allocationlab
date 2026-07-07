# Allocation Lab v2

A browser-based portfolio allocation reporting tool for internal investment research teams and non-technical analysts.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/allocation-lab run dev` — run the frontend (port 18596)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite, Recharts, shadcn/ui, Tailwind CSS, wouter

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/db/src/schema/` — Drizzle schema (config, priceData, sessions tables)
- `artifacts/api-server/src/lib/calculator.ts` — Core calculation engine (factors, regime, allocation)
- `artifacts/api-server/src/routes/` — API route handlers
- `artifacts/allocation-lab/src/pages/` — React pages (investment-committee, portfolio-construction, results-dashboard, reports, methodology)

## Architecture decisions

- **No placeholder data**: The app blocks pipeline execution if no price data has been uploaded. Factor scores are always computed from real uploaded prices — never synthetic.
- **CSV-first price ingestion**: Users upload a CSV with Date as first column and ticker symbols as headers. The server validates ≥21 rows before accepting.
- **In-memory config defaults**: Universe and constraints configs have defaults baked into the route handlers and are persisted to a `config` table as JSON blobs. No migration needed to change defaults.
- **Calculation engine is pure TypeScript**: `calculator.ts` contains all factor math (momentum, trend quality, realized vol, drawdown, mean reversion), regime estimation (trend/breadth/vol/liquidity), and the allocation constructor — no Python, no external processes.
- **Score scale**: All factor and regime scores are 0–100 cross-sectional ranks, never uniform. ETFs without enough price history are excluded.

## Product

- **Investment Committee**: One-click run with 6 visible pipeline steps. Shows data status banner and last run summary.
- **Portfolio Construction**: Edit ETF universe (17 ETFs default), prior weights, allocation constraints, upload price CSV.
- **Results Dashboard**: Regime card, cash card, donut chart, factor heatmap (color-coded 0–100), allocation table with changes vs. prior month, download buttons.
- **Reports**: Session history with downloadable CSV reports.
- **Methodology**: Factor/regime documentation + 10-cycle build progress checklist.

## Default Configuration

- **ETF Universe**: XLK 9%, XLC 8.5%, XLRE 5.5%, XLI 5%, XLY 4.5%, XLF 4.5%, XLU 4.5%, XLE 4.5%, Cash 54% (+ XLV, XLB, EEM, EWJ, AAXJ, EWC, EWB, EWG, EUFN at 0%)
- **Constraints**: Cash 50–60%, max ETF weight 10%, min inclusion threshold 5, target active ETFs 8, diversification enabled

## User preferences

- Institutional UI: white, navy (#1B2F5B), gray palette. No emojis. Inter font.
- Non-technical users must be able to use it without Python or CLI.
- Minimum 8 active ETFs in output.
- Max 10 planned build iteration cycles (tracked on Methodology page).

## Gotchas

- After any schema change in `lib/db/src/schema/`, run `pnpm --filter @workspace/db run push` then `pnpm run typecheck:libs` before typechecking the api-server.
- The `calculator.ts` engine requires ≥21 rows of price data; will error gracefully with a 400 if fewer rows are provided.
- The `run.ts` route imports `eq` from `drizzle-orm` at the bottom of the file (not top) — this is intentional to avoid circular dependency issues with the shared getters.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
