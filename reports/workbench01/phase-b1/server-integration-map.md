# Workbench Phase B1 server integration map

## Scope

Phase B1 integrates with the repository's existing API server. It adds one research-only route family and one isolated execution worker for the capital research engine. It does not introduce another HTTP server, router framework, persistence service, database dependency, frontend package, or deployment target.

The authorized engine remains `research/capital/engine.ts::runCampaign`. The API adapter must read the committed campaign and historical snapshot identified by Phase A and write execution evidence only beneath the configured temporary Workbench run root.

## Existing server architecture

| Concern | Existing implementation | Integration consequence |
|---|---|---|
| Server framework | Express 5.2.1 in the ESM package `@workspace/api-server` | Add an Express router to the existing package. |
| Application assembly | `artifacts/api-server/src/app.ts` creates one app, installs `pino-http`, CORS, JSON and URL-encoded parsing, and mounts the aggregate router at `/api`. | Workbench paths registered by the aggregate router automatically appear below `/api`. A route-scoped 16 KiB JSON parser, JSON-only media guard, safe body-parser mapping, labelled 404, and final Workbench error boundary surround the existing router; no additional listener is required. |
| Process entry point | `artifacts/api-server/src/index.ts` validates `PORT`, calls `app.listen`, starts the validation-job supervisor, and handles `SIGTERM` and `SIGINT`. | Phase B1 needs no lifecycle change because each Workbench attempt owns and bounds its fixed child process. |
| Route registration | `artifacts/api-server/src/routes/index.ts` imports route modules and attaches each with `router.use(...)`. Individual modules define their complete path below `/api`. | Register one `workbenchRouter`; define `/workbench/capabilities`, `/workbench/runs`, rerun, lookup, listing, and compare in that module. |
| Logging | `artifacts/api-server/src/lib/logger.ts` configures Pino. `pino-http` attaches `req.log` and redacts authorization, cookie, and set-cookie headers. | Log server diagnostics through Pino. Client responses receive safe error messages; detailed execution diagnostics belong in the temporary attempt record. |
| Build | `artifacts/api-server/build.mjs` uses esbuild to bundle ESM entry points. It currently emits the API entry and the validation-job worker. | Add one fixed `workbench-run-worker` entry when isolated execution is implemented. |
| Runtime configuration | Production starts `artifacts/api-server/dist/index.mjs` with Node and `PORT=8080`; readiness is `/api/healthz`. | Retain the current runtime and add `WORKBENCH_RUN_DIR` as Workbench-specific configuration. |

## Request and response validation pattern

The canonical API description is `lib/api-spec/openapi.yaml`. Orval configuration in `lib/api-spec/orval.config.ts` generates Zod contracts in `lib/api-zod/src/generated` and React client types in `lib/api-client-react/src/generated`. Server routes normally import schemas from `@workspace/api-zod` and use:

1. `safeParse` for request bodies, parameters, and query strings;
2. an immediate `400` response for malformed input;
3. explicit semantic checks after structural parsing;
4. `parse` or `safeParse` on response payloads before sending them.

Generated Zod object schemas strip unknown keys unless a stricter check is added. Current routes with sensitive contracts therefore inspect the raw object's allowed keys before parsing. Workbench submission must follow that stricter pattern: every accepted key has an implemented backend mapping, and every unexpected or unsupported key produces a validation error. Numeric checks must reject non-finite values before normalization. Route parameters such as `runId` must be validated before they are used to derive a store path.

Phase B1 can keep its implemented contract beside the Workbench service so that adding the server layer does not regenerate or modify UI client code. The contract must still reflect the Phase A JSON schemas and validate both requests and emitted responses.

## Error-handling pattern

Existing routes return small JSON errors, usually `{ "error": "..." }`, and map known domain failures to an explicit HTTP status. Some routes use local typed error classes or a local `sendError` helper. There is no application-wide custom error middleware in `app.ts`; an unhandled exception reaches the Express default handler. Phase B1 adds a route-scoped Workbench body guard and final error boundary, so malformed JSON, unsupported charset or media type, compression failures, oversized bodies, unknown Workbench paths, and URL-decoding failures all return labelled JSON without client stack traces.

Every Workbench handler therefore needs a complete route-local error boundary. It must:

- return a stable safe error code and message;
- avoid returning stack traces, local paths, commands, environment values, or raw engine exceptions;
- write detailed diagnostic evidence to the immutable attempt directory and structured server log;
- preserve a failed or blocked attempt instead of substituting an earlier success;
- validate the response contract before sending it.

Expected validation, conflict, busy, missing-run, and comparison errors should be mapped explicitly. An unexpected error should produce a generic `500` response after its diagnostic evidence has been recorded.

## Authentication and transport assumptions

The application has no global authentication or authorization middleware. Most routes are available through the internal application API. The only route-specific authentication pattern is the signal export router, which requires a server-to-server bearer token and deliberately rejects browser-originated requests. That guard is specific to signal export and is incompatible with the future browser Workbench workflow.

Phase B1 therefore follows the existing internal application API assumption. Every Workbench response must carry the `RESEARCH_ONLY` boundary, and the contract must contain no broker, order, approved-size, capital-authorization, promotion, activation, or allocation action. CORS is currently installed globally. Any later owner-level access control is a separate server-wide concern and is not inferred or invented by B1.

The existing upload-oriented JSON parser accepts up to 10 MB. The Workbench prefix accepts only JSON bodies and is parsed first with a 16 KiB bound, so unsupported media and oversized bodies are rejected before the general parsers. Route validation rejects structurally excessive specifications and unexpected query parameters. User-provided filesystem paths and command fragments are never accepted.

## Test pattern

