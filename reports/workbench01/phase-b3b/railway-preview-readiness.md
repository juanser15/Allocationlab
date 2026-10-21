# Railway owner preview requirements

This change is ready for owner review only after the accompanying test/browser evidence passes. No deployment, PR or merge is performed by this phase.

Use the existing frontend and Express API behind one HTTPS origin. Serve the Vite production assets with SPA fallback for `/workbench`; forward `/api/**` to the existing API without stripping `/api/workbench`. The new designer uses the ordinary V2 routes, including `POST /api/workbench/plan`. Do not redirect it to the legacy V1 fixture routes.

Required API runtime configuration:

- `WORKBENCH_PREVIEW_TOKEN`: an owner-generated high-entropy secret, server-side only. Never use a `VITE_` variable or frontend build argument for it. Access fails closed when absent.
- `WORKBENCH_RUN_DIR=/tmp/allocationlab-workbench-runs`: writable temporary storage outside the repository and certified artifacts. No durability claim or new database is introduced.
- `NODE_ENV=production` and Railway's provided `PORT`.
- `DATABASE_URL`: retain the existing API application's normal database configuration. The Workbench itself uses the existing filesystem run store.

Use the repository's existing installed toolchain and frozen lockfile. Build the backend with `node artifacts/api-server/build.mjs`; start `node --enable-source-maps artifacts/api-server/dist/index.mjs`. Preserve the separately built Workbench worker and the source/data files required by the certified repository-marker and snapshot checks. Git metadata is not required at runtime.

Build the frontend from `artifacts/allocation-lab` with `BASE_PATH=/`, a valid build-time `PORT`, and the existing `vite build --config vite.config.ts` command. Publish `artifacts/allocation-lab/dist/public` through the existing preview serving arrangement. No Railway path or configuration workaround is added.

The production-build browser acceptance uses a test-only same-origin static gateway, the actual built API/worker and a fresh isolated temporary run store. It injects a randomly generated test token without exposing it to the build. The existing `VALIDATION_JOB_WORKER_DISABLED=1` switch disables unrelated database-backed validation-job supervision in that test; it does not disable or replace Workbench execution. Production keeps its existing validation-service configuration.

Owner checks: open `/workbench`, verify all seven financial/calendar fields are empty, enter a supported design, preview and review the fold map, acknowledge it, run, inspect results, rerun and compare. Check that editing any field invalidates the plan. History remains temporary and research-only, with data vintages not independently verified.
