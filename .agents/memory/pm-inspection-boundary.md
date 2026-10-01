---
name: PM inspection boundary
description: UX safety rules for inspecting financial histories without changing working drafts or creating runs.
---

Navigation and historical inspection must not submit optimization, validation, or replay actions. These are separate explicit actions, even when a workflow step and an action share similar names.

**Why:** Portfolio managers must be able to inspect saved results without creating another immutable run. A workflow-entry button that also submits with hidden defaults violates that expectation.

**How to apply:** History restoration and selection use read-only retrieval. Keep active job recovery identities unchanged while browsing other records; recovery may finish in the background without replacing the inspected record.

The editable draft, the inspected frozen inputs/result, and the status of an execution job are separate identities. Inspection must not copy historical assumptions into the draft, and leaving or remounting a panel must not discard edited draft values.

**Why:** A frozen result may belong to a different policy, session, or representation than the current working configuration. Mixing them makes outputs and subsequent explicit actions misleading even if every calculation is correct.

**How to apply:** Attribute summaries and replay to the viewed frozen record. Keep the working engine preference separate from the inspected record's display engine, including refresh restoration; returning to draft must recover the working engine. Fence delayed results by selection and component lifetime. Require a loaded policy to match the policy selected for a new validation before enabling submission. Treat missing historical metadata as unrecorded, not as a fabricated zero or default.

Preserving draft fields alone does not preserve the last completed result when inspection temporarily unmounts a controller.

**Why:** Returning from another engine's historical view can restore every input yet lose the selected frozen result, leaving downstream validation pointed at a policy whose result is no longer visible.

**How to apply:** Retain the working frozen-result identity outside the remounting controller and restore its full saved record with a read-only lookup. Never restore it from the inspected record's identity or replace it with the newest history entry.

HTTP GET is not proof that an inspection is read-only or non-computational. Workflow navigation must use saved-state reads whose handlers neither create records nor calculate financial reports.

**Why:** Apparently informational reads have created decision drafts or indirectly run backtests, walk-forward folds, and sensitivity analyses. Removing one direct computation request does not remove those indirect effects.

**How to apply:** Check the handler behind each navigation/status read, including downstream calls. Use recorded status for completion, and describe missing recorded evidence as unavailable rather than generating it during navigation.

An explicit execution signal must be consumed once, not treated as fresh authorization when a view remounts or returns from history.

**Why:** A retained positive execution counter combined with reset component-local state can silently repeat a financial calculation without another user action.

**How to apply:** Preserve execution identity independently of inspected-view identity. Hide working diagnostics when inspecting another record; returning to the draft restores the working view without authorizing another calculation.