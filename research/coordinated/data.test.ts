import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  restoreResearchDataset,
  readResearchDatasetCsv,
  type ResearchDatasetMetadata,
} from "../../artifacts/api-server/src/lib/workbench/research-datasets";
import { loadCoordinatedDataset } from "../../artifacts/api-server/src/lib/workbench/coordinated-data";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
test("Restored Yahoo snapshots preserve short histories, missing values and explicit immutable run data", () => {
  const csv = "date,IEF,SPY\n2024-01-02,,100\n2024-01-03,95,101\n";
  const sha256 = hash(csv),
    tickers = ["IEF", "SPY"],
    start = "2024-01-01",
    end = "2024-01-03";
  const dataset_id =
    "yf_" +
    hash(
      JSON.stringify({
        tickers,
        start,
        end,
        digest: sha256,
        price_field: "adjusted_close",
      }),
    );
  const metadata: ResearchDatasetMetadata = {
    dataset_id,
    source: "YAHOO_FINANCE_RESEARCH",
    fetched_at: "2024-01-04T12:00:00Z",
    requested_start: start,
    requested_end: end,
    interval: "1d",
    price_field: "adjusted_close",
    tickers,
    successful_tickers: tickers,
    failed_tickers: [],
    observations: 2,
    first_observation: "2024-01-02",
    last_observation: "2024-01-03",
    complete_observations: 0,
    required_research_symbols: ["SPY"],
    missing_required_symbols: [],
    activation_eligible: true,
    coverage: [],
    sha256,
    note: "test snapshot",
  };
  restoreResearchDataset({ metadata, csv });
  const data = loadCoordinatedDataset(dataset_id);
  assert.equal(data.rows.length, 2);
  assert.equal(data.rows[0].prices.IEF, undefined);
  assert.equal(data.rows[1].prices.IEF, 95);
  assert.equal(data.snapshot.sha256, sha256);
  assert.equal(readResearchDatasetCsv(dataset_id), csv);
  assert.throws(
    () => restoreResearchDataset({ metadata, csv: csv.replace("101", "999") }),
    /hash/,
  );
  assert.throws(
    () => loadCoordinatedDataset("yf_" + "a".repeat(64)),
    /unavailable/,
  );
  assert.throws(
    () => loadCoordinatedDataset("../escape"),
    /existing research dataset/,
  );
  assert.equal(
    loadCoordinatedDataset("internal").snapshot.path,
    "reports/cl02/adjusted-closes.csv",
  );
  assert.deepEqual(loadCoordinatedDataset(dataset_id).rows, data.rows);
});
