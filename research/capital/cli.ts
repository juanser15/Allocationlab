import { readFileSync, readdirSync, existsSync } from "node:fs";
import { parseCsv } from "../../artifacts/api-server/src/lib/calculator";
import { plan, runCampaign, VERSION } from "./engine";
import { hash, generateCandidates, type Campaign } from "./spec";
import { atomicJson, freezeJson, readJson } from "./storage";

const args = process.argv.slice(2), file = args.find(a => a.endsWith(".json"));
if (!file) throw new Error("Usage: node cl03-cli.mjs campaign.json --dry-run | --run [--max-new-jobs N]");
const campaign = JSON.parse(readFileSync(file, "utf8")) as Campaign;
const csv = readFileSync(campaign.data_csv, "utf8");
if (hash(csv) !== campaign.data_sha256) throw new Error("Input CSV hash mismatch");
const rows = parseCsv(csv);
const codePaths = readdirSync("research/capital").filter(p => /\.(ts|py)$/.test(p)).sort().map(p => `research/capital/${p}`)
  .concat(["artifacts/api-server/src/lib/calculator.ts", "artifacts/api-server/src/lib/factor-library.ts", "artifacts/api-server/src/lib/d6-trace.ts", "artifacts/api-server/src/lib/calculator.a1.db-shim.ts"]);
const codeHashes = Object.fromEntries(codePaths.map(p => [p, hash(readFileSync(p, "utf8"))]));
const codeHash = hash(codeHashes), root = `reports/capital-research/${campaign.experiment_id}`;
const planning = plan(campaign, rows), identity = hash({ version: VERSION, campaign, data_hash: hash(rows), code_hash: codeHash });
const dry = { campaign_hash: hash(campaign), code_hash: codeHash, data_csv_hash: hash(csv), ...planning,
  execution_allowed_by_limit: planning.total_jobs_estimated <= campaign.max_jobs };
if (!args.includes("--run")) {
  freezeJson(`${root}/dry-run.json`, dry);
  console.log(JSON.stringify(dry, null, 2));
} else {
  // Force a matching, explicit dry-run before any performance execution.
  if (!existsSync(`${root}/dry-run.json`) || hash(readJson(`${root}/dry-run.json`)) !== hash(dry)) throw new Error("Run --dry-run first with exactly this code, data and campaign");
  freezeJson(`${root}/code-hashes.json`, codeHashes);
  freezeJson(`${root}/pre-performance-freeze.json`, { identity, campaign_hash: hash(campaign), code_hash: codeHash, data_csv_hash: hash(csv),
    candidate_definitions_hash: hash(generateCandidates(campaign).candidates) });
  const limitIndex = args.indexOf("--max-new-jobs");
  const result = runCampaign(campaign, rows, root, { code_hash: codeHash,
    max_new_jobs: limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined });
  // Separate run log from immutable experiment identity/results.
  atomicJson(`${root}/last-invocation.json`, { paused: result.paused, new_jobs: result.new_jobs, reused_jobs: result.reused_jobs });
  console.log(JSON.stringify({ experiment_id: campaign.experiment_id, experiment_hash: result.experiment_hash,
    paused: result.paused, new_jobs: result.new_jobs, reused_jobs: result.reused_jobs, status: result.summary?.status,
    outer_oos: result.summary?.outer_oos }, null, 2));
  if (!result.paused && result.summary?.status !== "COMPLETE") process.exitCode = 1;
}
