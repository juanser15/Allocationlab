/** Invented source-only accounting fixture, not historical market observations. */
import type { BacktestLedgerEntry } from "../../artifacts/api-server/src/lib/calculator";
import type { BlotterInput } from "../../artifacts/api-server/src/lib/workbench/trading-blotter";
export function blotterFixture(): BlotterInput {
  const steps = [
    {
      date: "2024-01-02",
      signal: "2024-01-01",
      prices: { SPY: 10, ETF1: 20 },
      trades: [
        ["SPY", 2],
        ["ETF1", 1],
      ],
    },
    {
      date: "2024-01-03",
      signal: "2024-01-02",
      prices: { SPY: 12, ETF1: 20 },
      trades: [["SPY", -0.5]],
    },
    {
      date: "2024-01-04",
      signal: "2024-01-03",
      prices: { SPY: 11, ETF1: 20 },
      trades: [["SPY", 0.5]],
    },
    {
      date: "2024-01-05",
      signal: "2024-01-04",
      prices: { SPY: 13, ETF1: 20 },
      trades: [
        ["SPY", -2],
        ["ETF1", -1],
      ],
    },
    {
      date: "2024-01-08",
      signal: "2024-01-05",
      prices: { SPY: 14, ETF1: 20 },
      trades: [["SPY", 1]],
    },
    {
      date: "2024-01-09",
      signal: null,
      prices: { SPY: 13.3, ETF1: 20 },
      trades: [],
    },
    {
      date: "2024-02-01",
      signal: "2024-01-31",
      prices: { SPY: 15, ETF1: 20 },
      trades: [["SPY", -0.25]],
    },
  ] as const;
  const ledger: BacktestLedgerEntry[] = [];
  let cash = 100,
    nav = 100,
    holdings: Record<string, number> = {},
    prices: Record<string, number> = { SPY: 10, ETF1: 20 },
    previous = "2024-01-01";
  const ps = (p: Record<string, number>, n: number) =>
    Object.entries(holdings)
      .filter(([, q]) => q > 0)
      .map(([ticker, quantity]) => ({
        ticker,
        quantity,
        price: p[ticker],
        marketValue: quantity * p[ticker],
        weight: (quantity * p[ticker]) / n,
      }));
  for (const step of steps) {
    const beginningPositions = ps(prices, nav),
      beginningNav = nav,
      beginningCash = cash,
      etfPnl = Object.entries(holdings).reduce(
        (s, [t, q]) =>
          s + q * (step.prices[t as keyof typeof step.prices] - prices[t]),
        0,
      ),
      cashPnl = 0.001 * cash;
    const trades = step.trades.map(([ticker, q]) => ({
      ticker,
      quantity: q,
      notional: q * step.prices[ticker],
    }));
    const gross = trades.reduce((s, t) => s + Math.abs(t.notional), 0),
      transactionCosts = gross * 0.01,
      slippage = gross * 0.005;
    for (const t of trades) {
      holdings[t.ticker] = (holdings[t.ticker] ?? 0) + t.quantity;
      cash -= t.notional;
    }
    cash += cashPnl - transactionCosts - slippage;
    nav =
      cash +
      Object.entries(holdings).reduce(
        (s, [t, q]) => s + q * step.prices[t as keyof typeof step.prices],
        0,
      );
    ledger.push({
      date: step.date,
      intervalStart: previous,
      signalDate: null,
      executionSignalDate: step.signal,
      beginningNav,
      beginningCash,
      beginningPositions,
      etfPnl,
      cashPnl,
      transactionCosts,
      slippage,
      trades,
      netPnl: etfPnl + cashPnl - transactionCosts - slippage,
      endingNav: nav,
      endingCash: cash,
      endingPositions: ps(step.prices, nav),
    });
    prices = { ...step.prices };
    previous = step.date;
  }
  const decisions = [
    {
      decision_date: "2024-01-01",
      information_cutoff: "2023-12-29",
      decision_method: "PORTFOLIO_OPTIMIZATION",
      multiplier: 1,
      weights: { SPY: 0.2, ETF1: 0.2 },
      optimizer: { optimized_nav_weights: { SPY: 0.2, ETF1: 0.2 } },
      capital_overlay: { baseline_maximum_exposure: 0.4 },
    },
    {
      decision_date: "2024-01-31",
      information_cutoff: "2024-01-30",
      decision_method: "PORTFOLIO_OPTIMIZATION",
      multiplier: 0.5,
      weights: { SPY: 0.1, ETF1: 0 },
      optimizer: { optimized_nav_weights: { SPY: 0.2, ETF1: 0 } },
      capital_overlay: { baseline_maximum_exposure: 0.2 },
    },
  ];
  const exposures = [0.4, 0.3, 0.35, 0, 0.2, 0.1],
    scores = [0, 0.25, 0.1, 1, 0, 0.5];
  const signals = ledger
    .filter((d) => d.executionSignalDate)
    .map((d, i) => ({
      decision_date: d.executionSignalDate,
      execution_date: d.date,
      information_cutoff:
        i === 0
          ? "2023-12-29"
          : new Date(Date.parse(d.executionSignalDate!) - 86400000)
              .toISOString()
              .slice(0, 10),
      rebalance_date: i === 0 || i === 5,
      optimizer_refreshed: i === 0 || i === 5,
      source_optimizer_date: i === 5 ? "2024-01-31" : "2024-01-01",
      trade_requested: true,
      exposure: exposures[i],
      frozen_risky_proportions:
        i === 5 ? { SPY: 1, ETF1: 0 } : { SPY: 0.5, ETF1: 0.5 },
      regime: { model: "TEST_ONLY_HMM", high_risk_probability: scores[i] },
    }));
  return {
    run_id: "rr_source_blotter",
    attempt_id: "ea_source_blotter",
    status: "SUCCESS",
    spec: {
      research_scope: "PORTFOLIO",
      regime_model: "HMM",
      regime_response: "ADAPTIVE",
      defensive_multiplier: 0,
      code_version: "SOURCE_ONLY_TEST_CODE",
      dataset_hash: "SOURCE_ONLY_TEST_DATA",
      dataset_id: "SOURCE_ONLY_DATA",
    },
    result: {
      ledger,
      decisions,
      capital_clock: { signals },
      financial_result_hash: "SOURCE_ONLY_HASH",
    },
  };
}
export function fixtureRecord() {
  const input = blotterFixture();
  return {
    run_id: input.run_id,
    spec: input.spec,
    latest_status: "SUCCESS",
    latest_attempt: {
      status: "SUCCESS",
      attempt: { run_id: input.run_id, execution_attempt_id: input.attempt_id },
    },
    attempt_history: [
      {
        status: "SUCCESS",
        completed_at: "2024-02-02",
        attempt: {
          run_id: input.run_id,
          execution_attempt_id: input.attempt_id,
        },
      },
    ],
  };
}
export function manyFillFixture(count = 1601): BlotterInput {
  const input = blotterFixture();
  input.result.ledger = [];
  input.result.decisions = [];
  input.result.capital_clock = { signals: [] };
  let cash = 100,
    quantity = 0,
    nav = 100,
    previousPrice = 10;
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.parse("2010-01-02") + i * 86400000)
        .toISOString()
        .slice(0, 10),
      intervalStart = new Date(Date.parse("2010-01-01") + i * 86400000)
        .toISOString()
        .slice(0, 10),
      price = i % 2 ? 11 : 10,
      q = i % 2 ? -1 : 1;
    const beginningNav = nav,
      beginningCash = cash,
      beginningPositions = quantity
        ? [
            {
              ticker: "SPY",
              quantity,
              price: previousPrice,
              marketValue: quantity * previousPrice,
              weight: (quantity * previousPrice) / nav,
            },
          ]
        : [];
    const etfPnl = quantity * (price - previousPrice),
      notional = q * price,
      transactionCosts = Math.abs(notional) * 0.001,
      slippage = Math.abs(notional) * 0.0005;
    quantity += q;
    cash -= notional + transactionCosts + slippage;
    nav = cash + quantity * price;
    input.result.ledger.push({
      date,
      intervalStart,
      executionSignalDate: intervalStart,
      signalDate: null,
      beginningNav,
      beginningCash,
      beginningPositions,
      etfPnl,
      cashPnl: 0,
      transactionCosts,
      slippage,
      trades: [{ ticker: "SPY", quantity: q, notional }],
      netPnl: etfPnl - transactionCosts - slippage,
      endingNav: nav,
      endingCash: cash,
      endingPositions: quantity
        ? [
            {
              ticker: "SPY",
              quantity,
              price,
              marketValue: quantity * price,
              weight: (quantity * price) / nav,
            },
          ]
        : [],
    });
    previousPrice = price;
  }
  return input;
}
