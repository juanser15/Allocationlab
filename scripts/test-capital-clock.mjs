import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const common = { bundle: true, packages: "external", platform: "node", format: "esm",
  alias: { "@workspace/db": resolve("research/coordinated/institutional-unit-db-shim.ts") },
  banner: { js: "import {createRequire as cr} from 'node:module';globalThis.require=cr(import.meta.url);" } };
if (process.argv.includes("--capture-pre-clock")) {
  const source = execFileSync("git", ["show", "HEAD:research/coordinated/engine.ts"], { encoding: "utf8" });
  if (source.includes("capital_signal_frequency") || source.includes("capital_clock:")) throw new Error("HEAD is not the pre-clock engine; never replace the frozen golden fixture with the current engine.");
  await build({ ...common, banner: {}, stdin: { contents: source, resolveDir: resolve("research/coordinated"), loader: "ts" }, outfile: "artifacts/api-server/dist/pre-clock-engine.mjs" });
  await build({ ...common, stdin: { contents: `
    import {runCoordinated} from "./artifacts/api-server/dist/pre-clock-engine.mjs";
    import {clockData,legacyCases} from "./research/coordinated/capital-clock-fixtures";
    import {normalizeP0WithData,engineRequest} from "./artifacts/api-server/src/lib/workbench/p0-calendar";
    const data=clockData(), hashes={};
    for(const {name,request} of legacyCases()) hashes[name]=runCoordinated({...normalizeP0WithData(request,data),...engineRequest(request)},data).financial_result_hash;
    console.log(JSON.stringify({description:"Financial hashes captured from the pre-separate-clock engine; TEST_ONLY deterministic fixture, not market performance evidence.",hashes},null,2));
  `, resolveDir: process.cwd(), loader: "ts" }, outfile: "artifacts/api-server/dist/capture-pre-clock.mjs" });
  process.exit(spawnSync(process.execPath, ["artifacts/api-server/dist/capture-pre-clock.mjs"], { stdio: "inherit" }).status ?? 1);
}
const outfile = resolve("artifacts/api-server/dist/capital-clock.test.mjs");
await build({ ...common, entryPoints: ["research/coordinated/capital-clock.test.ts"], outfile });
process.exit(spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" }).status ?? 1);
