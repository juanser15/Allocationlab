# Extended-run recommendation — no implementation in this phase

Keep the interactive service for small and medium campaigns within its current single-worker task, file, time and byte bounds. Preserve planning and explicit admission decisions there.

A later background research worker should accept an approved immutable normalized spec and exact fold plan, execute in an isolated bounded process, and publish immutable attempts. Give it separately configured capacity and explicit owner admission; do not disguise large campaigns as interactive work or silently reduce dates, windows or folds. A durable job lifecycle, timeout/cancellation policy and operational ownership need their own review.

External immutable object storage should hold normalized specs, source/data identities, ledgers, manifests, diagnostics, result artifacts and reports. Keep experiment identity separate from execution attempts and runtime telemetry. Verify hashes when publishing and reading; retain failed attempts. Define durability/retention and access control explicitly before replacing today's temporary-storage label.

This phase adds no worker, queue, database, storage service or deployment. Capacity changes cannot alter financial experiment identity or completed-run economics.
