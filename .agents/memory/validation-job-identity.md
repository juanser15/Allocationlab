---
name: Validation job identity
description: Why durable execution identity is separate from immutable financial-result identity.
---

Idempotency applies to one deliberate validation submission, not to every validation with identical financial inputs. Refresh, reconnect, and an uncertain submission response must reuse that submission identity. An explicit new validation after a terminal job may use identical inputs with a new identity.

**Why:** Permanent deduplication by financial-input hash would silently prevent intentional repeat validations. Conversely, creating a new execution identity during recovery would append duplicate Validation Runs and make reconnect behavior unreliable.

**How to apply:** Keep submission identity stable throughout recovery. Resolve and capture input selection before queueing; do not substitute newer working inputs when a delayed or recovered job runs.

A failed execution and a failed financial validation are different. If the unchanged financial path produces a persisted failed Validation Run, retain that immutable result and link it from the failed job. Infrastructure failures must instead preserve a useful execution error and must never be presented as a successful financial result.

**Why:** Async transport must not change the existing meaning of Validation Runs or treat an accepted HTTP submission as evidence of completed calculations.

**How to apply:** Keep result persistence and terminal job linkage atomic, fence recovered attempts, and display terminal errors without creating a new job automatically.