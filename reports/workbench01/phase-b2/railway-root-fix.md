# Workbench B2.1 Railway repository-root fix

## Root cause

`WorkbenchRunStore.open()` used an independent repository-root search that required `.git` in addition to two certified source markers. The execution adapter and worker used separate searches based on the two source markers. Railway's build image correctly omits Git metadata, so the store failed before the Workbench service could initialize even though the certified application, campaign and engine files were present.

## Before-fix reproduction

The implementation at starting SHA `6fad66396f890eb1111f7feffb0bb81300d8efaa` was bundled into an isolated runtime tree containing the committed application marker files and deliberately no `.git` directory. With `WORKBENCH_RUN_DIR` in a separate dedicated `/tmp` directory, `WorkbenchRunStore.open()` failed exactly as deployed:

```json
{
  "status": "EXPECTED_FAILURE",
  "code": "REPOSITORY_ROOT_NOT_FOUND",
  "message": "The certified repository root could not be resolved before initializing Workbench storage."
}
```

The real checkout's `.git` directory was not modified, renamed or copied.

## Fix and marker contract

One infrastructure helper, `repository-root.ts`, now resolves a repository from both `dirname(fileURLToPath(import.meta.url))` and `process.cwd()`. It searches upward and accepts a directory only when all four regular, non-symlink marker files exist:

- `configs/capital-research/acceptance-traditional.json`
- `research/capital/engine.ts`
- `artifacts/api-server/package.json`
- `package.json`

The qualified directory and each marker are resolved through `realpath`; marker targets must remain within the resolved root. Discovery does not inspect `.git`, branch state, the Git executable, network services, GitHub, Railway path names, or a client-supplied path. No explicit root environment override was needed.

`WorkbenchRunStore`, `executeCapitalResearchAttempt`, and `workbench-run-worker` now call this same helper. No campaign, data, financial parameter, spec field, run identity, result hash or storage rule changed.

## Security invariants

The existing pre-creation and post-creation repository/store overlap checks remain in place. The store still rejects `/`, the shared `/tmp` root, a store inside the repository, a repository inside the store, symlinked store paths, path escapes and protected roots. Resolving a repository through a symlink returns its real path, so an alias cannot weaken overlap checks. Missing campaign, engine or API package markers fail closed; an arbitrary directory with only `package.json` also fails closed.

The dedicated root regression suite passed 9/9 tests covering requirements A–K. The full Workbench backend suite passed, including its existing store-confinement and API-boundary checks.

## Railway-like production smoke

The production backend bundles were copied with installed runtime dependencies and all certified worker inputs into an isolated tree with no `.git`. The server was started from that tree with an injected preview test token, isolated `WORKBENCH_RUN_DIR`, production mode and an isolated test `DATABASE_URL`.

- Authenticated `GET /api/workbench/capabilities`: HTTP 200
- Research mode: `CAPITAL_MARKET_EXPOSURE`
- Storage: `TEMPORARY_RESEARCH_STORAGE`
- PIT label: `PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED`
- `REPOSITORY_ROOT_NOT_FOUND`: absent
- Authenticated 0-bps empirical submission: HTTP 202, terminal `SUCCESS`

The smoke run returned 501 out-of-sample observations, final research index `107.25445949277757`, realized simulated cost `0`, and financial result hash `426533ad89ffb1ad72246a8c8ecdb2a6e7ad8e9d1c50f8e6db713d36e1af7e0d`.

## Financial and API regression

The B1 empirical campaign and B2 authenticated integration campaign both passed. The 0-bps values remained 501 observations, `107.25445949277757`, and zero realized cost. The 5-bps values remained 501 observations, `107.13006040048703`, and `0.1130073297533634` realized cost. Run IDs and financial-result hashes were unchanged; the 0-bps rerun reproduced its hash, metrics and time series.

Backend and frontend typechecks passed. Production backend and frontend builds passed. Frontend Workbench tests passed 7/7. Backend Workbench tests passed 12/12 when empirical acceptance was enabled. B2 integration passed 1/1. `git diff --check` passed.

## Preservation

Byte hashes before and after are identical for `calculator.ts`, `research/capital/engine.ts`, the traditional campaign, the empirical adjusted-close dataset, Workbench contracts and run identity code. No allocation-core file, Phase A evidence, transaction-cost implementation, financial-result hashing, package manifest or lockfile changed. The only modifications outside these two reports are the shared repository-discovery helper, its regression test, and replacement of the three duplicate root-discovery blocks with calls to that helper.

## Files changed

- `artifacts/api-server/src/lib/workbench/repository-root.ts`
- `artifacts/api-server/src/lib/workbench/repository-root.test.ts`
- `artifacts/api-server/src/lib/workbench/run-store.ts`
- `artifacts/api-server/src/lib/workbench/execution-adapter.ts`
- `artifacts/api-server/src/workbench-run-worker.ts`
- `reports/workbench01/phase-b2/railway-root-fix.md`
- `reports/workbench01/phase-b2/railway-root-regression.json`
