import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const uiRequire = createRequire(new URL("../artifacts/allocation-lab/package.json", import.meta.url));
const outfile = resolve("artifacts/api-server/dist/execution-runtime.test.mjs");
await build({
  entryPoints: ["research/coordinated/execution-runtime.test.tsx"], outfile,
  bundle: true, platform: "node", format: "esm",
  alias: {
    "@workspace/db": resolve("research/coordinated/institutional-unit-db-shim.ts"),
    "react": uiRequire.resolve("react"),
    "react-dom/server": uiRequire.resolve("react-dom/server"),
  },
  banner: { js: "import {createRequire as cr} from 'node:module';globalThis.require=cr(import.meta.url);" },
});
process.exit(spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" }).status ?? 1);
