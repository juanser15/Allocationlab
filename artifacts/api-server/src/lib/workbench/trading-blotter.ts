/** Read-only institutional reporting. Never imported by normalization or execution. */
import { createHash } from "node:crypto";
import type { BacktestLedgerEntry, BacktestPosition } from "../calculator";
export const BLOTTER_VERSION = "institutional-fifo-blotter-1.0.1";
export const BLOTTER_TOLERANCE = 1e-8;
export const REASONS = [
  "INITIAL_ALLOCATION",
  "SCHEDULED_REBALANCE",
  "HMM_EXPOSURE_REDUCTION",
  "HMM_EXPOSURE_INCREASE",
  "HMM_EXIT_TO_CASH",
  "HMM_REENTRY",
  "CAPITAL_RULE_EXPOSURE_REDUCTION",
  "CAPITAL_RULE_EXPOSURE_INCREASE",
  "CAPITAL_RULE_EXIT_TO_CASH",
  "CAPITAL_RULE_REENTRY",
  "JOINT_REBALANCE_AND_EXPOSURE",
  "UNCLASSIFIED",
] as const;
export type Reason = (typeof REASONS)[number];
type Evidence = Record<string, any>;
export interface BlotterInput {
  run_id: string;
  attempt_id: string;
  status: string;
  spec: Evidence;
  result: Evidence;
}
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const hash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
const finite = (n: any): n is number =>
  typeof n === "number" && Number.isFinite(n);
const close = (a: number, b: number) =>
  Math.abs(a - b) <= BLOTTER_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
const positive = (n: any) => finite(n) && n > 0;
export class BlotterError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}
const requireValid = (valid: boolean, message: string) => {
  if (!valid) throw new BlotterError("BLOTTER_LEDGER_INCONSISTENT", message);
};
export interface BlotterEvent {
  event_id: string;
  signal_date: string | null;
  information_cutoff: string | null;
  execution_session_date: string;
  reason_code: Reason;
  target_source: string;
  causes: string[];
  exposure_before: number;
  exposure_after: number;
  policy_exposure_before: number | null;
  policy_exposure_after: number | null;
  evidence_status: string;
  scheduled_decision: Evidence | null;
  capital_signal: Evidence | null;
  source_strategic_decision: Evidence | null;
  recorded_multiplier: number | null;
}
export interface ExecutionFill {
  fill_id: string;
  event_id: string;
  run_id: string;
  attempt_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  signed_quantity: number;
  signed_notional: number;
  gross_notional: number;
  execution_price: number;
  price_verification: string;
  price_basis: "SIMULATED_ADJUSTED_CLOSE";
  execution_time: "NOT_AVAILABLE_EOD";
  execution_convention: "NEXT_OBSERVED_CLOSE";
  execution_session_date: string;
  signal_date: string | null;
  information_cutoff: string | null;
  reason_code: Reason;
  target_source: string;
  exposure_before: number;
  exposure_after: number;
  weight_before_fill: number;
  weight_after_fill: number;
  pretrade_nav: number;
  posttrade_nav: number;
  fees: number;
  slippage: number;
  cost_basis: string;
  code_version: string | null;
  dataset_hash: string | null;
  ledger_day_index: number;
  ledger_trade_index: number;
}
export interface LotRow {
  match_id: string;
  lot_id: string;
  symbol: string;
  status: "OPEN" | "CLOSED";
  entry_fill_id: string | null;
  exit_fill_id: string | null;
  entry_date: string | null;
  entry_price: number | null;
  opening_reason: Reason;
  exit_date: string | null;
  exit_price: number | null;
  closing_reason: Reason | null;
  quantity: number;
  holding_sessions: number | null;
  holding_calendar_days: number | null;
  gross_realized_pnl: number | null;
  net_realized_pnl: number | null;
  entry_fees: number | null;
  entry_slippage: number | null;
  exit_fees: number;
  exit_slippage: number;
  valuation_date: string;
  valuation_price: number | null;
  gross_unrealized_pnl: number | null;
  net_unrealized_pnl: number | null;
  net_return_on_invested_cost: number | null;
  basis_status: "KNOWN" | "UNKNOWN_INITIAL_BASIS";
}
export interface PositionRow {
  position_id: string;
  symbol: string;
  date: string;
  interval_start: string;
  signal_date: string | null;
  execution_signal_date: string | null;
  source_information_cutoff: string | null;
  quantity_at_information_cutoff: number | null;
  weight_at_information_cutoff: number | null;
  market_value_at_information_cutoff: number | null;
  beginning_quantity: number;
  ending_quantity: number;
  beginning_price: number | null;
  ending_price: number | null;
  beginning_weight: number;
  ending_weight: number;
  beginning_market_value: number;
  ending_market_value: number;
  market_price_pnl: number;
  signed_traded_quantity: number;
  fill_ids: string[];
  observed_state: "SIGNAL_DRIVEN_FILL" | "MARKET_DRIFT" | "UNCHANGED";
  strategic_target: number | null;
  strategic_target_date: string | null;
  effective_capital_target: number | null;
  effective_hmm_target: number | null;
  effective_target_signal_date: string | null;
  realized_position: BacktestPosition | null;
}
export interface TradingBlotter {
  version: string;
  run_id: string;
  attempt_id: string;
  scope: string;
  price_basis: string;
  execution_time: string;
  execution_convention: string;
  amount_units: string;
  ledger_checksum: string;
  projection_content_hash: string;
  blotter_hash: string;
  provenance: Evidence;
  events: BlotterEvent[];
  executions: ExecutionFill[];
  lots: LotRow[];
  positions: PositionRow[];
  warnings: string[];
  reconciliation: Evidence;
}
function apportion(total: number, weights: number[]): number[] {
  const gross = sum(weights);
  if (!gross) {
    requireValid(total === 0, "Costs exist without recorded fills.");
    return [];
  }
  const pivot = weights.reduce(
      (best, w, i) => (w > weights[best] ? i : best),
      0,
    ),
    result = weights.map(() => 0);
  let assigned = 0;
  weights.forEach((w, i) => {
    if (i !== pivot) {
      result[i] = total * (w / gross);
      assigned += result[i];
    }
  });
  result[pivot] = total - assigned;
  return result;
}
const quantityClose = (a: number, b: number, scale = 0) =>
  Math.abs(a - b) <=
  1e-10 * Math.max(Number.MIN_VALUE, Math.abs(a), Math.abs(b), scale);

