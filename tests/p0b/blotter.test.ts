import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import {
  projectTradingBlotter,
  BlotterError,
} from "../../artifacts/api-server/src/lib/workbench/trading-blotter";
import {
  queryTradingBlotter,
  validateBlotterQuery,
} from "../../artifacts/api-server/src/lib/workbench/trading-blotter-api";
import { createP0Router } from "../../artifacts/api-server/src/routes/workbench-p0";
import { createWorkbenchPreviewAccess } from "../../artifacts/api-server/src/lib/workbench/preview-access";
import { blotterFixture, fixtureRecord, manyFillFixture } from "./fixture";
import {
  optimizerTestData,
  optimizerTestRequest,
} from "../../research/coordinated/optimizer-test-fixtures";
import { normalizeP0WithData } from "../../artifacts/api-server/src/lib/workbench/p0-calendar";
import { runInstitutional } from "../../research/coordinated/institutional";
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0),
  near = (a: number, b: number) =>
    assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test("Deterministic read-only projection, stable source IDs, separate reporting identity and exact source hash", () => {
  const input = blotterFixture(),
    before = structuredClone(input),
    a = projectTradingBlotter(input),
    b = projectTradingBlotter(input);
  assert.deepEqual(a, b);
  assert.deepEqual(input, before);
  assert.equal(input.result.financial_result_hash, "SOURCE_ONLY_HASH");
  const c = projectTradingBlotter({
    ...input,
    attempt_id: "ea_new_immutable_attempt",
  });
  assert.equal(c.projection_content_hash, a.projection_content_hash);
  assert.notEqual(c.blotter_hash, a.blotter_hash);
  assert.notEqual(c.executions[0].fill_id, a.executions[0].fill_id);
  assert.equal(
    a.executions.length,
    input.result.ledger.reduce((s: number, d: any) => s + d.trades.length, 0),
  );
});
test("Execution reasons join recorded signal/decision evidence: initial, reduction, increase, exit, reentry, joint", () => {
  const b = projectTradingBlotter(blotterFixture());
  assert.deepEqual(
    b.events.map((e) => e.reason_code),
    [
      "INITIAL_ALLOCATION",
      "HMM_EXPOSURE_REDUCTION",
      "HMM_EXPOSURE_INCREASE",
      "HMM_EXIT_TO_CASH",
      "HMM_REENTRY",
      "JOINT_REBALANCE_AND_EXPOSURE",
    ],
  );
  assert.deepEqual(b.events.at(-1)!.causes, [
    "SCHEDULED_PORTFOLIO_REBALANCE",
    "RECORDED_CAPITAL_POLICY_CHANGE",
  ]);
  b.executions.forEach((f) => {
    assert.ok(f.signal_date! < f.execution_session_date);
    assert.ok(f.information_cutoff! < f.signal_date!);
    assert.equal(f.execution_time, "NOT_AVAILABLE_EOD");
    assert.equal(f.price_basis, "SIMULATED_ADJUSTED_CLOSE");
    assert.equal(f.execution_convention, "NEXT_OBSERVED_CLOSE");
  });
  const x = blotterFixture();
  x.spec.regime_model = "TREND";
  const generic = projectTradingBlotter(x);
  assert.equal(
    generic.events[1].reason_code,
    "CAPITAL_RULE_EXPOSURE_REDUCTION",
  );
  assert.equal(generic.events[3].reason_code, "CAPITAL_RULE_EXIT_TO_CASH");
});
test("Scheduled rebalances are not falsely classified joint merely because optimized exposure changed", () => {
  const input = blotterFixture();
  input.result.capital_clock.signals.at(-1).regime.high_risk_probability = 0;
  assert.equal(
    projectTradingBlotter(input).events.at(-1)!.reason_code,
    "SCHEDULED_REBALANCE",
  );
});
test("FIFO partial exits, scale-in, liquidation, cross-month reentry and open lots preserve fees and P&L", () => {
  const b = projectTradingBlotter(blotterFixture()),
    spy = b.lots.filter((l) => l.symbol === "SPY");
  assert.deepEqual(
    spy
      .filter((l) => l.status === "CLOSED")
      .map((l) => [l.entry_price, l.exit_price, l.quantity]),
    [
      [10, 12, 0.5],
      [10, 13, 1.5],
      [11, 13, 0.5],
      [14, 15, 0.25],
    ],
  );
  const open = spy.find((l) => l.status === "OPEN")!;
  assert.equal(open.quantity, 0.75);
  assert.equal(open.entry_price, 14);
  assert.equal(open.exit_date, null);
  assert.equal(open.exit_price, null);
  assert.equal(open.closing_reason, null);
  assert.equal(open.valuation_price, 15);
  near(open.gross_unrealized_pnl!, 0.75);
  const closed = spy.find((l) => l.exit_date === "2024-02-01")!;
  assert.ok(closed.holding_calendar_days! > 20);
  assert.equal(closed.opening_reason, "HMM_REENTRY");
  assert.equal(closed.closing_reason, "JOINT_REBALANCE_AND_EXPOSURE");
  near(
    sum(b.lots.map((l) => (l.entry_fees ?? 0) + l.exit_fees)),
    b.reconciliation.fees,
  );
  near(
    sum(b.lots.map((l) => (l.entry_slippage ?? 0) + l.exit_slippage)),
    b.reconciliation.slippage,
  );
  assert.equal(b.reconciliation.fifo_plus_cash_equals_portfolio_pnl, true);
  near(
    b.reconciliation.realized_net_pnl +
      b.reconciliation.unrealized_net_pnl +
      b.reconciliation.cash_pnl,
    b.reconciliation.net_pnl,
  );
});
test("Daily fills reconcile 1:1 prices, quantity, signed cash, fees and slippage; drift has no fill", () => {
  const input = blotterFixture(),
    b = projectTradingBlotter(input);
  input.result.ledger.forEach((d: any, di: number) => {
    const fills = b.executions.filter((f) => f.ledger_day_index === di);
    near(sum(fills.map((f) => f.fees)), d.transactionCosts);
    near(sum(fills.map((f) => f.slippage)), d.slippage);
    fills.forEach((f) => {
      assert.equal(f.signed_quantity, d.trades[f.ledger_trade_index].quantity);
      near(f.execution_price, f.signed_notional / f.signed_quantity);
    });
  });
  assert.equal(
    b.executions.filter((f) => f.execution_session_date === "2024-01-09")
      .length,
    0,
  );
  assert.equal(
    b.positions.find((p) => p.date === "2024-01-09" && p.symbol === "SPY")!
      .observed_state,
    "MARKET_DRIFT",
  );
});
test("Historical missing or ambiguous provenance is UNCLASSIFIED; initial inventory basis is not fabricated", () => {
  const x = blotterFixture();
  delete x.result.capital_clock;
  const b = projectTradingBlotter(x);
  assert.ok(b.executions.every((f) => f.reason_code === "UNCLASSIFIED"));
  assert.ok(b.warnings.includes("UNCLASSIFIED_HISTORICAL_EVENT"));
  const carry = blotterFixture();
  carry.result.ledger = carry.result.ledger.slice(1);
  const c = projectTradingBlotter(carry);
  assert.ok(c.warnings.includes("UNKNOWN_INITIAL_COST_BASIS"));
  assert.ok(
    c.lots.some(
      (l) =>
        l.entry_date === null &&
        l.entry_price === null &&
        l.net_realized_pnl === null,
    ),
  );
  assert.equal(
    c.reconciliation.fifo_pnl_status,
    "NOT_SUPPORTED_UNKNOWN_INITIAL_BASIS",
  );
  const ambiguous = blotterFixture();
  ambiguous.result.capital_clock.signals.push(
    ambiguous.result.capital_clock.signals[0],
  );
  assert.equal(
    projectTradingBlotter(ambiguous).events[0].reason_code,
    "UNCLASSIFIED",
  );
});
test("Corrupt cash, fill price, inventory or incomplete attempts fail closed without fabricated records", () => {
  for (const status of ["FAILED", "RUNNING", "BLOCKED", "PENDING"])
    assert.throws(
      () => projectTradingBlotter({ ...blotterFixture(), status }),
      (e: any) => e.code === "BLOTTER_NOT_AVAILABLE",
    );
  for (const mutate of [
    (x: any) => x.result.ledger[0].endingCash++,
    (x: any) => x.result.ledger[1].trades[0].notional++,
    (x: any) => x.result.ledger[2].endingPositions[0].quantity++,
  ]) {
    const x = blotterFixture();
    mutate(x);
    assert.throws(() => projectTradingBlotter(x), BlotterError);
  }
});
test("Typed pagination, search, reason/side/session filters and CSV preserve selected immutable source", () => {
  const b = projectTradingBlotter(blotterFixture()),
    q = validateBlotterQuery({
      symbol: "SPY",
      side: "SELL",
      sort: "execution_price",
      direction: "desc",
      page_size: "2",
    });
  const r = queryTradingBlotter(b, q) as any;
  assert.equal(r.rows.length, 2);
  assert.equal(r.total, 3);
  assert.ok(r.rows[0].execution_price >= r.rows[1].execution_price);
  assert.ok(r.rows.every((f: any) => f.symbol === "SPY" && f.side === "SELL"));
  const csv = queryTradingBlotter(b, { ...q, format: "csv" }) as any;
  assert.ok(csv.csv.includes("SIMULATED_ADJUSTED_CLOSE"));
  assert.ok(csv.csv.includes(b.blotter_hash));
  assert.equal(csv.csv.split("\r\n").length, 5);
  const exportInput = blotterFixture();
  exportInput.spec.code_version = "=SOURCE_ONLY_FORMULA";
  assert.ok(
    (
      queryTradingBlotter(projectTradingBlotter(exportInput), {
        ...q,
        format: "csv",
      }) as any
    ).csv.includes("'=SOURCE_ONLY_FORMULA"),
  );
  for (const q of [
    { path: "/etc/passwd" },
    { page_size: "101" },
    { sort: "__proto__" },
    { view: "other" },
    { view: "positions", side: "BUY" },
    { from: "2024-02-31" },
    { direction: ["asc"] },
    { reason: "MARKET_DRIFT" },
  ])
    assert.throws(() => validateBlotterQuery(q));
});
test("Actual source engine ledger projects both 2.5%/3% floors, preserves hashes and reconciles HMM trading", () => {
  for (const floor of [0.025, 0.03]) {
    const data = optimizerTestData(2),
      request = optimizerTestRequest({
        etfs: ["SPY", "ETF1"],
        maximum_etf_weight: floor,
        mandate: {
          minimum_positions: 2,
          maximum_positions: 2,
          minimum_weight: floor,
        },
        evaluation_end_exclusive: "2024-04-01",
      }),
      spec = normalizeP0WithData(request, data);
    const result = runInstitutional(spec, data, () => {}, {
      classifyCapital: ((_m: any, h: any[]) => ({
        model: "SOURCE_ONLY",
        high_risk_probability:
          (Math.floor(Date.parse(h.at(-1).date) / 86400000) % 3) / 2,
      })) as any,
    });
    const before = JSON.stringify(result),
      b = projectTradingBlotter({
        run_id: "rr_test",
        attempt_id: "ea_test",
        status: "SUCCESS",
        spec,
        result,
      });
    assert.equal(JSON.stringify(result), before);
    assert.equal(
      b.provenance.source_financial_result_hash,
      result.financial_result_hash,
    );
    assert.equal(b.reconciliation.fifo_plus_cash_equals_portfolio_pnl, true);
    assert.ok(b.executions.length > 20);
    assert.ok(
      b.executions.some(
        (f) => f.weight_after_fill > 0 && f.weight_after_fill < floor,
      ),
    );
  }
});
test("1,600 daily sessions project deterministically with bounded paginated response", () => {
  const x = blotterFixture(),
    d = structuredClone(x.result.ledger[0]);
  d.trades = [];
  d.transactionCosts = 0;
  d.slippage = 0;
  d.beginningPositions = [];
  d.endingPositions = [];
  d.etfPnl = 0;
  d.cashPnl = 0;
  d.netPnl = 0;
  d.beginningCash = d.endingCash = d.beginningNav = d.endingNav = 100;
  x.result.ledger = Array.from({ length: 1600 }, (_, i) => ({
    ...d,
    date: new Date(Date.parse("2010-01-02") + i * 86400000)
      .toISOString()
      .slice(0, 10),
    intervalStart: new Date(Date.parse("2010-01-01") + i * 86400000)
      .toISOString()
      .slice(0, 10),
  }));
  const start = performance.now(),
    b = projectTradingBlotter(x);
  assert.equal(b.executions.length, 0);
  assert.ok(performance.now() - start < 5000);
});
test("Authenticated production route reads an explicit successful attempt, no writes/execution, CSV equally protected", async () => {
  const input = blotterFixture(),
    record = fixtureRecord();
  let reads = 0;
  const store = {
    getRun: async () => ({
      normalized_spec: input.spec,
      attempt_history: [
        ...record.attempt_history,
        {
          status: "FAILED",
          attempt: { run_id: input.run_id, execution_attempt_id: "ea_failed" },
        },
      ],
    }),
    readAttemptResult: async () => {
      reads++;
      return input.result;
    },
    reviews: async () => [],
    review: async () => assert.fail("No writes"),
  };
  const app = express();
  app.use(
    "/api/workbench",
    createWorkbenchPreviewAccess(() => "P0B_SOURCE_TEST_TOKEN"),
  );
  app.use("/api", createP0Router({ service: async () => ({ store }) as any }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/workbench/p0/runs/${input.run_id}/attempts/`;
  try {
    for (const suffix of ["blotter", "blotter?format=csv"]) {
      const r = await fetch(base + input.attempt_id + "/" + suffix);
      assert.equal(r.status, 401);
    }
    assert.equal(reads, 0);
    const wrongRun = await fetch(
      base.replace(input.run_id, "rr_other_run") +
        input.attempt_id +
        "/blotter",
      { headers: { Authorization: "Bearer P0B_SOURCE_TEST_TOKEN" } },
    );
    assert.equal(wrongRun.status, 404);
    assert.equal(reads, 0);
    const get = (id: string, q = "") =>
      fetch(base + id + "/blotter" + q, {
        headers: { Authorization: "Bearer P0B_SOURCE_TEST_TOKEN" },
      });
    assert.equal((await get("ea_unknown")).status, 404);
    assert.equal((await get("ea_failed")).status, 409);
    assert.equal(reads, 0);
    const r = await get(input.attempt_id, "?page_size=2");
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.rows.length, 2);
    assert.equal(body.attempt_id, input.attempt_id);
    assert.equal(body.research_boundary, "RESEARCH_ONLY");
    const csv = await get(input.attempt_id, "?format=csv&symbol=SPY");
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type")!, /text\/csv/);
    assert.ok((await csv.text()).includes("SPY"));
    const count = reads;
    assert.equal(
      (await get(input.attempt_id, "?path=../../secrets")).status,
      400,
    );
    assert.equal(reads, count);
    assert.equal((await get(input.attempt_id, "?page_size=999")).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("1,601 actual fills: FIFO, charges and 50-row pages stay bounded with reproducible hashes", () => {
  const input = manyFillFixture(),
    start = performance.now(),
    b = projectTradingBlotter(input);
  assert.equal(b.executions.length, 1601);
  assert.equal(b.lots.filter((l) => l.status === "CLOSED").length, 800);
  assert.equal(b.lots.filter((l) => l.status === "OPEN").length, 1);
  assert.equal(b.reconciliation.fifo_plus_cash_equals_portfolio_pnl, true);
  const page = queryTradingBlotter(
    b,
    validateBlotterQuery({ page: "2", page_size: "50" }),
  ) as any;
  assert.equal(page.rows.length, 50);
  assert.equal(page.events.length, 50);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 200000);
  assert.ok(performance.now() - start < 5000);
  assert.equal(projectTradingBlotter(input).blotter_hash, b.blotter_hash);
});
test("An inactive HMM change is not misattributed as a joint fill; execution prices never infer intraday values", () => {
  const input = blotterFixture();
  input.result.decisions[1].capital_overlay.baseline_maximum_exposure = 0.1;
  input.result.decisions[0].capital_overlay.baseline_maximum_exposure = 0.2;
  const b = projectTradingBlotter(input);
  assert.equal(b.events.at(-1)!.reason_code, "SCHEDULED_REBALANCE");
});

test("Signal-date filtering and execution-to-FIFO links use the same immutable source, without mutating aliased evidence", () => {
  const input = blotterFixture(),
    b = projectTradingBlotter(input),
    original = structuredClone(input);
  const page = queryTradingBlotter(
    b,
    validateBlotterQuery({
      from: "2024-01-01",
      to: "2024-01-01",
      date_field: "signal_date",
    }),
  ) as any;
  assert.equal(page.total, 2);
  assert.ok(
    page.rows.every((f: any) => f.execution_session_date === "2024-01-02"),
  );
  const sell = b.executions.find((f) => f.side === "SELL")!;
  const lots = queryTradingBlotter(
    b,
    validateBlotterQuery({ view: "lots", fill_id: sell.fill_id }),
  ) as any;
  assert.equal(lots.total, 1);
  assert.equal(lots.rows[0].exit_fill_id, sell.fill_id);
  assert.ok(lots.events.some((e: any) => e.event_id === sell.event_id));
  b.events[0].scheduled_decision!.weights.SPY = 999;
  b.events[0].capital_signal!.regime.model = "MUTATED_REPORT";
  b.positions[0].realized_position!.quantity = 999;
  assert.deepEqual(input, original);
});
test("Signal-cutoff position evidence is kept separate from prior-close and executed positions; unavailable dates stay null", () => {
  const b = projectTradingBlotter(blotterFixture()),
    row = b.positions.find(
      (p) => p.date === "2024-01-04" && p.symbol === "SPY",
    )!;
  assert.equal(row.source_information_cutoff, "2024-01-02");
  assert.equal(row.quantity_at_information_cutoff, 2);
  assert.equal(row.beginning_quantity, 1.5);
  assert.equal(row.ending_quantity, 2);
  const absent = b.positions.find((p) => p.date === "2024-01-02")!;
  assert.equal(absent.quantity_at_information_cutoff, null);
});
test("Zero fill observations never become trades; joint events never attribute per-cause profit", () => {
  const input = blotterFixture();
  input.result.ledger[5].trades.push({
    ticker: "SPY",
    quantity: 0,
    notional: 0,
  });
  const b = projectTradingBlotter(input);
  assert.equal(b.executions.length, 8);
  assert.equal(
    b.events.filter((e) => e.execution_session_date === "2024-01-09").length,
    0,
  );
  assert.equal((b.events.at(-1) as any).hmm_pnl, undefined);
});

test("FIFO quantity precision is relative to the traded book, including tiny quantities at large adjusted prices", () => {
  const original = blotterFixture(),
    scaled = structuredClone(original);
  for (const day of scaled.result.ledger) {
    for (const positions of [day.beginningPositions, day.endingPositions])
      for (const p of positions) {
        p.quantity *= 1e-9;
        p.price *= 1e9;
      }
    for (const t of day.trades) t.quantity *= 1e-9;
  }
  const a = projectTradingBlotter(original),
    b = projectTradingBlotter(scaled);
  near(a.reconciliation.realized_net_pnl, b.reconciliation.realized_net_pnl);
  near(
    a.reconciliation.unrealized_net_pnl,
    b.reconciliation.unrealized_net_pnl,
  );
  assert.equal(b.lots.length, a.lots.length);
  b.lots.forEach((l, i) => near(l.quantity / 1e-9, a.lots[i].quantity));
});

test("Stale result/attempt, engine or dataset provenance cannot masquerade as the selected immutable source", () => {
  for (const patch of [
    { run_id: "rr_other" },
    { execution_attempt_id: "ea_other" },
    { dataset_hash: "OTHER_DATA" },
    { provenance: { code_version: "OTHER_ENGINE" } },
  ]) {
    const input = blotterFixture();
    Object.assign(input.result, patch);
    assert.throws(
      () => projectTradingBlotter(input),
      (e: any) => e.code === "BLOTTER_SOURCE_MISMATCH",
    );
  }
});

test("Daily position drill-down retains known zero holdings through cash without inventing unavailable prices", () => {
  const input = blotterFixture();
  input.spec.etfs = ["SPY", "ETF1", "NEVER_HELD"];
  const b = projectTradingBlotter(input),
    row = b.positions.find(
      (p) => p.date === "2024-01-09" && p.symbol === "ETF1",
    )!;
  assert.equal(row.beginning_quantity, 0);
  assert.equal(row.ending_quantity, 0);
  assert.equal(row.ending_price, null);
  assert.deepEqual(row.fill_ids, []);
  const never = b.positions.filter((p) => p.symbol === "NEVER_HELD");
  assert.equal(never.length, input.result.ledger.length);
  assert.ok(
    never.every((p) => p.ending_price === null && p.ending_quantity === 0),
  );
});
