# Railway owner preview requirements

No deployment, merge, PR, root-route replacement, new model family or ETF allocation is performed in B3C. This is an owner research preview, with the existing preview token boundary and temporary storage.

Retain the existing same-origin HTTPS setup: SPA fallback for `/workbench`, Vite production assets, and `/api/**` forwarded unchanged to the existing Express API. The designer uses ordinary V2 routes. The legacy `/api/workbench/v1/**` boundary remains certification-only.

Required API environment:

- `WORKBENCH_PREVIEW_TOKEN`: owner-generated secret, server-side only. Never a frontend build argument or `VITE_` variable. The existing guard fails closed if absent.
- `WORKBENCH_RUN_DIR=/tmp/allocationlab-workbench-runs`: writable temporary storage outside the repository. Original runs and versioned attribution sidecars remain temporary; no durability claim.
- `NODE_ENV=production`, Railway's runtime `PORT`, and the existing API's `DATABASE_URL` configuration. Workbench research continues using its filesystem store, without a new database.

Build with `node artifacts/api-server/build.mjs`; start `node --enable-source-maps artifacts/api-server/dist/index.mjs`. Preserve the separately built Workbench worker and committed source/configuration/dataset files required by the existing root-marker and data/code checks. The three new `exposure-*.ts` post-processing modules must remain in the runtime source tree so their benchmark code identity can be verified. Git metadata is not required. No Railway configuration workaround is introduced.

Build the existing frontend in `artifacts/allocation-lab` with `BASE_PATH=/`, a valid build-time `PORT`, and the installed `vite build --config vite.config.ts` command. Serve `artifacts/allocation-lab/dist/public` with the existing preview arrangement. There are no new packages or lockfile changes.

The browser acceptance starts the actual production API/worker and production frontend behind a test-only same-origin gateway, with an isolated run directory and a randomly injected token. The token is never written into reports, screenshots or build assets. It uses the existing `VALIDATION_JOB_WORKER_DISABLED=1` switch only to suppress unrelated database-backed supervision during the isolated test; the Workbench worker still executes actual empirical campaigns.

Owner workflow: enter the preview token, enter a backtest period, walk-forward type, training months, cadence and one Trading Costs assumption. Preview and review the exact fold map, then RUN BACKTEST. Inspect the three aligned tracks, risk/participation measures, policy-by-fold evidence and exposure/timing attribution. Rerun and compare as needed. The matched-beta track is retrospective; it is not an ex-ante strategy or an automatic alpha claim. No control authorizes money or orders.

All financial fields start empty. The standard form explicitly applies Trading Costs to both model selection and OOS evaluation; advanced API users may still distinguish those assumptions. Invalid requests are not repaired. Data vintage remains not independently verified. Deployment requires separate owner authorization.
