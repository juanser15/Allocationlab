# Current-state audit — before P0 implementation

Audit baseline: `5e95245a3ee279d836212d6fc41943c7620a3411` (`origin/render-preview`). The session began on clean `workbench-v1` at `337b2d09904ef4d3ca661b4b6e3325e7c0cc82ac`. Remote `render-preview` contains 34 additional commits and is strictly ahead of that Workbench checkpoint. Its functional coordinated workspace, Yahoo ingestion, model/forecast choices and portfolio workflow have not been reconciled into the local Workbench branch. P0 therefore uses a new `p0-data-workspace-reset` branch from the Render preview commit. No reset of either existing branch is required. No `main` change or deployment is authorized by this audit.

## Current storage and selection

| Concern | Actual implementation at the baseline | Consequence |
|---|---|---|
| Workbench Yahoo payload | `artifacts/api-server/src/lib/workbench/research-datasets.ts`: CSV and metadata JSON under `WORKBENCH_DATASET_DIR`, default `os.tmpdir()/allocationlab-research-datasets` | Instance-local and normally ephemeral. No database/object storage backing. |
| Active dataset | `active-dataset.json` in that same directory; one global pointer | Selection lasts only while those files survive. No persistent workspace entity. |
| Browser recovery | `artifacts/allocation-lab/src/research/dataset-persistence.ts`: one CSV+metadata snapshot in **localStorage**, key `allocationlab.yahoo.active-snapshot.v1` | Browser storage is acting as the backup authority. It is neither shared nor durable server state. Preview authentication uses sessionStorage separately. |
| Browser startup | `coordinated.tsx` calls `restoreRememberedYahooDataset()` before capabilities | If the browser's saved ID differs from the current server ID, `/data/restore` restores and activates the browser copy. An older browser can overwrite a newer server selection. |
| Fetch/activation | `data-universe.tsx::fetchYahoo()` fetches then immediately posts `/data/active` when SPY is present, and stores a browser copy | No separate inspect → save named version → activate workflow. |
| Dataset library/versioning | Yahoo ID is a digest of requested symbols/dates, normalized CSV digest and price field | Content identity exists, but no named persistent library, explicit version counter or durable dataset reference exists. Re-fetching identical content returns the existing metadata. |
| Legacy price ingestion | `/prices/live` in `routes/live-prices.ts` writes `price_data` through the existing Postgres pool | This separate legacy table is durable only if its configured database is durable. It is not the Workbench dataset library. `routes/prices.ts::getLatestPriceData()` selects the latest upload globally, not an explicit immutable workspace version. |

The Workbench survives an API restart only if the same dataset directory remains intact. A clean container, cleared `/tmp`, Render instance replacement or redeploy can remove both the payload and active selection. Browser recovery can restore one remembered snapshot when that same browser returns; it cannot satisfy canonical server persistence.

## Exact fallback paths

`research-datasets.ts` contains three fallback mechanisms:

1. `activeId()` returns `internal` when the pointer file is absent, malformed, or lacks a string ID.
2. `activeResearchDatasetStatus()` returns the internal snapshot when the selected Yahoo metadata cannot be read. It adds a warning, but the effective dataset changes.
3. `applyResearchDatasetOverride()` returns the internal base if external CSV parsing produces no rows.

`interactive-calendar.ts::preparedDataset()` obtains this effective active dataset, caches by its ID, and applies the override to `loadDatasetV2()`'s internal committed snapshot. Its capabilities therefore reflect whichever dataset this fallback chose.

The coordinated path is partially stronger: `coordinated-data.ts::loadCoordinatedDataset(explicitId)` loads the requested Yahoo CSV, verifies the metadata SHA-256 and fails if unavailable. It does not substitute another dataset for an explicit valid Yahoo ID. However, an omitted ID delegates to `preparedDataset()`, so implicit active selection can still fall back. Its current public unavailable code is `DATASET_NOT_AVAILABLE`, while P0 requires `DATASET_UNAVAILABLE`.

## Run data resolution and identity

`coordinated-calendar.ts::normalizeCoordinated()` records an explicit resolved `dataset_id` plus `data_snapshot`, including CSV SHA-256, parsed-data hash and coverage. `coordinatedRunId()` hashes the normalized spec using the existing identity implementation. `coordinated-service.ts` captures that normalized spec, and `workbench-coordinated-worker.ts` reloads `message.request.dataset_id` and checks the normalized run identity before execution. Changing the active dataset does not redirect a coordinated run that already captured an explicit Yahoo ID.

This protection still depends on keeping the referenced ephemeral files. Metadata has no explicit `dataset_version`; the immutable reference cannot be recovered from an absent server payload without a browser copy. The baseline interactive worker independently resolves `preparedDataset()` on execution, and its ordinary request does not contain an explicit immutable dataset version. P0 needs an explicit persistent identity contract rather than silently rewriting either existing contract or saved identities.

## Validation and UX defects

The baseline Data & Universe view is a vertical fetch/metadata layout, not a named library. Yahoo ingestion removes invalid observations and deduplicates dates before forming its normalized CSV without retaining duplicate/invalid counts or a raw-response hash; its current QA cannot reconstruct those source issues. It has browser-recovery language and automatic activation. At this exact baseline, no “Edit ETF Selection” or optimization-navigation action was found inside DataUniverse or its parent’s Data & Universe branch; P0 must preserve that boundary while rebuilding the layout. Other modules do have cross-module actions, which are outside this data-only UX cleanup. Canonical selection must stop being restored from React/browser state.

`coordinated-calendar.ts::planCoordinated()` unconditionally replaces an evaluation start earlier than the derived eligible boundary with a later start. A warning records the movement, but there is no explicit owner opt-in. P0 must reject the requested design with exact history dates instead of modifying it.

The coordinated CURRENT classifier already delegates to unchanged `computeRegime()` and permits unavailable optional components. The former universal complete-reference-universe requirement is inappropriate for this model. The remaining distinction is mandatory SPY/traded-asset history versus optional regime proxies. See `model-data-requirements.md`.

## Environment observations

The project already has `pg`, Drizzle, a shared Postgres pool and `DATABASE_URL` bootstrap integration in `lib/db/src/index.ts`. At audit time this execution environment has no configured `DATABASE_URL` and no PostgreSQL server binary in `/usr/lib/postgresql`. This is not evidence that Render lacks a database; deployed storage configuration has not been inspected or altered.

The managed network policy is current and enforced. Yahoo chart hosts are absent from its allowlist, and the environment reports no configured secrets/runtime bindings. Live Yahoo acceptance must be reported as blocked unless the permitted network configuration is supplied. No synthetic response may be presented as a successful live fetch.

## Preservation boundary

Freeze certified `calculator.ts`, `allocation-core/**`, `research/capital/**`, `research/coordinated/engine.ts`, `models.ts`, `forecasts.ts`, certified datasets, existing benchmark/turnover implementations and historical evidence before implementation. Changes belong in persistence, data binding, planner validation, UI state/data UX and new P0 evidence. Existing model choices on Render remain available; P0 adds none. Historical identities and stored runs must not be automatically migrated.
