import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const outfile = resolve("artifacts/api-server/dist/fetch-progress.test.mjs");
await build({
  entryPoints: ["artifacts/allocation-lab/src/research/fetch-progress.test.tsx"],
  outfile, bundle: true, platform: "node", format: "esm", jsx: "automatic", loader: { ".css": "empty" },
  banner: { js: "import {createRequire as cr} from 'node:module';globalThis.require=cr(import.meta.url);" },
  plugins: [{
    name: "no-database",
    setup(build) {
      build.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "no-database", namespace: "test" }));
      build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
        contents: `export * from ${JSON.stringify(resolve("artifacts/api-server/src/lib/calculator.a1.db-shim.ts"))}; export const pool={query(){throw new Error("No database in progress unit tests")},connect(){throw new Error("No database in progress unit tests")}};`,
        resolveDir: process.cwd(), loader: "ts",
      }));
    },
  }],
});
const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
process.exit(result.status ?? 1);
