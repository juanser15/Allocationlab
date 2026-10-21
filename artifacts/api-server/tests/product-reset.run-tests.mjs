// Reproducible local checks. No installation, network or deployment is performed.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readdirSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
process.chdir(root);
const empirical = process.argv.includes("--empirical"),
  browser = process.argv.includes("--browser");
const env = {
  ...process.env,
  NODE_ENV: "production",
  LOG_LEVEL: "silent",
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://agent@127.0.0.1:55432/allocationlab",
  VALIDATION_JOB_WORKER_DISABLED: "1",
  WORKBENCH_B3C1_ACCEPTANCE: "0",
};
for (const name of [
  "WORKBENCH_EMPIRICAL_ACCEPTANCE",
  "WORKBENCH_B2_EMPIRICAL_ACCEPTANCE",
  "WORKBENCH_B3A_ACCEPTANCE",
  "WORKBENCH_B3A_PIT",
  "WORKBENCH_B3C_ACCEPTANCE",
])
  env[name] = empirical ? "1" : "0";
const run = (command, args, extra = {}) => {
  const r = spawnSync(command, args, {
    cwd: root,
    env: { ...env, ...extra },
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error("Check failed: " + args.join(" "));
};
run(process.execPath, ["artifacts/api-server/build.mjs"]);
const banner = {
  js: "import{createRequire as __cr}from'node:module';import{fileURLToPath as __u}from'node:url';import{dirname as __d}from'node:path';globalThis.require=__cr(import.meta.url);globalThis.__filename=__u(import.meta.url);globalThis.__dirname=__d(globalThis.__filename);",
};
const backend = [],
  frontend = [];
for (const name of readdirSync("artifacts/api-server/src/lib/workbench").filter(
  (x) => x.endsWith(".test.ts"),
)) {
  const entry = resolve("artifacts/api-server/src/lib/workbench", name),
    out = resolve(
      "artifacts/api-server/dist",
      "reset-" + name.replace(".ts", ".mjs"),
    );
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["pdfkit", "pg-native"],
    banner,
  });
  backend.push(out);
}
for (const dir of ["src/lib", "src/components/portfolio-lab", "src/research"])
  for (const name of readdirSync("artifacts/allocation-lab/" + dir).filter(
    (x) => x.endsWith(".test.ts"),
  )) {
    const entry = resolve("artifacts/allocation-lab", dir, name),
      out = resolve(
        "artifacts/allocation-lab/dist",
        "reset-" + name.replace(".ts", ".mjs"),
      );
    await build({
      entryPoints: [entry],
      outfile: out,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      jsx: "automatic",
      alias: { "@": resolve("artifacts/allocation-lab/src") },
      define: { "import.meta.url": JSON.stringify(pathToFileURL(entry).href) },
      loader: { ".css": "empty" },
      banner,
    });
    frontend.push(out);
  }
for (const p of [
  "artifacts/api-server",
  "research/workbench",
  "artifacts/allocation-lab",
])
  run(process.execPath, [
    "node_modules/typescript/bin/tsc",
    "-p",
    p + "/tsconfig.json",
    "--noEmit",
  ]);
run(process.execPath, ["--test", "--test-concurrency=1", ...backend]);
run(process.execPath, ["--test", "--test-concurrency=1", ...frontend]);
run(
  process.execPath,
  [
    "artifacts/allocation-lab/node_modules/vite/bin/vite.js",
    "build",
    "--config",
    "artifacts/allocation-lab/vite.config.ts",
  ],
  { PORT: "5173", BASE_PATH: "/" },
);
if (empirical) {
  await build({
    entryPoints: ["research/workbench/interactive-reference.ts"],
    outfile: "artifacts/api-server/dist/product-reset-reference.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    alias: {
      "@workspace/db": resolve(
        "artifacts/api-server/src/lib/calculator.a1.db-shim.ts",
      ),
    },
    external: ["pdfkit", "pg-native"],
    banner,
  });
  run(
    process.execPath,
    ["artifacts/api-server/tests/product-reset.acceptance.mjs"],
    { PRODUCT_RESET_REUSE_PHASE_EVIDENCE: "0" },
  );
  run(process.execPath, [
    "artifacts/api-server/tests/product-reset.operational.mjs",
  ]);
  run(process.execPath, [
    "artifacts/api-server/tests/product-reset.performance.mjs",
  ]);
  run(
    process.execPath,
    ["artifacts/api-server/tests/product-reset.performance.mjs"],
    { RESET_PROFILE_24: "1" },
  );
}
if (browser)
  run(process.execPath, [
    "artifacts/allocation-lab/tests/product-reset.browser.mjs",
  ]);
run("git", ["diff", "--check"]);
console.log(
  "PASS requested checks. The retained B3C.1 migration suite needs its private historical fixture and must run separately in a copied runtime, with the fixture outside that copy. Historical evidence is never regenerated here.",
);
