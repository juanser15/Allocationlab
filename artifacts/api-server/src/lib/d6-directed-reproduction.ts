import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runB3Validation } from "./b3-policy";
import { d6TraceContext, withD6Trace } from "./d6-trace";
import {
  GetAllocationResponse, GetPreparedInputResponse, GetValidationRunResponse,
  ListValidationRunsResponse, GetFactorLibraryResponse, PrepareInputsBody,
} from "@workspace/api-zod";
import type { PreparedCandidate, PreparedSnapshot } from "./prepared-inputs";
import type { AllocationRequest } from "./allocation-b2";

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON object.");
  return Object.fromEntries(Object.entries(value));
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected a JSON array.");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a string.");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected a finite number.");
  return value;
}
const nullableNumber = (value: unknown) => value === null ? null : number(value);
const numbers = (value: unknown) => Object.fromEntries(Object.entries(record(value))
  .map(([key, item]) => [key, number(item)]));
const strings = (value: unknown) => array(value).map(text);
const alphaSchema = PrepareInputsBody.shape.alphaDefinitions.element;
function candidate(value: unknown): PreparedCandidate {
  const c = record(value);
  return {
    ...c,
    candidateId: text(c.candidateId), canonicalFingerprint: text(c.canonicalFingerprint),
    name: text(c.name), kind: GetPreparedInputResponse.shape.representation.parse(c.kind),
    status: GetPreparedInputResponse.shape.status.parse(c.status), reasons: strings(c.reasons),
    ...(c.factorId === undefined ? {} : { factorId: text(c.factorId) }),
    assetTickers: strings(c.assetTickers),
    ...(c.mapping === undefined ? {} : { mapping: alphaSchema.shape.mapping.parse(c.mapping) }),
    ...(c.signalUnits === undefined ? {} : { signalUnits: alphaSchema.shape.signalUnits.parse(c.signalUnits) }),
    targetAssetExposures: numbers(c.targetAssetExposures), actualAssetExposures: numbers(c.actualAssetExposures),
    targetHistory: array(c.targetHistory).map((value) => {
      const row = record(value);
      return { ...row, signalDate: text(row.signalDate), informationCutoff: text(row.informationCutoff),
        executionDate: row.executionDate === null ? null : text(row.executionDate), targetPositions: numbers(row.targetPositions) };
    }),
    residualCash: nullableNumber(c.residualCash),
    signalSeries: array(c.signalSeries).map((value) => {
      const row = record(value);
      return { ...row, ticker: text(row.ticker), peerUniverse: strings(row.peerUniverse), date: text(row.date),
        informationCutoff: text(row.informationCutoff), value: nullableNumber(row.value),
        rawValue: nullableNumber(row.rawValue), transformedValue: nullableNumber(row.transformedValue),
        winsorizedValue: nullableNumber(row.winsorizedValue), orientedValue: nullableNumber(row.orientedValue),
        normalizedValue: nullableNumber(row.normalizedValue) };
    }),
    returnSeries: array(c.returnSeries).map((value) => {
      const row = record(value);
      return { ...row, date: text(row.date), value: nullableNumber(row.value) };
    }),
    ledger: array(c.ledger), lineage: record(c.lineage), diagnostics: record(c.diagnostics),
  };
}
function snapshot(value: unknown): PreparedSnapshot {
  const s = record(value), dataset = record(s.dataset), factors = record(s.factorSet), request = record(s.request);
  if (s.schemaVersion !== 1) throw new Error("Unsupported prepared snapshot schema.");
  return {
    ...s, schemaVersion: 1, engineVersion: text(s.engineVersion), a1EngineVersion: text(s.a1EngineVersion),
    representation: GetPreparedInputResponse.shape.representation.parse(s.representation),
    dataset: { ...dataset, id: nullableNumber(dataset.id), sha256: text(dataset.sha256),
      csvContent: text(dataset.csvContent), startDate: text(dataset.startDate), endDate: text(dataset.endDate),
      tickers: strings(dataset.tickers), priceConvention: text(dataset.priceConvention) },
    factorSet: { ...factors, version: text(factors.version), factors: GetFactorLibraryResponse.shape.factors.parse(factors.factors) },
    request: { ...request, ...PrepareInputsBody.omit({ cutoffDate: true }).parse(request),
      ...(request.cutoffDate === undefined ? {} : { cutoffDate: text(request.cutoffDate) }) },
    coverage: record(s.coverage), candidates: array(s.candidates).map(candidate), dependence: record(s.dependence),
    suppliedWeights: numbers(s.suppliedWeights), createdAt: text(s.createdAt),
  };
}

const directory = resolve("../../reports/d6-general-correction");
mkdirSync(directory, { recursive: true });
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
async function get(path: string) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response.json();
}
const existing = ListValidationRunsResponse.parse(await get("/validation-runs?allocationId=291"));
const allocation = GetAllocationResponse.parse(await get("/allocations/291"));
const policy = GetPreparedInputResponse.parse(await get("/prepared-inputs/316"));
const evaluation = GetPreparedInputResponse.parse(await get("/prepared-inputs/317"));
const failed = GetValidationRunResponse.parse(await get("/validation-runs/515"));
if (!("allocationId" in failed)) throw new Error("Expected a B3 validation.");
if (allocation.preparedInputId !== 316 || failed.validationPreparedInputId !== 317 ||
    allocation.status !== "SOLVED" || failed.status !== "failed")
  throw new Error("Retained identity mismatch");
const forecast = allocation.request.forecastModel;
if (!forecast || forecast.type !== "SIGNAL_RIDGE" || forecast.factorIds === undefined ||
    forecast.lambdaSignal === undefined || forecast.trainingWindowDates === undefined ||
    forecast.minTrainingDates === undefined || forecast.hacBandwidth === undefined ||
    forecast.executionTiming === undefined)
  throw new Error("Retained reproduction requires a complete frozen SIGNAL_RIDGE configuration.");
const request: AllocationRequest = { ...allocation.request, forecastModel: {
  ...forecast, type: "SIGNAL_RIDGE", factorIds: forecast.factorIds, lambdaSignal: forecast.lambdaSignal,
  trainingWindowDates: forecast.trainingWindowDates, minTrainingDates: forecast.minTrainingDates,
  hacBandwidth: forecast.hacBandwidth, executionTiming: forecast.executionTiming,
} };
writeFileSync(`${directory}/frozen-inputs.json`, JSON.stringify({ existing, allocation, policy, evaluation, failed }));
const context = d6TraceContext();
console.log("DIRECTED_REPRODUCTION_START", context.id, new Date().toISOString());
const result = withD6Trace(context, () => runB3Validation(
  snapshot(policy.snapshot), request, snapshot(evaluation.snapshot), failed.assumptions,
));
writeFileSync(`${directory}/reproduction-result.json`, JSON.stringify(result));
console.log("DIRECTED_REPRODUCTION_END", result.status, result.reason, new Date().toISOString());