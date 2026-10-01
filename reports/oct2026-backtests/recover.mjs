import { api, load, save, progress, validate, assumptions } from "./execute.mjs";
import crypto from "node:crypto";
const action = process.argv[2];
const prep = await load("assets-preparation.response.json");
if (action === "allocate") {
  const original = await load("assets-allocation.request.json");
  // Nonnegative candidate weights already guarantee nonnegative assets for the
  // identity mapping. Removing redundant zero lower bounds preserves economics.
  const constraints = structuredClone(original.constraints);
  for (const bounds of Object.values(constraints.assetBounds)) delete bounds.min;
  const assets = await api("assets-equivalent-allocation", "/allocations", { ...original, constraints });
  await progress("Equivalent-constraint asset allocation", { id: assets.id, status: assets.status, reason: assets.result?.reason });
  await save("recovery-plan.json", {
    reason: "Independent KKT certification failed in original asset B2; first try eliminates redundant zero underlying lower bounds (candidate nonnegativity implies these). No economic assumption changed.",
    gamma: 1, eta: 0,
    ridgeCurrentTargetLimitation: "Sep30 cutoff / Oct1 decision is unavailable. Latest executable next_close policy reference uses cutoff Sep28, decision Sep29, execution calendar Sep30. This is a stale reference, not an Oct1 target or an executed trade.",
    alphaLimitation: "Seven-stream full-history snapshot insertion failed through existing B1 API. Response exposes SQL+313MB parameter, but not underlying driver cause; suspected oversized JSONB. No dataset truncation or synthetic replacement authorized.",
  });
  const originalSignals = await load("signals-allocation.request.json");
  const signals = await api("signals-reference-allocation", "/allocations", {
    ...originalSignals, constraints, informationCutoff: "2026-09-28", decisionTimestamp: "2026-09-29T00:00:00Z",
    forecastModel: { ...originalSignals.forecastModel, factorIds: ["momentum", "mean_reversion"] },
  });
  await progress("Stale policy reference Ridge allocation", { id: signals.id, status: signals.status, reason: signals.result?.reason });
} else if (action === "allocate-gamma100" || action === "allocate-gamma10") {
  const gamma = action === "allocate-gamma10" ? 10 : 100;
  const settings = {
    reason: `Common risk-aversion increase, gamma${gamma}, selected solely after gamma1 independent-certification failure and before reviewing any backtest performance. Changes economic risk/return tradeoff; not a performance-tuned choice.`,
    objective: { type: "regularized_mean_variance", gamma, eta: 0 },
  };
  await save(`gamma${gamma}-common-recovery.json`, settings);
  for (const [name, requestFile] of [["assets", "assets-equivalent-allocation.request.json"], ["signals", "signals-reference-allocation.request.json"]]) {
    const request = await load(requestFile);
    const result = await api(`${name}-gamma${gamma}-allocation`, "/allocations", { ...request, objective: settings.objective });
    await progress(`${name}: gamma${gamma} allocation`, { id: result.id, status: result.status, reason: result.result?.reason });
  }
} else if (action === "prepare-alpha2") {
  const original = await load("alpha-preparation.request.json");
  const selectedFactors = ["momentum", "mean_reversion"];
  await save("factor-count-recovery.json", {
    selectedFactors,
    reason: "Reduced from seven to two active frozen factors solely to bound snapshot size/computation after full-seven B1 insert failed. Selected momentum and mean_reversion a priori as supported medium-term trend and short-term reversal inputs, not using realized backtest performance.",
    appliesTo: ["signals", "alpha"], libraryVersionUnchanged: "v1.4",
  });
  const result = await api("alpha2-preparation", "/prepared-inputs", {
    ...original, factorIds: selectedFactors,
    alphaDefinitions: original.alphaDefinitions.filter(d => selectedFactors.includes(d.factorId)),
  });
  await progress("alpha2 preparation", { preparedInputId: result.preparedInputId, status: result.status });
} else if (action === "allocate-alpha2") {
  const alphaPrep = await load("alpha2-preparation.response.json");
  const base = await load(`assets-${process.argv[3] ?? "equivalent"}-allocation.request.json`);
  const result = await api("alpha-allocation", "/allocations", {
    ...base, preparedInputId: alphaPrep.preparedInputId, representation: "alpha_streams",
    candidateIds: alphaPrep.candidates.map(c => c.candidateId),
  });
  await progress("alpha allocation", { id: result.id, status: result.status, reason: result.result?.reason });
} else if (action === "submit-final") {
  for (const [name, file, preparationId] of [
    ["assets-gamma100", "assets-gamma100-allocation.response.json", 339],
    ["signals-gamma100", "signals-gamma100-allocation.response.json", 339],
    ["alpha", "alpha-allocation.response.json", 340],
  ]) {
    const allocation = await load(file);
    let request;
    try { request = await load(`${name}-job.request.json`); } catch {
      request = { idempotencyKey: `oct2026-${name}-${crypto.randomUUID()}`, request: {
        allocationId: allocation.id, validationPreparedInputId: preparationId, assumptions,
      } };
    }
    const job = await api(`${name}-job`, "/validation-jobs", request);
    await progress(`${name}: final job submitted`, { jobId: job.jobId, status: job.status, allocationId: allocation.id });
  }
} else if (action === "poll-final-once") {
  for (const name of ["signals-gamma10", "assets-gamma100", "signals-gamma100", "alpha"]) {
    const submission = await load(`${name}-job.response.json`);
    const job = await api(`${name}-job-latest`, `/validation-jobs/${submission.jobId}`);
    if (["completed", "failed"].includes(job.status)) {
      await save(`${name}-job-terminal.json`, job);
      if (job.validationRunId) {
        let already = false;
        try { already = (await load(`${name}-validation.response.json`)).validationRunId === job.validationRunId; } catch {}
        if (!already) await api(`${name}-validation`, `/validation-runs/${job.validationRunId}`);
      }
    }
    await progress(`${name}: latest job status`, { jobId: job.jobId, status: job.status, phase: job.phase, validationRunId: job.validationRunId, error: job.error });
  }
} else if (action === "validate-alpha") {
  await validate("alpha", await load("alpha-allocation.response.json"), await load("alpha2-preparation.response.json"));
} else if (action === "validate-assets" || action === "validate-signals") {
  const name = action.slice("validate-".length);
  const suffix = process.argv[3] ?? (name === "assets" ? "equivalent" : "reference");
  const allocation = await load(`${name}-${suffix}-allocation.response.json`);
  await validate(`${name}-${suffix}`, allocation, prep);
} else {
  throw new Error("Specify supported recovery action");
}