import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(
  new URL("../artifacts/api-server/package.json", import.meta.url),
);
const { build } = require("esbuild");
const output = resolve("artifacts/api-server/dist/coordinated.test.mjs");
await build({
  entryPoints: ["research/coordinated/coordinated.test.ts"],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  alias: {
    "@workspace/db": resolve(
      "artifacts/api-server/src/lib/calculator.a1.db-shim.ts",
    ),
  },
  banner: {
    js: "import {createRequire as cr} from 'node:module';globalThis.require=cr(import.meta.url);",
  },
});
const result = spawnSync(process.execPath, ["--test", output], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
