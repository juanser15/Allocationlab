# Allocation Lab — reviewed source snapshot

This branch is a source-code handoff for Codex, not an application release.
No builds, backtests, migrations, deployment or application changes were performed
as part of this synchronization.

## Identity and scope

- Source commit: `d51dd4a4fefbdd6a05dedf112b345ca7b3debf71`.
- Source tree: `b3f25ef56116f596968e36545d51ab0dc078b526`.
- Parent: verified public GitHub main
  `1163a0b574b573004372a3a2fc8752810dea7ef9`.
- Target branch: `source/replit-code-baseline-20261028`.
- One reviewed snapshot commit is added to that parent. The 65 additional Replit
  commits are not ancestors of this branch.
- `SOURCE_SYNC_PARITY.json` records the Git blob ID and file mode of every
  included source file. All included source files are unchanged from the source
  commit. This document and the parity manifest are handoff-only additions.

Included: frontend, API, existing workspace packages, optimization and research
engine source, tests, synthetic test fixtures, shared libraries, source
configuration, dependency manifests and lockfiles, migrations, technical docs,
and the existing public-facing empty-dashboard OpenGraph image.

Excluded from this branch's current tree: all `reports/`, `screenshots/`,
`attached_assets/`, `.agents/`, root financial reports/CSVs/ZIP, internal research
notes and collaborator instructions. Existing GitHub-main history remains in
the ancestry: deleting these paths in this snapshot does not erase content that
was already public in the parent history.

## Private runtime and evidence dependencies — not provided here

**Do not claim full runtime parity or runnable integration tests from this
source-only checkout. No private dataset has been substituted or regenerated.**

1. `reports/cl02/adjusted-closes.csv` is intentionally absent. Its source and
   redistribution rights are not verified. The existing code still requires
   its exact bytes at that path:
   SHA-256 `b4a4fa0e0ddb6f639521acbe7398740904860a933391081d06e783339e6c7bc0`.
   `calendar-v2.ts` reads and verifies it; `persistent-datasets.ts` reads it on
   library initialization; `p0-calendar.ts` loads the reference structure even
   when a selected dataset comes from PostgreSQL. Several tests, including
   synthetic capital-clock tests, obtain their base through `preparedDataset()`.
   Merely having the data in PostgreSQL does not remove this filesystem dependency.
2. PostgreSQL contents are not part of Git. Dataset versions, active workspace
   dataset selection, run/attempt history, financial evidence and existing user
   research remain in the original Replit database. Database credentials and
   other secrets are not included. Do not point tests at the live database or
   run migrations as part of inspecting this handoff.
3. Historical certification/replay paths and research CLIs may read private
   report manifests, input snapshots, frozen job directories or other report
   artifacts. They are absent, not replaced with fake data. The parity manifest
   includes a source-reference index for excluded report/input paths. That index
   is static evidence, not a successful runtime dependency-closure test.
4. Generated report, screenshot and job-output destinations referenced by tests
   are not prepopulated. A path reference may be an output rather than an input;
   inspect its call site before treating it as a runtime requirement.

The original Replit checkout, private CSV, database and running services were not
changed. Do not deploy this branch or repair the optimizer as part of source sync.

## Verification and review

The preparation process compares all included source blob IDs and modes against
the pinned source commit, excludes data/evidence paths from the current tree, and
checks that the only new ancestor after public main is this snapshot commit.
No numerical or application execution tests are implied by source parity.

Gitleaks 8.24.3 scans the complete snapshot working tree with secrets redacted.
The reviewed source produced one false positive: `generic-api-key` at
`artifacts/api-server/src/lib/b3-validation-store.ts:16`, whose declaration is
`B3_API_ENGINE_VERSION`, a static engine-version identifier. It is not a
credential. Supplemental checks review private-key markers, credential-bearing
URLs, signed URLs, JWT-shaped strings, literal sensitive assignments, unexpected
binaries and personal-contact-shaped strings. Review results are recorded by
location and classification, never by copying secret values.

## Rollback boundary

The original checkout remains on the source commit and original tree above.
Only this new source branch may be published; no force push, main update, merge
or Replit deployment is part of this handoff. Discarding the isolated worktree
does not roll back or change the running application.
