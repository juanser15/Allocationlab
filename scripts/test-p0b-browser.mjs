/** Isolated component browser + actual authenticated route; synthetic in-memory ledger only. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fork } from "node:child_process";
const api = createRequire(
    new URL("../artifacts/api-server/package.json", import.meta.url),
  ),
  ui = createRequire(
    new URL("../artifacts/allocation-lab/package.json", import.meta.url),
  );
const { build } = api("esbuild"),
  { chromium } = createRequire(import.meta.url)("playwright");
const out =
  process.argv[2] ??
  mkdtempSync(resolve(tmpdir(), "allocationlab-p0b-browser-"));
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["tests/p0b/browser-entry.tsx"],
  outfile: resolve(out, "app.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: {
    react: ui.resolve("react"),
    "react/jsx-runtime": ui.resolve("react/jsx-runtime"),
    "react-dom/client": ui.resolve("react-dom/client"),
  },
});
writeFileSync(
  resolve(out, "index.html"),
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>P0B synthetic blotter acceptance</title><style>body{margin:0;font-family:Arial,sans-serif;background:white}*{box-sizing:border-box}</style><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>',
);
await build({
  entryPoints: ["tests/p0b/browser-server.ts"],
  outfile: resolve(out, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  alias: {
    express: api.resolve("express"),
    "@workspace/db": resolve(
      "research/coordinated/institutional-unit-db-shim.ts",
    ),
  },
  banner: {
    js: `import{createRequire as cr}from'node:module';globalThis.require=cr(${JSON.stringify(api.resolve("express"))});`,
  },
});
const child = fork(resolve(out, "server.mjs"), [out], {
  env: { ...process.env, DATABASE_URL: "", WORKBENCH_PREVIEW_OPEN: "0" },
  stdio: ["ignore", "ignore", "pipe", "ipc"],
});
let browser;
const results = [];
try {
  const { port } = await new Promise((res, rej) => {
    const timer = setTimeout(
      () => rej(Error("Test server startup timeout")),
      10000,
    );
    child.once("message", (v) => {
      clearTimeout(timer);
      res(v);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      rej(Error("Test server exit " + code));
    });
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByRole("alert").filter({ hasText: "preview token" }).waitFor();
  results.push({ check: "unauthorized_UI", status: "PASS" });
  await page.evaluate(() =>
    sessionStorage.setItem(
      "allocationlab.workbench.preview-token",
      "P0B_BROWSER_TEST_ONLY",
    ),
  );
  await page.reload();
  await page.getByRole("table").waitFor();
  await page.getByText("Filter and sort records", { exact: true }).click();
  await page.getByLabel("Date basis").selectOption("signal_date");
  await page.getByLabel("From session").fill("2024-01-01");
  await page.getByLabel("Through session").fill("2024-01-01");
  await page.waitForFunction(
    () => document.querySelectorAll("tbody tr").length === 2,
  );
  results.push({ check: "signal_date_filter", status: "PASS" });
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.getByLabel("Symbol search").fill("SPY");
  await page.getByLabel("Side", { exact: true }).selectOption("SELL");
  await page.waitForFunction(
    () => document.querySelectorAll("tbody tr").length === 3,
  );
  await page.getByLabel("Sort by").selectOption("execution_price");
  await page.getByLabel("Direction").selectOption("desc");
  await page.waitForFunction(
    () =>
      document.querySelector("tbody tr td:nth-child(6)")?.textContent === "15",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download filtered CSV" }).click();
  const download = await downloadPromise;
  const csv = readFileSync(await download.path(), "utf8");
  if (!csv.includes("HMM_EXPOSURE_REDUCTION") || csv.split("\r\n").length !== 5)
    throw Error("Filtered authorized CSV mismatch");
  results.push({ check: "search_side_sort_CSV", status: "PASS" });
  await page
    .getByRole("button", { name: "Inspect SPY 2024-02-01", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "SPY · Execution evidence" })
    .waitFor();
  await page
    .getByRole("button", { name: "Inspect related FIFO lots", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("tbody tr").length === 1,
  );
  results.push({ check: "execution_FIFO_drill_link", status: "PASS" });
  await page
    .getByRole("button", { name: "Round-Trip Trade Blotter", exact: true })
    .click();
  await page.getByRole("cell", { name: "OPEN", exact: true }).waitFor();
  results.push({ check: "FIFO_open_lot_and_partial_exits", status: "PASS" });
  await page
    .getByRole("button", { name: "Position Drill-down", exact: true })
    .click();
  await page
    .getByRole("cell", { name: "MARKET DRIFT", exact: true })
    .first()
    .waitFor();
  results.push({ check: "position_drift_no_fill", status: "PASS" });
  await page
    .getByRole("button", { name: "Execution Blotter", exact: true })
    .click();
  await page.getByRole("table").waitFor();
  await page.getByText("Filter and sort records", { exact: true }).click();
  for (const width of [360, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: resolve(out, `executions-${width}.png`),
      fullPage: true,
    });
    const geometry = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: innerWidth,
      table: document.querySelector(".blotter-scroll")?.scrollWidth,
      container: document.querySelector(".blotter-scroll")?.clientWidth,
    }));
    if (geometry.page > width)
      throw Error("Page overflow at " + width + JSON.stringify(geometry));
    results.push({
      check: "responsive_execution",
      width,
      status: "PASS",
      geometry,
      screenshot: `executions-${width}.png`,
    });
  }
  for (const [view, caption] of [
    ["Round-Trip Trade Blotter", "lots"],
    ["Position Drill-down", "positions"],
  ]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await page.getByRole("table").waitFor();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: resolve(out, `${caption}-${width}.png`),
        fullPage: true,
      });
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )
      )
        throw Error("Overflow " + caption);
      results.push({
        check: caption,
        width,
        status: "PASS",
        screenshot: `${caption}-${width}.png`,
      });
    }
  }
  const start = Date.now();
  await page.goto(`http://127.0.0.1:${port}/?large=1`);
  await page.getByRole("table").waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll("tbody tr").length === 50,
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".blotter-pages")?.textContent?.includes("Page 2"),
  );
  await page.waitForFunction(
    () => document.querySelector("tbody tr td")?.textContent === "2010-02-21",
  );
  results.push({
    check: "1601_fills_UI_pagination",
    status: "PASS",
    elapsed_ms: Date.now() - start,
  });
  if (
    readFileSync(resolve(out, "app.js"), "utf8").includes(
      "P0B_BROWSER_TEST_ONLY",
    )
  )
    throw Error("Test owner token in frontend bundle");
  results.push({ check: "token_absent_frontend_bundle", status: "PASS" });
  if (errors.length) throw Error(errors.join("\n"));
  results.push({ check: "no_browser_errors", status: "PASS" });
  writeFileSync(
    resolve(out, "browser-results.json"),
    JSON.stringify(
      {
        scope:
          "SOURCE_ONLY_SYNTHETIC_COMPONENT_AND_AUTHENTICATED_API_NOT_REPLIT_RUNTIME",
        results,
        token_in_screenshots: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("P0B browser PASS", results.length, "checks; evidence:", out);
} catch (e) {
  writeFileSync(
    resolve(out, "browser-results.json"),
    JSON.stringify({ status: "FAIL", error: String(e), results }, null, 2),
  );
  throw e;
} finally {
  await browser?.close();
  child.kill("SIGTERM");
}
