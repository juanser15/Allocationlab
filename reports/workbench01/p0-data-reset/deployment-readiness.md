# P0 deployment recommendation — owner review required

Deployment is blocked pending the mandatory live Yahoo acceptance gate. No Render service configuration, deployed branch, database connection or production instance was changed by this phase. No automatic deployment is authorized.

Development is isolated on `p0-data-workspace-reset` from the latest functional Render-preview baseline. Do not reset `workbench-v1`, `render-preview` or `main` to publish it. Owner review must decide how to reconcile the dedicated branch while retaining the existing Render product changes and historical evidence.

## Storage and runtime requirements

1. Configure `DATABASE_URL` to an existing or owner-provisioned **durable PostgreSQL database** reachable by both the API and its child worker. Keep the same database across instance replacements and redeploys. Do not use an in-container `/tmp` database as production storage.
2. Ship `lib/db/migrations/0003_persistent_dataset_library.sql` in the runtime repository tree. Startup lazily applies its additive tables/triggers under a transaction/advisory lock. The database role needs the corresponding create-table/function/trigger privileges on first initialization. Existing tables and historical evidence are not migrated or rewritten.
3. Retain the committed repository marker files, identified financial source/configuration files, internal reference CSV and P0 identity source files in the runtime image. Ship the built `workbench-p0-worker.mjs` beside the existing workers. A dist-only image is insufficient for the current verified root/identity contract. Git metadata is not required.
4. Set a strong server-only `WORKBENCH_PREVIEW_TOKEN`. Keep `WORKBENCH_PREVIEW_OPEN` unset or `0`; the inherited Render launcher can otherwise inject backend authorization for visitors. Never use its open-preview mode for this persistent owner workspace. Do not put the token in Vite variables or reports.
5. Preserve the existing bounded execution settings and dedicated `WORKBENCH_RUN_DIR` outside repository/source paths. This directory remains temporary run storage; it is not the dataset store. Do not increase capacity defaults as part of this data reset.
6. Allow outbound HTTPS to the fixed Yahoo chart host. The managed development network currently returns CONNECT 403; its saved host-allowlist draft must be published by the owner before live acceptance can be completed.

## Build and start arrangement

Use the repository's existing pnpm toolchain and frozen lockfile. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/allocation-lab typecheck
pnpm --filter @workspace/api-server build
PORT=5173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/allocation-lab build
node scripts/render-preview.mjs
```

The existing launcher serves `artifacts/allocation-lab/dist/public`, redirects its root to `/workbench` and forwards same-origin `/api` to the built API on loopback port 3001. Render supplies public `PORT`; no new server framework or separate frontend is required. Use the server environment for `DATABASE_URL` and the preview secret, with `WORKBENCH_PREVIEW_OPEN=0`. An isolated Workbench preview may retain the existing `VALIDATION_JOB_WORKER_DISABLED=1` configuration to stop the unrelated legacy validation supervisor; do not silently alter an existing deployment's other services.

## Acceptance available

The recorded PostgreSQL integration passes persistence, explicit activation, immutable version protection, exact CSV hashes, pinned worker identity, changed-active-state isolation, API restart and clean-runtime reconstruction. Chromium tests record the four required Data screens at 390px and 1440px, no page overflow, module-navigation/browser-refresh persistence and no data-module cross-navigation actions. Those provider calls were explicitly labelled test fixtures built from committed historical observations. Build/typecheck/test command outcomes are recorded separately in `test-results.json`; do not infer them from this recommendation.

Before any deployment recommendation can become actionable, run actual Yahoo SPY and model-universe downloads through the production retrieval path, inspect QA, save and activate, restart against the same durable database, and execute research with the same recorded ID/hash. Confirm the deployed environment also retains the library and active selection after instance replacement. The clean-runtime local test supports the persistence architecture but does not verify a Render database that has not been accessed in this task.

The unresolved status is `LIVE_YAHOO_ACCEPTANCE_BLOCKED_NETWORK_POLICY`. Local fixture-based success must not be relabelled as live-provider success or used to bypass this gate.

## Existing ephemeral downloads

No old CSV, browser snapshot or saved run is silently imported or rewritten. Before replacing an existing instance, export any owner Yahoo versions that exist only in its old temporary directory. This P0 branch does not delete those files, but their previous ephemeral retention contract is not converted automatically. New saves use the persistent library; old result reads remain on their historical routes. Do not discard owner data during branch reconciliation.
