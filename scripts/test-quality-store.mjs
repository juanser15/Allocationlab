import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const outfile = resolve("lib/db/dist/quality-store-validation.mjs");
await build({
  entryPoints: ["scripts/verify-quality-store.ts"], outfile,
  bundle: true, external: ["pg", "pg-native"], platform: "node", format: "esm",
  alias: { "@workspace/db": resolve("lib/db/src/index.ts") },
  banner: { js: "import {createRequire as cr} from 'node:module';globalThis.require=cr(import.meta.url);" },
});
const result = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
process.exit(result.status ?? 1);
