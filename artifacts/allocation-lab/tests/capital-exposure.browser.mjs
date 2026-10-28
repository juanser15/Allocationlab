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
const reports = resolve(root, "reports/workbench01/phase-b3c");
await mkdir(join(reports, "screenshots"), { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "allocationlab-b3c-browser-"));
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
  assert.equal(caps.model_definition.name, "Current Regime Score — baseline");
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
    errors = [],
    checks = {},
    screenshots = [],
    responsive = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/workbench"))
      calls.push({ path: u.pathname, method: r.method() });
  });
  const shot = async (name, full = true, target = page) => {
    const file = `screenshots/${name}.png`;
    await target.mouse.move(0, 0);
    await target.screenshot({ path: join(reports, file), fullPage: full });
    screenshots.push(file);
    return file;
  };
  await page.goto(origin + "/workbench", { waitUntil: "networkidle" });
  await page.getByLabel("Preview token").fill(token);
  await page.getByRole("button", { name: "OPEN WORKBENCH" }).click();
  await page
    .getByRole("heading", { name: "Configure the backtest", exact: true })
    .waitFor();
  const fields = [
    "evaluation_start",
    "evaluation_end_exclusive",
    "window_type",
    "training_window_months",
    "rebalance_frequency",
    "transaction_cost_bps",
  ];
  for (const f of fields)
    assert.equal(await page.locator(`#${f}`).inputValue(), "");
  assert.equal(await page.locator("#selection_cost_bps").count(), 0);
  assert.equal(
    await page.getByLabel("Trading Costs (bps)", { exact: true }).count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("group", { name: "Backtest Period", exact: true })
      .count(),
    1,
  );
  assert.equal(await page.getByLabel("From", { exact: true }).count(), 1);
  assert.equal(await page.getByLabel("To", { exact: true }).count(), 1);
  for (const label of [
    "Out-of-Sample Start",
    "Out-of-Sample End",
    "Model-Selection Cost",
    "Available empirical data",
    "Earliest evaluation boundary",
    "Latest evaluation boundary",
  ])
    assert.equal(await page.getByText(label, { exact: false }).count(), 0);
  const dateFormat = new Intl.DateTimeFormat("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  assert.equal(
    await page.locator(".ce-data-line").innerText(),
    `Data available: ${dateFormat.format(new Date(caps.data_first_observation))} – ${dateFormat.format(new Date(caps.data_last_observation))}`,
  );
  await page
    .getByText(
      "This stage tests SPY versus cash exposure. It does not allocate capital among ETFs.",
      { exact: true },
    )
    .waitFor();
  await page
    .getByText(caps.model_definition.limitation, { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "RUN BACKTEST", exact: true })
      .isDisabled(),
    true,
  );
  checks.primary_copy_and_single_cost = true;
  checks.no_silent_defaults = true;
  checks.data_is_one_capabilities_line = true;
  checks.model_scope_and_baseline_visible = true;
  await shot("empty-desktop");
  await page.getByText("How the exposure rule works", { exact: true }).click();
  assert.ok(
    (await page.locator(".ce-model").innerText()).includes(
      caps.model_definition.fixed_model_versions.models.current_regime,
    ),
  );
  for (const c of caps.model_definition.components)
    assert.ok((await page.locator(".ce-model").innerText()).includes(c.label));
  await shot("model-transparency-desktop");
  await page.getByText("How the exposure rule works", { exact: true }).click();
  checks.backend_authoritative_model_metadata = true;
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
    selection_cost_bps: 0,
  };
  const fill = async (spec, target = page) => {
    for (const f of fields) {
      if (["window_type", "rebalance_frequency"].includes(f))
        await target.locator(`#${f}`).selectOption(spec[f]);
      else await target.locator(`#${f}`).fill(String(spec[f]));
    }
  };
  await fill({
    ...base,
    evaluation_start: "2020-01-01",
    evaluation_end_exclusive: "2020-05-01",
  });
  await page
    .getByRole("button", { name: "PREVIEW WALK-FORWARD", exact: true })
    .click();
  await page
    .getByText("INSUFFICIENT_MODEL_WARMUP_HISTORY", { exact: true })
    .waitFor();
  await page
    .getByText(
      "Not enough historical information is available for a 24-month training window.",
      { exact: false },
    )
    .waitFor();
  assert.equal(
    await page.locator("#evaluation_start").inputValue(),
    "2020-01-01",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "RUN BACKTEST", exact: true })
      .isDisabled(),
    true,
  );
  checks.contextual_history_error_no_date_repair = true;
  const matrix = [
    { name: "rolling_monthly", spec: base },
    { name: "expanding_monthly", spec: { ...base, window_type: "EXPANDING" } },
    {
      name: "rolling_quarterly",
      spec: {
        ...base,
        rebalance_frequency: "QUARTERLY",
        evaluation_end_exclusive: "2022-07-01",
      },
    },
    {
      name: "arbitrary_cost",
      spec: { ...base, transaction_cost_bps: 3.125, selection_cost_bps: 3.125 },
    },
  ];
  const evidence = [];
  const metricsHash = (obj) =>
    createHash("sha256").update(JSON.stringify(obj)).digest("hex");
  for (const item of matrix) {
    await fill(item.spec);
    const planResponse = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/workbench/plan",
    );
    await page
      .getByRole("button", { name: "PREVIEW WALK-FORWARD", exact: true })
      .click();
    const plannedResponse = await planResponse;
    assert.equal(plannedResponse.status(), 200);
    const plan = await plannedResponse.json();
    assert.deepEqual(plan.normalized_request, item.spec);
    assert.equal(
      plan.normalized_request.selection_cost_bps,
      plan.normalized_request.transaction_cost_bps,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "RUN BACKTEST", exact: true })
        .isDisabled(),
      true,
    );
    await page.locator(".wd-review-check input").check();
    const actualRects = await page
      .locator("rect[data-kind=training]")
      .evaluateAll((nodes) =>
        nodes.map((n) => [
          n.getAttribute("data-start"),
          n.getAttribute("data-end"),
        ]),
      );
    assert.deepEqual(
      actualRects,
      plan.folds.map((f) => [f.training_start, f.training_end_exclusive]),
    );
    if (item.name === "rolling_monthly") {
      await page.locator("#transaction_cost_bps").fill("1.875");
      await page.getByText("PLAN OUTDATED", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "RUN BACKTEST", exact: true })
          .isDisabled(),
        true,
      );
      await page.locator("#transaction_cost_bps").fill("0");
      const again = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname === "/api/workbench/plan",
      );
      await page
        .getByRole("button", { name: "PREVIEW WALK-FORWARD", exact: true })
        .click();
      await again;
      await page.locator(".wd-review-check input").check();
      checks.edit_invalidates_review = true;
      for (const width of [360, 390, 430, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.locator("#preview-folds").scrollIntoViewIfNeeded();
        const d = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
        }));
        assert.ok(d.document <= d.viewport);
        const boxes = await page
          .locator(".ce-form-groups input,.ce-form-groups select")
          .evaluateAll((nodes) =>
            nodes.map((n) => ({
              left: n.getBoundingClientRect().left,
              right: n.getBoundingClientRect().right,
              height: n.getBoundingClientRect().height,
            })),
          );
        assert.ok(
          boxes.every((b) => b.left >= 0 && b.right <= width && b.height >= 44),
        );
        responsive.push({
          width,
          stage: "CONFIGURE_AND_PLAN",
          ...d,
          overflow: false,
          screenshot: await shot(`plan-${width}`),
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const submitted = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/workbench/runs",
    );
    await page
      .getByRole("button", { name: "RUN BACKTEST", exact: true })
      .click();
    const started = await submitted,
      receipt = await started.json();
    assert.equal(started.status(), 202);
    assert.deepEqual(started.request().postDataJSON(), plan.normalized_request);
    assert.equal(receipt.execution_requested, true);
    const wait = async (rec) => {
      await page.waitForFunction(
        ({ id, attempt }) =>
          document.querySelector("#run-status small")?.textContent ===
            "SUCCESS" &&
          (
            document.querySelector("#run-status .workbench-audit")
              ?.textContent || ""
          ).includes(id) &&
          (
            document.querySelector("#run-status .workbench-audit")
              ?.textContent || ""
          ).includes(attempt),
        { id: rec.run_id, attempt: rec.execution_attempt_id },
      );
      await page
        .getByRole("heading", { name: "Risk, upside and timing", exact: true })
        .waitFor();
      return apiRequest(`/runs/${rec.run_id}`);
    };
    const detail = await wait(receipt),
      r = detail.latest_successful_result;
    assert.equal(r.attribution.status, "AVAILABLE");
    assert.equal(r.matched_beta_diagnostic.status, "MATCHED");
    assert.ok(
      Math.abs(r.matched_beta_diagnostic.remaining_beta_difference) <= 1e-9,
    );
    assert.deepEqual(r.validation_diagnostics.exact_fold_plan, plan.folds);
    const tracks = Object.values(r.benchmark_tracks),
      dates = r.time_series.points.map((p) => p.date);
    for (const t of tracks) {
      assert.deepEqual(
        t.points.map((p) => p.date),
        dates,
      );
      assert.deepEqual(t.fold_boundaries, plan.folds);
    }
    assert.equal(r.benchmark_metrics.DYNAMIC_EXPOSURE.cagr, r.metrics.cagr);
    assert.equal(
      r.benchmark_metrics.DYNAMIC_EXPOSURE.final_research_index,
      r.metrics.final_research_index,
    );
    assert.deepEqual(
      r.benchmark_tracks.DYNAMIC_EXPOSURE.points.map((p) => p.index),
      r.time_series.points.map((p) => p.index),
    );
    if (item.spec.transaction_cost_bps > 0) {
      assert.ok(r.benchmark_metrics.PASSIVE_SPY.realized_simulated_cost > 0);
      assert.ok(
        r.benchmark_metrics.STATIC_MATCHED_BETA.realized_simulated_cost > 0,
      );
    }
    const a = r.attribution.values;
    assert.ok(
      Math.abs(
        a.total_dynamic_effect_cagr_difference -
          a.exposure_level_effect_cagr_difference -
          a.timing_residual_cagr_difference,
      ) < 1e-12,
    );
    assert.equal(r.attribution.alpha_claim, "NONE");
    assert.equal(await page.locator("#results .ce-chart").count(), 3);
    assert.equal(
      await page.locator("#results .ce-chart .recharts-line").count(),
      8,
    );
    await page
      .getByText(
        "A positive timing residual is not automatically statistical alpha.",
        { exact: false },
      )
      .waitFor();
    const rawPath = join(
      temp,
      "runs",
      "runs",
      receipt.run_id,
      "attempts",
      receipt.execution_attempt_id,
      "result.json",
    );
    const rawBefore = metricsHash(await readFile(rawPath));
    await apiRequest(`/runs/${receipt.run_id}`);
    const rawAfter = metricsHash(await readFile(rawPath));
    assert.equal(rawBefore, rawAfter);
    const raw = JSON.parse((await readFile(rawPath)).toString());
    assert.deepEqual(raw.metrics, r.metrics);
    assert.equal(raw.financial_result_hash, r.financial_result_hash);
    assert.equal(raw.benchmark_tracks, undefined);
    const repeatResponse = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname.endsWith("/rerun"),
    );
    await page
      .getByRole("button", { name: "RERUN SAME DESIGN", exact: true })
      .click();
    const repeatStarted = await repeatResponse,
      repeatReceipt = await repeatStarted.json();
    assert.deepEqual(repeatStarted.request().postDataJSON(), {});
    const repeated = await wait(repeatReceipt),
      repeatedResult = repeated.latest_successful_result;
    assert.equal(repeatReceipt.run_id, receipt.run_id);
    assert.notEqual(
      repeatReceipt.execution_attempt_id,
      receipt.execution_attempt_id,
    );
    for (const key of [
      "financial_result_hash",
      "passive_control_hash",
      "matched_beta_control_hash",
      "attribution_hash",
    ])
      assert.equal(repeatedResult[key], r[key]);
    assert.deepEqual(repeatedResult.benchmark_tracks, r.benchmark_tracks);
    assert.equal(repeated.attempt_history.length, 2);
    evidence.push({
      name: item.name,
      request: item.spec,
      run_id: receipt.run_id,
      attempt_id: receipt.execution_attempt_id,
      rerun_attempt_id: repeatReceipt.execution_attempt_id,
      dynamic_metrics: r.metrics,
      benchmark_metrics: r.benchmark_metrics,
      matched_beta_diagnostic: r.matched_beta_diagnostic,
      attribution: r.attribution,
      selected_policy_by_fold: r.selected_policy_by_fold,
      hashes: {
        dynamic: r.financial_result_hash,
        passive: r.passive_control_hash,
        matched_beta: r.matched_beta_control_hash,
        attribution: r.attribution_hash,
      },
      all_hashes_reproduce: true,
      dynamic_stored_result_unchanged: true,
      normalized_costs_equal: true,
      screenshot: await shot(`${item.name}-results`),
    });
    console.log(`PASS empirical Chromium B3C: ${item.name}`);
  }
  checks.single_cost_maps_both_wire_fields = true;
  checks.three_real_aligned_tracks = true;
  checks.beta_and_attribution_reconcile = true;
  checks.every_case_reruns_all_hashes = true;
  const rows = page.locator("#temporary-history tbody tr");
  for (const item of [matrix[0], matrix[3]]) {
    const row = rows
      .filter({ hasText: `${item.spec.transaction_cost_bps} bps` })
      .filter({ hasText: "Rolling" })
      .filter({ hasText: "Monthly" });
    await row.getByRole("button", { name: "COMPARE", exact: true }).click();
  }
  const beforeCompare = await apiRequest("/runs");
  const comparisonResponse = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/workbench/compare",
  );
  await page.getByRole("button", { name: "COMPARE SELECTED RUNS" }).click();
  const comparison = await (await comparisonResponse).json();
  await page
    .getByRole("heading", { name: "Compared designs", exact: true })
    .waitFor();
  assert.deepEqual(
    comparison.financial_input_differences.map((d) => d.path).sort(),
    ["/selection_cost_bps", "/transaction_cost_bps"],
  );
  assert.equal(comparison.calculation, "READ_ONLY_NO_RECALCULATION");
  assert.deepEqual(await apiRequest("/runs"), beforeCompare);
  await shot("comparison-desktop");
  checks.compare_read_only_no_winner = true;
  for (const width of [360, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const d = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(d.document <= d.viewport);
    const chartBounds = await page
      .locator("#results .ce-chart")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({
          left: n.getBoundingClientRect().left,
          right: n.getBoundingClientRect().right,
          width: n.getBoundingClientRect().width,
        })),
      );
    assert.ok(
      chartBounds.every(
        (c) =>
          c.left >= 0 &&
          c.right <= width &&
          c.width >= Math.min(width - 80, 900),
      ),
    );
    responsive.push({
      width,
      stage: "RESULTS_AND_COMPARE",
      ...d,
      overflow: false,
      charts: chartBounds,
      screenshot: await shot(`results-${width}`),
    });
    await page
      .getByRole("heading", { name: "OOS research index", exact: true })
      .scrollIntoViewIfNeeded();
    if (width === 390) {
      const chart = page.locator("#results .ce-chart").first();
      await chart.hover({ position: { x: 120, y: 150 } });
      const tooltips = await chart
        .locator(".recharts-tooltip-wrapper")
        .evaluateAll((nodes) =>
          nodes
            .filter((n) => getComputedStyle(n).visibility === "visible")
            .map((n) => ({
              left: n.getBoundingClientRect().left,
              right: n.getBoundingClientRect().right,
            })),
        );
      assert.equal(tooltips.length, 1);
      assert.ok(
        tooltips.every((t) => t.left >= 0 && t.right <= width),
        "Chart tooltip stays within the mobile viewport",
      );
      checks.mobile_tooltip_contained = true;
    }
    await shot(`chart-viewport-${width}`, false);
  }
  for (const boundary of [
    "RESEARCH ONLY",
    "TEMPORARY STORAGE",
    "DATA VINTAGE NOT INDEPENDENTLY VERIFIED",
  ])
    await page.getByText(boundary, { exact: true }).waitFor();
  assert.equal(
    calls.some((c) => c.path.includes("/v1")),
    false,
  );
  assert.equal(
    await page
      .getByRole("button", { name: /^(TRADE|PLACE ORDER|AUTHORIZE CAPITAL)$/i })
      .count(),
    0,
  );
  checks.no_v1_or_live_trading_controls = true;
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 900 },
    isMobile: true,
    hasTouch: true,
  });
  const touch = await mobile.newPage();
  touch.setDefaultTimeout(30000);
  await touch.goto(origin + "/workbench", { waitUntil: "networkidle" });
  await touch.getByLabel("Preview token").fill(token);
  await touch.getByRole("button", { name: "OPEN WORKBENCH" }).tap();
  await touch
    .getByRole("heading", { name: "Configure the backtest", exact: true })
    .waitFor();
  await fill(base, touch);
  await touch.getByRole("button", { name: "PREVIEW WALK-FORWARD" }).tap();
  await touch.locator(".wd-review-check input").waitFor();
  await touch.locator(".wd-review-check").tap();
  assert.equal(
    await touch
      .getByRole("button", { name: "RUN BACKTEST", exact: true })
      .isEnabled(),
    true,
  );
  await touch.locator("#preview-folds").scrollIntoViewIfNeeded();
  await touch.locator(".wd-map-scroll").evaluate((e) => {
    e.scrollLeft = e.scrollWidth;
  });
  await shot("touch-mobile-fold-review", false, touch);
  await mobile.close();
  checks.touch_mobile_review = true;
  for (const f of (await readdir(join(frontend, "assets"))).filter((f) =>
    f.endsWith(".js"),
  )) {
    const content = await readFile(join(frontend, "assets", f), "utf8");
    assert.equal(content.includes(token), false);
    assert.equal(content.includes("WORKBENCH_PREVIEW_TOKEN"), false);
  }
  checks.no_preview_secret_in_build = true;
  assert.deepEqual(errors, []);
  const evidenceReport = {
    status: "PASS",
    browser: await browser.version(),
    checks,
    standard_mode_empirical_attempts: 8,
    matrix: evidence,
    comparison,
    responsive,
    screenshots,
    page_errors: errors,
    mobile_touch_emulation: true,
    physical_android_tested: false,
    alpha_claim: "NONE",
  };
  await writeFile(
    join(reports, "browser-acceptance.json"),
    JSON.stringify(evidenceReport, null, 2) + "\n",
  );
  console.log(
    "PASS B3C browser UX, benchmarks, attribution, reruns and all five widths",
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
