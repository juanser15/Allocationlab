# Workbench Phase B1 security boundary

## Service boundary

Every Workbench endpoint identifies the service as `RESEARCH_ONLY`. A successful run does not imply `PROMOTED`, `ACTIVE`, `ALLOCATED`, or `AUTHORIZED`. The contract contains no broker route, order object, approved size, capital authorization, live-execution state, or investment recommendation.

Every capability and result also carries `PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED`. The worker checks strict training, signal, and execution cutoffs, but the committed adjusted-close vendor identity and historical data vintages have not been independently verified. Phase B1 never returns an unqualified point-in-time-safety label.

The filesystem store is labelled `TEMPORARY_RESEARCH_STORAGE`, has no durability claim, and does not use a database.

## Input allowlist

`POST /api/workbench/runs` accepts one exact five-property JSON object. Four values are literals: `CAPITAL_MARKET_EXPOSURE`, `EMPIRICAL`, `SPY`, and `TRADITIONAL_WALK_FORWARD`. `transaction_cost_bps` is required, finite, and exactly `0` or `5`. Unknown and missing properties are errors. This rejects user-supplied paths, commands, campaign definitions, dates, candidate budgets, universes, validation modes, and unimplemented financial controls instead of accepting and ignoring them.

The application accepts only JSON Workbench bodies and applies a Workbench-only 16 KiB parser limit before the existing larger general parsers. Malformed or oversized JSON, unsupported media types or charsets, corrupt compression, unknown Workbench routes, and URL-decoding errors receive a safe labelled JSON envelope. Route validation rejects non-objects, arrays, nonfinite numeric values, unexpected rerun bodies, unexpected query parameters, malformed run IDs, and path traversal. Run IDs must match `rr_` plus 64 lowercase hexadecimal characters; attempt IDs must match `ea_` plus a UUID v4.

## Fixed execution process

The HTTP process does not construct or execute a shell command. It forks one fixed build artifact, `workbench-run-worker.mjs`, with no request-derived executable, argument, module, command fragment, shell interpolation, `eval`, or user-provided path. The child receives a small structured IPC message containing only validated run ID, attempt ID, and the `0|5` scenario.

The worker statically imports and directly calls `research/capital/engine.ts::runCampaign`. It resolves the repository, campaign, dataset, and output roots from server-owned locations. Before execution it verifies:

- committed campaign SHA-256 `9ad484bc22d2120f583b08fe1a951d22ddb34525f8c89feee28a813a336c1c64`;
- empirical CSV SHA-256 `b4a4fa0e0ddb6f639521acbe7398740904860a933391081d06e783339e6c7bc0`;
- parsed data hash `f7436db75e7c6ed35938e6248c48c162c051cd8a99457a5c386910b36f6c743e` and 4,023 rows;
- certified engine code hash `94a2c94f0cf7a096865a7d5a8284aa1141f23b62a49685e8d3e3502afd830dcf`;
- fixed traditional dates, universe, candidate space, selection cost, cost scenarios, warmup, and job limit.

The adapter always uses a new empty attempt engine directory and no shared cache. The committed campaign remains the dual `0` and `5` bps campaign because selection is certified at 5 bps. The API maps only the requested scenario after the full unchanged campaign completes.

## Filesystem confinement and immutability

`WORKBENCH_RUN_DIR` must be an absolute dedicated directory. The default is `/tmp/allocationlab-workbench-runs`; `/`, the shared temporary root itself, repository overlaps, other protected-root overlaps, and symlinked roots are rejected before mutation. Store initialization resolves the nearest existing ancestor before any `mkdir`, repeats the overlap check after creation, and changes permissions only on a root it created rather than on a pre-existing configured directory. HTTP values are never accepted as filesystem paths.

All path segments derived from identifiers pass strict regular expressions. Directory walking rejects symbolic links, nonregular artifacts, absolute paths, and `..` escapes. The adapter and worker independently repeat root and identifier validation.

Run specifications, attempt metadata, state events, results, diagnostics, and manifests are write-once. Publication creates a mode-0600 same-directory temporary file with `O_EXCL` and `O_NOFOLLOW`, flushes it, hard-links it to the destination without replacement, flushes the parent, and removes the temporary link. Reusing an existing byte-identical immutable record is safe; different content raises an immutable conflict. A terminal state is published only after its result or error evidence.

The store cannot write beneath certified report, source, data, or artifact paths because any repository overlap is rejected before mutation. Every execution attempt gets its own engine root, so rerun evidence cannot overwrite earlier evidence.

## Resource and concurrency controls

Phase B1 permits one empirical execution at a time. A process-local guard and an atomic store lease prevent a second child process. A repeated matching PENDING or RUNNING submission returns the existing attempt. A different request while the lease is held receives one immutable `BLOCKED_EXECUTION_CAPACITY` attempt and an HTTP 429 response; repeated pressure against that same run and active lease reuses the blocker. A per-run 100-attempt cap rejects further creation while keeping existing history readable.

The fixed bounds are:

| Resource | Bound |
|---|---:|
| Concurrent empirical executions | 1 |
| Execution timeout | 120,000 ms |
| Engine output | 64 MiB |
| Engine files | 512 |
| Captured logs | 1 MiB |
| Worker result IPC | 1 MiB |
| Worker diagnostic text | 64 KiB |
| Store metadata record | 1 MiB |
| Listed runs or attempts | 100 |
| Immutable attempts per run | 100 |
| HTTP JSON request body | 16 KiB |

The parent terminates an overrun child, monitors output size during execution, rechecks it on completion, caps captured output, and rejects oversized IPC. The fixed committed campaign also bounds the search to 24 jobs for this configuration.

## Failure evidence and client errors

The status model is `PENDING`, `RUNNING`, `SUCCESS`, `FAILED`, or `BLOCKED`. A failed attempt retains its normalized run specification, immutable attempt ID, timestamps, stage, safe error class and message, bounded logs, detailed internal diagnostic, partial engine evidence where present, and provenance. The result and attempt view expose an attempt-relative `runtime_diagnostic_reference` while keeping diagnostic content private. A missing or corrupt terminal result fails explicitly instead of becoming `NOT_SUPPORTED`. It never substitutes an earlier successful result for the latest failed status. A normal duplicate submission does not silently rerun a failure; only the explicit rerun route creates another attempt when capacity permits.

Detailed stacks and local paths remain in the temporary diagnostic record. Route-local error handlers return stable codes and safe messages with the three mandatory boundary labels. The API does not expose stack traces.

Runtime telemetry remains separate from financial evidence. `progress.json`, timestamps, memory readings, logs, runtime counters, process IDs, and attempt IDs are excluded from the scenario financial result hash. A separate runtime hash may differ across otherwise identical attempts.

## Existing authentication assumption

The existing Express server has no global authentication middleware. Phase B1 follows that internal-application API convention so a future Workbench UI can call the routes. This phase does not add or claim an authorization system. Exposure outside the existing trusted application boundary requires a separate owner-approved authentication and authorization design.