The server uses Node's built-in `node:test` runner with `node:assert/strict`. Route tests commonly:

1. create a small Express application;
2. install `express.json()`;
3. mount the router directly;
4. listen on an ephemeral loopback port;
5. exercise the public HTTP contract with `fetch`;
6. close the server in `finally` or a test hook.

Library tests call service and store functions directly. Database integration tests use `DATABASE_URL` and may skip when it is absent. Workbench storage is filesystem-backed and must use a fresh temporary root per test, so its unit and route tests require no database.

Package tests bundle a TypeScript test entry with esbuild and execute the result with `node --test`. Phase B1 follows that convention directly without changing `package.json` or adding a second test framework.

## Package boundaries

The pnpm workspace contains `artifacts/*`, `lib/*`, `lib/integrations/*`, and `scripts`. The API server depends on `@workspace/api-zod` and `@workspace/db`, while the capital research directory is committed repository source rather than a separate workspace package or TypeScript project.

`research/capital/engine.ts` already imports the certified backtest implementation from `artifacts/api-server/src/lib/calculator.ts`. The Workbench worker inside the API package invokes `runCampaign` through a fixed literal module reference, preserving the existing engine and avoiding shell command construction. The existing API TypeScript project typechecks this fixed reference with `noEmit`; no `tsconfig.json` change was required. Esbuild bundles the fixed worker entry and its literal module dependencies separately with the existing calculator DB shim.

No database schema, migration, `lib/db` source, package manager, or new runtime dependency is required. The temporary filesystem store remains within the Workbench service and defaults outside the repository's certified source, data, and report paths.

## Isolated fixed-worker integration

`runCampaign` is synchronous and the Phase A empirical campaign took about 29 seconds. Running it in an Express request handler would block status polling and unrelated API requests. Phase B1 reuses the repository's established fixed child-process pattern, represented by `validation-job-supervisor.ts`, `validation-job-worker.ts`, and the multiple-entry esbuild configuration.

The bounded flow is:

1. The route validates and normalizes the supported specification.
2. The service calculates `run_id`, creates an immutable `execution_attempt_id`, persists `PENDING`, and returns without waiting for the campaign.
3. The service acquires a filesystem execution lease and the adapter starts only the fixed bundled `workbench-run-worker.mjs` executable; together they allow at most one active Workbench execution.
4. The worker receives validated identifiers, resolves all input and output paths from fixed configuration, and directly invokes the typed `runCampaign` export.
5. The adapter enforces the execution timeout, terminates an overrun worker, and the service records a terminal failure without a silent retry.
6. The worker maps only actual engine outputs, applies output and log bounds, writes the immutable result, and transitions the attempt to `SUCCESS`, `FAILED`, or `BLOCKED`.
7. Polling and comparison read immutable store artifacts. They never invoke the engine.

No user value becomes an executable, shell fragment, module path, campaign path, dataset path, or storage root. The worker command and entry point are fixed at build time. A process exit, signal, timeout, or mapping failure remains attached to its own attempt.

## Exact integration paths

The narrow service layout is:

| Path | Change | Responsibility |
|---|---|---|
| `artifacts/api-server/src/lib/workbench/contracts.ts` | New | Implemented request/result types, strict validators, capability metadata, supported enums and boundary constants. |
| `artifacts/api-server/src/lib/workbench/identity.ts` | New | Canonical normalization and deterministic `run_id` construction. |
| `artifacts/api-server/src/lib/workbench/run-store.ts` | New | Immutable filesystem run and attempt persistence rooted at `WORKBENCH_RUN_DIR`. |
| `artifacts/api-server/src/lib/workbench/execution-adapter.ts` | New | Fixed child lifecycle, timeout/output/log bounds, structured IPC, and actual-output result contract. |
| `artifacts/api-server/src/lib/workbench/service.ts` | New | Submit, list, retrieve, rerun, idempotency, and compare orchestration. |
| `artifacts/api-server/src/routes/workbench.ts` | New | Thin Express transport for all `/workbench` endpoints. |
| `artifacts/api-server/src/workbench-run-worker.ts` | New | Fixed isolated worker entry that invokes the typed adapter. |
| `artifacts/api-server/src/lib/workbench/workbench.test.ts` | New | Contract, identity, store, security, concurrency, route, empirical acceptance, rerun, and compare tests. |
| `artifacts/api-server/src/app.ts` | Minimal existing-file change | Apply the Workbench-only JSON media guard, 16 KiB limit, safe parser mapping, labelled not-found response, and final error boundary around the existing router. |
| `artifacts/api-server/src/routes/index.ts` | Minimal existing-file change | Import and register `workbenchRouter`. |
| `artifacts/api-server/build.mjs` | Minimal existing-file change | Bundle `workbench-run-worker` as a fixed executable entry. |

No change is made to any certified engine or dataset, `calculator.ts`, allocation-core, database schemas, API client packages, frontend packages, or deployment configuration.

## Existing commands retained

| Purpose | Command |
|---|---|
| Development server | `pnpm --filter @workspace/api-server run dev` |
| API build | `pnpm --filter @workspace/api-server run build` |
| API start | `PORT=8080 pnpm --filter @workspace/api-server run start` |
| API strict typecheck | `pnpm --filter @workspace/api-server run typecheck` |
| Workspace strict typecheck | `pnpm run typecheck` |
| Production executable | `PORT=8080 NODE_ENV=production node --enable-source-maps artifacts/api-server/dist/index.mjs` |
| Readiness endpoint | `GET /api/healthz` |

The Workbench test uses the existing esbuild plus `node --test` convention directly. No package manifest, dependency, lockfile, TypeScript configuration, server lifecycle entry point, database package, or deployment file changed.
