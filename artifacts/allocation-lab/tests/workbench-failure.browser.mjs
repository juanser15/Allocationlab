// Real Chromium acceptance against production frontend + actual built API.
// PLAYWRIGHT_MODULE may select an existing environment-owned Playwright install.
// No package installation, financial fixtures in the product, or external deployment.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const reports = resolve(root, "reports/workbench01/phase-b3c1");
await mkdir(join(reports, "screenshots"), { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "allocationlab-b3c1-browser-"));
const oldFailure = JSON.parse(
  await readFile(process.env.B3C1_REPRODUCTION_LOCATION, "utf8"),
);
const token = randomBytes(32).toString("hex"); // never printed, persisted in reports, or passed to Vite
const portProbe = createServer();
portProbe.listen(0, "127.0.0.1");
await once(portProbe, "listening");
const apiPort = portProbe.address().port;
await new Promise((r) => portProbe.close(r));
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const log = createWriteStream(join(temp, "api.log"));
const api = spawn(
  process.execPath,
  ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"],
  {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(apiPort),
      WORKBENCH_PREVIEW_TOKEN: token,
      WORKBENCH_RUN_DIR: join(oldFailure.dir, "runs"),
      VALIDATION_JOB_WORKER_DISABLED: "1",
      DATABASE_URL:
        process.env.DATABASE_URL ||
        "postgresql://agent@127.0.0.1:55432/allocationlab",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
api.stdout.pipe(log);
api.stderr.pipe(log);
const frontend = resolve(root, "artifacts/allocation-lab/dist/public");
// Test-only same-origin gateway: static production assets + forwarding to the
// unmodified production API. The browser uses the actual relative API paths.
const gateway = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const headers = { ...req.headers };
      delete headers.host;
      delete headers.connection;
      delete headers["content-length"];
      const response = await fetch(apiOrigin + url.pathname + url.search, {
        method: req.method,
        headers,
        ...(req.method === "GET" || req.method === "HEAD"
          ? {}
          : { body: Buffer.concat(chunks) }),
      });
      res.writeHead(response.status, {
        "content-type":
          response.headers.get("content-type") || "application/json",
      });
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const path = resolve(frontend, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(frontend + sep)) {
      res.writeHead(400);
      res.end();
      return;
    }
    const file = extname(path) ? path : join(frontend, "index.html");
    const mime = {
      ".js": "application/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".woff2": "font/woff2",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };
    res.writeHead(200, {
      "content-type": mime[extname(file)] || "application/octet-stream",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end("Unavailable");
  }
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    if (api.exitCode !== null)
      throw new Error(
        "Production API exited; inspect isolated diagnostic log.",
      );
    try {
      const r = await fetch(apiOrigin + "/api/workbench/capabilities");
      if (r.status === 401) break;
    } catch {
      /* bounded startup */
    }
    if (i === 99) throw new Error("Production API startup timeout");
    await new Promise((r) => setTimeout(r, 100));
  }
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const origin = `http://127.0.0.1:${gateway.address().port}`;
  const apiRequest = async (path, method = "GET", body) => {
    const r = await fetch(origin + "/api/workbench" + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(r.ok, `API ${path}: ${r.status}`);
    return r.json();
  };
  const before = JSON.parse(
    await readFile(join(reports, "before-fix-reproduction.json"), "utf8"),
  );
  const originalList = await apiRequest("/runs");
  const detail = await apiRequest("/runs/" + oldFailure.run_id);
  assert.equal(detail.latest_attempt.error_class, "NO_VALID_CANDIDATE");
  assert.equal(detail.latest_attempt.failed_fold_id, 0);
  assert.equal(detail.latest_attempt.failed_decision_date, "2019-10-01");
  assert.equal(
    detail.latest_result.contract_version,
    "workbench-research-run-result-2.0.0",
  );
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(30000);
  const errors = [],
    screenshots = [],
    responsive = [],
    posts = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname.startsWith("/api/workbench/")
    )
      posts.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() });
  });
  const shot = async (name) => {
    await page.mouse.move(0, 0);
    const file = "screenshots/" + name + ".png";
    await page.screenshot({ path: join(reports, file), fullPage: false });
    screenshots.push(file);
  };
  await page.goto(origin + "/workbench", { waitUntil: "networkidle" });
  await page.getByLabel("Preview token").fill(token);
  await page
    .getByRole("button", { name: "OPEN WORKBENCH", exact: true })
    .click();
  await page.getByRole("button", { name: "OPEN", exact: true }).click();
  const failure = page.locator("#run-status .wd-failure-notice");
  await failure.waitFor();
  assert.ok((await failure.innerText()).includes("NO_VALID_CANDIDATE"));
  assert.ok((await failure.innerText()).includes("Fold 0"));
  assert.ok((await failure.innerText()).includes("2019-10-01"));
  assert.ok((await failure.innerText()).includes("20-observation"));
  assert.ok((await failure.innerText()).includes("8.684581"));
  assert.ok((await failure.innerText()).includes("Maximum: 8"));
  assert.ok(
    (await page.locator(".wd-attempts").innerText()).includes(
      "NO_VALID_CANDIDATE",
    ),
  );
  for (const width of [360, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await failure.scrollIntoViewIfNeeded();
    const sizes = await page.evaluate(() => ({
      width: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(sizes.document <= sizes.width);
    await shot("retained-failure-" + width);
    responsive.push({
      ...sizes,
      overflow: false,
      stage: "RETAINED_FAILED_ATTEMPT",
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const f of [
    "evaluation_start",
    "evaluation_end_exclusive",
    "window_type",
    "training_window_months",
    "rebalance_frequency",
    "transaction_cost_bps",
  ]) {
    const input = page.locator("#" + f);
    if (["window_type", "rebalance_frequency"].includes(f))
      await input.selectOption(before.request[f]);
    else await input.fill(String(before.request[f]));
  }
  const planned = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/workbench/plan",
  );
  await page
    .getByRole("button", { name: "PREVIEW WALK-FORWARD", exact: true })
    .click();
  const response = await planned;
  assert.equal(response.status(), 422);
  assert.deepEqual(response.request().postDataJSON(), before.request);
  const blocker = page.locator("#configure .wd-failure-notice");
  await blocker.waitFor();
  assert.ok((await blocker.innerText()).includes("NO_VALID_CANDIDATE"));
  assert.ok((await blocker.innerText()).includes("Fold 0"));
  assert.ok((await blocker.innerText()).includes("8.684581"));
  assert.ok(
    (await blocker.innerText()).includes(
      "No dates or training windows were changed automatically.",
    ),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "RUN BACKTEST", exact: true })
      .isDisabled(),
    true,
  );
  for (const f of [
    "evaluation_start",
    "evaluation_end_exclusive",
    "training_window_months",
    "transaction_cost_bps",
  ])
    assert.equal(
      await page.locator("#" + f).inputValue(),
      String(before.request[f]),
    );
  for (const width of [360, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await blocker.scrollIntoViewIfNeeded();
    const sizes = await page.evaluate(() => ({
      width: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(sizes.document <= sizes.width);
    await shot("blocked-preview-" + width);
    responsive.push({
      ...sizes,
      overflow: false,
      stage: "EXACT_84_FOLD_PREFLIGHT",
    });
  }
  assert.equal(
    posts.filter(
      (x) => x.path === "/api/workbench/runs" || x.path.endsWith("/rerun"),
    ).length,
    0,
  );
  assert.deepEqual(await apiRequest("/runs"), originalList);
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /\/workspace\/|\/tmp\/|CAPITAL_ENGINE_EXECUTION_FAILED|Dynamic campaign did not complete/,
  );
  assert.deepEqual(errors, []);
  const evidence = {
    status: "PASS",
    browser: await browser.version(),
    actual_retained_attempt_id: oldFailure.attempt_id,
    retained_status: "FAILED",
    safe_failure: detail.latest_attempt,
    v2_result_contract_version: detail.latest_result.contract_version,
    safe_error_class: "NO_VALID_CANDIDATE",
    failed_fold_id: 0,
    failed_decision_date: "2019-10-01",
    exact_84_fold_preview_status: 422,
    no_execution_submission: true,
    run_disabled: true,
    fields_not_repaired: true,
    immutable_history_preserved: true,
    private_paths_or_stacks_exposed: false,
    page_errors: errors,
    responsive,
    screenshots,
  };
  await writeFile(
    join(reports, "ui-failure-acceptance.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    "PASS Chromium: actionable retained failure, exact 84-fold preflight blocker and all five widths.",
  );
} finally {
  await browser?.close();
  await new Promise((r) => gateway.close(r));
  api.kill("SIGTERM");
  await Promise.race([
    once(api, "exit"),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  if (api.exitCode === null) api.kill("SIGKILL");
  log.end();
}
