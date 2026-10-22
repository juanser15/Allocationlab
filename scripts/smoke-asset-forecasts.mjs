import assert from "node:assert/strict";
const base =
  process.env.ASSET_TEST_BASE ??
  "http://localhost:4173/api/workbench/coordinated";
const pause = () => new Promise((resolve) => setTimeout(resolve, 1200));
async function api(path, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(result)}`);
  return result;
}
let datasetId = process.env.ASSET_TEST_DATASET;
if (!datasetId) {
  const response = await api("/data/yahoo", {
    tickers: ["SPY", "IEF"],
    start: "2023-01-01",
    end: "2024-12-31",
  });
  assert.equal(response.dataset.failed_tickers.length, 0);
  datasetId = response.dataset.dataset_id;
  console.log(JSON.stringify({ stage: "DOWNLOAD_PASSED", dataset: datasetId }));
}
const caps = await api("/dataset-capabilities", { dataset_id: datasetId });
assert.deepEqual(caps.etfs, ["IEF", "SPY"]);
assert.equal(caps.data_first_observation, "2023-01-03");
const request = {
  contract_version: caps.supported_spec_version,
  research_scope: "PORTFOLIO",
  dataset_id: datasetId,
  evaluation_start: "2024-01-21",
  evaluation_end_exclusive: "2024-07-21",
  training_window_months: 1,
  window_type: "ROLLING",
  rebalance_frequency: "MONTHLY",
  transaction_cost_bps: 10,
  control_mode: "MAX_EXPOSURE",
  maximum_exposure: 0.6,
  risk_budget: 0.1,
  regime_model: "TREND",
  regime_response: "FIXED",
  defensive_multiplier: 0.5,
  etfs: ["SPY", "IEF"],
  maximum_etf_weight: 0.6,
  risk_aversion: 5,
  covariance_shrinkage: 0.2,
};
const signals = [
  {
    id: "MOMENTUM",
    enabled: true,
    lookback_sessions: 1,
    skip_sessions: 0,
    weight: 1,
  },
];
async function finish(receipt) {
  const deadline = Date.now() + 120000;
  let run;
  do {
    assert.ok(Date.now() < deadline, "Research execution timed out");
    await pause();
    run = await api(`/runs/${receipt.run_id}`);
  } while (["RUNNING", "PENDING"].includes(run.latest_status));
  assert.equal(run.latest_status, "SUCCESS", JSON.stringify(run.latest_result));
  return run;
}
const runs = [];
for (const model of ["HISTORICAL_MEAN", "MANUAL_SCORE", "SIGNAL_RIDGE"]) {
  const forecast = {
    ...caps.default_forecast,
    model,
    signals,
    training_sessions: 8,
    horizon_sessions: 2,
  };
  const plan = await api("/plan", { ...request, forecast });
  assert.equal(plan.normalized_request.dataset_id, datasetId);
  const submitted = await api("/runs", { ...request, forecast }),
    run = await finish(submitted);
  const result = run.latest_successful_result;
  assert.equal(result.provenance.data_snapshot.dataset_id, datasetId);
  assert.equal(result.decisions[0].forecast.model, model);
  if (model === "SIGNAL_RIDGE") {
    assert.ok(
      result.decisions.every((d) => d.forecast.training.training_dates === 8),
    );
    assert.ok(
      result.decisions.every(
        (d) => d.forecast.training.last_label_end <= d.information_cutoff,
      ),
    );
    const rerun = await finish(
      await api(`/runs/${submitted.run_id}/rerun`, {}),
    );
    assert.equal(
      rerun.latest_successful_result.financial_result_hash,
      result.financial_result_hash,
    );
  }
  runs.push({
    model,
    id: submitted.run_id,
    hash: result.financial_result_hash,
  });
  console.log(JSON.stringify({ stage: "MODEL_PASSED", ...runs.at(-1) }));
}
assert.equal(new Set(runs.map((r) => r.hash)).size, 3);
const csv = await fetch(base + `/data/${datasetId}.csv`);
assert.ok(csv.ok);
assert.ok((await csv.text()).startsWith("date,IEF,SPY"));
console.log(
  JSON.stringify({
    stage: "ASSET_FORECAST_SMOKE_PASSED",
    dataset: datasetId,
    runs,
  }),
);
