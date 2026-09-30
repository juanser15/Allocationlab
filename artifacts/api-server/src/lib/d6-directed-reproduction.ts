import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runB3Validation } from "./b3-policy";
import { d6TraceContext, withD6Trace } from "./d6-trace";

const directory = resolve("../../reports/d6-general-correction");
mkdirSync(directory, { recursive: true });
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
async function get(path: string) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response.json();
}
const existing = await get("/validation-runs?allocationId=291");
const allocation = await get("/allocations/291");
const policy = await get("/prepared-inputs/316");
const evaluation = await get("/prepared-inputs/317");
const failed = await get("/validation-runs/515");
if (allocation.preparedInputId !== 316 || failed.validationPreparedInputId !== 317 ||
    allocation.status !== "SOLVED" || failed.status !== "failed")
  throw new Error("Retained identity mismatch");
writeFileSync(`${directory}/frozen-inputs.json`, JSON.stringify({ existing, allocation, policy, evaluation, failed }));
const context = d6TraceContext();
console.log("DIRECTED_REPRODUCTION_START", context.id, new Date().toISOString());
const result = withD6Trace(context, () => runB3Validation(
  policy.snapshot, allocation.request, evaluation.snapshot, failed.assumptions,
));
writeFileSync(`${directory}/reproduction-result.json`, JSON.stringify(result));
console.log("DIRECTED_REPRODUCTION_END", result.status, result.reason, new Date().toISOString());