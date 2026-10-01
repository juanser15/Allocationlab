---
name: PM inspection boundary
description: UX safety rules for inspecting financial histories without changing working drafts or creating runs.
---

Navigation and historical inspection must not submit optimization, validation, or replay actions. These are separate explicit actions, even when a workflow step and an action share similar names.

**Why:** Portfolio managers must be able to inspect saved results without creating another immutable run. A workflow-entry button that also submits with hidden defaults violates that expectation.

**How to apply:** History restoration and selection use read-only retrieval. Keep active job recovery identities unchanged while browsing other records; recovery may finish in the background without replacing the inspected record.

The editable draft, the inspected frozen inputs/result, and the status of an execution job are separate identities. Inspection must not copy historical assumptions into the draft, and leaving or remounting a panel must not discard edited draft values.

**Why:** A frozen result may belong to a different policy, session, or representation than the current working configuration. Mixing them makes outputs and subsequent explicit actions misleading even if every calculation is correct.

**How to apply:** Attribute summaries and replay to the viewed frozen record. Fence delayed results by selection and component lifetime. Require a loaded policy to match the policy selected for a new validation before enabling submission. Treat missing historical metadata as unrecorded, not as a fabricated zero or default.