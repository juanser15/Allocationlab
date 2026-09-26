---
name: Database test ESM runner
description: Module-loading constraint for database-backed Node tests bundled with esbuild in this workspace.
---

For database-backed ESM tests, leave third-party packages external, bundle the workspace database entry, and emit the test under the database package so Node resolves its declared dependencies from there. A server-only dependency may need an explicit alias during bundling.

**Why:** Bundling CommonJS `pg` into ESM triggers an unsupported dynamic require. Externalizing the workspace database package instead makes Node load raw TypeScript with unsupported directory imports. Emitting the bundled workspace module under the API server leaves database-only packages unresolved.

**How to apply:** Follow this module-resolution pattern for future DB test harnesses. A successfully loaded runner does not imply assertions pass; treat real assertion failures separately from loader errors.