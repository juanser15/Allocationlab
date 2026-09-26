---
name: Immutable history list payloads
description: Browser picker performance when immutable preparation and validation histories grow large.
---

List endpoints that serialize every frozen snapshot can look healthy in database and single-record checks while leaving browser selectors empty indefinitely. During D1 verification, a preparation list exceeded 380 MB and a validation list exceeded 40 MB; a selector waited for both, so it appeared to have no saved options despite valid records.

**Why:** Immutable financial snapshots carry complete ledgers, factor data, and underlying datasets. A picker needs IDs and labels, not the stored evidence. Promise-all loading of multiple full-history lists compounds this failure.

**How to apply:** For any saved-run picker, query projected metadata from the database and fetch the complete frozen record only after explicit selection. Diagnose empty selectors by measuring the list response size and checking whether all concurrent list requests finish, not just whether individual record endpoints return 200.