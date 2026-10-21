import type { ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ResultV2 } from "@/lib/workbench-v2-api";
import type {
  BenchmarkMetrics,
  BenchmarkPoint,
  ExposureModel,
} from "@/lib/workbench-attribution-api";
import { formatResearchNumber as number } from "@/lib/workbench-state";

const pct = (v: number) =>
  new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(v);
const show = (v: unknown, percent = false): ReactNode =>
  typeof v === "number" ? (percent ? pct(v) : number(v, 6)) : "NOT_SUPPORTED";
function Diagnostic({
  d,
  percent = false,
}: {
  d?: { value: number | null; status: string; reason: string | null };
  percent?: boolean;
}) {
  return d?.value !== null && d?.value !== undefined ? (
    <>{show(d.value, percent)}</>
  ) : (
    <span className="ce-unavailable" title={d?.reason ?? "Not supported"}>
      Unavailable
      {d
        ? ` (${d.status.toLowerCase().replaceAll("_", " ")})`
        : " (NOT_SUPPORTED)"}
    </span>
  );
}
export function CapitalModelSummary({ model }: { model: ExposureModel }) {
  return (
    <aside className="ce-model" aria-labelledby="model-summary-title">
      <p className="workbench-eyebrow">THE CURRENT BASELINE</p>
      <h2 id="model-summary-title">Model Summary</h2>
      <dl>
        {[
          ["Model", model.name],
          ["Decision", model.decision],
          [
            "Information window",
            `${model.information_window_observations} historical observations`,
          ],
          ["Policy selection", model.policy_selection],
          ["Recalibration", model.recalibration],
          ["Output", model.output],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="ce-model-limitation">{model.limitation}</p>
      <details>
        <summary>How the exposure rule works</summary>
        <ol>
          <li>The system computes a regime score from historical prices.</li>
          <li>The selected policy maps that score to a SPY/cash exposure.</li>
          <li>The policy is reselected at each walk-forward rebalance.</li>
        </ol>
        <p>
          Score range: {model.score_range.minimum}–{model.score_range.maximum}.{" "}
          {model.weight_normalization}
        </p>
        <div className="wd-table-scroll">
          <table>
            <caption>
              Score components from the backend model definition
            </caption>
            <thead>
              <tr>
                <th>Component</th>
                <th>Weight</th>
                <th>Availability</th>
              </tr>
            </thead>
            <tbody>
              {model.components.map((c) => (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td>{pct(c.weight)}</td>
                  <td>{c.availability.toLowerCase().replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          {model.regime_thresholds
            .map((t) => `${t.label}: score ≥ ${t.minimum_score}`)
            .join(" · ")}
          . Thresholds label the score; the exposure policy uses the score
          itself.
        </p>
        <p>{model.cash_exposure_mapping}</p>
        <h3>Candidate policies</h3>
        <ul>
          {model.candidate_policy_set.map((p, i) => (
            <li key={i}>
              {p.policy === "constant"
                ? `Constant SPY exposure: ${pct(p.parameters.risk)}`
                : `Cash range: ${pct(p.parameters.cash_min)}–${pct(p.parameters.cash_max)}`}
            </li>
          ))}
        </ul>
        <p>
          Selection metric:{" "}
          {model.fixed_selection_metric === "net_sharpe"
            ? "Net Sharpe after costs"
            : model.fixed_selection_metric}
          .
        </p>
        <p>{model.execution}</p>
        <p>
          These information series inform the score; they are not ETF portfolio
          weights: {model.reference_universe.join(", ")}.
        </p>
        <p>
          Model version: {model.fixed_model_versions.models.current_regime}.
          Policy versions:{" "}
          {Object.values(model.fixed_model_versions.policies).join(", ")}.
        </p>
      </details>
    </aside>
  );
}
const names = ["Dynamic exposure", "Passive SPY", "Matched-beta control"];
const colors = ["#173b57", "#84919d", "#17756d"];
const tooltipStyle = {
  maxWidth: "calc(100vw - 64px)",
  whiteSpace: "normal" as const,
  overflowWrap: "anywhere" as const,
  fontSize: 12,
};
function TrackChart({
  tracks,
  field,
  title,
}: {
  tracks: BenchmarkPoint[][];
  field: "index" | "drawdown";
  title: string;
}) {
  const available = tracks.filter((t) => t.length);
  if (!available.length)
    return (
      <p className="workbench-empty">
        The required aligned tracks are not available.
      </p>
    );
  // Date joins for display only. No returns, metrics or benchmark differences
  // are calculated in the browser, and missing observations remain missing.
  const rows = tracks[0].map((p, i) => ({
    date: p.date,
    A: p[field],
    B: tracks[1]?.[i]?.[field],
    C: tracks[2]?.[i]?.[field],
  }));
  return (
    <div className="workbench-chart ce-chart" role="img" aria-label={title}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={rows}
          margin={{ top: 14, right: 18, bottom: 8, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="#dce5eb" />
          <XAxis
            dataKey="date"
            minTickGap={48}
            tick={{ fontSize: 12 }}
            tickFormatter={(d) => String(d).slice(0, 7)}
          />
          <YAxis
            domain={["auto", "auto"]}
            width={55}
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => (field === "drawdown" ? pct(v) : String(v))}
          />
          <Tooltip
            formatter={(v, n) => [String(v), n]}
            labelFormatter={(d) => `Date: ${d}`}
            wrapperStyle={{ maxWidth: "calc(100vw - 64px)" }}
            contentStyle={tooltipStyle}
            itemStyle={{ whiteSpace: "normal", overflowWrap: "anywhere" }}
          />
          {["A", "B", "C"].map((key, i) =>
            tracks[i]?.length ? (
              <Line
                key={key}
                dataKey={key}
                name={names[i]}
                stroke={colors[i]}
                strokeWidth={i === 0 ? 2.2 : 1.7}
                type="linear"
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
                strokeDasharray={i === 2 ? "5 3" : undefined}
              />
            ) : null,
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
function ExposureChart({ points }: { points: BenchmarkPoint[] }) {
  return (
    <div
      className="workbench-chart ce-chart"
      role="img"
      aria-label="Actual dynamic SPY exposure and cash allocation through time"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={{ top: 12, right: 18, bottom: 8, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="#dce5eb" />
          <XAxis
            dataKey="date"
            minTickGap={48}
            tick={{ fontSize: 12 }}
            tickFormatter={(d) => String(d).slice(0, 7)}
          />
          <YAxis
            width={55}
            domain={[0, 1]}
            tickFormatter={pct}
            tick={{ fontSize: 12 }}
          />
          <Tooltip
            formatter={(v, n) => [String(v), n]}
            wrapperStyle={{ maxWidth: "calc(100vw - 64px)" }}
            contentStyle={tooltipStyle}
            itemStyle={{ whiteSpace: "normal", overflowWrap: "anywhere" }}
          />
          <Line
            dataKey="spy_exposure"
            name="SPY exposure"
            type="linear"
            stroke={colors[0]}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
            strokeWidth={2}
          />
          <Line
            dataKey="cash_allocation"
            name="Cash allocation"
            type="linear"
            stroke={colors[1]}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
            strokeWidth={1.8}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
function MetricTable({
  metrics,
  rows,
  caption,
}: {
  metrics: Array<BenchmarkMetrics | undefined>;
  rows: Array<[string, (m: BenchmarkMetrics) => ReactNode]>;
  caption: string;
}) {
  return (
    <div className="ce-summary-scroll">
      <table className="ce-summary-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th>Measure</th>
            <th>Dynamic</th>
            <th>Passive SPY</th>
            <th>Matched beta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, get]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              {metrics.map((m, i) => (
                <td key={i}>{m ? get(m) : "NOT_SUPPORTED"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function CapitalExposureResults({ result: r }: { result: ResultV2 }) {
  if (
    !r.benchmark_tracks ||
    typeof r.benchmark_tracks === "string" ||
    !r.benchmark_metrics ||
    typeof r.benchmark_metrics === "string"
  )
    return (
      <div className="wd-notice">
        <h3>Benchmark attribution is unavailable</h3>
        <p>
          {r.attribution?.explanation ??
            "The dynamic result is preserved. The server must provide versioned benchmark evidence before this view can show the controls."}
        </p>
        <code>{r.attribution?.code ?? "BENCHMARK_CONTRACT_UNAVAILABLE"}</code>
        <p>
          Dynamic final research index:{" "}
          {typeof r.metrics !== "string"
            ? show(r.metrics.final_research_index)
            : "NOT_SUPPORTED"}
        </p>
      </div>
    );
  const b = r.benchmark_tracks,
    m = r.benchmark_metrics;
  const tracks = [
    b.DYNAMIC_EXPOSURE.points,
    b.PASSIVE_SPY.points,
    b.STATIC_MATCHED_BETA.points,
  ];
  if (
    !tracks[0].length ||
    tracks.some(
      (t) =>
        t.length &&
        (t.length !== tracks[0].length ||
          t.some(
            (p, i) =>
              p.date !== tracks[0][i].date ||
              p.fold_id !== tracks[0][i].fold_id,
          )),
    )
  )
    return (
      <div className="wd-error" role="alert">
        BENCHMARK_ALIGNMENT_MISMATCH — benchmark charts are withheld.
      </div>
    );
  const metrics = [
    m.DYNAMIC_EXPOSURE,
    m.PASSIVE_SPY,
    typeof m.STATIC_MATCHED_BETA === "string"
      ? undefined
      : m.STATIC_MATCHED_BETA,
  ];
  const matched = r.matched_beta_diagnostic?.status === "MATCHED";
  const attribution = r.attribution?.values;
  return (
    <div className="ce-results">
      <h3>Risk, upside and timing</h3>
      <p>
        Compare drawdown and volatility for risk, capture ratios for market
        participation, and the beta-matched residual for timing. These are
        research diagnostics.
      </p>
      {!matched && (
        <div className="wd-notice">
          <strong>{r.matched_beta_diagnostic?.status}</strong>
          <p>
            {r.matched_beta_diagnostic?.reason ??
              "The requested dynamic beta cannot be matched exactly without leverage or shorting. The third line shows the closest attainable diagnostic, not an exact beta match."}
          </p>
          <p>
            Attainable beta:{" "}
            {show(r.matched_beta_diagnostic?.minimum_attainable_control_beta)}{" "}
            to{" "}
            {show(r.matched_beta_diagnostic?.maximum_attainable_control_beta)}.
            Closest target:{" "}
            {show(r.matched_beta_diagnostic?.best_attainable_lambda, true)}.
            Remaining beta difference:{" "}
            {show(r.matched_beta_diagnostic?.remaining_beta_difference)}.
          </p>
        </div>
      )}
      <MetricTable
        metrics={metrics}
        caption="Same dates, same fold boundaries, consistent costs"
        rows={[
          ["CAGR", (v) => show(v.cagr, true)],
          [
            "Realized market beta",
            (v) => <Diagnostic d={v.full_sample_beta} />,
          ],
          ["Maximum drawdown", (v) => show(v.max_drawdown, true)],
          ["Annualized volatility", (v) => show(v.annualized_volatility, true)],
          ["Net Sharpe", (v) => show(v.net_sharpe)],
          ["Downside beta", (v) => <Diagnostic d={v.downside_beta} />],
          ["Upside beta", (v) => <Diagnostic d={v.upside_beta} />],
          ["Upside capture", (v) => <Diagnostic d={v.upside_capture} />],
          ["Downside capture", (v) => <Diagnostic d={v.downside_capture} />],
          ["Observations", (v) => show(v.observations)],
        ]}
      />
      <div className="ce-attribution">
        <h3>Exposure and timing attribution</h3>
        {attribution && typeof attribution !== "string" ? (
          <dl>
            <div>
              <dt>Total dynamic effect</dt>
              <dd>
                {show(attribution.total_dynamic_effect_cagr_difference, true)}
              </dd>
              <p>
                Dynamic minus passive; combines exposure reduction and timing.
              </p>
            </div>
            <div>
              <dt>Exposure-level effect</dt>
              <dd>
                {show(attribution.exposure_level_effect_cagr_difference, true)}
              </dd>
              <p>Matched-beta control minus passive SPY.</p>
            </div>
            <div>
              <dt>Timing residual</dt>
              <dd>{show(attribution.timing_residual_cagr_difference, true)}</dd>
              <p>Dynamic minus the matched-beta control.</p>
            </div>
          </dl>
        ) : (
          <p>
            NOT_SUPPORTED — a valid exact beta match is required for this
            decomposition.
          </p>
        )}
        <p>
          Values are differences in annualized CAGR, expressed in percentage
          points. A positive timing residual is not automatically statistical
          alpha.
        </p>
      </div>
      <div className="ce-legend">
        {names.map((name, i) => (
          <span key={name}>
            <i style={{ background: colors[i] }} />
            {i === 2 && !matched ? "Closest attainable diagnostic" : name}
          </span>
        ))}
      </div>
      <h3>OOS research index</h3>
      <TrackChart
        tracks={tracks}
        field="index"
        title="Aligned dynamic, passive and retrospective matched-beta OOS research indices"
      />
      <h3>Drawdown</h3>
      <TrackChart
        tracks={tracks}
        field="drawdown"
        title="Aligned drawdowns for all three research tracks"
      />
      <h3>SPY exposure and cash through time</h3>
      <ExposureChart points={tracks[0]} />
      <p className="wd-muted">
        Beginning-of-period SPY and cash weights from the actual dynamic ledger.
        Targets are filled at the next close; weights can drift between
        rebalances.
      </p>
      <p className="ce-control-note">
        <strong>Retrospective matched-beta diagnostic.</strong> This control is
        constructed after observing the completed OOS path. It is a diagnostic
        benchmark, not an ex-ante investable strategy.
      </p>
      <p className="wd-muted">
        All tracks restart from cash at each fold, share the initial next-close
        entry lag and compound the aligned daily returns. Passive SPY pays the
        configured entry cost and holds. The matched control also pays actual
        daily maintenance turnover to keep its target exposure constant. No
        final liquidation is assumed.
      </p>
      <h3>Selected policy by fold</h3>
      {typeof r.selected_policy_by_fold !== "string" &&
      r.selected_policy_by_fold ? (
        <div className="wd-table-scroll">
          <table>
            <caption>
              Policy selection uses prior training information only
            </caption>
            <thead>
              <tr>
                {[
                  "Fold",
                  "Decision date",
                  "Training interval",
                  "Test interval",
                  "Selected policy",
                  "Cash range / SPY target",
                  "Training net Sharpe",
                  "Average SPY",
                  "Average cash",
                  "Turnover",
                  "Simulated cost",
                  "Audit",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.selected_policy_by_fold.map((p) => (
                <tr key={p.fold}>
                  <td>{p.fold}</td>
                  <td>{p.decision_date}</td>
                  <td>
                    {p.training_start} → {p.training_end_exclusive} (not
                    included)
                  </td>
                  <td>
                    {p.oos_start} → {p.oos_end_exclusive} (not included)
                  </td>
                  <td>
                    {p.selected_exposure_policy === "constant"
                      ? "Constant exposure"
                      : "Cash band"}
                  </td>
                  <td>
                    {p.selected_exposure_policy === "constant"
                      ? `SPY ${pct(p.parameters.risk)}`
                      : `Cash ${pct(p.parameters.cash_min)}–${pct(p.parameters.cash_max)}`}
                  </td>
                  <td>{show(p.training_net_sharpe)}</td>
                  <td>{pct(p.average_oos_spy_exposure)}</td>
                  <td>{pct(p.average_oos_cash)}</td>
                  <td>{show(p.realized_turnover)}</td>
                  <td>{show(p.realized_simulated_cost)}</td>
                  <td>
                    <details className="workbench-inline-audit">
                      <summary>Advanced</summary>
                      <p>Information cutoff: {p.information_cutoff}</p>
                      <code>{p.audit.candidate_id}</code>
                      {p.audit.fit_keys.map((k) => (
                        <code key={k}>{k}</code>
                      ))}
                      <code>{p.audit.job_hash}</code>
                      <code>{p.audit.result_hash}</code>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>NOT_SUPPORTED</p>
      )}
      <h3>Capital-efficiency context</h3>
      <MetricTable
        metrics={metrics}
        caption="Diagnostics supplement standard performance measures"
        rows={[
          ["Average SPY exposure", (v) => show(v.average_risky_exposure, true)],
          [
            "Average cash allocation",
            (v) => show(v.average_cash_allocation, true),
          ],
          [
            "CAGR / average SPY exposure",
            (v) => (
              <Diagnostic
                d={v.capital_efficiency.cagr_per_average_spy_exposure}
              />
            ),
          ],
          [
            "CAGR / realized market beta",
            (v) => (
              <Diagnostic d={v.capital_efficiency.cagr_per_average_beta} />
            ),
          ],
          ["Gross turnover", (v) => show(v.gross_turnover)],
          ["Realized simulated cost", (v) => show(v.realized_simulated_cost)],
        ]}
      />
      <p>
        Lower average exposure may release capital for other independent
        strategies. This does not by itself establish market-timing skill.
      </p>
      <p className="wd-muted">
        Cost totals use normalized research units across independently started
        folds. They are simulated assumptions, not broker fees paid.
      </p>
      <details className="ce-extra-diagnostics">
        <summary>Additional certified risk diagnostics</summary>
        <MetricTable
          metrics={metrics}
          caption="AL-02 conditional beta definitions and thresholds"
          rows={[
            ...Object.keys(m.DYNAMIC_EXPOSURE.drawdown_beta).map(
              (k) =>
                [
                  `Beta in SPY drawdowns ≥ ${pct(Number(k))}`,
                  (v: BenchmarkMetrics) => (
                    <Diagnostic d={v.drawdown_beta[k]} />
                  ),
                ] as [string, (m: BenchmarkMetrics) => ReactNode],
            ),
            ...Object.keys(m.DYNAMIC_EXPOSURE.tail_beta).map(
              (k) =>
                [
                  `Tail beta, worst ${pct(Number(k))}`,
                  (v: BenchmarkMetrics) => <Diagnostic d={v.tail_beta[k]} />,
                ] as [string, (m: BenchmarkMetrics) => ReactNode],
            ),
          ]}
        />
        <p>
          Market betas use raw adjusted SPY returns on the aligned test dates.
          Drawdown states use available prior SPY history. Unavailable
          conditional metrics reflect insufficient observations or undefined
          variance.
        </p>
      </details>
      <details className="ce-extra-diagnostics">
        <summary>CAPM residual diagnostic</summary>
        <p>
          Certified regression with explicit statistical inference; this is not
          a profitability or investment claim.
        </p>
        <MetricTable
          metrics={metrics}
          caption="Annualized residual alpha, uncertainty and sample"
          rows={[
            [
              "Annualized CAPM residual alpha",
              (v) => show(v.capm_alpha_diagnostic.alpha_annualized, true),
            ],
            [
              "Annualized standard error",
              (v) =>
                show(v.capm_alpha_diagnostic.standard_error_annualized, true),
            ],
            ["t-statistic", (v) => show(v.capm_alpha_diagnostic.t_alpha)],
            ["Sample size", (v) => show(v.capm_alpha_diagnostic.observations)],
          ]}
        />
        {metrics.map(
          (v, i) =>
            v && (
              <p key={i}>
                {names[i]}:{" "}
                {v.capm_alpha_diagnostic.configuration.standard_errors.replaceAll(
                  "_",
                  " ",
                )}
                , {v.capm_alpha_diagnostic.configuration.hac_lags} lags.
                Inference: {v.capm_alpha_diagnostic.inference_status}.{" "}
                {v.capm_alpha_diagnostic.inference_reason}
              </p>
            ),
        )}
      </details>
      <details className="workbench-audit">
        <summary>Advanced Audit Details</summary>
        <dl>
          <div>
            <dt>Candidate-ranking cost assumption</dt>
            <dd>
              {typeof r.costs !== "string"
                ? `${r.costs.selection_cost_bps} bps`
                : "NOT_SUPPORTED"}
            </dd>
          </div>
          <div>
            <dt>OOS evaluation cost assumption</dt>
            <dd>
              {typeof r.costs !== "string"
                ? `${r.costs.transaction_cost_bps} bps`
                : "NOT_SUPPORTED"}
            </dd>
          </div>
        </dl>
        <p>Benchmark methodology: {r.benchmark_methodology_version}</p>
        <p>Dynamic financial hash</p>
        <code>{r.financial_result_hash}</code>
        <p>Passive control hash</p>
        <code>{r.passive_control_hash}</code>
        <p>Matched-beta control hash</p>
        <code>{r.matched_beta_control_hash}</code>
        <p>Attribution hash</p>
        <code>{r.attribution_hash}</code>
        <pre>
          {JSON.stringify(
            {
              matched_beta_diagnostic: r.matched_beta_diagnostic,
              provenance: r.provenance,
              artifacts: r.result_artifacts,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}
