---
name: Postgres JSONB key reordering breaks JSON.stringify equality
description: Comparing a freshly-fetched object to one round-tripped through a JSONB column with JSON.stringify can falsely report "changed" — use a stable/sorted stringify instead.
---

Postgres normalizes JSONB column key order alphabetically on write. When you store an object (e.g. a config snapshot) in a JSONB column and later compare it against a freshly-computed in-memory object of the same shape via `JSON.stringify(a) !== JSON.stringify(b)`, the comparison can report a spurious difference purely from key order, even when all values are identical.

**Why:** Discovered while building a rerun-consistency / reproducibility check that snapshots universe & constraints config into a JSONB column and re-diffs them later — it flagged "changed" on every check even with zero actual changes.

**How to apply:** Any diff/equality check against data that has passed through a JSONB column must use a stable stringify (recursively sort object keys before serializing) or a proper deep-equal, never raw `JSON.stringify` string comparison. Also keep absent optional fields absent before fingerprinting: assigning `undefined` to an optional constraint creates an in-memory shape that JSONB drops, breaking frozen hashes and identity comparisons even with sorted keys. Hash frozen envelopes only after normalizing to the exact persisted JSON shape. If supporting old hashes, a compatibility path must compare saved and recomputed normalized results **exactly**; a numeric replay tolerance is not an integrity check and can admit tampered sub-tolerance values.
