/** Diagnostic-only replay of the published pre-fix reporting source. No private data. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
const base = "0617e7b565806bc17e86688bcfbf3d17eb700575";
const require = createRequire(
  new URL("../artifacts/api-server/package.json", import.meta.url),
);
const { build } = require("esbuild"),
  out = resolve(
    mkdtempSync(resolve(tmpdir(), "allocationlab-fifo-before-")),
    "replay.mjs",
  );
const original = execFileSync(
  "git",
  ["show", `${base}:artifacts/api-server/src/lib/workbench/trading-blotter.ts`],
  { encoding: "utf8" },
);
const marker =
  "    requireValid(\n      quantityClose(\n        sum(queue.map((l) => l.quantity)),";
if (!original.includes(marker))
  throw Error("Pinned baseline diagnostic insertion point changed");
const source = original.replace(
  marker,
  `    if (!quantityClose(sum(queue.map(l=>l.quantity)),position(last.endingPositions,symbol)?.quantity??0)) globalThis.__fifoBefore={symbol,residual:sum(queue.map(l=>l.quantity)),source_ending_quantity:position(last.endingPositions,symbol)?.quantity??0,old_tolerance:1e-10*Math.abs(sum(queue.map(l=>l.quantity)))};\n${marker}`,
);
await build({
  stdin: {
    contents: `import{projectTradingBlotter}from'./artifacts/api-server/src/lib/workbench/trading-blotter';import{inventoryFixture,XLF_DUST_TARGETS,XLY_DUST_TARGETS}from'./tests/p0b/fifo-dust-fixture';
const cases=[];for(const [symbol,targets]of[['XLF',XLF_DUST_TARGETS],['XLY',XLY_DUST_TARGETS]]){try{projectTradingBlotter(inventoryFixture(symbol,targets));throw Error('Baseline unexpectedly passed');}catch(e){if(e.message!=='FIFO open quantities do not reconcile.')throw e;cases.push({...globalThis.__fifoBefore,error_class:e.code,message:e.message});}}
console.log(JSON.stringify({baseline:${JSON.stringify(base)},scope:'ANALYTICAL_FIXTURES_NO_PRIVATE_DATA',instrumentation:'Observation of final quantity values only; matching and assertion unchanged',cases},null,2));`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "pinned-before-source",
      setup(b) {
        b.onLoad({ filter: /workbench\/trading-blotter\.ts$/ }, () => ({
          contents: source,
          loader: "ts",
        }));
      },
    },
  ],
});
const r = spawnSync(process.execPath, [out], { stdio: "inherit" });
process.exitCode = r.status ?? 1;
