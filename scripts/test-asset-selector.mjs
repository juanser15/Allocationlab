import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const outfile = resolve("generated-artifacts/asset-selector/test.mjs");
await build({
  entryPoints: ["artifacts/allocation-lab/src/research/asset-multiselect.test.tsx"],
  outfile, bundle: true, platform: "node", format: "esm", jsx: "automatic",
  loader: { ".css": "empty" },
  banner: { js: "import {createRequire as cr} from 'node:module';globalThis.require=cr(import.meta.url);" },
});
const run = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
process.exit(run.status ?? 1);
