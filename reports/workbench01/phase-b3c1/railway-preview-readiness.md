# Owner preview readiness

No deployment is performed by this change. Retain the B3C same-origin `/workbench` SPA and `/api/workbench/**` routing, production backend/worker build, committed source/configuration/dataset tree and existing preview token guard.

Server environment remains `NODE_ENV=production`, Railway's `PORT`, existing application `DATABASE_URL`, server-only `WORKBENCH_PREVIEW_TOKEN`, and an external writable `WORKBENCH_RUN_DIR` such as `/tmp/allocationlab-workbench-runs`. Never place the token in a frontend build argument or a `VITE_` variable. Existing immutable run storage is temporary and may disappear on restart; do not delete the reported failed attempt as a workaround.

Build backend with `node artifacts/api-server/build.mjs`; start `node --enable-source-maps artifacts/api-server/dist/index.mjs`. Build the existing frontend from `artifacts/allocation-lab` using the installed `vite build --config vite.config.ts` with `BASE_PATH=/` and a valid build-time `PORT`. No dependency, lockfile, database or deployment configuration changes are required.

The new API preflight and failure-diagnostic modules are bundled in the server. The fixed worker and all financially hashed source files are unchanged. Source files required by the existing data/code and benchmark identity checks must remain present in the runtime image; Git metadata is unnecessary.

Owner check after an explicitly authorized redeploy: enter the original exact design, preview it and verify NO_VALID_CANDIDATE in fold 0 with decision date 2019-10-01, 20 training observations and the fixed turnover limit. RUN must remain unavailable. Open the retained failed attempt and verify its actionable diagnosis and unchanged history. A direct submit or rerun of that infeasible design must be blocked before creating an attempt. Valid one-month designs remain possible; there is no hardcoded two-, three- or twelve-month minimum.

The unchanged limits are still 120 seconds, 64 MiB output, 1 MiB logs and 512 sealed engine files. A long design can additionally be blocked by the proven artifact-file bound or existing job budget. Passing preview never guarantees metric/constraint viability; actual candidate evaluation remains authoritative.

RESEARCH_ONLY, TEMPORARY_RESEARCH_STORAGE and PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED remain in force. No new model, capital authorization, broker operation, merge, PR or deployment is included.
