// Real Chromium acceptance against production frontend + actual built API.
// PLAYWRIGHT_MODULE may select an existing environment-owned Playwright install.
// No package installation, financial fixtures in the product, or external deployment.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const reports = resolve(root, "reports/workbench01/phase-b3b");
await mkdir(join(reports, "screenshots"), { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "allocationlab-b3b-browser-"));
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
  const caps = await apiRequest("/capabilities");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  const calls = [],
    pageErrors = [],
    checks = {};
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/workbench"))
      calls.push({ path: new URL(r.url()).pathname, method: r.method() });
  });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(origin + "/workbench", { waitUntil: "networkidle" });
  assert.equal(await page.locator("#configure").count(), 0);
  await page.getByLabel("Preview token").fill("incorrect-test-token");
  await page.getByRole("button", { name: "OPEN WORKBENCH" }).click();
  await page.getByText("Preview access denied", { exact: true }).waitFor();
  checks.unauthorized_fails_closed = true;
  await page.getByLabel("Preview token").fill(token);
  await page.getByRole("button", { name: "OPEN WORKBENCH" }).click();
  await page
    .getByRole("heading", { name: "Define your research design" })
    .waitFor();
  const fields = [
    "evaluation_start",
    "evaluation_end_exclusive",
    "window_type",
    "training_window_months",
    "rebalance_frequency",
    "transaction_cost_bps",
    "selection_cost_bps",
  ];
  for (const f of fields)
    assert.equal(await page.locator(`#${f}`).inputValue(), "");
  assert.equal(
    await page
      .getByRole("button", { name: "RUN RESEARCH", exact: true })
      .isDisabled(),
    true,
  );
  for (const f of ["test_months", "step_months", "recalibration_frequency"])
    assert.equal(await page.locator(`[name=${f}],#${f}`).count(), 0);
  assert.ok(
    (await page.locator(".wd-data-rules").innerText()).includes(
      caps.data_first_observation,
    ),
  );
  assert.ok(
    (await page.locator(".wd-data-rules").innerText()).includes(
      caps.supported_evaluation_end_max,
    ),
  );
  checks.empty_initial_financial_fields = true;
  checks.capabilities_driven_bounds = true;
  checks.no_independent_clock_inputs = true;

  // These values are explicit acceptance inputs only, never product defaults.
  const base = {
    contract_version: "workbench-research-run-spec-2.0.0",
    research_mode: "CAPITAL_MARKET_EXPOSURE",
    execution_scope: "EMPIRICAL",
    universe: "SPY",
    validation_protocol: "TRADITIONAL_WALK_FORWARD",
    evaluation_start: "2022-01-01",
    evaluation_end_exclusive: "2022-03-01",
    window_type: "ROLLING",
    training_window_months: 24,
    rebalance_frequency: "MONTHLY",
    transaction_cost_bps: 0,
    selection_cost_bps: 2.5,
  };
  const fill = async (spec) => {
    for (const f of fields) {
      if (["window_type", "rebalance_frequency"].includes(f))
        await page.locator(`#${f}`).selectOption(spec[f]);
      else await page.locator(`#${f}`).fill(String(spec[f]));
    }
  };
  await fill({
    ...base,
    evaluation_start: "2020-01-01",
    evaluation_end_exclusive: "2020-05-01",
  });
  await page.getByRole("button", { name: "PREVIEW WALK-FORWARD" }).click();
  await page
    .getByText("INSUFFICIENT_MODEL_WARMUP_HISTORY", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "RUN RESEARCH", exact: true })
      .isDisabled(),
    true,
  );
  checks.real_warmup_blocker_rendered = true;
  await fill({
    ...base,
    rebalance_frequency: "QUARTERLY",
    evaluation_start: "2022-02-01",
  });
  assert.equal(
    await page
      .getByRole("button", { name: "PREVIEW WALK-FORWARD" })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.locator("#evaluation_start").inputValue(),
    "2022-02-01",
  );
  checks.invalid_quarter_boundary_not_snapped = true;

  const matrix = [
    { name: "rolling_monthly", label: "A_ROLLING_MONTHLY_24", spec: base },
    {
      name: "expanding_monthly",
      label: "C_EXPANDING_MONTHLY",
      spec: { ...base, window_type: "EXPANDING" },
    },
    {
      name: "rolling_quarterly",
      label: "D_ROLLING_QUARTERLY",
      spec: {
        ...base,
        rebalance_frequency: "QUARTERLY",
        evaluation_end_exclusive: "2022-07-01",
      },
    },
    {
      name: "arbitrary_oos_cost",
      label: "E_SAME_CALENDAR_COST_7_25",
      spec: { ...base, transaction_cost_bps: 7.25 },
    },
  ];
  const certified = JSON.parse(
    await readFile(
      join(root, "reports/workbench01/phase-b3a/acceptance-matrix.json"),
      "utf8",
    ),
  );
  const evidence = [],
    responsive = [];
  async function preview(spec) {
    await fill(spec);
    const responsePromise = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/workbench/plan",
    );
    await page.getByRole("button", { name: "PREVIEW WALK-FORWARD" }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    const plan = await response.json();
    await page.locator(".wd-review-check input").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "RUN RESEARCH", exact: true })
        .isDisabled(),
      true,
    );
    assert.deepEqual(plan.normalized_request, spec);
    const rects = await page
      .locator("rect[data-kind=training]")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({
          start: n.getAttribute("data-start"),
          end: n.getAttribute("data-end"),
          x: Number(n.getAttribute("x")),
          width: Number(n.getAttribute("width")),
        })),
      );
    assert.deepEqual(
      rects.map((r) => [r.start, r.end]),
      plan.folds.map((f) => [f.training_start, f.training_end_exclusive]),
    );
    if (spec.window_type === "EXPANDING") assert.equal(rects[0].x, rects[1].x);
    else assert.ok(rects[0].x < rects[1].x);
    assert.equal(
      plan.derived_engine_calendar.test_months,
      spec.rebalance_frequency === "MONTHLY" ? 1 : 3,
    );
    await page.locator(".wd-review-check input").check();
    return plan;
  }
  async function waitResult(id, attemptId) {
    await page.waitForFunction(
      ({ id, attemptId }) => {
        const audit =
          document.querySelector("#run-status .workbench-audit")?.textContent ||
          "";
        return (
          audit.includes(id) &&
          audit.includes(attemptId) &&
          document.querySelector("#run-status small")?.textContent === "SUCCESS"
        );
      },
      { id, attemptId },
    );
    await page.locator(".wd-plan-verified").waitFor();
    return apiRequest(`/runs/${id}`);
  }
  for (const item of matrix) {
    let plan = await preview(item.spec);
    if (item.name === "rolling_monthly") {
      await page.locator("#transaction_cost_bps").fill("3.125");
      await page.getByText("PLAN OUTDATED", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "RUN RESEARCH", exact: true })
          .isDisabled(),
        true,
      );
      checks.edit_invalidates_plan_immediately = true;
      plan = await preview(item.spec);
      for (const width of [360, 390, 430, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.locator("#preview-folds").scrollIntoViewIfNeeded();
        const size = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
        }));
        assert.ok(
          size.document <= size.viewport,
          `Page overflow at ${width}: ${JSON.stringify(size)}`,
        );
        const mobile = width <= 430;
        if (mobile) {
          const boxes = await page
            .locator(".wd-field")
            .evaluateAll((nodes) =>
              nodes.map((n) => n.getBoundingClientRect().width),
            );
          assert.ok(boxes.every((w) => w > width * 0.7));
        }
        const screenshot = `screenshots/plan-${width}.png`;
        await page.screenshot({
          path: join(reports, screenshot),
          fullPage: true,
        });
        responsive.push({
          width,
          stage: "PRE_RUN_REVIEW",
          ...size,
          page_overflow: false,
          screenshot,
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(
      await page
        .getByRole("button", { name: "RUN RESEARCH", exact: true })
        .isEnabled(),
      true,
    );
    const posted = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/workbench/runs",
    );
    await page
      .getByRole("button", { name: "RUN RESEARCH", exact: true })
      .click();
    const response = await posted;
    const receipt = await response.json();
    assert.deepEqual(
      response.request().postDataJSON(),
      plan.normalized_request,
    );
    assert.equal(receipt.execution_requested, true);
    const detail = await waitResult(
      receipt.run_id,
      receipt.execution_attempt_id,
    );
    const result = detail.latest_successful_result;
    assert.equal(detail.latest_status, "SUCCESS");
    assert.deepEqual(result.validation_diagnostics.exact_fold_plan, plan.folds);
    const old = certified.matrix.find((v) => v.case === item.label);
    assert.ok(old, `Missing certified case ${item.label}`);
    // B3A stores actual mapped metrics and hashes. They must reproduce unchanged.
    assert.equal(
      result.financial_result_hash,
      old.financial_result_hash ?? old.first_result?.financial_result_hash,
    );
    assert.equal(receipt.run_id, old.run_id);
    assert.deepEqual(result.metrics, old.metrics);
    assert.deepEqual(result.costs, old.costs);
    const final = page.locator("#results strong[title]").first();
    assert.equal(
      await final.getAttribute("title"),
      String(result.metrics.final_research_index),
    );
    const screenshot = `screenshots/${item.name}-result.png`;
    await page.screenshot({ path: join(reports, screenshot), fullPage: true });
    const itemEvidence = {
      name: item.name,
      spec: item.spec,
      run_id: receipt.run_id,
      execution_attempt_id: receipt.execution_attempt_id,
      plan,
      evaluation: result.evaluation,
      metrics: result.metrics,
      costs: result.costs,
      financial_result_hash: result.financial_result_hash,
      plan_matches_execution: true,
      screenshot,
      actual_backend_execution: result.execution,
    };
    evidence.push(itemEvidence);
    console.log(`PASS real Chromium: ${item.name}`);
    if (item.name === "rolling_monthly") {
      const requestPromise = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname.endsWith("/rerun"),
      );
      await page
        .getByRole("button", { name: "RERUN SAME DESIGN", exact: true })
        .click();
      const rr = await requestPromise;
      assert.deepEqual(rr.request().postDataJSON(), {});
      const newReceipt = await rr.json();
      const repeated = await waitResult(
        newReceipt.run_id,
        newReceipt.execution_attempt_id,
      );
      assert.equal(newReceipt.run_id, receipt.run_id);
      assert.notEqual(
        newReceipt.execution_attempt_id,
        receipt.execution_attempt_id,
      );
      assert.equal(repeated.attempt_history.length, 2);
      assert.deepEqual(
        repeated.latest_successful_result.metrics,
        result.metrics,
      );
      assert.deepEqual(
        repeated.latest_successful_result.time_series.points,
        result.time_series.points,
      );
      assert.equal(
        repeated.latest_successful_result.financial_result_hash,
        result.financial_result_hash,
      );
      itemEvidence.rerun = {
        run_id: newReceipt.run_id,
        execution_attempt_id: newReceipt.execution_attempt_id,
        attempt_count: repeated.attempt_history.length,
        financial_result_hash:
          repeated.latest_successful_result.financial_result_hash,
        financial_outputs_equal: true,
      };
      checks.immutable_rerun_same_identity_new_attempt = true;
      const reusedPromise = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname === "/api/workbench/runs",
      );
      await page
        .getByRole("button", { name: "RUN RESEARCH", exact: true })
        .click();
      const reused = await (await reusedPromise).json();
      assert.equal(reused.reused_existing_attempt, true);
      assert.equal(reused.execution_requested, false);
      await page
        .getByText("Existing experiment reused.", { exact: false })
        .waitFor();
      checks.idempotent_submission_visible = true;
    }
  }
  const a = evidence[0],
    b = evidence.at(-1);
  for (const item of [a, b]) {
    const historyRows = page.locator("#temporary-history tbody tr");
    const row = historyRows
      .filter({ hasText: `${item.spec.transaction_cost_bps} bps` })
      .filter({ hasText: "Rolling" })
      .filter({ hasText: "Monthly" });
    await row.getByRole("button", { name: "COMPARE", exact: true }).click();
  }
  const beforeCompare = (await apiRequest("/runs")).runs;
  const compareResponse = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/workbench/compare",
  );
  await page.getByRole("button", { name: "COMPARE SELECTED RUNS" }).click();
  const comparison = await (await compareResponse).json();
  await page
    .getByRole("heading", { name: "Compared designs", exact: true })
    .waitFor();
  assert.equal(comparison.calculation, "READ_ONLY_NO_RECALCULATION");
  assert.deepEqual(
    comparison.financial_input_differences.map((d) => d.path),
    ["/transaction_cost_bps"],
  );
  assert.deepEqual((await apiRequest("/runs")).runs, beforeCompare);
  checks.comparison_read_only_correct_artifacts = true;
  const compareScreenshot = "screenshots/comparison-1440.png";
  await page.screenshot({
    path: join(reports, compareScreenshot),
    fullPage: true,
  });
  for (const width of [360, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const size = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(size.document <= size.viewport, `Results overflow ${width}`);
    const screenshot = `screenshots/results-${width}.png`;
    await page.screenshot({ path: join(reports, screenshot), fullPage: true });
    responsive.push({
      width,
      stage: "RESULTS_AND_COMPARE",
      ...size,
      page_overflow: false,
      screenshot,
    });
  }
  assert.equal(await page.locator("details.workbench-audit[open]").count(), 0);
  for (const text of [
    "RESEARCH ONLY",
    "TEMPORARY STORAGE",
    "DATA VINTAGE NOT INDEPENDENTLY VERIFIED",
  ])
    await page.getByText(text, { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /^(TRADE|PLACE ORDER|AUTHORIZE CAPITAL)$/i })
      .count(),
    0,
  );
  assert.equal(
    calls.some((c) => c.path.includes("/v1")),
    false,
  );
  checks.no_v1_route_ever_requested = true;
  checks.boundaries_visible_advanced_collapsed = true;
  checks.no_broker_controls = true;

  // Fault-injection UI regressions, separate from all empirical evidence above.
  await page.route(`**/api/workbench/runs/${b.run_id}`, async (route) => {
    const r = await route.fetch();
    const d = await r.json();
    for (const key of ["latest_result", "latest_successful_result"])
      d[key].validation_diagnostics.exact_fold_plan[0].decision_date =
        "2022-01-04";
    await route.fulfill({ response: r, json: d });
  });
  await page
    .getByRole("button", { name: "REFRESH STATUS", exact: true })
    .click();
  await page.getByText("PLAN_EXECUTION_MISMATCH", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "RUN RESEARCH", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(await page.locator("#results .workbench-chart").count(), 0);
  checks.execution_mismatch_withholds_results = true;
  await page.unroute(`**/api/workbench/runs/${b.run_id}`);
  await page
    .getByRole("button", { name: "REFRESH STATUS", exact: true })
    .click();
  await page.locator(".wd-plan-verified").waitFor();
  let capacityRequests = 0;
  await page.route("**/api/workbench/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    capacityRequests++;
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "BLOCKED_EXECUTION_CAPACITY",
          message:
            "Another empirical run is currently using the available research worker.",
        },
      }),
    });
  });
  await page.getByRole("button", { name: "RUN RESEARCH", exact: true }).click();
  await page.getByText("BLOCKED_EXECUTION_CAPACITY", { exact: true }).waitFor();
  await page.waitForTimeout(2500);
  assert.equal(capacityRequests, 1);
  checks.capacity_does_not_auto_retry = true;
  await page.unroute("**/api/workbench/runs");
  assert.deepEqual(pageErrors, []);
  const assets = (await readdir(join(frontend, "assets"))).filter((f) =>
    f.endsWith(".js"),
  );
  for (const asset of assets) {
    const js = await readFile(join(frontend, "assets", asset), "utf8");
    assert.equal(js.includes(token), false);
    assert.equal(js.includes("WORKBENCH_PREVIEW_TOKEN"), false);
  }
  checks.no_secret_in_built_bundle = true;
  // Touch-enabled mobile Chromium: an independent empty session, real preflight,
  // readable inputs, explicit review and a reachable enabled RUN target.
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 900 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const touch = await mobile.newPage();
  touch.setDefaultTimeout(30000);
  await touch.goto(origin + "/workbench", { waitUntil: "networkidle" });
  await touch.getByLabel("Preview token").fill(token);
  await touch.getByRole("button", { name: "OPEN WORKBENCH" }).tap();
  await touch
    .getByRole("heading", { name: "Define your research design" })
    .waitFor();
  for (const f of fields) {
    assert.equal(await touch.locator(`#${f}`).inputValue(), "");
    if (["window_type", "rebalance_frequency"].includes(f))
      await touch.locator(`#${f}`).selectOption(base[f]);
    else await touch.locator(`#${f}`).fill(String(base[f]));
  }
  await touch.getByRole("button", { name: "PREVIEW WALK-FORWARD" }).tap();
  await touch.locator(".wd-review-check input").waitFor();
  await touch.locator(".wd-review-check").tap();
  assert.equal(
    await touch
      .getByRole("button", { name: "RUN RESEARCH", exact: true })
      .isEnabled(),
    true,
  );
  const tapTarget = await touch
    .getByRole("button", { name: "RUN RESEARCH", exact: true })
    .boundingBox();
  assert.ok(tapTarget.height >= 44 && tapTarget.width > 250);
  await touch.locator("#preview-folds").scrollIntoViewIfNeeded();
  await touch.locator(".wd-map-scroll").evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const mobileDimensions = await touch.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(mobileDimensions.document <= mobileDimensions.viewport);
  const mobileScreenshot = "screenshots/touch-390-fold-map.png";
  await touch.screenshot({ path: join(reports, mobileScreenshot) });
  responsive.push({
    width: 390,
    stage: "TOUCH_MOBILE_REVIEW",
    ...mobileDimensions,
    page_overflow: false,
    screenshot: mobileScreenshot,
  });
  checks.mobile_touch_plan_review_and_run_target = true;
  let unreviewedExecutionPosts = 0;
  touch.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/api\/workbench\/runs(?:\/[^/]+\/rerun)?$/.test(
        new URL(r.url()).pathname,
      )
    )
      unreviewedExecutionPosts++;
  });
  await touch
    .locator("#temporary-history tbody tr")
    .first()
    .getByRole("button", { name: "RERUN", exact: true })
    .tap();
  await touch
    .getByRole("heading", {
      name: "Review the immutable design before rerunning",
    })
    .waitFor();
  assert.equal(unreviewedExecutionPosts, 0);
  const confirmRerun = touch.getByRole("button", {
    name: "CONFIRM RERUN SAME DESIGN",
    exact: true,
  });
  assert.equal(await confirmRerun.isDisabled(), true);
  await touch
    .getByText(
      "I have reviewed this immutable design and its exact folds for rerun.",
      { exact: false },
    )
    .tap();
  assert.equal(await confirmRerun.isEnabled(), true);
  assert.equal(unreviewedExecutionPosts, 0);
  checks.history_rerun_requires_fold_review_in_new_session = true;
  await mobile.close();
  const browserEvidence = {
    status: "PASS",
    browser: await browser.version(),
    actual_production_frontend: true,
    actual_built_api: true,
    same_origin_relative_requests: true,
    isolated_temporary_store: true,
    empirical_attempts: 5,
    checks,
    page_errors: pageErrors,
    screenshot_count: responsive.length + matrix.length + 1,
    no_deployment: true,
  };
  await writeFile(
    join(reports, "api-integration.json"),
    JSON.stringify(
      {
        status: "PASS",
        matrix: evidence,
        comparison,
        no_v1_requests: true,
        economic_claim: "NONE",
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    join(reports, "browser-acceptance.json"),
    JSON.stringify(browserEvidence, null, 2) + "\n",
  );
  await writeFile(
    join(reports, "responsive-checks.json"),
    JSON.stringify(
      { status: "PASS", browser: "Real Chromium", checks: responsive },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS browser acceptance, responsive widths and fault-injection regressions",
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
