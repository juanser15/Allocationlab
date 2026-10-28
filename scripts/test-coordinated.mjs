import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
const require = createRequire(
  new URL("../artifacts/api-server/package.json", import.meta.url),
);
const { build } = require("esbuild");
const output = resolve("artifacts/api-server/dist/coordinated.test.mjs");
const regressionFiles = [
  [
    "artifacts/api-server/src/lib/workbench/interactive.test.ts",
    "interactive-regression.test.mjs",
  ],
  [
    "artifacts/allocation-lab/src/research/product-reset.test.ts",
    "product-reset-regression.test.mjs",
  ],
];
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
for (const [entry, name] of regressionFiles)
  await build({
    entryPoints: [entry],
    outfile: resolve("artifacts/api-server/dist", name),
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    loader: { ".css": "empty" },
    alias: {
      "@workspace/db": resolve(
        "artifacts/api-server/src/lib/calculator.a1.db-shim.ts",
      ),
    },
    banner: {
      js: "import {createRequire as cr} from 'node:module';globalThis.require=cr(import.meta.url);",
    },
  });
const datasetDirectory = mkdtempSync(
  resolve(tmpdir(), "allocationlab-test-datasets-"),
);
const result = spawnSync(
  process.execPath,
  [
    "--test",
    output,
    ...regressionFiles.map(([, name]) =>
      resolve("artifacts/api-server/dist", name),
    ),
  ],
  {
    stdio: "inherit",
    env: { ...process.env, WORKBENCH_DATASET_DIR: datasetDirectory },
  },
);
if (
  !datasetDirectory.startsWith(
    resolve(tmpdir(), "allocationlab-test-datasets-"),
  )
)
  throw Error("Unexpected test dataset directory");
rmSync(datasetDirectory, { recursive: true, force: true });
process.exit(result.status ?? 1);
