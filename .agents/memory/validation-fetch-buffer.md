---
name: Full validation fetches in child processes
description: Child-process output limit when testing full persisted validation records.
---

When a verification reads a complete saved financial validation in a fresh Node process, set an explicit `maxBuffer` on synchronous child-process capture, with a finite timeout. Do not treat `ENOBUFS` as evidence that the application failed to persist or replay a record.

**Why:** A self-contained historical fixture produced a valid persisted record with a large daily ledger; a fresh process retrieved it successfully, but the test failed solely because the default child-process output limit was too small.

**How to apply:** For any fresh-process persistence test that serializes the full result to stdout, choose a buffer large enough for the expected ledger and still assert the returned identities and numerical values. Keep the actual API failure and test-harness overflow distinct.