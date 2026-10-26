# Immutable dataset-version contract

Authority: `artifacts/api-server/src/lib/workbench/persistent-datasets.ts`. Persisted metadata and normalized CSV live together in PostgreSQL under `PERSISTENT_POSTGRES_DATASET_STORAGE`. A dataset version is never edited in place. The inherited temporary-storage label describes run artifacts only.

| Field | Meaning and validation |
|---|---|
| `dataset_id` | Immutable identifier: internal snapshot uses `internal_` plus its SHA-256; saved Yahoo versions use `yf_` plus a generated UUID without hyphens. |
| `dataset_name` | Explicit user name, trimmed, 1–120 characters; control characters rejected. |
| `dataset_version` | Positive integer, allocated serially within a name under a database advisory lock. |
| `source` | Currently `INTERNAL_SNAPSHOT` or `YAHOO_FINANCE`; other providers are not advertised as implemented. |
| `created_at`, `fetched_at` | Version-save and source-fetch timestamps respectively. |
| `frequency`, `price_field` | `DAILY`, `ADJUSTED_CLOSE` in this phase. |
| `adjustment_convention` | Declared provider adjusted-close convention; historical revisions are not independently verified. |
| `requested_start`, `requested_end` | Explicit fetch request; `requested_end_convention = INCLUSIVE`. This differs deliberately from a research run's end-exclusive interval. |
| `actual_start`, `actual_end` | First/last dates in the persisted normalized calendar. Per-ticker first/last valid observations are in QA. |
| `tickers`, `row_count` | Normalized requested ticker columns and union-calendar rows. Failed symbols remain visible in the columns/QA when another symbol succeeds. |
| `per_ticker_observations`, `missing_values` | Actual valid cell counts and empty cells, without imputation. |
| `dataset_hash` | SHA-256 of the exact normalized CSV bytes. Downloads reproduce those bytes. |
| `raw_source_hash` | SHA-256 of the sorted mapping of ticker to raw provider-response SHA-256; internal snapshot records its committed bytes' hash. |
| `pit_status` | `VINTAGE_UNVERIFIED`; source availability does not certify historical vintages. |
| `qa_status` | `PASS` or `WARNINGS`, with detailed `qa`. Yahoo's vintage warning is retained. |
| `notes` | User/source notes, bounded to 2,000 characters on save. |
| `storage_location` | PostgreSQL table/payload reference, not a client-supplied filesystem path. |
| `refresh_of` | Prior immutable Yahoo version when the user explicitly refreshes; otherwise null. |

## Normalized payload and QA

CSV contains `date` and unique supported ticker columns, strictly ordered unique ISO dates, positive finite prices or explicit empty cells, and a final newline. No forward-fill or interpolation is applied. Provider timestamps with unavailable prices remain represented in the union calendar. Duplicate provider observations and invalid/nonpositive prices are counted. Identical duplicates may be deduplicated with a warning; conflicting values reject that symbol. QA reports union observations, complete cases, per-ticker coverage and gaps longer than seven calendar days without claiming an exchange-calendar classification.

The normalized payload bound is 32 MiB. The library accepts at most 64 requested symbols per fetch. Fixed-host provider retrieval has separate byte/time limits described in `yahoo-ingestion.md`. Decode bounds, CSV validation and SHA-256 checks are repeated when the saved payload is read.

## Lifecycle and API

| Request | Behavior |
|---|---|
| `GET /api/workbench/library` | List saved immutable version metadata. |
| `POST /api/workbench/library/fetch` | Fetch and persist a draft; returns QA. Does not save a named version or activate it. |
| `POST /api/workbench/library/save` | Save the identified draft under a name; optional `notes` and `refresh_of`. Does not activate it. |
| `GET /api/workbench/library/datasets/:id` | Inspect one saved version. |
| `GET /api/workbench/library/datasets/:id/csv` | Download the exact persisted normalized CSV. |

Saving the same draft again under the same name returns its existing saved version; a different name is rejected. A new fetch creates a new draft and a new saved version even if its bytes match the previous version. Refresh requires the same existing Yahoo dataset name. There is no silent mutation, automatic activation, delete route or implicit old-run migration.

Run references bind the immutable ID and hash. Unknown/unreadable IDs and failed integrity checks produce `DATASET_UNAVAILABLE`. Changing the workspace selection cannot change a previously normalized spec or worker's data source.
