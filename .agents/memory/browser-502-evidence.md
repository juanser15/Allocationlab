---
name: Browser 502 evidence boundary
description: How to interpret browser HTTP 502 responses during long Allocation Lab validation or replay requests.
---

Treat a browser-visible HTTP 502 as an unresolved transport or request-completion failure unless the corresponding API request and result are actually observed. Do not infer the numerical model failed, or that a replay passed, from the status alone.

**Why:** On separate historical-validation and replay journeys, the browser showed HTTP 502 while the available API workflow logs did not show a completed response for the relevant request. One of those journeys later passed on a separate observed browser replay, so the earlier 502 was not a mathematical verdict. The precise cause of an individual 502 was not established.

**How to apply:** Record the browser action, HTTP status, whether a saved result exists, and API request/response logs. Mark numerical reconciliation and replay differences unavailable until the actual endpoint succeeds and the UI displays a result. Do not retry merely to obtain a passing gate when a bounded verification protocol forbids it.