/** Forward roundoff bound, scaled only by observed inventory/fills; no absolute share floor. */
export function fifoQuantityTolerance(
  grossQuantity: number,
  peakQuantity: number,
  operations: number,
): number {
  requireValid(
    finite(grossQuantity) &&
      grossQuantity >= 0 &&
      finite(peakQuantity) &&
      peakQuantity >= 0 &&
      Number.isSafeInteger(operations) &&
      operations > 0,
    "Invalid FIFO quantity reference.",
  );
  const nu = operations * Number.EPSILON;
  requireValid(nu < 1, "FIFO roundoff bound is unavailable.");
  return Math.min((nu / (1 - nu)) * grossQuantity, 1e-10 * peakQuantity);
}
function compensatedSum(values: number[]): number {
  let sum = 0,
    correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction +=
      Math.abs(sum) >= Math.abs(value)
        ? sum - next + value
        : value - next + sum;
    sum = next;
  }
  return sum + correction;
}
const position = (ps: BacktestPosition[], symbol: string) =>
  ps.find((p) => p.ticker === symbol);
const defensive = (s: Evidence | undefined) =>
  s &&
  (finite(s.regime?.defensive_score)
    ? s.regime.defensive_score
    : finite(s.regime?.high_risk_probability)
      ? s.regime.high_risk_probability
      : null);
function eventFor(
  input: BlotterInput,
  day: BacktestLedgerEntry,
  index: number,
  signals: Evidence[],
  decisions: Evidence[],
  event_id: string,
): BlotterEvent {
  const matches = signals.filter(
    (s) =>
      s.decision_date === day.executionSignalDate &&
      s.execution_date === day.date,
  );
  const s = matches.length === 1 ? matches[0] : undefined,
    si = s ? signals.indexOf(s) : -1,
    previous =
      si > 0 &&
      signals[si - 1].decision_date < s!.decision_date &&
      signals.filter((p) => p.decision_date === signals[si - 1].decision_date)
        .length === 1
        ? signals[si - 1]
        : undefined;
  const ds = decisions.filter(
      (d) => d.decision_date === day.executionSignalDate,
    ),
    d = ds.length === 1 ? ds[0] : undefined;
  const sourceDate = s?.source_optimizer_date ?? d?.decision_date;
  const source = decisions.find((d) => d.decision_date === sourceDate) ?? null;
  const pre = day.beginningNav + day.etfPnl + day.cashPnl;
  let reason: Reason = "UNCLASSIFIED",
    causes: string[] = [];
  const valid =
    s &&
    typeof s.rebalance_date === "boolean" &&
    typeof s.trade_requested === "boolean" &&
    s.trade_requested &&
    finite(s.exposure) &&
    typeof s.information_cutoff === "string" &&
    s.information_cutoff < s.decision_date &&
    s.decision_date < day.date &&
    (!s.source_optimizer_date || s.source_optimizer_date <= s.decision_date);
  if (valid) {
    const changed =
      previous &&
      finite(previous.exposure) &&
      Math.abs(s.exposure - previous.exposure) > 1e-10;
    const adaptive =
      input.spec.regime_response === "ADAPTIVE" &&
      finite(input.spec.defensive_multiplier) &&
      input.spec.defensive_multiplier < 1;
    const stateChanged =
      adaptive &&
      defensive(s) !== null &&
      defensive(previous) !== null &&
      defensive(s) !== defensive(previous);
    const previousSource = previous
      ? decisions.find(
          (d) => d.decision_date === previous.source_optimizer_date,
        )
      : undefined;
    const currentBaseline = d?.capital_overlay?.baseline_maximum_exposure,
      previousBaseline =
        previousSource?.capital_overlay?.baseline_maximum_exposure;
    const currentOverlay = finite(currentBaseline)
      ? s.exposure < currentBaseline - BLOTTER_TOLERANCE
      : null;
    const previousOverlay =
      previous && finite(previousBaseline)
        ? previous.exposure < previousBaseline - BLOTTER_TOLERANCE
        : null;
    const portfolioConstruction =
      d?.decision_method === "PORTFOLIO_OPTIMIZATION" &&
      s.optimizer_refreshed === true;
    const initialOverlay =
      adaptive && !previous && portfolioConstruction && currentOverlay === true;
    if (
      s.rebalance_date &&
      d &&
      (d.decision_method === "PORTFOLIO_OPTIMIZATION" ||
        input.spec.research_scope === "CAPITAL_EXPOSURE")
    ) {
      causes.push(
        input.spec.research_scope === "CAPITAL_EXPOSURE"
          ? "SCHEDULED_CAPITAL_POLICY"
          : "SCHEDULED_PORTFOLIO_REBALANCE",
      );
      if (
        (portfolioConstruction &&
          changed &&
          stateChanged &&
          (currentOverlay === true || previousOverlay === true)) ||
        initialOverlay
      ) {
        reason = "JOINT_REBALANCE_AND_EXPOSURE";
        causes.push("RECORDED_CAPITAL_POLICY_CHANGE");
      } else if (
        !adaptive ||
        (previous &&
          defensive(s) !== null &&
          defensive(previous) !== null &&
          (!stateChanged ||
            (currentOverlay === false && previousOverlay === false))) ||
        (d.multiplier === 1 && !previous)
      ) {
        const first =
          decisions[0] === d &&
          day.beginningPositions.every((p) => p.quantity === 0);
        reason = first ? "INITIAL_ALLOCATION" : "SCHEDULED_REBALANCE";
      }
    } else if (!s.rebalance_date && previous && changed) {
      const prefix = input.spec.regime_model === "HMM" ? "HMM" : "CAPITAL_RULE";
      reason = (
        s.exposure === 0
          ? `${prefix}_EXIT_TO_CASH`
          : previous.exposure === 0
            ? `${prefix}_REENTRY`
            : s.exposure < previous.exposure
              ? `${prefix}_EXPOSURE_REDUCTION`
              : `${prefix}_EXPOSURE_INCREASE`
      ) as Reason;
      causes = [
        prefix === "HMM"
          ? "RECORDED_HMM_CAPITAL_CHANGE"
          : "RECORDED_CAPITAL_RULE_CHANGE",
      ];
    }
  }
  return {
    event_id,
    signal_date: day.executionSignalDate,
    information_cutoff: valid ? s!.information_cutoff : null,
    execution_session_date: day.date,
    reason_code: reason,
    target_source:
      reason === "UNCLASSIFIED"
        ? "NOT_AVAILABLE"
        : (sourceDate ?? "NOT_AVAILABLE"),
    causes,
    exposure_before: 1 - (day.beginningCash + day.cashPnl) / pre,
    exposure_after: 1 - day.endingCash / day.endingNav,
    policy_exposure_before: finite(previous?.exposure)
      ? previous!.exposure
      : null,
    policy_exposure_after: finite(s?.exposure) ? s!.exposure : null,
    evidence_status:
      reason === "UNCLASSIFIED"
        ? "INSUFFICIENT_RECORDED_EVENT_PROVENANCE"
        : "RECORDED_EVENT_JOIN",
    scheduled_decision: d ? structuredClone(d) : null,
    capital_signal: s ? structuredClone(s) : null,
    source_strategic_decision: source ? structuredClone(source) : null,
    recorded_multiplier: finite(d?.multiplier) ? d!.multiplier : null,
  };
}

