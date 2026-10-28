import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  type FormEvent,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ResearchClient,
  ResearchApiError,
  resultSchema,
  type Result,
  type Plan,
  type Capabilities,
  type RequestSpec,
  type Detail,
  type Comparison,
} from "./api";
import {
  CAPITAL_TABS,
  modules,
  blankDesign,
  readDesign,
  duplicateDesign,
  number,
  percent,
  dateLabel,
  dataMonth,
  type FormDesign,
} from "./state";
import { ResearchResults, CompareResults } from "./results";
import { WORKBENCH_SESSION_TOKEN_KEY } from "@/lib/workbench-api";
import "./workbench.css";
type Tab = "Setup" | "Results" | "Compare" | "Runs" | "Audit";
const terminal = (s: string | null | undefined) =>
  ["SUCCESS", "FAILED", "BLOCKED"].includes(s ?? "");
const getSuccess = (d?: Detail): Result | undefined => {
  const x = resultSchema.safeParse(d?.latest_successful_result);
  return x.success ? x.data : undefined;
};
function Technical({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="pr-technical">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}
export function ErrorMessage({
  error,
  refresh,
}: {
  error: unknown;
  refresh?: () => void;
}) {
  const e = error as any;
  if (!e) return null;
  const code = e.code ?? e.error_class ?? "REQUEST_FAILED";
  const capacity = code === "BLOCKED_EXECUTION_CAPACITY" || e.status === 429;
  const access =
    e.status === 401 || code === "WORKBENCH_PREVIEW_ACCESS_NOT_CONFIGURED";
  const message =
    e.safe_message ?? e.message ?? "The backtest could not be completed.";
  return (
    <section role="alert" className="pr-error">
      <h3>
        {access
          ? "Preview access required"
          : capacity
            ? "Research worker in use"
            : "Backtest cannot run"}
      </h3>
      <p>{message}</p>
      <p>
        {access
          ? "Check the preview token. If access was rotated, sign out and enter the current token."
          : capacity
            ? "Refresh status to check the available worker. No automatic retry was started."
            : (e.suggested_user_action ??
              "Review the design and change the requested inputs explicitly before trying again.")}
      </p>
      {refresh && (
        <button type="button" onClick={refresh}>
          Refresh status
        </button>
      )}
      <Technical title="Show technical details">
        <dl>
          <dt>Classification</dt>
          <dd>{code}</dd>
          {e.failed_fold_id !== null && e.failed_fold_id !== undefined && (
            <>
              <dt>Fold</dt>
              <dd>{e.failed_fold_id}</dd>
            </>
          )}
          {e.failed_decision_date && (
            <>
              <dt>Decision date</dt>
              <dd>{e.failed_decision_date}</dd>
            </>
          )}
        </dl>
        <pre>
          {JSON.stringify(e.details ?? e.technical_details ?? {}, null, 2)}
        </pre>
      </Technical>
    </section>
  );
}
function Access({ accept }: { accept: (token: string) => void }) {
  const [token, setToken] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      await new ResearchClient(token.trim()).capabilities();
      sessionStorage.setItem(WORKBENCH_SESSION_TOKEN_KEY, token.trim());
      accept(token.trim());
    },
  });
  return (
    <main className="pr-access">
      <div className="pr-access-box">
        <div className="pr-brand">
          <span>AL</span> Allocation Lab
        </div>
        <p className="pr-eyebrow">Institutional research workspace</p>
        <h1>Owner preview</h1>
        <p>Enter your preview token to access the research platform.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <label htmlFor="research-token">Preview token</label>
          <input
            id="research-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <button
            className="pr-primary"
            disabled={!token.trim() || mutation.isPending}
          >
            {mutation.isPending
              ? "Checking access…"
              : "Open research workspace"}
          </button>
        </form>
        <ErrorMessage error={mutation.error} />
        <p className="pr-subtle">
          Research only. The token remains in this tab’s session storage.
        </p>
      </div>
    </main>
  );
}
export function PlatformShell({
  children,
  signOut,
  module,
  setModule,
}: {
  children: React.ReactNode;
  signOut: () => void;
  module: string;
  setModule: (id: string) => void;
}) {
  useEffect(() => {
    const position = () => {
      const nav = document.querySelector<HTMLElement>(".pr-modules"),
        active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
      if (nav && active)
        nav.scrollLeft =
          active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [module]);
  return (
    <div className="pr-app">
      <header className="pr-header">
        <div className="pr-brand">
          <span>AL</span>
          <strong>Allocation Lab</strong>
          <small>Research platform</small>
        </div>
        <div className="pr-header-right">
          <span className="pr-preview-label">Owner preview</span>
          {import.meta.env?.VITE_WORKBENCH_PREVIEW_OPEN !== "1" && <button onClick={signOut}>Sign out</button>}
        </div>
      </header>
      <nav className="pr-modules" aria-label="Portfolio research modules">
        {modules.map((m, i) => (
          <button
            key={m.id}
            onClick={() => setModule(m.id)}
            aria-current={module === m.id ? "page" : undefined}
          >
            <span className="pr-module-order">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{m.label}</span>
            <small>{m.id === "capital" ? "Active" : "Coming"}</small>
          </button>
        ))}
      </nav>
      <div className="pr-boundaries">
        <span>Research only</span>
        <span>Temporary storage</span>
        <span>Data vintage not independently verified</span>
      </div>
      {children}
      <footer className="pr-footer">
        <span>Interactive research · No trading or capital authorization</span>
        <details>
          <summary>Contract boundaries</summary>
          <p>
            RESEARCH_ONLY · TEMPORARY_RESEARCH_STORAGE ·
            PIT_MECHANICS_ENFORCED_DATA_VINTAGE_UNVERIFIED
          </p>
        </details>
      </footer>
    </div>
  );
}
export function ProgressPanel({
  progress,
  status,
}: {
  progress: Detail["progress"];
  status: string;
}) {
  return (
    <section className="pr-progress" aria-live="polite">
      <div className="pr-section-title">
        <h3>{status === "PENDING" ? "Queued" : "Running backtest"}</h3>
        <strong>
          {progress ? number(progress.percent_complete, 1) + "%" : "Preparing…"}
        </strong>
      </div>
      {progress && (
        <>
          <div
            className="pr-progress-track"
            role="progressbar"
            aria-label="Actual completed research work"
            aria-valuenow={progress.percent_complete}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div style={{ width: `${progress.percent_complete}%` }} />
          </div>
          <div className="pr-progress-grid">
            <span>
              Fold
              <strong>
                {progress.current_fold} / {progress.total_folds}
              </strong>
            </span>
            <span>
              Stage<strong>{progress.stage}</strong>
            </span>
            <span>
              Elapsed<strong>{number(progress.elapsed_ms / 1000, 1)}s</strong>
            </span>
            <span>
              Remaining
              <strong>
                {progress.estimated_remaining_ms === null
                  ? "Estimating…"
                  : "~" +
                    number(progress.estimated_remaining_ms / 1000, 1) +
                    "s"}
              </strong>
            </span>
          </div>
          <small>
            {progress.completed_work_units} / {progress.total_work_units} work
            units · {progress.completed_candidates} /{" "}
            {progress.total_candidates} candidate evaluations · {status}
          </small>
        </>
      )}
    </section>
  );
}
function FoldAudit({ plan }: { plan: Plan }) {
  const earliest = Math.min(
      ...plan.folds.map((f) => Date.parse(f.training_start)),
    ),
    last = Math.max(...plan.folds.map((f) => Date.parse(f.oos_end_exclusive)));
  const x = (date: string) =>
    145 + (620 * (Date.parse(date) - earliest)) / (last - earliest);
  return (
    <>
      <p>
        Intended boundaries stay anchored to the requested date. Decisions use
        the next observed trading day; fills occur at the next close. Training
        and OOS intervals are end exclusive.
      </p>
      <div className="pr-table-wrap pr-fold-map">
        <svg
          role="img"
          aria-label="Exact anchored walk-forward training and OOS intervals"
          viewBox={`0 0 800 ${plan.folds.length * 25 + 35}`}
          style={{ minWidth: 720, width: "100%" }}
        >
          <text x={145} y={16} fontSize={11} fill="#647682">
            {dateLabel(plan.folds[0].training_start)}
          </text>
          <text x={760} y={16} fontSize={11} textAnchor="end" fill="#647682">
            {dateLabel(plan.folds.at(-1)!.oos_end_exclusive)}
          </text>
          {plan.folds.map((f, i) => (
            <g key={f.fold_id}>
              <text x={8} y={i * 25 + 36} fontSize={11} fill="#425767">
                Period {f.fold_id + 1}
              </text>
              <rect
                x={x(f.training_start)}
                y={i * 25 + 24}
                width={x(f.training_end_exclusive) - x(f.training_start)}
                height={17}
                fill="#c5d3dd"
              />
              <rect
                x={x(f.oos_start)}
                y={i * 25 + 24}
                width={x(f.oos_end_exclusive) - x(f.oos_start)}
                height={17}
                fill="#4e8585"
              />
              <line
                x1={x(f.decision_date)}
                x2={x(f.decision_date)}
                y1={i * 25 + 21}
                y2={i * 25 + 44}
                stroke="#173b54"
              />
            </g>
          ))}
        </svg>
      </div>
      <div className="pr-table-wrap pr-audit-scroll">
        <table>
          <thead>
            <tr>
              {[
                "Fold",
                "Training start",
                "Training end excl.",
                "Cutoff",
                "Decision",
                "OOS start",
                "OOS end excl.",
                "Training obs.",
                "Warmup obs.",
                "OOS obs.",
              ].map((s) => (
                <th key={s}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.folds.map((f) => (
              <tr key={f.fold_id}>
                <td>{f.fold_id + 1}</td>
                {[
                  f.training_start,
                  f.training_end_exclusive,
                  f.information_cutoff,
                  f.decision_date,
                  f.oos_start,
                  f.oos_end_exclusive,
                  f.training_observations,
                  f.warmup_observations,
                  f.oos_observations,
                ].map((x, i) => (
                  <td key={i}>{x}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function Audit({
  caps,
  plan,
  result,
  detail,
}: {
  caps?: Capabilities;
  plan?: Plan;
  result?: Result;
  detail?: Detail;
}) {
  return (
    <section>
      <div className="pr-section-title">
        <h2>Research audit</h2>
        <span>Read-only evidence</span>
      </div>
      <p className="pr-subtle">
        The research design, temporal boundaries and accounting evidence remain
        available here. Interactive runs retain compact evidence; exhaustive
        certification is a future action.
      </p>
      <Technical title="Methodology">
        <p>
          At each rebalance, use prior information, select an exposure policy,
          apply it for the next interval, then advance. Independent sleeves
          start with 100 in cash. Initial implementation is cost charged. The
          recurring-turnover limit is unchanged at 8.
        </p>
        <p>
          Current Regime Score is a deterministic baseline rule, not an HMM,
          Markov model or machine-learning classifier.
        </p>
        <p>
          Matched beta is retrospective. Timing residual does not establish
          alpha.
        </p>
        <p>
          Interactive execution reuses immutable prepared calculations and
          retains compact evidence. Stateless fits do not materialize fit
          artifacts; full candidate ledgers are materialized only by the
          certification reference in acceptance tests.
        </p>
        {result && (
          <pre>{JSON.stringify(result.benchmark_metrics, null, 2)}</pre>
        )}
      </Technical>
      <Technical title="Walk-Forward Folds">
        {plan ? (
          <FoldAudit plan={plan} />
        ) : (
          <p>Run a validated design to inspect its exact folds here.</p>
        )}
      </Technical>
      <Technical title="Model Definition">
        <pre>{JSON.stringify(caps?.model_definition ?? {}, null, 2)}</pre>
      </Technical>
      <Technical title="Candidate Selection">
        <pre>
          {JSON.stringify(result?.selected_policy_by_fold ?? [], null, 2)}
        </pre>
      </Technical>
      <Technical title="Execution Evidence">
        {detail ? (
          <>
            <dl>
              <dt>Experiment identity</dt>
              <dd>{detail.run_id}</dd>
            </dl>
            <pre>{JSON.stringify(detail.spec, null, 2)}</pre>
            <div className="pr-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Attempt</th>
                    <th>Status</th>
                    <th>Requested</th>
                    <th>Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.attempt_history.map((a) => (
                    <tr key={a.attempt.execution_attempt_id}>
                      <td>{a.attempt.execution_attempt_id}</td>
                      <td>
                        {a.status}
                        {a.attempt.execution_attempt_id ===
                        result?.execution_attempt_id
                          ? " · latest successful"
                          : ""}
                      </td>
                      <td>{a.attempt.requested_at}</td>
                      <td>{a.completed_at ?? "In progress"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>No attempt selected.</p>
        )}
      </Technical>
      <Technical title="PIT / Data Provenance">
        <p>
          Information cutoffs are enforced mechanically. Historical data
          vintages have not been independently verified.
        </p>
        <pre>
          {JSON.stringify(
            result?.provenance ?? {
              data_range: [
                caps?.data_first_observation,
                caps?.data_last_observation,
              ],
            },
            null,
            2,
          )}
        </pre>
      </Technical>
      <Technical title="Hashes / Reproducibility">
        <pre>
          {JSON.stringify(
            result
              ? Object.fromEntries(
                  Object.entries(result).filter(
                    ([k]) =>
                      k.endsWith("_hash") ||
                      k === "benchmark_methodology_version",
                  ),
                )
              : {},
            null,
            2,
          )}
        </pre>
      </Technical>
      <Technical title="Diagnostics">
        <pre>
          {JSON.stringify(
            {
              warnings: result?.warnings ?? plan?.warnings ?? [],
              matched_beta:
                result?.matched_beta_diagnostic ?? "Not yet calculated",
              runtime: result?.execution_profile ?? "Not yet executed",
              capacity: caps?.resource_limits,
            },
            null,
            2,
          )}
        </pre>
      </Technical>
    </section>
  );
}
function Workspace({ token, signOut }: { token: string; signOut: () => void }) {
  const client = useMemo(() => new ResearchClient(token), [token]),
    cache = useQueryClient();
  const [module, setModule] = useState("capital"),
    [tab, setTab] = useState<Tab>("Setup"),
    [form, setForm] = useState(blankDesign),
    [runId, setRunId] = useState<string>(),
    [pendingAttempt, setPendingAttempt] = useState<string>(),
    [submitted, setSubmitted] = useState<{
      run_id: string;
      execution_attempt_id: string;
      status: string;
    }>(),
    [plan, setPlan] = useState<Plan>(),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [comparison, setComparison] = useState<Comparison>(),
    [pollUntil, setPollUntil] = useState(0),
    [names, setNames] = useState<Record<string, string>>(() => {
      try {
        return JSON.parse(
          sessionStorage.getItem("allocationlab-research-labels") ?? "{}",
        );
      } catch {
        return {};
      }
    });
  const capabilities = useQuery({
    queryKey: ["research", "capabilities", token],
    queryFn: () => client.capabilities(),
    retry: false,
  });
  const caps = capabilities.data,
    request = useMemo(
      () => (caps ? readDesign(form, caps) : null),
      [form, caps],
    );
  const detail = useQuery({
    queryKey: ["research", "run", runId, token],
    queryFn: () => client.get(runId!),
    enabled: !!runId,
    refetchInterval: (q) =>
      !terminal(q.state.data?.latest_status) && Date.now() < pollUntil
        ? 250
        : false,
    retry: false,
  });
  const history = useQuery({
    queryKey: ["research", "history", token],
    queryFn: () => client.list(),
    enabled: !!caps,
    retry: false,
  });
  const result = getSuccess(detail.data),
    activeAttemptMatches =
      !pendingAttempt ||
      detail.data?.latest_attempt?.attempt.execution_attempt_id ===
        pendingAttempt;
  const status = activeAttemptMatches
    ? (detail.data?.latest_status ??
      (submitted && submitted.run_id === runId ? submitted.status : undefined))
    : submitted && submitted.run_id === runId
      ? submitted.status
      : undefined;
  const activeProgress = activeAttemptMatches
    ? (detail.data?.progress ?? null)
    : null;
  const running = !!runId && !terminal(status) && Date.now() < pollUntil;
  const name = useCallback(
    (id: string) => {
      if (names[id]) return names[id];
      const r = history.data?.runs.find((r) => r.run_id === id);
      return r
        ? `${r.spec.window_type === "ROLLING" ? "Rolling" : "Expanding"} ${r.spec.training_window_months}m · ${r.spec.rebalance_frequency.toLowerCase()} · ${r.spec.transaction_cost_bps} bps`
        : "Research run";
    },
    [names, history.data],
  );
  useEffect(() => {
    if (!request) {
      setPlan(undefined);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      client
        .plan(request)
        .then((p) => {
          if (current) {
            setPlan(p);
            setError(undefined);
          }
        })
        .catch((e) => {
          if (current) {
            setPlan(undefined);
            setError(e);
          }
        });
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [request, client]);
  useEffect(() => {
    if (
      !detail.data ||
      !terminal(detail.data.latest_status) ||
      !pendingAttempt ||
      detail.data.latest_attempt?.attempt.execution_attempt_id !==
        pendingAttempt
    )
      return;
    setPendingAttempt(undefined);
    cache.invalidateQueries({ queryKey: ["research", "history", token] });
    if (detail.data.latest_status === "SUCCESS") {
      const good = getSuccess(detail.data);
      if (
        good &&
        plan &&
        JSON.stringify(good.plan.normalized_request) ===
          JSON.stringify(plan.normalized_request) &&
        good.plan.plan_hash !== plan.plan_hash
      ) {
        setError(
          new ResearchApiError(
            502,
            "PLAN_EXECUTION_MISMATCH",
            "The executed calendar differs from the validated design. Results are withheld.",
          ),
        );
        return;
      }
      setTab("Results");
    } else {
      setTab("Results");
    }
  }, [
    detail.data?.latest_attempt?.attempt.execution_attempt_id,
    status,
    pendingAttempt,
  ]);
  useEffect(() => {
    const e = capabilities.error ?? detail.error;
    if (e instanceof ResearchApiError && e.status === 401) {
      setError(e);
    }
  }, [capabilities.error, detail.error]);
  const setField = (k: keyof FormDesign, v: string) => {
    setForm((old) => ({ ...old, [k]: v }));
    setPlan(undefined);
    setError(undefined);
    setNotice("");
  };
  const launch = useMutation({
    mutationFn: async (kind: "submit" | "rerun") => {
      setError(undefined);
      setNotice("");
      let receipt;
      if (kind === "rerun") {
        if (!runId) throw new Error("Open an experiment first.");
        receipt = await client.rerun(runId);
      } else {
        if (!request) throw new Error("Complete every research field.");
        const exact = await client.plan(request);
        setPlan(exact);
        receipt = await client.submit(exact.normalized_request);
      }
      setSubmitted(receipt);
      setPendingAttempt(
        receipt.status === "SUCCESS" ? undefined : receipt.execution_attempt_id,
      );
      setTab(receipt.status === "SUCCESS" ? "Results" : "Setup");
      setRunId(receipt.run_id);
      setPollUntil(
        receipt.status === "SUCCESS"
          ? 0
          : Date.now() + (caps?.resource_limits.timeout_ms ?? 120000) + 15000,
      );
      await cache.invalidateQueries({
        queryKey: ["research", "run", receipt.run_id, token],
      });
      await cache.invalidateQueries({
        queryKey: ["research", "history", token],
      });
      if (receipt.reused_existing_attempt)
        setNotice(
          "This configuration already exists. Its immutable attempt was reused; no duplicate calculation was started.",
        );
      return receipt;
    },
    onError: (e) => setError(e),
  });
  const compare = useMutation({
    mutationFn: async () => {
      setError(undefined);
      setComparison(await client.compare(selected));
      setTab("Compare");
    },
    onError: (e) => setError(e),
  });
  const sameVisibleDesign =
    !!request &&
    !!detail.data &&
    caps?.code_version === detail.data.spec.code_version &&
    Object.entries(request).every(
      ([field, value]) => (detail.data!.spec as any)[field] === value,
    );
  const failed =
    detail.data &&
    ["FAILED", "BLOCKED"].includes(status ?? "") &&
    (tab === "Results" ||
      tab === "Audit" ||
      (tab === "Setup" && sameVisibleDesign))
      ? detail.data.latest_result
      : null;
  const row = history.data?.runs.find((r) => r.run_id === runId);
  const rename = (value: string) => {
    if (!runId) return;
    const next = { ...names, [runId]: value.slice(0, 80) };
    setNames(next);
    sessionStorage.setItem(
      "allocationlab-research-labels",
      JSON.stringify(next),
    );
  };
  const open = (id: string) => {
    setRunId(id);
    setPollUntil(
      Date.now() + (caps?.resource_limits.timeout_ms ?? 120000) + 15000,
    );
    setTab("Results");
    setError(undefined);
  };
  const duplicate = (s: RequestSpec) => {
    setForm(duplicateDesign(s));
    setPlan(undefined);
    setTab("Setup");
    setNotice(
      "Configuration copied explicitly. Review your inputs, then run a new experiment.",
    );
    setError(undefined);
  };
  const select = (id: string) =>
    setSelected((v) =>
      v.includes(id) ? v.filter((x) => x !== id) : [...v, id],
    );
  const isMismatch = (error as any)?.code === "PLAN_EXECUTION_MISMATCH";
  return (
    <PlatformShell signOut={signOut} module={module} setModule={setModule}>
      {module !== "capital" ? (
        <main className="pr-main pr-module-empty">
          <span className="pr-eyebrow">
            Portfolio construction ·{" "}
            {modules.find((x) => x.id === module)?.label}
          </span>
          <h1>Module not yet enabled</h1>
          <p>{modules.find((x) => x.id === module)?.description}</p>
          <span className="pr-tag">Coming · No executable functionality</span>
        </main>
      ) : (
        <main className="pr-main">
          <div className="pr-page-title">
            <div>
              <p className="pr-eyebrow">
                Portfolio construction / Capital exposure
              </p>
              <h1>Capital Exposure</h1>
              <p>
                Test dynamic SPY / cash exposure against passive and
                matched-beta controls.
              </p>
            </div>
            <span className="pr-active-badge">Active research module</span>
          </div>
          <nav className="pr-tabs" aria-label="Capital Exposure workspace">
            {CAPITAL_TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-current={tab === t ? "page" : undefined}
              >
                {t}
                {t === "Runs" && history.data
                  ? " · " + history.data.runs.length
                  : ""}
              </button>
            ))}
          </nav>
          {!!runId && !terminal(status) && !running && (
            <p className="pr-notice">
              Automatic polling paused at the UI time bound. No new attempt was
              started.{" "}
              <button
                onClick={() => {
                  setPollUntil(
                    Date.now() +
                      (caps?.resource_limits.timeout_ms ?? 120000) +
                      15000,
                  );
                  detail.refetch();
                }}
              >
                Refresh status
              </button>
            </p>
          )}
          {running && (
            <ProgressPanel
              progress={activeProgress}
              status={status ?? "PENDING"}
            />
          )}
          {(error || capabilities.error || detail.error) && (
            <ErrorMessage
              error={error ?? capabilities.error ?? detail.error}
              refresh={() => {
                if (runId) detail.refetch();
                else capabilities.refetch();
                history.refetch();
              }}
            />
          )}
          {!!failed && (
            <ErrorMessage error={failed} refresh={() => detail.refetch()} />
          )}
          {notice && (
            <p className="pr-notice" role="status">
              {notice}
            </p>
          )}
          {tab === "Setup" && running && detail.data && (
            <section className="pr-current-design">
              <h2>Current research design</h2>
              <dl>
                <dt>Model</dt>
                <dd>Current Regime Score — baseline</dd>
                <dt>Backtest period</dt>
                <dd>
                  {dateLabel(detail.data.spec.evaluation_start)} –{" "}
                  {dateLabel(detail.data.spec.evaluation_end_exclusive)}{" "}
                  exclusive
                </dd>
                <dt>Training</dt>
                <dd>
                  {detail.data.spec.training_window_months} months ·{" "}
                  {detail.data.spec.window_type.toLowerCase()}
                </dd>
                <dt>Rebalance</dt>
                <dd>{detail.data.spec.rebalance_frequency.toLowerCase()}</dd>
                <dt>Trading costs</dt>
                <dd>{detail.data.spec.transaction_cost_bps} bps</dd>
              </dl>
              <p className="pr-subtle">
                The worker is executing this submitted design. No new attempt
                starts automatically.
              </p>
            </section>
          )}
          {tab === "Setup" && !running && (
            <>
              {!caps ? (
                <p className="pr-empty">
                  Loading verified research capabilities…
                </p>
              ) : (
                <div className="pr-setup-grid">
                  <section>
                    <div className="pr-section-title">
                      <h2>Research design</h2>
                      <span>
                        Data: {dataMonth(caps.data_first_observation)} –{" "}
                        {dataMonth(caps.data_last_observation)}
                      </span>
                    </div>
                    <form
                      onSubmit={(e: FormEvent) => {
                        e.preventDefault();
                        launch.mutate("submit");
                      }}
                      className="pr-form"
                    >
                      <fieldset>
                        <legend>Backtest Period</legend>
                        <div className="pr-field-pair">
                          <label>
                            From
                            <input
                              aria-label="From"
                              type="date"
                              value={form.from}
                              min={caps.data_first_observation}
                              max={caps.supported_evaluation_end_max}
                              onChange={(e) => setField("from", e.target.value)}
                              required
                            />
                          </label>
                          <label>
                            To
                            <input
                              aria-label="To"
                              type="date"
                              value={form.to}
                              min={caps.data_first_observation}
                              max={caps.supported_evaluation_end_max}
                              onChange={(e) => setField("to", e.target.value)}
                              required
                            />
                          </label>
                        </div>
                        <p className="pr-field-help">
                          To is exclusive. Rebalances stay anchored to From;
                          non-trading dates use the next observed trading day.
                        </p>
                      </fieldset>
                      <fieldset>
                        <legend>Walk-Forward</legend>
                        <div className="pr-field-pair">
                          <label>
                            Training window <span>months</span>
                            <input
                              aria-label="Training window"
                              type="number"
                              min={caps.training_window_rules.minimum_months}
                              max={caps.training_window_rules.maximum_months}
                              step="1"
                              value={form.training}
                              onChange={(e) =>
                                setField("training", e.target.value)
                              }
                              required
                            />
                          </label>
                          <label>
                            Type
                            <select
                              aria-label="Walk-forward type"
                              value={form.window}
                              onChange={(e) =>
                                setField("window", e.target.value)
                              }
                              required
                            >
                              <option value="">Choose type</option>
                              {caps.supported_window_types.map((x) => (
                                <option value={x} key={x}>
                                  {x === "ROLLING" ? "Rolling" : "Expanding"}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="pr-field-pair">
                          <label>
                            Rebalance
                            <select
                              aria-label="Rebalance"
                              value={form.rebalance}
                              onChange={(e) =>
                                setField("rebalance", e.target.value)
                              }
                              required
                            >
                              <option value="">Choose cadence</option>
                              {caps.supported_rebalance_frequencies.map((x) => (
                                <option value={x} key={x}>
                                  {x === "MONTHLY" ? "Monthly" : "Quarterly"}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Trading costs <span>bps</span>
                            <input
                              aria-label="Trading costs"
                              type="number"
                              min={caps.cost_rules.minimum}
                              step="any"
                              value={form.cost}
                              onChange={(e) => setField("cost", e.target.value)}
                              required
                            />
                          </label>
                        </div>
                      </fieldset>
                      <Technical title="Advanced">
                        <p>
                          Trading costs apply equally to candidate ranking and
                          OOS evaluation. The API preserves their separate
                          meanings.
                        </p>
                        <p>
                          No financial defaults are inserted. Training precedes
                          the backtest period. A final partial period is
                          permitted when it contains enough observations.
                        </p>
                        <p>
                          Current execution capacity:{" "}
                          {number(caps.resource_limits.max_jobs, 0)} planned
                          work units ·{" "}
                          {number(caps.resource_limits.timeout_ms / 1000, 0)}s
                          worker timeout. Capacity is independent of financial
                          validity.
                        </p>
                      </Technical>
                      <div className="pr-action-row">
                        <button
                          className="pr-primary"
                          disabled={
                            !request || launch.isPending || running || !!error
                          }
                        >
                          {launch.isPending
                            ? "Validating design…"
                            : "RUN BACKTEST"}
                        </button>
                        {plan && (
                          <span className="pr-validation-note">
                            ✓ Design validated · {plan.number_of_folds} periods
                          </span>
                        )}
                      </div>
                    </form>
                  </section>
                  <aside className="pr-context">
                    <h2>Capital exposure layer</h2>
                    <dl>
                      <dt>Model</dt>
                      <dd>Current Regime Score — baseline</dd>
                      <dt>Decision</dt>
                      <dd>Dynamic SPY / cash exposure</dd>
                    </dl>
                    <p>
                      This stage tests SPY versus cash exposure. It does not
                      allocate capital among ETFs.
                    </p>
                    <button
                      className="pr-text-button"
                      onClick={() => setTab("Audit")}
                    >
                      View methodology →
                    </button>
                  </aside>
                </div>
              )}
            </>
          )}
          {tab === "Results" && (
            <>
              {result && !isMismatch ? (
                <>
                  <div className="pr-run-toolbar">
                    <label>
                      Run name
                      <input
                        aria-label="Run name"
                        maxLength={80}
                        value={names[result.run_id] ?? ""}
                        placeholder={name(result.run_id)}
                        onChange={(e) => rename(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={running || launch.isPending}
                      onClick={() => launch.mutate("rerun")}
                    >
                      Rerun same design
                    </button>
                    <button onClick={() => duplicate(detail.data!.spec)}>
                      Duplicate configuration
                    </button>
                    <button onClick={() => setTab("Audit")}>Audit</button>
                  </div>
                  {status !== "SUCCESS" && (
                    <p className="pr-inline-warning">
                      Showing an earlier successful attempt. The latest attempt
                      is {status?.toLowerCase()}; its failure remains visible
                      above and in Audit.
                    </p>
                  )}
                  <p className="pr-result-context">
                    {dateLabel(result.plan.normalized_request.evaluation_start)}{" "}
                    –{" "}
                    {dateLabel(
                      result.plan.normalized_request.evaluation_end_exclusive,
                    )}{" "}
                    exclusive ·{" "}
                    {result.plan.normalized_request.window_type.toLowerCase()} ·{" "}
                    {result.plan.normalized_request.training_window_months}m
                    training ·{" "}
                    {result.plan.normalized_request.rebalance_frequency.toLowerCase()}{" "}
                    · {result.plan.normalized_request.transaction_cost_bps} bps
                  </p>
                  <ResearchResults result={result} />
                  <div className="pr-attempt-strip">
                    {detail.data?.attempt_history.length} immutable attempt
                    {detail.data?.attempt_history.length === 1 ? "" : "s"}{" "}
                    retained.{" "}
                    <button onClick={() => setTab("Audit")}>
                      Inspect attempts
                    </button>
                    <button
                      disabled
                      title="Exhaustive certification is not implemented in this version"
                    >
                      Certify run · Coming
                    </button>
                  </div>
                </>
              ) : (
                !running && (
                  <section
                    className={
                      detail.data?.latest_attempt
                        ? "pr-run-toolbar"
                        : "pr-empty"
                    }
                  >
                    {detail.data?.latest_attempt ? (
                      <>
                        <button
                          disabled={launch.isPending || isMismatch}
                          onClick={() => launch.mutate("rerun")}
                        >
                          Rerun same design
                        </button>
                        <button onClick={() => duplicate(detail.data!.spec)}>
                          Duplicate configuration
                        </button>
                        <button onClick={() => setTab("Audit")}>
                          Inspect attempt evidence
                        </button>
                      </>
                    ) : (
                      <>
                        <h2>No result selected</h2>
                        <p>
                          Run a research design or open a completed experiment
                          from temporary history.
                        </p>
                        <button onClick={() => setTab("Setup")}>
                          Configure backtest
                        </button>
                      </>
                    )}
                  </section>
                )
              )}
            </>
          )}
          {tab === "Runs" && (
            <section>
              <div className="pr-section-title">
                <div>
                  <h2>Temporary research history</h2>
                  <p>
                    Results may disappear when the preview service restarts.
                    Labels stay in this browser tab.
                  </p>
                </div>
                <button
                  className="pr-primary"
                  disabled={selected.length < 2 || compare.isPending}
                  onClick={() => compare.mutate()}
                >
                  Compare selected ({selected.length})
                </button>
              </div>
              <div className="pr-table-wrap">
                <table className="pr-history">
                  <thead>
                    <tr>
                      {[
                        "Select",
                        "Run name / model",
                        "Backtest period",
                        "Training",
                        "Rebalance",
                        "Costs",
                        "Status",
                        "CAGR",
                        "Sharpe",
                        "Max DD",
                        "Created",
                        "Actions",
                      ].map((x) => (
                        <th key={x}>{x}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.data?.runs.map((r) => (
                      <tr key={r.run_id} data-run-id={r.run_id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={"Compare " + name(r.run_id)}
                            checked={selected.includes(r.run_id)}
                            disabled={typeof r.metrics === "string"}
                            onChange={() => select(r.run_id)}
                          />
                        </td>
                        <td>
                          <strong>{name(r.run_id)}</strong>
                          <small>Current Regime Score</small>
                        </td>
                        <td>
                          {r.spec.evaluation_start}
                          <small>
                            to {r.spec.evaluation_end_exclusive} excl.
                          </small>
                        </td>
                        <td>
                          {r.spec.training_window_months}m{" "}
                          {r.spec.window_type.toLowerCase()}
                        </td>
                        <td>{r.spec.rebalance_frequency.toLowerCase()}</td>
                        <td>{r.spec.transaction_cost_bps} bps</td>
                        <td>
                          <span className="pr-status">
                            {r.status?.toLowerCase()}
                          </span>
                          {r.status !== "SUCCESS" &&
                            typeof r.metrics !== "string" && (
                              <small>Metrics: earlier success</small>
                            )}
                        </td>
                        <td>
                          {typeof r.metrics === "string"
                            ? "—"
                            : percent(r.metrics.cagr)}
                        </td>
                        <td>
                          {typeof r.metrics === "string"
                            ? "—"
                            : number(r.metrics.net_sharpe)}
                        </td>
                        <td>
                          {typeof r.metrics === "string"
                            ? "—"
                            : percent(r.metrics.max_drawdown)}
                        </td>
                        <td>{new Date(r.created_at).toLocaleString()}</td>
                        <td>
                          <div className="pr-row-actions">
                            <button onClick={() => open(r.run_id)}>Open</button>
                            <button onClick={() => duplicate(r.spec)}>
                              Duplicate
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!history.data?.runs.length && (
                  <p className="pr-empty">
                    No interactive experiments yet. Configure your first
                    backtest in Setup.
                  </p>
                )}
              </div>
            </section>
          )}
          {tab === "Compare" && (
            <>
              {comparison ? (
                <CompareResults comparison={comparison} name={name} />
              ) : (
                <section className="pr-empty">
                  <h2>Compare completed designs</h2>
                  <p>
                    Select two or more successful runs from temporary research
                    history. Compare curves, performance and configuration
                    without recalculation.
                  </p>
                  <button onClick={() => setTab("Runs")}>Select runs</button>
                </section>
              )}
              <div className="pr-action-row">
                <button onClick={() => setTab("Runs")}>Change selection</button>
                {selected.length >= 2 && (
                  <button
                    onClick={() => compare.mutate()}
                    disabled={compare.isPending}
                  >
                    Refresh comparison ({selected.length})
                  </button>
                )}
              </div>
            </>
          )}
          {tab === "Audit" && (
            <Audit
              caps={caps}
              plan={result?.plan ?? plan}
              result={result}
              detail={detail.data}
            />
          )}
        </main>
      )}
    </PlatformShell>
  );
}
export default function ResearchWorkbench() {
  const openPreview = import.meta.env?.VITE_WORKBENCH_PREVIEW_OPEN === "1";
  const [token, setToken] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (sessionStorage.getItem(WORKBENCH_SESSION_TOKEN_KEY) ?? ""),
  );
  const cache = useQueryClient();
  const signOut = () => {
    sessionStorage.removeItem(WORKBENCH_SESSION_TOKEN_KEY);
    cache.removeQueries({ queryKey: ["research"] });
    setToken("");
  };
  return openPreview || token ? (
    <Workspace token={openPreview ? "open-preview" : token} signOut={signOut} />
  ) : (
    <Access accept={setToken} />
  );
}
