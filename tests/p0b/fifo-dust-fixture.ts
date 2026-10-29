/** Analytical inventory targets, not private XLF/XLY prices or historical trades. */
import type { BlotterInput } from "../../artifacts/api-server/src/lib/workbench/trading-blotter";
export const XLF_DUST_TARGETS = [
  0.8356250000000001, 0.223828125, 0.343203125, 0.10445312500000001,
  0.223828125, 0.62671875, 0.14921875, 0.164140625, 0,
];
export const XLY_DUST_TARGETS = XLF_DUST_TARGETS.map((q) => q / 8);
export const DUST_TARGETS = [0.56, 0.15, 0.23, 0.07, 0.15, 0.42, 0.1, 0.11, 0];
export function inventoryFixture(
  symbol: string,
  targets: number[],
  prices: number | number[] = 10,
): BlotterInput {
  let quantity = 0,
    cash = 100,
    nav = 100,
    previousPrice = typeof prices === "number" ? prices : prices[0];
  const ledger = targets.map((target, i) => {
    const price = typeof prices === "number" ? prices : prices[i];
    const date = new Date(Date.parse("2024-01-02") + i * 86400000)
        .toISOString()
        .slice(0, 10),
      intervalStart = new Date(Date.parse("2024-01-01") + i * 86400000)
        .toISOString()
        .slice(0, 10);
    const snapshot = (q: number, n: number, p = price) =>
      q
        ? [
            {
              ticker: symbol,
              quantity: q,
              price: p,
              marketValue: q * p,
              weight: (q * p) / n,
            },
          ]
        : [];
    const beginningNav = nav,
      beginningCash = cash,
      beginningPositions = snapshot(quantity, nav, previousPrice),
      etfPnl = quantity * (price - previousPrice),
      delta = target - quantity,
      notional = delta * price;
    const transactionCosts = Math.abs(notional) * 0.001,
      slippage = Math.abs(notional) * 0.0005;
    cash -= notional + transactionCosts + slippage;
    nav = cash + target * price;
    quantity = target;
    previousPrice = price;
    return {
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
      trades: delta ? [{ ticker: symbol, quantity: delta, notional }] : [],
      netPnl: etfPnl - transactionCosts - slippage,
      endingNav: nav,
      endingCash: cash,
      endingPositions: snapshot(target, nav),
    };
  });
  return {
    run_id: "rr_analytical_fifo",
    attempt_id: "ea_analytical_fifo",
    status: "SUCCESS",
    spec: {
      research_scope: "PORTFOLIO",
      code_version: "SOURCE_ONLY_ANALYTICAL",
      dataset_hash: "NO_PRIVATE_DATA",
    },
    result: { ledger, financial_result_hash: "UNCHANGED_SOURCE_HASH" },
  };
}
