# Railway preview readiness

The Phase B2 build is ready for owner review on a temporary Railway preview. It has not been deployed.

## Required configuration

Configure the existing frontend and API services behind one public origin so `/workbench` and `/api/workbench/**` share the same origin. Preserve SPA fallback for `/workbench` and proxy `/api/**` to the existing Express service.

Set server-side variables:

- `WORKBENCH_PREVIEW_TOKEN`: an owner-generated high-entropy secret. Do not expose it as a Vite variable or frontend build argument.
- `WORKBENCH_RUN_DIR=/tmp/allocationlab-workbench-runs`: temporary writable storage outside the repository and certified artifacts.
- `NODE_ENV=production`
- `PORT`: Railway-provided service port.
- `DATABASE_URL`: the existing API service's normal database configuration; the Workbench run store itself does not use a database.

Build the frontend with `BASE_PATH=/`. The Vite configuration also expects a build-time `PORT` value. Build the API with the existing `artifacts/api-server/build.mjs` and start its existing `dist/index.mjs` entry point.

## Operational meaning

The filesystem run store is ephemeral and must be presented as `TEMPORARY_RESEARCH_STORAGE`. The service supports one concurrent empirical execution and preserves `RESEARCH_ONLY` plus `PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED` on every Workbench response.

Preview access fails closed when the token is absent. The token is entered manually by the owner and stored only for the browser session. This control is suitable for the requested restricted preview and is not a production authentication claim.

## Owner review checklist

Open `/workbench`, enter the token, execute 0 bps, rerun it, execute 5 bps, and compare both successful runs. Confirm the responsive layout and the displayed limitations. Do not expose the preview publicly without the server token, and do not treat the preview as durable storage, production readiness, or real-money authorization.
