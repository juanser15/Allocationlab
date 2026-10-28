import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const outfile = resolve("artifacts/api-server/dist/institutional.test.mjs");
await build({
  entryPoints: ["research/coordinated/institutional.test.ts"], outfile,
  bundle: true, packages: "external", platform: "node", format: "esm",
  alias: { "@workspace/db": resolve("research/coordinated/institutional-unit-db-shim.ts") },
  banner: { js: "import {createRequire as cr} from 'node:module';globalThis.require=cr(import.meta.url);" },
});
const test = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
process.exit(test.status ?? 1);
