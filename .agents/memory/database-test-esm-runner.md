---
name: Database test ESM runner
description: Module-loading constraint for database-backed Node tests bundled with esbuild in this workspace.
---

For database-backed ESM tests, leave third-party packages external, bundle the workspace database entry, and emit the test under the database package so Node resolves its declared dependencies from there. Mixed route tests also import server-only packages: do not assume an esbuild alias with `--packages=external` changes the emitted bare package imports. Inspect the emitted import or use a runner whose output location can resolve both sets of dependencies.

**Why:** Bundling CommonJS `pg` into ESM triggers an unsupported dynamic require. Externalizing the workspace database package instead makes Node load raw TypeScript with unsupported directory imports. Emitting the bundled workspace module under the API server leaves database-only packages unresolved; emitting route tests under the DB package can leave Express unresolved even when an alias was supplied.

**How to apply:** Confirm module loading before interpreting a test verdict; loader failures are not passing regressions. Keep genuine assertion failures separate from runner-resolution problems.