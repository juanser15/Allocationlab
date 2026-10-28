import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const outfile = resolve("generated-artifacts/backtest-range/test.mjs");
await build({
  entryPoints: ["artifacts/allocation-lab/src/research/backtest-range.test.ts"],
  outfile, bundle: true, platform: "node", format: "esm",
});
const run = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
process.exit(run.status ?? 1);
