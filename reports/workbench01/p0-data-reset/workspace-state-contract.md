# Persistent active workspace state

The server owns the active selection, labelled `PERSISTENT_POSTGRES_WORKSPACE_STATE` in library and capability responses. The PostgreSQL row contains:

```text
workspace_id: string
active_dataset_id: immutable saved dataset ID
updated_at: timestamp
```

The current preview exposes one workspace, `default`. Store methods accept validated workspace identifiers so a future authenticated multi-workspace layer can use the same relationship; multi-workspace authorization is not implemented or claimed here.

`GET /api/workbench/library/workspace` returns this row together with the verified active version metadata. `PUT /api/workbench/library/workspace` accepts exactly `{ "dataset_id": "<saved immutable ID>" }`. Activation verifies the persisted version and then updates the foreign-key reference. Fetching and saving are separate operations and never activate automatically.

The bootstrap inserts the internal reference snapshot as the default only when no default workspace exists. Existing selections are not overwritten on initialization, browser refresh, API restart or redeploy. Missing/corrupt selected data fails closed; a stale browser copy cannot repair or replace canonical state.

## Frontend ownership

The Data & Universe module loads the server library and workspace state. Its Library, Fetch Data, Quality and Metadata views manage data only. “Use this dataset” explicitly changes the server selection; the resulting active version is labelled ACTIVE. The compact shell DATA indicator is derived from server capabilities and identifies source and coverage. Modules re-read server capabilities on navigation/focus as appropriate.

Dataset payloads and active IDs are not saved to localStorage or sessionStorage. The old browser-snapshot restoration is removed from the ordinary product path. sessionStorage remains in use only for the manually entered preview access token, not dataset authority.

## Submission isolation

A configuration carries the selected immutable `dataset_id`. Planning resolves that version and returns the four-field binding: ID, version, hash and source. Submission normalizes and stores that binding before execution. The worker resolves the same explicit version independently. Later activation affects new configuration, not an existing run or rerun.

Unavailable selected data returns `DATASET_UNAVAILABLE`; the frontend cannot submit an omitted dataset ID to select an implicit internal fallback. Retired coordinated/interactive mutation routes return 410 to prevent a second temporary active pointer from re-entering the workflow. Existing saved evidence is left untouched.

## Tested guarantees and limits

The recorded local PostgreSQL acceptance verifies explicit activation; unchanged ID/hash after server restart; a clean source/runtime tree with no Git metadata or old temporary run directories; an actual worker execution against the restored dataset; unchanged old-run binding after another version becomes active; and different identity for a newly selected version.

Chromium acceptance verifies navigation across all current product modules, browser reload and a stale legacy browser snapshot cannot change the server selection. These tests used explicitly labelled provider fixtures derived from committed historical observations. Actual live Yahoo retrieval remains blocked by network policy and is a separate mandatory acceptance gate. Research attempt/result retention still follows the temporary run-store contract.
