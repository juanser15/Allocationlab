import test from "node:test";
import assert from "node:assert/strict";
import { projectTradingBlotter } from "../../artifacts/api-server/src/lib/workbench/trading-blotter";
import {
  DUST_TARGETS,
  XLF_DUST_TARGETS,
  XLY_DUST_TARGETS,
  inventoryFixture,
} from "./fifo-dust-fixture";
for (const symbol of ["XLF", "XLY"])
  test(`${symbol}: flat source inventory must not become a microscopic FIFO OPEN lot`, () => {
    const input = inventoryFixture(
        symbol,
        symbol === "XLF" ? XLF_DUST_TARGETS : XLY_DUST_TARGETS,
      ),
      before = structuredClone(input),
      b = projectTradingBlotter(input);
    assert.equal(b.lots.filter((l) => l.status === "OPEN").length, 0);
    assert.equal(b.reconciliation.fifo_plus_cash_equals_portfolio_pnl, true);
    assert.deepEqual(input, before);
  });
test("Positive tiny source inventory after large historical activity remains an OPEN lot", () => {
  const quantity = Number.EPSILON * 2,
    input = inventoryFixture("XLF", [1, quantity]),
    b = projectTradingBlotter(input);
  const open = b.lots.filter((l) => l.status === "OPEN");
  assert.equal(open.length, 1);
  assert.equal(open[0].quantity, quantity);
  assert.equal(open[0].exit_date, null);
});

test("Reported XLF/XLY residual magnitudes fit a historical-inventory bound with no absolute share floor", async () => {
  const { fifoQuantityTolerance } =
    await import("../../artifacts/api-server/src/lib/workbench/trading-blotter");
  const bound = fifoQuantityTolerance(1.2, 0.6, 64);
  for (const residue of [1.1102230246251565e-16, 1.3877787807814457e-17])
    assert.ok(residue < bound);
  assert.ok(bound < 1e-10 * 0.6);
  assert.equal(fifoQuantityTolerance(0, 0, 8), 0);
  assert.ok(fifoQuantityTolerance(1.2e-12, 0.6e-12, 64) < 1e-24);
});
function changeLastSell(
  input: ReturnType<typeof inventoryFixture>,
  delta: number,
) {
  const d = input.result.ledger.at(-1),
    fill = d.trades[0],
    price = fill.notional / fill.quantity;
  fill.quantity += delta;
  fill.notional = fill.quantity * price;
  d.transactionCosts = Math.abs(fill.notional) * 0.001;
  d.slippage = Math.abs(fill.notional) * 0.0005;
  d.endingCash =
    d.beginningCash - fill.notional - d.transactionCosts - d.slippage;
  d.endingNav = d.endingCash;
  d.netPnl = -d.transactionCosts - d.slippage;
}
test("An excess sell of numerical dust closes with full costs but no invented execution", () => {
  const input = inventoryFixture("XLF", [0.6, 0]);
  changeLastSell(input, -Number.EPSILON / 2);
  const before = structuredClone(input),
    b = projectTradingBlotter(input);
  assert.deepEqual(input, before);
  assert.equal(b.executions.length, 2);
  assert.equal(b.lots.filter((l) => l.status === "OPEN").length, 0);
  assert.ok(
    b.reconciliation.fifo_quantity_policy.adjustments.some(
      (a: any) => a.kind === "SELL_QUANTITY_ROUNDOFF",
    ),
  );
  assert.equal(b.reconciliation.fifo_plus_cash_equals_portfolio_pnl, true);
});
test("A material flat-book inventory shortfall is rejected, even inside legacy NAV money tolerance", () => {
  for (const delta of [1e-11, -1e-11]) {
    const input = inventoryFixture("XLF", [0.6, 0]);
    changeLastSell(input, delta);
    assert.throws(
      () => projectTradingBlotter(input),
      (e: any) =>
        e.code === "BLOTTER_LEDGER_INCONSISTENT" &&
        /FIFO open quantities|Sell exceeds/.test(e.message),
    );
  }
});
test("Full liquidation, partial exits and re-entry reset the lot queue without carrying old dust into a new position", () => {
  const input = inventoryFixture("XLY", [...DUST_TARGETS, 0.4, 0.2, 0, 0.3]),
    b = projectTradingBlotter(input);
  const open = b.lots.filter((l) => l.status === "OPEN");
  assert.equal(open.length, 1);
  assert.equal(open[0].entry_date, input.result.ledger.at(-1).date);
  assert.equal(open[0].quantity, 0.3);
  assert.equal(open[0].exit_date, null);
  const sums = b.lots.reduce(
    (a, l) => ({
      fees: a.fees + (l.entry_fees ?? 0) + l.exit_fees,
      slippage: a.slippage + (l.entry_slippage ?? 0) + l.exit_slippage,
    }),
    { fees: 0, slippage: 0 },
  );
  assert.ok(Math.abs(sums.fees - b.reconciliation.fees) < 1e-12);
  assert.ok(Math.abs(sums.slippage - b.reconciliation.slippage) < 1e-12);
  for (const a of b.reconciliation.fifo_quantity_policy.adjustments)
    assert.ok(a.quantity <= a.quantity_tolerance);
});
test("Sub-picounit real holdings at high adjusted prices remain open and reconcile", () => {
  const input = inventoryFixture("XLY", [1e-12, 0.25e-12], 1e12),
    b = projectTradingBlotter(input),
    open = b.lots.filter((l) => l.status === "OPEN");
  assert.equal(open.length, 1);
  assert.ok(open[0].quantity > 0);
  assert.ok(Math.abs(open[0].quantity - 0.25e-12) <= 0.25e-12 * 1e-12);
  assert.equal(open[0].entry_price, 1e12);
  assert.equal(b.reconciliation.fifo_quantity_policy.adjustments.length, 0);
  assert.equal(b.reconciliation.fifo_plus_cash_equals_portfolio_pnl, true);
});
test("One ETF cannot inherit the quantity tolerance of another large-share book", () => {
  const first = inventoryFixture("XLF", [1e5, 0], 1e-4),
    second = inventoryFixture("XLY", [1e-12, 0.25e-12], 1e12),
    offset = first.result.ledger.at(-1).endingNav - 100;
  for (const [i, d] of second.result.ledger.entries()) {
    d.beginningNav += offset;
    d.endingNav += offset;
    d.beginningCash += offset;
    d.endingCash += offset;
    for (const p of d.beginningPositions)
      p.weight = p.marketValue / d.beginningNav;
    for (const p of d.endingPositions) p.weight = p.marketValue / d.endingNav;
    d.date = new Date(Date.parse("2024-01-04") + i * 86400000)
      .toISOString()
      .slice(0, 10);
    d.intervalStart = new Date(Date.parse("2024-01-03") + i * 86400000)
      .toISOString()
      .slice(0, 10);
    d.executionSignalDate = d.intervalStart;
  }
  first.result.ledger.push(...second.result.ledger);
  const b = projectTradingBlotter(first),
    policy = b.reconciliation.fifo_quantity_policy,
    e = policy.evidence.find((e: any) => e.symbol === "XLY");
  assert.ok(e.quantity_tolerance < 1e-24);
  assert.equal(b.lots.filter((l) => l.status === "OPEN").length, 1);
  assert.equal(b.lots.find((l) => l.status === "OPEN")!.symbol, "XLY");
});
test("Repeated liquidation dust across more than 1,500 sessions is bounded, deterministic and source preserving", () => {
  const targets = Array.from({ length: 200 }, () => DUST_TARGETS).flat(),
    input = inventoryFixture("XLF", targets),
    before = structuredClone(input),
    b = projectTradingBlotter(input);
  assert.equal(input.result.ledger.length, 1800);
  assert.equal(b.lots.filter((l) => l.status === "OPEN").length, 0);
  assert.ok(b.reconciliation.fifo_quantity_policy.adjustments.length > 0);
  assert.equal(b.reconciliation.fifo_plus_cash_equals_portfolio_pnl, true);
  assert.deepEqual(input, before);
  assert.equal(projectTradingBlotter(input).blotter_hash, b.blotter_hash);
});

