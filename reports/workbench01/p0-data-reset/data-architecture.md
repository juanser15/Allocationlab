# P0 persistent data architecture

Implementation baseline: `5e95245a3ee279d836212d6fc41943c7620a3411`, inherited from `render-preview` on the dedicated `p0-data-workspace-reset` development branch. The existing financial engine, historical evidence and legacy run-identity implementation are preserved.

## Canonical persistence

The existing project PostgreSQL connection (`@workspace/db`, `DATABASE_URL`) stores both metadata and gzip-compressed normalized CSV payloads. Library and P0 capability responses label these guarantees `PERSISTENT_POSTGRES_DATASET_STORAGE` and `PERSISTENT_POSTGRES_WORKSPACE_STATE`. The inherited `TEMPORARY_RESEARCH_STORAGE` boundary applies only to run artifacts, not saved datasets or workspace selection. No additional persistence service is introduced. These tables are created additively by `lib/db/migrations/0003_persistent_dataset_library.sql`:

| Table | Authority |
|---|---|
| `allocationlab_dataset_versions` | Immutable named versions, metadata, SHA-256 and compressed normalized payload |
| `allocationlab_dataset_drafts` | Provider-produced fetched payload and QA before an explicit save |
| `allocationlab_workspace_state` | Workspace's active immutable dataset reference |
| `allocationlab_dataset_run_references` | Immutable binding from run ID to dataset ID and payload hash |

Database triggers reject updates/deletes of versions, drafts and run references. Workspace state alone is mutable. Foreign keys prevent dangling active/run references. There is no delete API in this phase. PostgreSQL persistence is only as durable as the configured database; a database running on an ephemeral application filesystem would not satisfy this design.

`PersistentDatasetStore.initialize()` applies the additive migration in a transaction with a database advisory lock. It verifies the committed internal CSV against its fixture hash and inserts that version if absent. It initializes the `default` workspace only when that workspace does not exist. This bootstrap does not replace an existing active selection. Browser state never seeds or restores the database.

## Request and execution boundary

`/api/workbench/library` owns fetching, saving, inspecting, downloading and explicit activation. `/api/workbench/p0` owns capabilities, planning and execution against persisted versions. Both inherit the existing Workbench preview-token middleware before body parsing and route handling.

The new normalized identity namespace is `allocationlab-persistent-data-1.0.0`. Every P0 run contains `dataset_id`, `dataset_version`, `dataset_hash` and `dataset_source`, plus the existing snapshot/code/runtime identity. Different saved versions receive different identities even if their normalized bytes happen to match. Existing saved runs are not migrated or rehashed.

The parent normalizes against the requested immutable ID. The separate worker independently loads that same ID from PostgreSQL, verifies the normalized payload hash, reconstructs the normalized run identity, and receives the persisted rows explicitly. It does not resolve the workspace's current selection. A local `internal` parser alias accommodates the unchanged lower-level parser; it never triggers a payload lookup because that engine invocation receives the verified dataset object. Public spec, plan and result preserve the actual persisted ID.

The actual `research/coordinated/engine.ts` and its model, forecast and accounting functions remain the financial calculation authority. P0 adds data binding and preflight validation. It rejects missing history with exact dates instead of allowing the prior wrapper to move the requested start. It does not alter financial formulas, fold mathematics or existing identity functions.

## Compatibility and unavailable data

New POST mutations/plans/executions under `/api/workbench/coordinated/{data,runs,plan,bounds}` and `/api/workbench/interactive/{data,runs,plan,bounds}` return `410 PERSISTENT_DATASET_REQUIRED`, including reruns and mixed-case/trailing-slash variants. Historical reads remain available. This prevents the retired ephemeral workspace or browser snapshot-restore route from becoming a second active-data authority. Other historical certification contracts are not rewritten.

Missing versions, failed integrity checks and unavailable database reads fail closed with `DATASET_UNAVAILABLE`; no internal snapshot or latest dataset is substituted. Dataset versions, run references and workspace state survive an API restart or a new instance connected to the same durable database. Run-attempt/result storage remains the existing temporary store; P0 makes datasets durable and does not silently change the retention contract of historical results.

## Evidence limits

`persistence-test.json`, `restart-test.json` and `dataset-engine-reconciliation.json` record actual PostgreSQL persistence, API restart, clean-runtime and worker execution checks. The Yahoo-shaped transport in these checks is an explicitly labelled test provider built from committed historical observations. It establishes persistence and execution mechanics, not a successful download from Yahoo. Live Yahoo acceptance is blocked by the managed network policy and remains required before readiness.
