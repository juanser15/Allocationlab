import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const BASE = "http://localhost:80/api";
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`
    : JSON.stringify(value);
const save = async (file, value) => fs.writeFile(path.join(DIR, file), JSON.stringify(value, null, 2));
const load = async file => JSON.parse(await fs.readFile(path.join(DIR, file), "utf8"));
const exists = async file => fs.access(path.join(DIR, file)).then(() => true, () => false);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(name, endpoint, body, options = {}) {
  if (body) await save(`${name}.request.json`, body);
  const startedAt = new Date().toISOString();
  const response = await fetch(BASE + endpoint, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(options.timeout ?? 7200000),
  });
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); } catch { value = { nonJsonBody: text }; }
  await save(`${name}.response.json`, value);
  await save(`${name}.transport.json`, { endpoint, method: body ? "POST" : "GET", status: response.status, startedAt, completedAt: new Date().toISOString(), responseSha256: sha(text) });
  if (!response.ok && !options.allowError) throw new Error(`${name}: HTTP ${response.status}; ${JSON.stringify(value).slice(0, 1000)}`);
  return value;
}
async function progress(phase, detail = {}) {
  const status = { at: new Date().toISOString(), phase, ...detail };
  await save("progress.json", status);
  console.log(JSON.stringify(status));
}
const assumptions = {
  evaluationStartDate: "2016-10-01", evaluationEndDate: "2026-09-30",
  decisionCalendar: "monthly", executionTiming: "next_close",
  initialNav: 100000, initialHoldings: {}, initialCash: 100000,
  transactionCostBps: 10, slippageBps: 5, dailyCashYield: 0, benchmarkTicker: "SPY",
};
async function allocation(name, preparation, forecastModel, universe) {
  if (await exists(`${name}-allocation.response.json`)) return load(`${name}-allocation.response.json`);
  const body = {
    preparedInputId: preparation.preparedInputId,
    candidateIds: preparation.candidates.map(c => c.candidateId),
    informationCutoff: "2026-09-30", decisionTimestamp: "2026-10-01T00:00:00Z",
    estimationWindow: 252, minObservations: 60,
    representation: preparation.representation, returnConvention: "daily_decimal",
    expectedReturnShrinkage: 0, covarianceDiagonalShrinkage: 0.2,
    allocationMode: "CAPITAL_LONG_ONLY", dailyCashYield: 0,
    objective: { type: "regularized_mean_variance", gamma: 1, eta: 0 },
    forecastModel,
    constraints: {
      totalCash: { min: 0.1, max: 0.2 },
      assetBounds: Object.fromEntries(universe.map(ticker => [ticker, { min: 0, max: 0.3 }])),
    },
  };
  await progress(`${name}: computing current B2 allocation`, { preparedInputId: preparation.preparedInputId });
  const result = await api(`${name}-allocation`, "/allocations", body);
  await progress(`${name}: current B2 result`, { allocationId: result.id, status: result.status, reason: result.result?.reason });
  return result;
}
async function validate(name, allocation, preparation) {
  if (await exists(`${name}-validation.response.json`)) return load(`${name}-validation.response.json`);
  const submissionFile = `${name}-job.request.json`;
  const submission = await exists(submissionFile) ? await load(submissionFile) : {
    idempotencyKey: `oct2026-${name}-${crypto.randomUUID()}`,
    request: { allocationId: allocation.id, validationPreparedInputId: preparation.preparedInputId, assumptions },
  };
  let job = await exists(`${name}-job.response.json`) ? await load(`${name}-job.response.json`) : null;
  if (!job?.jobId) {
    job = await api(`${name}-job`, "/validation-jobs", submission, { allowError: true });
    if (!job.jobId) {
      await progress(`${name}: uncertain submission, recovering SAME idempotency key`);
      const jobs = await api(`${name}-job-recovery-list`, `/validation-jobs?allocationId=${allocation.id}`);
      await save(`${name}-job-recovery-evidence.json`, jobs);
      await sleep(5000);
      job = await api(`${name}-job-recovery-submit`, "/validation-jobs", submission);
      if (!job.jobId) throw new Error("Submission recovery did not return job identity");
      await save(`${name}-job.response.json`, job);
    }
  }
  await progress(`${name}: validation job`, { jobId: job.jobId, allocationId: allocation.id, status: job.status });
  let poll = 0;
  while (!["completed", "failed"].includes(job.status)) {
    await sleep(15000);
    try {
      const next = await api(`${name}-job-latest`, `/validation-jobs/${job.jobId}`);
      job = next;
      if (++poll % 4 === 1 || ["completed", "failed"].includes(job.status))
        await progress(`${name}: validation job`, { jobId: job.jobId, status: job.status, jobPhase: job.phase, validationRunId: job.validationRunId, error: job.error });
    } catch (error) {
      await save(`${name}-poll-error-${Date.now()}.json`, { error: String(error), jobId: job.jobId });
    }
  }
  await save(`${name}-job-terminal.json`, job);
  if (job.validationRunId) return api(`${name}-validation`, `/validation-runs/${job.validationRunId}`);
  return null;
}
async function main() {
  const prices = await api("source-price-status", "/prices/status");
  const factors = await api("source-factor-library", "/factors/library");
  const activeFactors = factors.factors.filter(f => f.enabled && f.status === "active");
  if (factors.version !== "v1.4" || activeFactors.length !== 7) throw new Error("Approved factor set changed");
  if (prices.rowCount !== 4023 || prices.endDate !== "2026-09-30") throw new Error("Approved dataset coverage changed");
  const universe = prices.tickers.filter(t => !["XLC", "XLRE"].includes(t));
  const prepRequest = { representation: "asset_returns", assetTickers: universe, factorIds: [], alphaDefinitions: [], cutoffDate: "2026-09-30" };
  const prep = await exists("assets-preparation.response.json") ? await load("assets-preparation.response.json") : await api("assets-preparation", "/prepared-inputs", prepRequest);
  const csv = prep.snapshot.dataset.csvContent.trim().split(/\r?\n/).map(line => line.split(","));
  const header = csv.shift();
  const priorRows = csv.filter(row => row[0] < "2016-10-01");
  const requiredHistory = Math.max(...activeFactors.map(f => f.lookback + f.lag + 2)) + 252 + 2;
  const coverage = prices.tickers.map(ticker => {
    const index = header.indexOf(ticker);
    const valid = row => index >= 0 && row[index] !== "" && Number.isFinite(Number(row[index])) && Number(row[index]) > 0;
    const observed = csv.filter(valid);
    const before = priorRows.filter(valid);
    const eligible = priorRows.length >= requiredHistory && priorRows.slice(-requiredHistory).every(valid);
    return { ticker, firstObservation: observed[0]?.[0] ?? null, lastObservation: observed.at(-1)?.[0] ?? null, priorObservations: before.length, trailingRequiredObservations: requiredHistory, eligible, reason: eligible ? "At least 509 contiguous observations preceding evaluation start, covering longest frozen factor history + full 252-date training + label maturity." : `Insufficient pre-evaluation contiguous history for ${requiredHistory}-observation threshold.` };
  });
  if (coverage.filter(c => c.eligible).map(c => c.ticker).sort().join() !== [...universe].sort().join()) throw new Error("Coverage-based eligible universe differs from expected 20; inspect before proceeding");
  if (prep.snapshot.dataset.id !== 22 || prep.status !== "READY") throw new Error("Unexpected frozen data identity/readiness");
  const freeze = {
    datasetId: prep.snapshot.dataset.id, datasetHash: prep.snapshot.dataset.sha256,
    datasetStart: prep.snapshot.dataset.startDate, datasetEnd: prep.snapshot.dataset.endDate,
    factorSetVersion: prep.snapshot.factorSet.version, factorSetHash: sha(canonical(prep.snapshot.factorSet)),
    assetPreparedInputId: prep.preparedInputId, universe, coverage,
    eligibilityRule: `Require ${requiredHistory} contiguous positive close observations immediately before 2016-10-01: max factor lookback+lag+2 (${requiredHistory - 254}) +252 training dates +2 next-close label-maturity buffer. No future-performance selection.`,
    provenance: "Persisted adjusted-close CSV; vendor authenticity unverified. Neither vendor verification nor synthetic origin is established.",
    factorIds: activeFactors.map(f => f.id), assumptions,
  };
  await save("freeze.json", freeze);
  await progress("DATA FROZEN: 20 eligible assets, 7 active factors", freeze);
  const assets = await allocation("assets", prep, { type: "SAMPLE_MEAN", displayZ: 1.96 }, universe);
  await validate("assets", assets, prep);
  const signals = await allocation("signals", prep, {
    type: "SIGNAL_RIDGE", factorIds: freeze.factorIds, lambdaSignal: 1,
    trainingWindowDates: 252, minTrainingDates: 60, hacBandwidth: 0, executionTiming: "next_close", displayZ: 1.96,
  }, universe);
  await validate("signals", signals, prep);
  await progress("alpha: preparing seven cross-sectional streams; full leading history retained");
  const alphaRequest = { ...prepRequest, representation: "alpha_streams", factorIds: freeze.factorIds,
    alphaDefinitions: activeFactors.map(f => ({
      name: `Oct2026 ${f.id} cross-sectional long-only`, factorId: f.id, assetTickers: universe,
      mapping: "cross_sectional_long_only", signalUnits: "oriented", threshold: 0, grossFraction: 1,
      rebalanceFrequency: "monthly", executionTiming: "next_close", transactionCostBps: 10, slippageBps: 5, cashYieldAnnual: 0,
    })),
  };
  const alphaPrep = await exists("alpha-preparation.response.json") ? await load("alpha-preparation.response.json")
    : await api("alpha-preparation", "/prepared-inputs", alphaRequest);
  if (alphaPrep.snapshot.dataset.sha256 !== freeze.datasetHash || sha(canonical(alphaPrep.snapshot.factorSet)) !== freeze.factorSetHash)
    throw new Error("Alpha preparation source/factor hashes differ from frozen common source");
  if (alphaPrep.status !== "READY") throw new Error(`Alpha preparation not READY: ${alphaPrep.status}`);
  const alpha = await allocation("alpha", alphaPrep, { type: "SAMPLE_MEAN", displayZ: 1.96 }, universe);
  await validate("alpha", alpha, alphaPrep);
  await progress("All three strategy attempts finished; export analysis next");
}
export { api, load, save, progress, validate, assumptions };
if (process.argv[1] === new URL(import.meta.url).pathname) main().catch(async error => {
  await save("execution-error.json", { at: new Date().toISOString(), error: String(error), stack: error.stack });
  await progress("EXECUTION BLOCKED", { error: String(error) });
  process.exitCode = 1;
});