test("Numerically small share dust is rejected when its economic value is material", () => {
  const targets = XLF_DUST_TARGETS.map((q) => q * 1e5),
    prices = targets.map((_, i) => (i === targets.length - 1 ? 1e10 : 1e-4)),
    input = inventoryFixture("XLF", targets, prices);
  assert.throws(
    () => projectTradingBlotter(input),
    (e: any) =>
      e.code === "BLOTTER_LEDGER_INCONSISTENT" &&
      /monetary value/.test(e.message),
  );
});

test("The existing authenticated endpoint reprojects saved dust ledgers with HTTP 200 and never submits/reruns research", async () => {
  const [
    { default: express },
    { once },
    { createP0Router },
    { createWorkbenchPreviewAccess },
  ] = await Promise.all([
    import("express"),
    import("node:events"),
    import("../../artifacts/api-server/src/routes/workbench-p0"),
    import("../../artifacts/api-server/src/lib/workbench/preview-access"),
  ]);
  const saved = new Map(
    ["XLF", "XLY"].map((symbol, i) => {
      const input = inventoryFixture(
        symbol,
        symbol === "XLF" ? XLF_DUST_TARGETS : XLY_DUST_TARGETS,
      );
      input.run_id = `rr_saved_source_${i}`;
      input.attempt_id = `ea_saved_source_${i}`;
      return [input.run_id, input] as const;
    }),
  );
  const before = structuredClone([...saved.values()]);
  let reads = 0;
  const store = {
    getRun: async (id: string) => {
      const r = saved.get(id)!;
      return {
        normalized_spec: r.spec,
        attempt_history: [
          {
            status: "SUCCESS",
            attempt: { run_id: r.run_id, execution_attempt_id: r.attempt_id },
          },
        ],
      };
    },
    readAttemptResult: async (ref: any) => {
      reads++;
      return saved.get(ref.runId)!.result;
    },
  };
  const app = express();
  app.use(
    "/api/workbench",
    createWorkbenchPreviewAccess(() => "SOURCE_ONLY_SAVED_READ"),
  );
  app.use(
    "/api",
    createP0Router({
      service: async () =>
        ({
          store,
          submit: () => assert.fail("No submission"),
          rerun: () => assert.fail("No rerun"),
        }) as any,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    for (const r of saved.values()) {
      const url = `http://127.0.0.1:${(server.address() as any).port}/api/workbench/p0/runs/${r.run_id}/attempts/${r.attempt_id}/blotter?view=lots`;
      const response = await fetch(url, {
        headers: { Authorization: "Bearer SOURCE_ONLY_SAVED_READ" },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(body.rows.every((l: any) => l.status === "CLOSED"));
      assert.equal(
        body.provenance.source_financial_result_hash,
        r.result.financial_result_hash,
      );
      assert.equal(
        body.reconciliation.fifo_plus_cash_equals_portfolio_pnl,
        true,
      );
    }
    assert.equal(reads, 2);
    assert.deepEqual([...saved.values()], before);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
