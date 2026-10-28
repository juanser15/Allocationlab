# Replit platform update

## Source and preservation
- Upstream: `juanser15/Allocationlab`, `render-preview`, `e8b3450caa14e7a2e1cc32ac6390f869ee765eaa`.
- Merged into this existing workspace, retaining local research documentation and historical evidence.
- Existing PostgreSQL connection retained. No reset, destructive schema push, table replacement, or financial run was performed.
- Exact legacy counts before/after: price_data 21; sessions 40; prepared_inputs 57; allocations 63; validation_runs 171; config 3.

## Runtime
- Existing Replit artifact services jointly serve the app: frontend at `/`, API at `/api`.
- Frontend production build: `pnpm --filter @workspace/allocation-lab run build`; static output `artifacts/allocation-lab/dist/public` with SPA fallback.
- API production build: `pnpm --filter @workspace/api-server run build`; runtime `node --enable-source-maps artifacts/api-server/dist/index.mjs`.
- Keep the existing managed PostgreSQL database attached. Dataset initialization applies only the additive `0003_persistent_dataset_library.sql` migration.
- PostgreSQL stores compressed dataset payloads, metadata, immutable versions, active workspace selection, and run-to-dataset references.
- The four runtime-created tables are also declared in Drizzle so schema-aware deployment tools recognize them.
- `/` opens `/workbench`; `/legacy` retains the old dashboard.
- Explicit temporary open-preview flags: `WORKBENCH_PREVIEW_OPEN=1` and `VITE_WORKBENCH_PREVIEW_OPEN=1`. Default code behavior remains token-protected when the flags are removed; rebuild the frontend when changing its flag. Open preview does not provide per-user access isolation.

## Verification
- Full workspace typecheck and production frontend/API builds passed.
- Eight focused dataset/calendar tests passed.
- Browser verified token-free navigation, Data & Universe, Capital Exposure, Backtesting, reload persistence, and mobile access.
- Internal dataset ID/hash survived API restart.
- Valid capital-exposure design request returned HTTP 200 with selected dataset identity; empty dates now return HTTP 422 rather than an upstream date-arithmetic crash.
- No financial-engine formulas were altered; calendar validation only rejects invalid inputs before arithmetic.

## Unresolved external verification
- Live Yahoo fetch of SPY returned upstream HTTP 429. Error text now exposes ticker/provider status; no substitute data is saved or activated.
- Fresh Yahoo save/activate/download end-to-end verification remains blocked by provider throttling. Unit tests use explicit test responses, not production data.
- Dataset and workspace persistence are PostgreSQL-backed. Upstream workbench execution outputs still have their separately declared temporary-storage lifecycle; this update does not claim they became a permanent run archive.
- Not published. The existing Replit multi-service deployment configuration is retained; production publishing and its schema review remain explicit user actions.
