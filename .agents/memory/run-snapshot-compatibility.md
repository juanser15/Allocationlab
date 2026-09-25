---
name: Run snapshot compatibility
description: Why saved optimization inputs are self-contained and engine versions are replay boundaries.
---

Treat an optimization run's frozen dataset and configuration as the source of truth for historical validation, not as a reference to mutable working settings. Historical input retention is deliberate even when it duplicates a large CSV.

**Why:** Uploads, active factors, universe settings, constraints, and previous weights can change independently after an optimization. Re-reading any of them would make the same saved allocation appear to have been validated against inputs it never used.

**How to apply:** When changing optimization, factor computation, or backtest semantics, advance the engine compatibility version. A previous snapshot remains viewable, but a newer engine must not claim an exact historical rerun without the original implementation. Never fill gaps in a legacy run from current state.