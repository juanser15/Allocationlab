import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const outfile = resolve("artifacts/api-server/dist/capital-policy.test.mjs");
await build({
  entryPoints: ["artifacts/allocation-lab/src/research/capital-policy.test.tsx"],
  outfile, bundle: true, platform: "node", format: "esm", jsx: "automatic",
  banner: { js: "import {createRequire as cr} from 'node:module';globalThis.require=cr(import.meta.url);" },
});
const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
process.exit(result.status ?? 1);
