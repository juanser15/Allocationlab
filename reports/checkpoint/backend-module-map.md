# Certified Allocation Lab backend checkpoint through PIPE-03 / BANK-01

All listed current source, tests, declared fixtures, runtime configuration and downstream frozen data dependencies are included explicitly or already present in the base commit. Status at preparation: **VALIDATED_FOR_COMMIT**. The committed-tree verification must confirm every listed path and SHA before declaring COMMITTED_COMPLETE.

No financial logic, test, model parameter or original artifact was changed. The existing local corrected calculator is included byte-for-byte. No Workbench/UI/API/preview/broker feature, merge or deployment is included.

| Module | Source | Existing tests | Runtime dependencies | Data dependencies | Validation |
| --- | --- | --- | --- | --- | --- |
| CL-01 | artifacts/api-server/src/lib/calculator.ts | artifacts/api-server/src/lib/calculator.cl01-regressions.test.ts | calculator.a1.db-shim.ts; factor-library.ts; d6-trace.ts (HEAD) | synthetic inline fixtures | PASS (48) |
| CL-02 | reports/cl02/research-runner.ts | CL-01 real accounting tests | corrected calculator and existing CL02 adapters | original prepared snapshot/config/freeze; adjusted-closes; frozen ledgers | PASS (6) |
| CL-03 | research/capital | research/capital/engine.test.ts | calculator; capital spec/registry/storage | configs/capital-research; CL02 adjusted-closes | PASS (16) |
| CL-04 | research/capital | research/capital/validation.test.ts; hardening-regressions.test.ts | capital engine + independent oracles | inline QA fixtures | PASS (199) |
| AL-01 | artifacts/api-server/src/lib/allocation-core | contracts.test.ts; amendment-a.test.ts | canonical contracts/validation/composition/risk-mandate | inline synthetic known answers | PASS (60) |
| AL-02 | artifacts/api-server/src/lib/allocation-core/risk-analytics | analytics.test.ts | AL01 risk contracts/estimators | oracle-fixtures.json; CL02 frozen data/ledgers | PASS (42) |
| AL-03 | artifacts/api-server/src/lib/allocation-core/assets-engine | engine.test.ts | AL01/AL02; existing optimizer mathematics | AL03 oracle and historical input artifacts | PASS (44) |
| AL-04 | artifacts/api-server/src/lib/allocation-core/factors-engine | engine.test.ts | AL01/02/03 factor contracts and numerics | synthetic-fixtures; sensitivity-details | PASS (51) |
| AL-05 | artifacts/api-server/src/lib/allocation-core/strategy-engine | engine.test.ts | AL01/02/03 return-space solver | synthetic-results; sensitivity-results; blocked-artifacts | PASS (83) |
| AL-06 | artifacts/api-server/src/lib/allocation-core/gates | gates.test.ts | AL01–05 certified observer contracts | frozen AL03/04/05 fixtures and stresses | PASS (52) |
| AL-07 | research/allocation | research/allocation/engine.test.ts | capital folds/storage; AL01–06 | frozen AL03 artifacts; missing-from-copy psr-oracle.json | PASS (30) |
| PIPE-01 | research/pipeline | research/pipeline/pipeline.test.ts | AL01–07; corrected accounting | frozen AL07 jobs/selections; AL04/05 synthetic fixtures | PASS (39) |
| PIPE-02 | research/governance | research/governance/governance.test.ts | PIPE01 target contracts; capital storage | frozen PIPE01 decisions; AL07 evidence; original checkpoint | PASS (37) |
| PIPE-03 | research/active-pipeline | research/active-pipeline/integration.test.ts | BANK01, AL05/06, PIPE01/02 | frozen BANK01 catalogs; PIPE02 registry and routing fixture | PASS (46) |
| BANK-01 | research/bank | research/bank/bank.test.ts | governance; certified AL05 validation | declared synthetic controls; original checkpoint | PASS (71) |

Generated fixture bundles are excluded. Rebuild with the existing command: `cd artifacts/api-server && ./node_modules/.bin/esbuild src/lib/allocation-core/assets-engine/engine.ts src/lib/allocation-core/assets-engine/artifacts.ts src/lib/allocation-core/assets-engine/sensitivity.ts --bundle --platform=node --format=esm --packages=external --outdir=dist/al03/fixtures`. This supplies the original fixtures.mjs build prerequisite without committing dist files.

## Dependency closure and reproduction scope

Package/workspace manifests and lockfile are already in the base commit; no dependencies were changed. `backend-checkpoint-manifest.json` pins each selected existing source/test/fixture/config/dataset/manifest/report, its bytes and SHA256. The source-import closure is checked against the bundler input catalog and base tree; all certified TS sources pass strict typecheck. Existing compiled outputs and installed packages are build/runtime products, not committed duplicates. Build using the recorded existing esbuild commands and DB shim; source and shim are versioned.

AL07 frozen jobs and selection locks, PIPE01 frozen decisions, and BANK01 synthetic input/result catalogs are retained because downstream certified readers consume their exact hashes. Other repeated pre/post evidence, caches, screenshots, ZIPs, frontend/preview files and Workbench evidence remain outside the allowlist. Original historical preservation catalogs can mention older files; those catalogs are archival integrity anchors and are not recursively treated as runtime inputs. The old report finalizers assert historical branch/HEAD and are not part of the current test invocation.

COMMITTED_COMPLETE means the tested source/fixture/runtime-data path is available from this committed tree plus declared installed dependencies. It does not mean missing historical canonical factor/strategy histories or governance were recovered. Their original blockers remain intact. No historical performance claim is added.

## CL02 export and numerical reproduction

The unmodified exporter was run from a complete byte-verified isolated worktree with only .git, node_modules and unrelated caches excluded. All 11 exporter outputs were first moved into a separate temporary baseline. Fresh exports match every original byte, size and SHA256, including PNGs. Six CSVs additionally have identical headers/cells/rows/columns/newlines, JSON structures match, image dimensions match. This proves **CL02_WRITE_ONCE_UNIVERSAL_NEWLINE_FALSE_POSITIVE**: text-mode reads normalize CRLF while the existing StringIO CSV content retains CRLF. No guard was changed.

The existing CL02 runner also checked 6 × 1823 intervals with its original NAV/cash/positions/trades/fees/timing assertions and reused all six frozen ledgers. Its process ran at the manifest-bound original cwd with write operations blocked; zero write attempts, no new backtests. Every frozen manifest source hash matched. Numerical validation is separate from byte reproduction.

## Validation evidence

The explicit checkpoint logs retain the original nine green suites, AL07 30/30 rerun, all five remaining suites, strict typecheck, and the CL02 failure/reproduction/accounting evidence needed to explain this checkpoint. CL04 test count includes CL03; AL01A includes the contract cases. `checkpoint-validation.json` records commands and scope. No broad source audit, new financial test or follow-on Workbench work was performed.
