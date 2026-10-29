import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TradingBlotterPanel,
  BlotterTable,
  blotterPath,
  emptyBlotterFilters,
  requestBlotter,
} from "../../artifacts/allocation-lab/src/research/trading-blotter";
import { projectTradingBlotter } from "../../artifacts/api-server/src/lib/workbench/trading-blotter";
import { blotterFixture, fixtureRecord } from "./fixture";
test("Institutional UI describes simulated prices, unavailable time and NAV units, without dollar/broker claims", () => {
  const html = renderToStaticMarkup(
    <TradingBlotterPanel record={fixtureRecord()} />,
  );
  for (const label of [
    "Execution Blotter",
    "Round-Trip Trade Blotter",
    "Position Drill-down",
    "Download filtered CSV",
    "Symbol search",
    "From session",
    "Recorded reason",
    "FIFO is a reporting convention",
    "adjusted closes",
    "Intraday execution time is not available",
    "not dollars",
  ])
    assert.ok(html.includes(label), label);
  assert.doesNotMatch(
    html,
    /09:30|16:00|broker fill|Execute trade|Place order/,
  );
});
test("Fill/lot table renders backend values including partial exits and open null exits; detail is explicit", () => {
  const b = projectTradingBlotter(blotterFixture());
  for (const view of ["executions", "lots", "positions"] as const) {
    const html = renderToStaticMarkup(
      <BlotterTable rows={b[view]} view={view} onInspect={() => {}} />,
    );
    assert.match(html, /Scrollable recorded trading evidence/);
    assert.match(html, /Inspect/);
    assert.match(html, /SPY/);
    if (view === "lots") {
      assert.match(html, /Not available/);
      assert.match(html, /OPEN/);
    }
  }
});
test("Failed/incomplete attempt cannot auto-display prior completed trades", () => {
  const record = fixtureRecord();
  record.latest_status = "FAILED";
  const html = renderToStaticMarkup(<TradingBlotterPanel record={record} />);
  assert.match(html, /No completed trades are implied/);
  assert.match(html, /explicitly inspect an earlier successful attempt/);
  assert.doesNotMatch(html, /<tbody>/);
});
test("Typed client uses same-origin attempt-pinned read-only endpoints for filters and CSV; token stays in header", async () => {
  const path = blotterPath(
    "rr_source",
    "ea_source",
    "executions",
    {
      ...emptyBlotterFilters,
      symbol: "SPY",
      side: "SELL",
      reason: "HMM_EXIT_TO_CASH",
    },
    2,
    true,
  );
  assert.match(path, /\/attempts\/ea_source\/blotter/);
  assert.match(path, /symbol=SPY/);
  assert.match(path, /format=csv/);
  assert.match(path, /page=2/);
  assert.doesNotMatch(path, /token|v1/);
  const oldFetch = globalThis.fetch,
    oldStorage = globalThis.sessionStorage;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { getItem: () => "SOURCE_ONLY_TOKEN" },
  });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, path);
    assert.equal(
      (options!.headers as any).Authorization,
      "Bearer SOURCE_ONLY_TOKEN",
    );
    assert.equal(options!.method, undefined);
    return new Response("csv-data", {
      headers: { "Content-Type": "text/csv" },
    });
  };
  try {
    assert.equal(
      await ((await requestBlotter(path, true)) as Blob).text(),
      "csv-data",
    );
  } finally {
    globalThis.fetch = oldFetch;
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: oldStorage,
    });
  }
});

test("Decision detail shows recorded HMM evidence and strategic/effective/realized values without invented fields", async () => {
  const { BlotterDecisionDetail } =
    await import("../../artifacts/allocation-lab/src/research/trading-blotter");
  const b = projectTradingBlotter(blotterFixture()),
    selected = b.executions.at(-1)!,
    html = renderToStaticMarkup(
      <BlotterDecisionDetail
        selected={selected}
        data={{ events: b.events, position_evidence: b.positions }}
      />,
    );
  for (const label of [
    "Information cutoff",
    "High-risk probability",
    "Policy multiplier",
    "Strategic NAV target",
    "Effective capital NAV target",
    "Realized NAV weight",
    "jointly affected",
  ])
    assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /09:30|16:00|broker/);
});

test("Blotter client rejects foreign URLs before reading the owner token or fetching", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => assert.fail("No foreign request is allowed");
  try {
    await assert.rejects(
      () => requestBlotter("https://example.invalid/blotter"),
      /same-origin/,
    );
  } finally {
    globalThis.fetch = previous;
  }
});
