import { useMemo } from "react";
import type { Result, Metrics, Comparison } from "./api";
import { ResearchChart } from "./charts";
import { percent, number } from "./state";
export const metricRows: Array<{
  label: string;
  key: keyof Metrics;
  format?: (x: any) => string;
  diagnostic?: boolean;
}> = [
  { label: "CAGR", key: "cagr", format: percent },
  { label: "Annualized return", key: "cagr", format: percent },
  {
    label: "Annualized volatility",
    key: "annualized_volatility",
    format: percent,
  },
  { label: "Net Sharpe", key: "net_sharpe" },
  { label: "Max drawdown", key: "max_drawdown", format: percent },
  { label: "Full beta", key: "full_sample_beta", diagnostic: true },
  { label: "Upside beta", key: "upside_beta", diagnostic: true },
  { label: "Downside beta", key: "downside_beta", diagnostic: true },
  {
    label: "Upside capture",
    key: "upside_capture",
    diagnostic: true,
    format: percent,
  },
  {
    label: "Downside capture",
    key: "downside_capture",
    diagnostic: true,
    format: percent,
  },
  {
    label: "Average SPY exposure",
    key: "average_risky_exposure",
    format: percent,
  },
  {
    label: "Trading costs¹",
    key: "realized_simulated_cost",
    format: (x) => number(x, 6),
  },
];
export function metricValue(
  m: Metrics | "NOT_SUPPORTED" | undefined,
  row: (typeof metricRows)[number],
) {
  if (!m || typeof m === "string") return "Not supported";
  const value = m[row.key] as any;
  return (row.format ?? number)(row.diagnostic ? value?.value : value);
}
const trackNames = {
  DYNAMIC_EXPOSURE: "Dynamic exposure",
  PASSIVE_SPY: "Passive SPY",
  STATIC_MATCHED_BETA: "Matched-beta control",
};
export function ResearchResults({ result: r }: { result: Result }) {
  const matched =
    (r.matched_beta_diagnostic as { status?: string } | undefined)?.status ===
    "MATCHED";
  const names = useMemo(
    () => ({
      ...trackNames,
      STATIC_MATCHED_BETA: matched
        ? "Matched-beta control"
        : "Retrospective control (unmatched)",
    }),
    [matched],
  );
  const curves = useMemo(
    () =>
      Object.entries(names)
        .map(([id, label]) => ({
          id,
          label,
          points: r.benchmark_tracks[id] ?? [],
        }))
        .filter((c) => c.points.length > 0),
    [r, names],
  );
  const exposure = useMemo(
    () => [
      {
        id: "spy",
        label: "SPY",
        points: r.benchmark_tracks.DYNAMIC_EXPOSURE ?? [],
      },
    ],
    [r],
  );
  const cash = useMemo(
    () => [
      {
        id: "cash",
        label: "Cash",
        points: (r.benchmark_tracks.DYNAMIC_EXPOSURE ?? []).map((p) => ({
          ...p,
          spy_exposure: p.cash_allocation,
        })),
      },
    ],
    [r],
  );
  return (
    <section aria-label="Backtest results" className="pr-results">
      <div className="pr-section-title">
        <div>
          <h2>Backtest results</h2>
          <p>
            {r.plan.number_of_folds} rebalance periods ·{" "}
            {number(r.metrics.observations, 0)} observed sessions · Independent
            fold sleeves
          </p>
        </div>
        <span className="pr-tag">Completed</span>
      </div>
      <div className="pr-kpis">
        {[
          { label: "CAGR", value: percent(r.metrics.cagr) },
          {
            label: "Volatility",
            value: percent(r.metrics.annualized_volatility),
          },
          { label: "Sharpe", value: number(r.metrics.net_sharpe) },
          { label: "Max drawdown", value: percent(r.metrics.max_drawdown) },
          { label: "Beta", value: number(r.metrics.full_sample_beta.value) },
          {
            label: "Avg SPY exposure",
            value: percent(r.metrics.average_risky_exposure),
          },
          {
            label: "Trading cost¹",
            value: number(r.metrics.realized_simulated_cost, 6),
          },
        ].map((k) => (
          <div key={k.label}>
            <span>{k.label}</span>
            <strong>{k.value}</strong>
          </div>
        ))}
      </div>
      <div className="pr-section-title pr-chart-title">
        <h3>Research index</h3>
        <span>Dynamic · Passive · Retrospective matched beta</span>
      </div>
      <ResearchChart
        curves={curves}
        label="Research index: dynamic, passive SPY and matched-beta control"
      />
      <div className="pr-chart-pair">
        <section>
          <h3>Drawdown</h3>
          <ResearchChart
            curves={curves}
            field="drawdown"
            label="Aligned drawdowns"
            height={185}
          />
        </section>
        <section>
          <h3>SPY exposure / cash</h3>
          <ResearchChart
            curves={[...exposure, ...cash]}
            field="spy_exposure"
            label="Actual SPY exposure and cash"
            height={185}
          />
        </section>
      </div>
      <h3 className="pr-table-title">Performance &amp; capital use</h3>
      <div className="pr-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              {Object.values(names).map((n) => (
                <th key={n}>{n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricRows.map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                {Object.keys(names).map((id) => (
                  <td key={id}>{metricValue(r.benchmark_metrics[id], row)}</td>
                ))}
              </tr>
            ))}
            {[
              { key: "recurring_gross_turnover", label: "Recurring turnover" },
              { key: "total_gross_turnover", label: "Total turnover" },
              {
                key: "initial_implementation_turnover",
                label: "Initial implementation",
              },
            ].map((x) => (
              <tr key={x.key}>
                <th>{x.label}²</th>
                {Object.keys(names).map((id) => (
                  <td key={id}>
                    {number((r.turnover[id] as any)?.[x.key], 4)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pr-footnotes">
        {r.warnings.includes("NO_RECURRING_REBALANCE_OBSERVED") && (
          <span>
            Some training intervals contain no portfolio change after initial
            entry. Their recurring-turnover constraint is not informative.
          </span>
        )}
        <span>
          ¹ Simulated cost in independent sleeve index units. Each sleeve starts
          at 100; entry is cost charged.
        </span>
        <span>
          ² Sum of actual traded notional / pre-cost NAV across sleeves.
          Annualized return uses the certified 252 / observed-session
          convention.
        </span>
      </div>
      <section className="pr-attribution">
        <h3>Return attribution</h3>
        {typeof r.attribution === "string" ? (
          <p>
            Exact beta matching is unavailable for this result. Any displayed
            control is the closest attainable retrospective diagnostic. See
            Audit for its feasibility evidence.
          </p>
        ) : (
          <div className="pr-attribution-grid">
            <div>
              <span>Total dynamic effect</span>
              <strong>
                {percent(r.attribution.total_dynamic_effect_cagr_difference)}
              </strong>
              <small>Dynamic − Passive</small>
            </div>
            <div>
              <span>Exposure effect</span>
              <strong>
                {percent(r.attribution.exposure_level_effect_cagr_difference)}
              </strong>
              <small>Matched beta − Passive</small>
            </div>
            <div>
              <span>Timing residual</span>
              <strong>
                {percent(r.attribution.timing_residual_cagr_difference)}
              </strong>
              <small>Dynamic − Matched beta</small>
            </div>
          </div>
        )}
        <p>
          CAGR percentage-point differences. Timing residual is not
          automatically alpha. Matched beta is a retrospective diagnostic, not
          an ex-ante investable strategy.
        </p>
      </section>
    </section>
  );
}
const configLabels: Record<string, string> = {
  evaluation_start: "From",
  evaluation_end_exclusive: "To (exclusive)",
  window_type: "Walk-forward type",
  training_window_months: "Training months",
  rebalance_frequency: "Rebalance",
  transaction_cost_bps: "Trading costs (bps)",
  selection_cost_bps: "Candidate ranking cost (bps)",
  turnover_constraint_methodology_version: "Turnover methodology",
  engine_version: "Model / engine version",
  code_version: "Calculation version",
};
export function CompareResults({
  comparison: c,
  name,
}: {
  comparison: Comparison;
  name: (id: string) => string;
}) {
  const curves = useMemo(
    () =>
      c.runs.slice(0, c.display_curve_limit).map((r) => ({
        id: r.run_id,
        label: name(r.run_id),
        points: r.points,
      })),
    [c, name],
  );
  return (
    <section>
      <div className="pr-section-title">
        <h2>Compare research runs</h2>
        <span>{c.runs.length} completed experiments</span>
      </div>
      {c.warnings.map((w) => (
        <p className="pr-inline-warning" key={w}>
          {w}
        </p>
      ))}
      <p className="pr-subtle">
        Read-only comparison of immutable results. No recalculation. First{" "}
        {Math.min(c.runs.length, c.display_curve_limit)} curves shown; the
        matrix includes every selected run.
      </p>
      <h3>Research index</h3>
      <ResearchChart
        curves={curves}
        label="Multiple-run research index comparison"
      />
      <h3>Drawdown</h3>
      <ResearchChart
        curves={curves}
        field="drawdown"
        label="Multiple-run drawdown comparison"
        height={180}
      />
      <h3 className="pr-table-title">Performance matrix</h3>
      <div className="pr-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              {c.runs.map((r) => (
                <th key={r.run_id}>{name(r.run_id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricRows.map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                {c.runs.map((r) => (
                  <td key={r.run_id}>{metricValue(r.metrics, row)}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th>Rebalance periods</th>
              {c.runs.map((r) => (
                <td key={r.run_id}>{r.fold_count}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <h3 className="pr-table-title">Configuration matrix</h3>
      <div className="pr-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Configuration</th>
              {c.runs.map((r) => (
                <th key={r.run_id}>{name(r.run_id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.configuration_matrix
              .filter(
                (row) =>
                  row.field !== "code_version" &&
                  row.field !== "runtime_versions" &&
                  (row.field !== "selection_cost_bps" ||
                    c.runs.some(
                      (r) =>
                        r.spec.selection_cost_bps !==
                        r.spec.transaction_cost_bps,
                    )),
              )
              .map((row) => (
                <tr
                  key={row.field}
                  className={row.differs ? "pr-difference" : ""}
                >
                  <th>
                    {configLabels[row.field] ?? row.field}
                    {row.differs ? " · differs" : ""}
                  </th>
                  {row.values.map((x) => (
                    <td key={x.run_id} className="pr-config-value">
                      {row.field === "turnover_constraint_methodology_version"
                        ? x.value === "RECURRING_TURNOVER_EXCLUDING_INITIAL_V2"
                          ? "Recurring turnover; initial entry cost charged"
                          : "Legacy total turnover"
                        : row.field === "engine_version"
                          ? "Current Regime Score — baseline"
                          : String(x.value)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <details className="pr-technical">
        <summary>Calculation versions &amp; result hashes</summary>
        <pre>
          {JSON.stringify(
            {
              versions: c.configuration_matrix.filter((r) =>
                ["code_version", "runtime_versions"].includes(r.field),
              ),
              hashes: c.runs.map((r) => ({
                run_id: r.run_id,
                financial_result_hash: r.financial_result_hash,
              })),
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}
