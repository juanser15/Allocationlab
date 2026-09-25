---
name: Run snapshot compatibility
description: Why saved optimization inputs are self-contained and engine versions are replay boundaries.
---

Treat an optimization run's frozen dataset and configuration as the source of truth for historical validation, not as a reference to mutable working settings. Historical input retention is deliberate even when it duplicates a large CSV.

**Why:** Uploads, active factors, universe settings, constraints, and previous weights can change independently after an optimization. Re-reading any of them would make the same saved allocation appear to have been validated against inputs it never used.

**How to apply:** When changing optimization, factor computation, or backtest semantics, advance the engine compatibility version. A previous snapshot remains viewable, but a newer engine must not claim an exact historical rerun without the original implementation. Never fill gaps in a legacy run from current state.

New audit fields on persisted nested results must remain optional at the historical read boundary, even if newly calculated runs always populate them. Do not synthesize missing historical measurements.

**Why:** Immutable saved results predate newly introduced audit fields; making those fields universally required caused historical result endpoints to fail validation rather than remain viewable.

**How to apply:** For any response schema shared by live and persisted runs, check older stored payloads before adding required fields. Enforce completeness when writing new runs, while rendering missing historical audit values as unavailable.