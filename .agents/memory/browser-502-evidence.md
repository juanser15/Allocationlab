---
name: Browser 502 evidence boundary
description: How to interpret browser HTTP 502 responses during long Allocation Lab validation or replay requests.
---

Treat a browser-visible HTTP 502 as an unresolved transport or request-completion failure unless the corresponding API request and result are actually observed. Do not infer the numerical model failed, or that a replay passed, from the status alone.

**Why:** On separate historical-validation and replay journeys, the browser showed HTTP 502 while the available API workflow logs did not show a completed response for the relevant request. One of those journeys later passed on a separate observed browser replay, so the earlier 502 was not a mathematical verdict. The precise cause of an individual 502 was not established.

**How to apply:** Record the browser action, HTTP status, whether a saved result exists, and API request/response logs. Mark numerical reconciliation and replay differences unavailable until the actual endpoint succeeds and the UI displays a result. Do not retry merely to obtain a passing gate when a bounded verification protocol forbids it.

A longer monthly historical validation with an adjusted-OHLC dataset returned browser 502 with no saved result or completed API response; a separately configured, shorter evaluation on the same frozen inputs later saved and replayed successfully after an unrelated fingerprint issue was fixed. This does **not** establish a precise duration limit or prove the longer numerical calculation failed. For future long-range validations, investigate request completion, server resource use, and proxy timeouts separately from model correctness.

Keep server-generated traces and browser-authored evidence in different files with explicit ownership; browser agents must treat server trace files as read-only.

**Why:** A browser evidence write replaced correlated server JSONL with a persisted GET response, losing intermediate stages even though a separate workflow log preserved the POST status and duration. A later GET response cannot stand in for the original POST response.

**How to apply:** Give testers a separate browser evidence path, prohibit writes to server traces, and preserve an independent copy before delegating evidence formatting.