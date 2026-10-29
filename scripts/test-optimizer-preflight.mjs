import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const uiRequire = createRequire(new URL("../artifacts/allocation-lab/package.json", import.meta.url));
const outdir = resolve("artifacts/api-server/dist/optimizer-preflight-tests");
await build({
  entryPoints: {
    backend: "research/coordinated/optimizer-preflight.test.ts",
    frontend: "artifacts/allocation-lab/src/research/optimizer-inputs.test.tsx",
  },
  outdir, outExtension: { ".js": ".mjs" }, bundle: true, platform: "node", format: "esm", jsx: "automatic", loader: { ".css": "empty" },
  alias: {
    "@workspace/db": resolve("research/coordinated/institutional-unit-db-shim.ts"),
    "react": uiRequire.resolve("react"), "react/jsx-runtime": uiRequire.resolve("react/jsx-runtime"),
    "react-dom/server": uiRequire.resolve("react-dom/server"),
  },
  banner: { js: "import {createRequire as cr} from 'node:module';globalThis.require=cr(import.meta.url);" },
});
process.exit(spawnSync(process.execPath, ["--test", resolve(outdir, "backend.mjs"), resolve(outdir, "frontend.mjs")], { stdio: "inherit" }).status ?? 1);
