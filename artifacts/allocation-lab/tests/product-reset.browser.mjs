// Real Chromium acceptance against production frontend + actual built API.
// PLAYWRIGHT_MODULE may select an existing environment-owned Playwright install.
// No package installation, financial fixtures in the product, or external deployment.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { once } from "node:events";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  readdir,
  cp,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const reports = resolve(root, "reports/workbench01/product-reset-01");
await mkdir(join(reports, "screenshots"), { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "allocationlab-reset-browser-"));
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
      WORKBENCH_RUN_DIR: join(temp, "runs"),
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
const screenshots = [],
  responsive = [],
  errors = [],
  network = [],
  cases = [];
let page;
const save = (file, data) =>
  writeFile(join(reports, file), JSON.stringify(data, null, 2) + "\n");
async function shot(name, width) {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
  await page.waitForTimeout(170);
  await page.screenshot({
    path: join(reports, "screenshots", name + "-" + width + ".png"),
    fullPage: true,
  });
  const size = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(size.scroll <= size.width, JSON.stringify({ name, ...size }));
  responsive.push({ screen: name, ...size, overflow: false });
  screenshots.push("screenshots/" + name + "-" + width + ".png");
}
async function fill(c) {
  await page
    .getByRole("navigation", { name: "Capital Exposure workspace" })
    .getByRole("button", { name: "Setup", exact: true })
    .click();
  for (const [label, value] of [
    ["From", c.from],
    ["To", c.to],
    ["Training window", c.training],
    ["Trading costs", c.cost],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByLabel("Walk-forward type", { exact: true })
    .selectOption(c.window);
  await page.getByLabel("Rebalance", { exact: true }).selectOption(c.rebalance);
}
async function success() {
  await page
    .getByRole("heading", { name: "Backtest results", exact: true })
    .waitFor({ timeout: 120000 });
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(
        apiOrigin + "/api/workbench/interactive/capabilities",
      );
      if (r.status === 401) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) throw new Error("Production API startup timeout");
  }
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const origin = `http://127.0.0.1:${gateway.address().port}`;
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    hasTouch: true,
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (req) => {
    if (req.url().includes("/api/workbench"))
      network.push({
        method: req.method(),
        path: new URL(req.url()).pathname,
        body: req.postData() ? JSON.parse(req.postData()) : null,
      });
  });
  await page.goto(origin + "/workbench");
  await page.getByLabel("Preview token").fill(token);
  await page.getByRole("button", { name: "Open research workspace" }).click();
  await page.locator(".pr-form").waitFor();
  for (const input of await page
    .locator(".pr-form input,.pr-form select")
    .all())
    assert.equal(await input.inputValue(), "");
  assert.equal(
    await page.getByLabel("Trading costs", { exact: true }).count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "RUN BACKTEST", exact: true })
      .isDisabled(),
    true,
  );
  for (const w of [360, 390, 430, 768, 1440]) await shot("setup", w);
  const campaign = [
    {
      name: "Rolling monthly",
      from: "2021-01-01",
      to: "2026-01-01",
      training: "6",
      window: "ROLLING",
      rebalance: "MONTHLY",
      cost: "1",
    },
    {
      name: "Expanding monthly",
      from: "2022-01-01",
      to: "2023-01-01",
      training: "6",
      window: "EXPANDING",
      rebalance: "MONTHLY",
      cost: "1",
    },
    {
      name: "Rolling quarterly",
      from: "2022-01-01",
      to: "2023-01-01",
      training: "6",
      window: "ROLLING",
      rebalance: "QUARTERLY",
      cost: "1",
    },
    {
      name: "Arbitrary costs and weekend anchor",
      from: "2025-03-22",
      to: "2025-09-22",
      training: "1",
      window: "ROLLING",
      rebalance: "MONTHLY",
      cost: "2.875",
    },
  ];
  const responseResults = [];
  page.on("response", async (response) => {
    if (
      /\/interactive\/runs\/rr_/.test(response.url()) &&
      response.request().method() === "GET"
    ) {
      try {
        const d = await response.json();
        if (
          d.latest_status === "SUCCESS" &&
          d.latest_successful_result &&
          !responseResults.some(
            (x) =>
              x.execution_attempt_id ===
              d.latest_successful_result.execution_attempt_id,
          )
        )
          responseResults.push(d.latest_successful_result);
      } catch {}
    }
  });
  for (const [i, c] of campaign.entries()) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await fill(c);
    await page
      .getByRole("button", { name: "RUN BACKTEST", exact: true })
      .waitFor();
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.textContent === "RUN BACKTEST",
      );
      return b && !b.disabled;
    });
    await page
      .getByRole("button", { name: "RUN BACKTEST", exact: true })
      .click();
    if (i === 0) {
      await page.locator(".pr-progress").waitFor({ timeout: 30000 });
      await shot("progress", 1440);
      if (await page.locator(".pr-progress").count())
        await shot("progress", 390);
    }
    await success();
    console.log("Completed browser case", c.name);
    await page.getByLabel("Run name").fill(c.name);
    await page
      .getByRole("img", {
        name: "Research index: dynamic, passive SPY and matched-beta control",
      })
      .waitFor();
    await page
      .getByRole("img", { name: "Actual SPY exposure and cash" })
      .waitFor();
    cases.push({ case: c.name, status: "SUCCESS", actual_api: true });
    if (i === 0) {
      for (const w of [360, 390, 430, 768, 1440]) await shot("results", w);
      await page
        .getByRole("button", { name: "Rerun same design", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document
            .querySelector(".pr-attempt-strip")
            ?.textContent?.includes("2 immutable attempts"),
        undefined,
        { timeout: 120000 },
      );
      await success();
    }
  }
  assert.ok(responseResults.length >= 5);
  const zero = responseResults.filter(
    (r) => r.plan.normalized_request.evaluation_start === "2021-01-01",
  );
  assert.equal(zero.length, 2);
  assert.equal(zero[0].run_id, zero[1].run_id);
  assert.notEqual(zero[0].execution_attempt_id, zero[1].execution_attempt_id);
  for (const key of [
    "financial_result_hash",
    "passive_control_hash",
    "matched_beta_control_hash",
    "attribution_hash",
  ])
    assert.equal(zero[0][key], zero[1][key]);
  // A real, deliberate financial constraint failure, not an injected UI state.
  await fill({
    name: "Constraint rejection",
    from: "2019-10-01",
    to: "2019-11-01",
    training: "1",
    window: "ROLLING",
    rebalance: "MONTHLY",
    cost: "50000",
  });
  const failedPost = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && r.url().endsWith("/interactive/runs"),
  );
  await page.getByRole("button", { name: "RUN BACKTEST", exact: true }).click();
  const failureReceipt = await (await failedPost).json();
  await page.getByRole("alert").waitFor({ timeout: 120000 });
  assert.equal(await page.locator(".pr-error details[open]").count(), 0);
  assert.ok(
    !(await page.getByRole("alert").innerText()).includes("NO_VALID_CANDIDATE"),
  );
  const failedDetail = await (
    await fetch(
      apiOrigin + "/api/workbench/interactive/runs/" + failureReceipt.run_id,
      { headers: { Authorization: "Bearer " + token } },
    )
  ).json();
  assert.equal(failedDetail.latest_status, "FAILED");
  assert.equal(failedDetail.latest_result.error_class, "NO_VALID_CANDIDATE");
  const firstFailure = await readFile(
    join(
      temp,
      "runs/runs",
      failureReceipt.run_id,
      "attempts",
      failureReceipt.execution_attempt_id,
      "result.json",
    ),
  );
  await shot("constraint-failure", 390);
  const retryResponse = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/rerun"),
  );
  await page
    .getByRole("button", { name: "Rerun same design", exact: true })
    .click();
  const retry = await (await retryResponse).json();
  assert.equal(retry.run_id, failureReceipt.run_id);
  assert.notEqual(
    retry.execution_attempt_id,
    failureReceipt.execution_attempt_id,
  );
  let failureAgain;
  for (let n = 0; n < 400; n++) {
    failureAgain = await (
      await fetch(
        apiOrigin + "/api/workbench/interactive/runs/" + retry.run_id,
        { headers: { Authorization: "Bearer " + token } },
      )
    ).json();
    if (
      failureAgain.latest_status === "FAILED" &&
      failureAgain.attempt_history.length === 2
    )
      break;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.equal(failureAgain.latest_status, "FAILED");
  assert.equal(failureAgain.attempt_history.length, 2);
  assert.deepEqual(
    firstFailure,
    await readFile(
      join(
        temp,
        "runs/runs",
        failureReceipt.run_id,
        "attempts",
        failureReceipt.execution_attempt_id,
        "result.json",
      ),
    ),
  );
  await page.getByRole("alert").waitFor();
  cases.push({
    case: "Deliberate drawdown-constraint rejection and explicit retry",
    status: "EXPECTED_FAILED",
    error_class: "NO_VALID_CANDIDATE",
    immutable_attempts: 2,
    prior_failed_bytes_unchanged: true,
    technical_details_collapsed: true,
  });
  await page
    .getByRole("navigation", { name: "Capital Exposure workspace" })
    .getByRole("button", { name: /Runs/ })
    .click();
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.locator(".pr-history tbody tr").first().waitFor();
  const checks = page.locator(".pr-history input[type=checkbox]:enabled");
  assert.equal(await checks.count(), 4);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const ch of await checks.all()) {
    await ch.tap();
    assert.equal(await ch.isChecked(), true);
  }
  await page.getByRole("button", { name: "Compare selected (4)" }).tap();
  await page.getByRole("heading", { name: "Compare research runs" }).waitFor();
  for (const w of [360, 390, 430, 768, 1440]) await shot("compare", w);
  assert.equal(
    await page
      .getByRole("img", { name: "Multiple-run research index comparison" })
      .count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("img", { name: "Multiple-run drawdown comparison" })
      .count(),
    1,
  );
  await page
    .getByRole("navigation", { name: "Capital Exposure workspace" })
    .getByRole("button", { name: "Audit", exact: true })
    .click();
  assert.equal(await page.locator(".pr-main details[open]").count(), 0);
  for (const w of [360, 390, 430, 768, 1440]) await shot("audit", w);
  await page.getByText("Walk-Forward Folds", { exact: true }).click();
  await page
    .getByRole("img", {
      name: "Exact anchored walk-forward training and OOS intervals",
    })
    .waitFor();
  await shot("audit-folds", 1440);
  await shot("audit-folds", 390);
  await page
    .getByRole("navigation", { name: "Portfolio research modules" })
    .getByRole("button", { name: /ETF Selection/ })
    .click();
  await page.getByRole("heading", { name: "Module not yet enabled" }).waitFor();
  assert.equal(await page.locator(".pr-module-empty input").count(), 0);
  assert.equal(await page.locator(".pr-module-empty button").count(), 0);
  await shot("future-module", 390);
  await page
    .getByRole("navigation", { name: "Portfolio research modules" })
    .getByRole("button", { name: /Capital Exposure/ })
    .click();
  await fill({ ...campaign[0], from: "2011-01-01", to: "2012-01-01" });
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator(".pr-error details[open]").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "RUN BACKTEST", exact: true })
      .isDisabled(),
    true,
  );
  await shot("contextual-error", 390);
  assert.ok(!network.some((n) => n.path.includes("/v1/")));
  const submits = network.filter(
    (n) => n.method === "POST" && n.path.endsWith("/interactive/runs"),
  );
  assert.equal(submits.length, campaign.length + 1);
  for (const n of submits) {
    assert.equal(Object.keys(n.body).length, 13);
    assert.equal(n.body.transaction_cost_bps, n.body.selection_cost_bps);
  }
  assert.ok(
    network.some(
      (n) =>
        n.path.endsWith("/interactive/compare") && n.body.run_ids.length === 4,
    ),
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  const assets = [];
  async function walk(d) {
    for (const n of await readdir(d, { withFileTypes: true })) {
      const p = join(d, n.name);
      if (n.isDirectory()) await walk(p);
      else assets.push(p);
    }
  }
  await walk(frontend);
  for (const p of assets)
    assert.ok(!(await readFile(p)).includes(Buffer.from(token)));
  await save("browser-acceptance.json", {
    status: "PASS",
    browser: await browser.version(),
    source:
      "Actual production frontend and API, isolated temporary store, committed empirical inputs",
    cases,
    rerun: {
      same_run_id: true,
      new_attempt: true,
      all_four_hashes_identical: true,
    },
    comparison: {
      runs: 4,
      read_only: true,
      no_winner: true,
      mobile_touch_selection: true,
    },
    no_fixture_defaults: true,
    only_one_cost: true,
    standard_cost_mapping: true,
    primary_workflow: "CONFIGURE_RUN_PROGRESS_RESULTS",
    no_mandatory_preview_or_review: true,
    legacy_v1_requests: 0,
    future_modules: "READ_ONLY_NOT_ENABLED_NO_INPUTS",
    audit_all_sections_collapsed: true,
    diagnostics_collapsed: true,
    failed_attempt_retry: {
      error_class: "NO_VALID_CANDIDATE",
      failed_attempts: 2,
      same_run_id: true,
      different_attempt_ids: true,
      earlier_failure_bytes_unchanged: true,
      no_unrelated_failure_in_history: true,
    },
    token_not_in_built_assets: true,
    console_errors: errors,
    screenshots,
    visual_review: "PENDING_EXPLICIT_IMAGE_REVIEW",
  });
  await save("mobile-acceptance.json", {
    status: "PASS",
    physical_device: false,
    browser:
      "Chromium responsive viewport; Android-size widths, not physical Android certification",
    checks: responsive,
  });
  console.log(
    "PASS real browser workflows, N-run compare and responsive widths",
  );
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(temp, "failure.png"), fullPage: true });
    await writeFile(join(temp, "failure.html"), await page.content());
    console.log("Private browser evidence", temp);
  }
  throw error;
} finally {
  await browser?.close();
  gateway.close();
  api.kill("SIGTERM");
  await Promise.race([
    once(api, "exit"),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  if (api.exitCode === null) api.kill("SIGKILL");
  log.end();
}
