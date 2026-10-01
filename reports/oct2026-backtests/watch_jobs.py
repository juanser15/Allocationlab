"""Read-only watcher for the three final, deliberately submitted validation jobs."""
import json
import os
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
IDS = {
    "assets": "a1f27d9c-dbbf-4a97-91fd-96cdbbb5d3e6",
    "signals": "0c9ca31f-8991-4344-abc5-9292ecdac71b",
    "alpha": "5597e686-ac6a-4460-be16-42fe339e4502",
}
BASE = "https://" + os.environ["REPLIT_DEV_DOMAIN"] + "/api"
deadline = time.monotonic() + 7200
previous = None
while time.monotonic() < deadline:
    rows = {}
    for key, job_id in IDS.items():
        try:
            with urllib.request.urlopen(
                f"{BASE}/validation-jobs/{job_id}", timeout=30
            ) as response:
                job = json.load(response)
            rows[key] = {field: job.get(field) for field in [
                "jobId", "status", "phase", "validationRunId", "error",
                "attempts", "completedAt",
            ]}
        except Exception as exc:
            rows[key] = {"jobId": job_id, "status": "READ_ERROR",
                         "error": str(exc)}
    (ROOT / "watched-jobs.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2)
    )
    signature = json.dumps(rows, sort_keys=True)
    if signature != previous:
        print(json.dumps(rows, ensure_ascii=False), flush=True)
        previous = signature
    if all(row["status"] in {"completed", "failed", "cancelled"}
           for row in rows.values()):
        print("REPORT_BACKTESTS_TERMINAL", flush=True)
        break
    time.sleep(20)
else:
    print("REPORT_BACKTESTS_TIMEOUT", flush=True)