/** Source-only synthetic reporting tests. Database access is forbidden. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
const require = createRequire(
  new URL("../artifacts/api-server/package.json", import.meta.url),
);
const ui = createRequire(
  new URL("../artifacts/allocation-lab/package.json", import.meta.url),
);
const { build } = require("esbuild"),
  out = mkdtempSync(resolve(tmpdir(), "allocationlab-p0b-tests-"));
const entries = {
  financial: "tests/p0b/blotter.test.ts",
  dust: "tests/p0b/fifo-dust.test.ts",
  frontend: "tests/p0b/blotter-ui.test.tsx",
};
await build({
  entryPoints: entries,
  outdir: out,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "empty" },
  alias: {
    express: require.resolve("express"),
    "@workspace/db": resolve(
      "research/coordinated/institutional-unit-db-shim.ts",
    ),
    react: ui.resolve("react"),
    "react/jsx-runtime": ui.resolve("react/jsx-runtime"),
    "react-dom/server": ui.resolve("react-dom/server"),
  },
  banner: {
    js: `import{createRequire as cr}from'node:module';globalThis.require=cr(${JSON.stringify(require.resolve("express"))});`,
  },
});
const env = { ...process.env, WORKBENCH_PREVIEW_OPEN: "0", DATABASE_URL: "" };
const result = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-concurrency=1",
    ...Object.keys(entries).map((k) => resolve(out, k + ".mjs")),
  ],
  { stdio: "inherit", env },
);
process.exitCode = result.status ?? 1;