export function projectTradingBlotter(input: BlotterInput): TradingBlotter {
  if (
    (input.result?.run_id && input.result.run_id !== input.run_id) ||
    (input.result?.execution_attempt_id &&
      input.result.execution_attempt_id !== input.attempt_id) ||
    (input.spec.code_version &&
      input.result?.provenance?.code_version &&
      input.spec.code_version !== input.result.provenance.code_version) ||
    (input.spec.dataset_hash &&
      input.result?.dataset_hash &&
      input.spec.dataset_hash !== input.result.dataset_hash)
  )
    throw new BlotterError(
      "BLOTTER_SOURCE_MISMATCH",
      "The recorded result identity does not match the selected immutable source.",
      409,
    );
  if (
    input.status !== "SUCCESS" ||
    !Array.isArray(input.result?.ledger) ||
    !input.result.ledger.length
  )
    throw new BlotterError(
      "BLOTTER_NOT_AVAILABLE",
      "A completed successful attempt with a recorded daily ledger is required.",
      409,
    );
  const ledger = input.result.ledger as BacktestLedgerEntry[];
  if (ledger.length > 50000)
    throw new BlotterError(
      "BLOTTER_CAPACITY",
      "Ledger exceeds the current reporting capacity.",
      413,
    );
  const ledger_checksum = hash(ledger),
    spec = input.spec;
  const sourceCodeVersion =
    spec.code_version ?? input.result.provenance?.code_version ?? null;
  const sourceDatasetHash =
    spec.dataset_hash ??
    input.result.dataset_hash ??
    input.result.provenance?.dataset_hash ??
    spec.data_snapshot?.sha256 ??
    null;
  if (
    spec.dataset_hash &&
    input.result.provenance?.dataset_hash &&
    spec.dataset_hash !== input.result.provenance.dataset_hash
  )
    throw new BlotterError(
      "BLOTTER_SOURCE_MISMATCH",
      "Recorded dataset provenance does not match the selected source.",
      409,
    );
  const signals: Evidence[] = Array.isArray(input.result.capital_clock?.signals)
      ? input.result.capital_clock.signals
          .slice()
          .sort((a: Evidence, b: Evidence) =>
            String(a.decision_date).localeCompare(
              String(b.decision_date),
              "en",
            ),
          )
      : [],
    decisions: Evidence[] = Array.isArray(input.result.decisions)
      ? input.result.decisions
          .slice()
          .sort((a: Evidence, b: Evidence) =>
            String(a.decision_date).localeCompare(
              String(b.decision_date),
              "en",
            ),
          )
      : [];
  const identity = {
    run_id: input.run_id,
    attempt_id: input.attempt_id,
    version: BLOTTER_VERSION,
    ledger_checksum,
  };
  const id = (kind: string, ...key: (string | number)[]) =>
    `${kind}_${hash([identity, ...key]).slice(0, 32)}`;
  const executions: ExecutionFill[] = [],
    events: BlotterEvent[] = [],
    positions: PositionRow[] = [],
    warnings = new Set<string>();
  const knownSymbols = [
    ...new Set<string>([
      ...(Array.isArray(spec.etfs) ? spec.etfs : []),
      ...ledger.flatMap((d) => {
        requireValid(
          Array.isArray(d.beginningPositions) &&
            Array.isArray(d.endingPositions) &&
            Array.isArray(d.trades),
          "Ledger position/fill evidence is missing.",
        );
        return [
          ...d.beginningPositions.map((p) => p.ticker),
          ...d.endingPositions.map((p) => p.ticker),
          ...d.trades.map((t) => t.ticker),
        ];
      }),
    ]),
  ].sort();
  const dateIndex = new Map(ledger.map((day, i) => [day.date, i]));
  const dayByDate = new Map(ledger.map((day) => [day.date, day]));
  const totals = {
    fees: 0,
    slippage: 0,
    etf_pnl: 0,
    cash_pnl: 0,
    net_pnl: 0,
    signed_notional: 0,
    gross_notional: 0,
  };
  let lastStrategic: Evidence | null = null,
    lastEffective: Evidence | null = null;
  const effectiveByDate = new Map<string, Evidence>();
  for (const s of signals)
    if (s.trade_requested && s.execution_date)
      effectiveByDate.set(s.execution_date, s);
  for (const [di, day] of ledger.entries()) {
    requireValid(
      typeof day.date === "string" && (!di || day.date > ledger[di - 1].date),
      "Ledger session dates must be unique and ordered.",
    );
    for (const key of [
      "beginningNav",
      "endingNav",
      "beginningCash",
      "endingCash",
      "etfPnl",
      "cashPnl",
      "netPnl",
      "transactionCosts",
      "slippage",
    ] as const)
      requireValid(
        finite(day[key]),
        "A required ledger accounting value is unavailable.",
      );
    requireValid(
      day.beginningNav > 0 &&
        day.endingNav > 0 &&
        day.transactionCosts >= 0 &&
        day.slippage >= 0,
      "Invalid ledger NAV or costs.",
    );
    requireValid(
      Array.isArray(day.trades) &&
        Array.isArray(day.beginningPositions) &&
        Array.isArray(day.endingPositions),
      "Ledger position/fill evidence is missing.",
    );
    for (const [ps, nav] of [
      [day.beginningPositions, day.beginningNav],
      [day.endingPositions, day.endingNav],
    ] as const) {
      requireValid(
        new Set(ps.map((p) => p.ticker)).size === ps.length,
        "Duplicate position snapshots.",
      );
      for (const p of ps)
        requireValid(
          typeof p.ticker === "string" &&
            finite(p.quantity) &&
            p.quantity >= 0 &&
            positive(p.price) &&
            finite(p.weight) &&
            close(p.marketValue, p.quantity * p.price) &&
            close(p.weight, p.marketValue / nav),
          "Invalid long-only position snapshot.",
        );
    }
    const pre = day.beginningNav + day.etfPnl + day.cashPnl;
    const fills = day.trades
      .map((t, ti) => ({ t, ti }))
      .filter(({ t }) => t.quantity !== 0 || t.notional !== 0);
    for (const { t } of fills)
      requireValid(
        finite(t.quantity) &&
          finite(t.notional) &&
          t.quantity !== 0 &&
          positive(t.notional / t.quantity),
        "A recorded fill has invalid quantity/notional.",
      );
    const fees = apportion(
      day.transactionCosts,
      fills.map(({ t }) => Math.abs(t.notional)),
    );
    const slip = apportion(
      day.slippage,
      fills.map(({ t }) => Math.abs(t.notional)),
    );
    const signed = sum(fills.map(({ t }) => t.notional));
    requireValid(
      close(day.beginningNav + day.netPnl, day.endingNav) &&
        close(
          day.netPnl,
          day.etfPnl + day.cashPnl - day.transactionCosts - day.slippage,
        ),
      "Daily NAV/P&L does not reconcile.",
    );
    requireValid(
      close(
        day.beginningCash +
          day.cashPnl -
          signed -
          day.transactionCosts -
          day.slippage,
        day.endingCash,
      ),
      "Daily fill cash movements do not reconcile.",
    );
    requireValid(
      close(
        day.endingCash + sum(day.endingPositions.map((p) => p.marketValue)),
        day.endingNav,
      ),
      "Ending positions and cash do not reconcile to NAV.",
    );
    requireValid(
      close(
        day.beginningCash +
          sum(day.beginningPositions.map((p) => p.marketValue)),
        day.beginningNav,
      ),
      "Beginning positions and cash do not reconcile to NAV.",
    );
    if (di) {
      const prev = ledger[di - 1];
      requireValid(
        close(day.beginningNav, prev.endingNav) &&
          close(day.beginningCash, prev.endingCash),
        "Ledger continuity is broken.",
      );
    }
    const e = fills.length
      ? eventFor(input, day, di, signals, decisions, id("event", di))
      : null;
    if (e) {
      events.push(e);
      if (e.reason_code === "UNCLASSIFIED")
        warnings.add("UNCLASSIFIED_HISTORICAL_EVENT");
    }
    const s = effectiveByDate.get(day.date);
    if (s) {
      lastEffective = s;
      const d = decisions.find(
        (d) => d.decision_date === (s.source_optimizer_date ?? s.decision_date),
      );
      if (d) lastStrategic = d;
    }
    const scheduled = decisions.find(
      (d) => d.decision_date === day.executionSignalDate,
    );
    if (scheduled) lastStrategic = scheduled;
    if (!s && scheduled)
      lastEffective = {
        decision_date: scheduled.decision_date,
        weights: scheduled.weights,
      };
    if (executions.length + fills.length > 250000)
      throw new BlotterError(
        "BLOTTER_CAPACITY",
        "Fill count exceeds the current reporting capacity.",
        413,
      );
    fills.forEach(({ t, ti }, i) => {
      const p = position(day.endingPositions, t.ticker),
        b = position(day.beginningPositions, t.ticker),
        price = t.notional / t.quantity;
      if (p)
        requireValid(
          close(price, p.price),
          "Fill price disagrees with the recorded adjusted close.",
        );
      executions.push({
        fill_id: id("fill", di, ti),
        event_id: e!.event_id,
        run_id: input.run_id,
        attempt_id: input.attempt_id,
        symbol: t.ticker,
        side: t.quantity > 0 ? "BUY" : "SELL",
        quantity: Math.abs(t.quantity),
        signed_quantity: t.quantity,
        signed_notional: t.notional,
        gross_notional: Math.abs(t.notional),
        execution_price: price,
        price_verification: p
          ? "RECORDED_ENDING_POSITION_AND_FILL_RATIO"
          : "FILL_NOTIONAL_QUANTITY_RATIO",
        price_basis: "SIMULATED_ADJUSTED_CLOSE",
        execution_time: "NOT_AVAILABLE_EOD",
        execution_convention: "NEXT_OBSERVED_CLOSE",
        execution_session_date: day.date,
        signal_date: day.executionSignalDate,
        information_cutoff: e!.information_cutoff,
        reason_code: e!.reason_code,
        target_source: e!.target_source,
        exposure_before: e!.exposure_before,
        exposure_after: e!.exposure_after,
        weight_before_fill: ((b?.quantity ?? 0) * price) / pre,
        weight_after_fill: p?.weight ?? 0,
        pretrade_nav: pre,
        posttrade_nav: day.endingNav,
        fees: fees[i],
        slippage: slip[i],
        cost_basis:
          "ABSOLUTE_TRADED_NOTIONAL_ALLOCATION_OF_RECORDED_DAILY_TOTAL",
        code_version: sourceCodeVersion,
        dataset_hash: sourceDatasetHash,
        ledger_day_index: di,
        ledger_trade_index: ti,
      });
    });
    const symbols = [
      ...new Set([
        ...knownSymbols,
        ...day.beginningPositions.map((p) => p.ticker),
        ...day.endingPositions.map((p) => p.ticker),
        ...fills.map(({ t }) => t.ticker),
        ...(di ? ledger[di - 1].endingPositions.map((p) => p.ticker) : []),
      ]),
    ].sort();
    let markPnl = 0;
    for (const symbol of symbols) {
      const a = position(day.beginningPositions, symbol),
        b = position(day.endingPositions, symbol),
        trades = fills.filter(({ t }) => t.ticker === symbol);
      const qty = sum(trades.map(({ t }) => t.quantity));
      requireValid(
        quantityClose(
          (a?.quantity ?? 0) + qty,
          b?.quantity ?? 0,
          Math.abs(a?.quantity ?? 0) +
            sum(trades.map(({ t }) => Math.abs(t.quantity))),
        ),
        "Fill quantities do not reconcile to ending holdings.",
      );
      if (di)
        requireValid(
          quantityClose(
            a?.quantity ?? 0,
            position(ledger[di - 1].endingPositions, symbol)?.quantity ?? 0,
          ),
          "Position continuity is broken.",
        );
      const price =
        b?.price ??
        (trades.length ? trades[0].t.notional / trades[0].t.quantity : null);
      if (a)
        requireValid(
          price !== null,
          "A required mark-to-market price is unavailable.",
        );
      for (const { t } of trades)
        requireValid(
          price !== null && close(t.notional / t.quantity, price),
          "Multiple fills disagree with the recorded daily close.",
        );
      const cutoff =
        e?.information_cutoff ?? scheduled?.information_cutoff ?? null;
      const cutoffDay =
        typeof cutoff === "string" ? dayByDate.get(cutoff) : undefined;
      const cutoffSnapshot =
        cutoffDay?.endingPositions ??
        (cutoff === ledger[0].intervalStart
          ? ledger[0].beginningPositions
          : null);
      const cutoffPosition = cutoffSnapshot
        ? position(cutoffSnapshot, symbol)
        : null;
      const pnl = a && price !== null ? a.quantity * (price - a.price) : 0;
      markPnl += pnl;
      const strategic =
        lastStrategic?.optimizer?.optimized_nav_weights ??
        lastStrategic?.capital_overlay?.pre_overlay_optimizer_weights;
      const symbolIndex = Array.isArray(spec.etfs)
        ? spec.etfs.indexOf(symbol)
        : -1;
      const strategicWeight = Array.isArray(strategic)
        ? symbolIndex >= 0
          ? strategic[symbolIndex]
          : null
        : strategic?.[symbol];
      const effective =
        lastEffective?.weights?.[symbol] ??
        (finite(lastEffective?.exposure) &&
        finite(lastEffective?.frozen_risky_proportions?.[symbol])
          ? lastEffective!.exposure *
            lastEffective!.frozen_risky_proportions[symbol]
          : null);
      if (positions.length >= 250000)
        throw new BlotterError(
          "BLOTTER_CAPACITY",
          "Position history exceeds the current reporting capacity.",
          413,
        );
      positions.push({
        position_id: id("position", di, symbol),
        symbol,
        date: day.date,
        interval_start: day.intervalStart,
        signal_date: day.signalDate,
        execution_signal_date: day.executionSignalDate,
        source_information_cutoff: cutoff,
        quantity_at_information_cutoff: cutoffSnapshot
          ? (cutoffPosition?.quantity ?? 0)
          : null,
        weight_at_information_cutoff: cutoffSnapshot
          ? (cutoffPosition?.weight ?? 0)
          : null,
        market_value_at_information_cutoff: cutoffSnapshot
          ? (cutoffPosition?.marketValue ?? 0)
          : null,
        beginning_quantity: a?.quantity ?? 0,
        ending_quantity: b?.quantity ?? 0,
        beginning_price: a?.price ?? null,
        ending_price: price,
        beginning_weight: a?.weight ?? 0,
        ending_weight: b?.weight ?? 0,
        beginning_market_value: a?.marketValue ?? 0,
        ending_market_value: b?.marketValue ?? 0,
        market_price_pnl: pnl,
        signed_traded_quantity: qty,
        fill_ids: trades.map(({ ti }) => id("fill", di, ti)),
        observed_state: trades.length
          ? "SIGNAL_DRIVEN_FILL"
          : a && b && (a.price !== b.price || a.weight !== b.weight)
            ? "MARKET_DRIFT"
            : "UNCHANGED",
        strategic_target: finite(strategicWeight) ? strategicWeight : null,
        strategic_target_date: lastStrategic?.decision_date ?? null,
        effective_capital_target: finite(effective) ? effective : null,
        effective_hmm_target:
          spec.regime_model === "HMM" && finite(effective) ? effective : null,
        effective_target_signal_date: lastEffective?.decision_date ?? null,
        realized_position: b ? { ...b } : null,
      });
    }
    requireValid(
      close(markPnl, day.etfPnl),
      "Position mark-to-market P&L does not reconcile.",
    );
    totals.fees += day.transactionCosts;
    totals.slippage += day.slippage;
    totals.etf_pnl += day.etfPnl;
    totals.cash_pnl += day.cashPnl;
    totals.net_pnl += day.netPnl;
    totals.signed_notional += signed;
    totals.gross_notional += sum(fills.map(({ t }) => Math.abs(t.notional)));
  }
  const lots: LotRow[] = [];
  type Lot = {
    id: string;
    symbol: string;
    fill: ExecutionFill | null;
    quantity: number;
    fees: number | null;
    slippage: number | null;
  };
  const queues = new Map<string, Lot[]>();
  const heads = new Map<string, number>();
  for (const p of ledger[0].beginningPositions)
    if (p.quantity > 0) {
      queues.set(p.ticker, [
        {
          id: id("initial-lot", p.ticker),
          symbol: p.ticker,
          fill: null,
          quantity: p.quantity,
          fees: null,
          slippage: null,
        },
      ]);
      warnings.add("UNKNOWN_INITIAL_COST_BASIS");
    }
  const last = ledger.at(-1)!;
  function lotRow(
    lot: Lot,
    q: number,
    entryFees: number | null,
    entrySlippage: number | null,
    exit: ExecutionFill | null,
    exitFees: number,
    exitSlippage: number,
    match_id: string,
  ): LotRow {
    const entry = lot.fill,
      mark =
        exit?.execution_price ??
        position(last.endingPositions, lot.symbol)?.price ??
        null;
    const gross =
      entry && mark !== null ? q * (mark - entry.execution_price) : null;
    const net =
      gross !== null && entryFees !== null && entrySlippage !== null
        ? gross - entryFees - entrySlippage - exitFees - exitSlippage
        : null;
    const invested = entry
      ? q * entry.execution_price + (entryFees ?? 0) + (entrySlippage ?? 0)
      : null;
    return {
      match_id,
      lot_id: lot.id,
      symbol: lot.symbol,
      status: exit ? "CLOSED" : "OPEN",
      entry_fill_id: entry?.fill_id ?? null,
      exit_fill_id: exit?.fill_id ?? null,
      entry_date: entry?.execution_session_date ?? null,
      entry_price: entry?.execution_price ?? null,
      opening_reason: entry?.reason_code ?? "UNCLASSIFIED",
      exit_date: exit?.execution_session_date ?? null,
      exit_price: exit?.execution_price ?? null,
      closing_reason: exit?.reason_code ?? null,
      quantity: q,
      holding_sessions: entry
        ? dateIndex.get(exit?.execution_session_date ?? last.date)! -
          dateIndex.get(entry.execution_session_date)!
        : null,
      holding_calendar_days: entry
        ? (Date.parse(exit?.execution_session_date ?? last.date) -
            Date.parse(entry.execution_session_date)) /
          86400000
        : null,
      gross_realized_pnl: exit ? gross : null,
      net_realized_pnl: exit ? net : null,
      entry_fees: entryFees,
      entry_slippage: entrySlippage,
      exit_fees: exitFees,
      exit_slippage: exitSlippage,
      valuation_date: exit?.execution_session_date ?? last.date,
      valuation_price: mark,
      gross_unrealized_pnl: exit ? null : gross,
      net_unrealized_pnl: exit ? null : net,
      net_return_on_invested_cost:
        net !== null && invested !== null && invested > 0
          ? net / invested
          : null,
      basis_status: entry ? "KNOWN" : "UNKNOWN_INITIAL_BASIS",
    };
  }
  type QuantityHistory = {
    sum: number;
    correction: number;
    peak: number;
    operations: number;
    fills: number;
  };
  const history = new Map<string, QuantityHistory>();
  const adjustments: Evidence[] = [];
  const lastFill = new Map<string, string>();
  for (const fill of executions)
    lastFill.set(`${fill.ledger_day_index}:${fill.symbol}`, fill.fill_id);
  const reference = (symbol: string) => {
    let r = history.get(symbol);
    if (!r) {
      const initial =
        position(ledger[0].beginningPositions, symbol)?.quantity ?? 0;
      r = {
        sum: initial,
        correction: 0,
        peak: initial,
        operations: 8,
        fills: 0,
      };
      history.set(symbol, r);
    }
    return r;
  };
  const tolerance = (r: QuantityHistory, extra = 0) =>
    fifoQuantityTolerance(r.sum + r.correction, r.peak, r.operations + extra);
  const addHistory = (r: QuantityHistory, q: number) => {
    const next = r.sum + q;
    r.correction += Math.abs(r.sum) >= q ? r.sum - next + q : q - next + r.sum;
    r.sum = next;
  };
  for (const fill of executions) {
    const queue = queues.get(fill.symbol) ?? [];
    queues.set(fill.symbol, queue);
    const day = ledger[fill.ledger_day_index],
      expected = position(day.endingPositions, fill.symbol)?.quantity ?? 0;
    const finalSymbolFill =
      lastFill.get(`${fill.ledger_day_index}:${fill.symbol}`) === fill.fill_id;
    const flat = expected === 0 && finalSymbolFill && fill.side === "SELL";
    const h = reference(fill.symbol);
    addHistory(h, fill.quantity);
    h.operations += 8;
    h.fills++;
    h.peak = Math.max(
      h.peak,
      fill.quantity,
      position(day.beginningPositions, fill.symbol)?.quantity ?? 0,
      expected,
    );
    if (fill.side === "BUY") {
      queue.push({
        id: id("lot", fill.fill_id),
        symbol: fill.symbol,
        fill,
        quantity: fill.quantity,
        fees: fill.fees,
        slippage: fill.slippage,
      });
      continue;
    }
    let remaining = fill.quantity,
      chargedFees = 0,
      chargedSlippage = 0,
      mi = 0;
    while (remaining > 0) {
      const lot = queue[heads.get(fill.symbol) ?? 0];
      if (!lot) {
        const bound = tolerance(h),
          row = lots.at(-1);
        if (!row)
          throw new BlotterError(
            "BLOTTER_LEDGER_INCONSISTENT",
            "Sell exceeds available FIFO inventory.",
          );
        requireValid(
          flat &&
            remaining <= bound &&
            !!row &&
            row.exit_fill_id === fill.fill_id,
          "Sell exceeds available FIFO inventory.",
        );
        requireValid(
          close(remaining * fill.execution_price, 0),
          "FIFO quantity roundoff has material monetary value.",
        );
        const fee = fill.fees - chargedFees,
          slip = fill.slippage - chargedSlippage;
        requireValid(
          close(Math.abs(fee) + Math.abs(slip), 0),
          "FIFO rounding costs are material.",
        );
        row.exit_fees += fee;
        row.exit_slippage += slip;
        if (row.net_realized_pnl !== null) {
          row.net_realized_pnl -= fee + slip;
          row.net_return_on_invested_cost =
            row.net_realized_pnl /
            (row.quantity * row.entry_price! +
              row.entry_fees! +
              row.entry_slippage!);
        }
        adjustments.push({
          symbol: fill.symbol,
          execution_session_date: day.date,
          source_fill_id: fill.fill_id,
          kind: "SELL_QUANTITY_ROUNDOFF",
          quantity: remaining,
          quantity_tolerance: bound,
          fees: fee,
          slippage: slip,
          match_id: row.match_id,
        });
        remaining = 0;
        break;
      }
      h.operations += 4;
      const quantity = Math.min(remaining, lot.quantity);
      // A real positive source position must never be erased by a local epsilon.
      const finishes =
        quantity === remaining ||
        (flat && remaining - quantity <= Number.EPSILON * 32 * fill.quantity);
      const consumesLot =
        quantity === lot.quantity ||
        (flat &&
          lot.quantity - quantity <= Number.EPSILON * 32 * lot.quantity &&
          close(
            (lot.quantity - quantity) *
              Math.max(
                lot.fill?.execution_price ?? fill.execution_price,
                fill.execution_price,
              ),
            0,
          ));
      const entryFees =
        lot.fees === null
          ? null
          : consumesLot
            ? lot.fees
            : (lot.fees * quantity) / lot.quantity;
      const entrySlippage =
        lot.slippage === null
          ? null
          : consumesLot
            ? lot.slippage
            : (lot.slippage * quantity) / lot.quantity;
      const exitFees = finishes
        ? fill.fees - chargedFees
        : (fill.fees * quantity) / fill.quantity;
      const exitSlippage = finishes
        ? fill.slippage - chargedSlippage
        : (fill.slippage * quantity) / fill.quantity;
      lots.push(
        lotRow(
          lot,
          quantity,
          entryFees,
          entrySlippage,
          fill,
          exitFees,
          exitSlippage,
          id("match", fill.fill_id, mi++),
        ),
      );
      chargedFees += exitFees;
      chargedSlippage += exitSlippage;
      lot.quantity = consumesLot ? 0 : lot.quantity - quantity;
      if (lot.fees !== null) lot.fees -= entryFees!;
      if (lot.slippage !== null) lot.slippage -= entrySlippage!;
      remaining -= quantity;
      if (lot.quantity === 0)
        heads.set(fill.symbol, (heads.get(fill.symbol) ?? 0) + 1);
    }
    if (flat) {
      const pending = queue.slice(heads.get(fill.symbol) ?? 0),
        residual = compensatedSum(pending.map((l) => l.quantity)),
        bound = tolerance(h, pending.length + 2);
      requireValid(residual <= bound, "FIFO open quantities do not reconcile.");
      requireValid(
        close(
          compensatedSum(
            pending.map(
              (l) =>
                l.quantity *
                  Math.max(
                    l.fill?.execution_price ?? fill.execution_price,
                    fill.execution_price,
                  ) +
                (l.fees ?? 0) +
                (l.slippage ?? 0),
            ),
          ),
          0,
        ),
        "FIFO quantity roundoff has material monetary value.",
      );
      for (const lot of pending) {
        const row = [...lots]
          .reverse()
          .find((r) => r.lot_id === lot.id && r.exit_fill_id === fill.fill_id);
        if (row) {
          Object.assign(
            row,
            lotRow(
              lot,
              row.quantity + lot.quantity,
              row.entry_fees === null ? null : row.entry_fees + (lot.fees ?? 0),
              row.entry_slippage === null
                ? null
                : row.entry_slippage + (lot.slippage ?? 0),
              fill,
              row.exit_fees,
              row.exit_slippage,
              row.match_id,
            ),
          );
        } else {
          // This is an allocation of an existing closing fill, never another execution.
          lots.push(
            lotRow(
              lot,
              lot.quantity,
              lot.fees,
              lot.slippage,
              fill,
              0,
              0,
              id("roundoff-match", fill.fill_id, lot.id),
            ),
          );
        }
        adjustments.push({
          symbol: fill.symbol,
          execution_session_date: day.date,
          source_fill_id: fill.fill_id,
          kind: "FLAT_INVENTORY_ROUNDOFF",
          quantity: lot.quantity,
          quantity_tolerance: bound,
          entry_fees: lot.fees,
          entry_slippage: lot.slippage,
          lot_id: lot.id,
          match_id: row?.match_id ?? id("roundoff-match", fill.fill_id, lot.id),
        });
      }
      heads.set(fill.symbol, queue.length);
    }
  }
  const quantityEvidence: Evidence[] = [];
  for (const [symbol, allLots] of queues) {
    const queue = allLots.slice(heads.get(symbol) ?? 0),
      actual = compensatedSum(queue.map((l) => l.quantity)),
      expected = position(last.endingPositions, symbol)?.quantity ?? 0;
    const h = reference(symbol),
      bound = tolerance(h, queue.length + 2);
    requireValid(
      Math.abs(actual - expected) <= bound &&
        (expected === 0 ? actual === 0 : actual > 0),
      "FIFO open quantities do not reconcile.",
    );
    requireValid(
      close(
        Math.abs(actual - expected) *
          (position(last.endingPositions, symbol)?.price ?? 0),
        0,
      ),
      "FIFO quantity mismatch has material monetary value.",
    );
    quantityEvidence.push({
      symbol,
      initial_plus_gross_traded_quantity: h.sum + h.correction,
      peak_recorded_inventory_quantity: h.peak,
      roundoff_operations: h.operations + queue.length + 2,
      quantity_tolerance: bound,
      source_ending_quantity: expected,
      fifo_ending_quantity: actual,
    });
    for (const lot of queue)
      lots.push(
        lotRow(
          lot,
          lot.quantity,
          lot.fees,
          lot.slippage,
          null,
          0,
          0,
          id("open", lot.id),
        ),
      );
  }
  const known = lots.every((l) => l.basis_status === "KNOWN");
  const realized = sum(lots.map((l) => l.net_realized_pnl ?? 0)),
    unrealized = sum(lots.map((l) => l.net_unrealized_pnl ?? 0));
  if (known)
    requireValid(
      close(
        realized + unrealized,
        totals.etf_pnl - totals.fees - totals.slippage,
      ),
      "FIFO net realized/unrealized P&L does not reconcile to equity P&L less trading costs.",
    );
  if (!sourceCodeVersion) warnings.add("SOURCE_CODE_VERSION_NOT_RECORDED");
  const content = {
    version: BLOTTER_VERSION,
    ledger_checksum,
    source_spec: spec,
    decisions,
    signals,
    code_version: sourceCodeVersion,
    dataset_hash: sourceDatasetHash,
  };
  const projection_content_hash = hash(content);
  const reconciliation = {
    status: "PASS",
    tolerance: BLOTTER_TOLERANCE,
    fifo_quantity_policy: {
      version: "HISTORICAL_INVENTORY_ROUNDOFF_V1",
      reference: "INITIAL_PLUS_ACTUAL_GROSS_TRADED_QUANTITY",
      absolute_share_floor: 0,
      evidence: quantityEvidence,
      adjustments,
    },
    ...totals,
    realized_net_pnl: known ? realized : null,
    unrealized_net_pnl: known ? unrealized : null,
    fifo_pnl_status: known
      ? "RECONCILED"
      : "NOT_SUPPORTED_UNKNOWN_INITIAL_BASIS",
    fifo_plus_cash_equals_portfolio_pnl: known
      ? close(realized + unrealized + totals.cash_pnl, totals.net_pnl)
      : "NOT_SUPPORTED",
    unchanged_initial_nav: ledger[0].beginningNav,
    unchanged_final_nav: last.endingNav,
  };
  return {
    version: BLOTTER_VERSION,
    run_id: input.run_id,
    attempt_id: input.attempt_id,
    scope: spec.research_scope ?? "NOT_RECORDED",
    price_basis: "SIMULATED_ADJUSTED_CLOSE",
    execution_time: "NOT_AVAILABLE_EOD",
    execution_convention: "NEXT_OBSERVED_CLOSE",
    amount_units: "SIMULATED_NAV_INDEX_UNITS_INITIAL_100",
    ledger_checksum,
    projection_content_hash,
    blotter_hash: hash({
      ...identity,
      projection_content_hash,
      events,
      executions,
      lots,
      positions,
      reconciliation,
    }),
    provenance: {
      code_version: sourceCodeVersion,
      engine_version:
        spec.engine_version ?? input.result.provenance?.engine_version ?? null,
      code_commit: spec.code_commit ?? null,
      dataset_version: spec.dataset_version ?? null,
      dataset_source: spec.dataset_source ?? null,
      dataset_id: spec.dataset_id ?? null,
      dataset_hash: content.dataset_hash,
      source_financial_result_hash: input.result.financial_result_hash ?? null,
      accounting: "FIFO_REPORTING_ONLY_NO_CHANGE_TO_LEDGER",
      cost_allocation: "ABSOLUTE_TRADED_NOTIONAL_WITH_LARGEST_FILL_RESIDUAL",
    },
    events,
    executions,
    lots,
    positions,
    warnings: [...warnings].sort(),
    reconciliation,
  };
}
