import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDatasetV2 } from "./calendar-v2";
import { resolveWorkbenchRepositoryRoot } from "./repository-root";
import { AttributionError } from "./exposure-controls";
const { generateCandidates } =
  require("../../../../../research/capital/spec") as {
    generateCandidates(c: any): {
      candidates: Array<{
        candidate_id: string;
        spec: {
          model_family: string;
          model_parameters: Record<string, number>;
          exposure_policy: string;
          exposure_parameters: Record<string, number>;
        };
      }>;
    };
  };
const { defaultRegistry } =
  require("../../../../../research/capital/registry") as {
    defaultRegistry(): { versions(): unknown };
  };

/** Read-only metadata from the certified source, registry and committed model
 * definition. No weights or thresholds are independently defined in the UI. */
export function exposureModelDefinition(dataset = loadDatasetV2()) {
  const root = resolveWorkbenchRepositoryRoot({ moduleUrl: import.meta.url });
  const text = readFileSync(
    resolve(root, "artifacts/api-server/src/lib/calculator.ts"),
    "utf8",
  );
  const source = text.slice(
    text.indexOf("export function computeRegime("),
    text.indexOf("function insufficientRegime("),
  );
  const literal = source.match(
    /const weightMap: Record<string, number> = (\{[^}]+\})/,
  );
  if (!literal)
    throw new AttributionError(
      "MODEL_METADATA_SOURCE_MISMATCH",
      "The certified model weight definition could not be resolved.",
    );
  const weights = JSON.parse(
    literal[1].replace(/([a-z_]+)\s*:/g, '"$1":'),
  ) as Record<string, number>;
  const components = [
    ...source.matchAll(/\{ key: "([^"]+)", label: "([^"]+)"/g),
  ].map((m) => ({
    key: m[1],
    label: m[2],
    weight: weights[m[1]] ?? 0,
    availability:
      weights[m[1]] === undefined
        ? "UNAVAILABLE_IN_THIS_MODEL"
        : ["trend", "breadth", "volatility", "liquidity"].includes(m[1])
          ? "COMPUTED"
          : "PRICE_PROXY_WHEN_AVAILABLE",
  }));
  const thresholds = [
    ...source.matchAll(/composite >= (\d+)\) label = "([^"]+)"/g),
  ].map((m) => ({ minimum_score: Number(m[1]), label: m[2] }));
  if (
    components.length !== 10 ||
    thresholds.length !== 4 ||
    Object.values(weights).some((v) => !Number.isFinite(v) || v < 0)
  )
    throw new AttributionError(
      "MODEL_METADATA_SOURCE_MISMATCH",
      "The certified regime metadata structure changed.",
    );
  const policies = generateCandidates(dataset.fixture).candidates.map((c) => ({
    policy: c.spec.exposure_policy,
    parameters: c.spec.exposure_parameters,
    information_window_observations: c.spec.model_parameters.lookback_rows,
    description:
      c.spec.exposure_policy === "constant"
        ? `Constant SPY exposure ${c.spec.exposure_parameters.risk}`
        : `Cash band ${c.spec.exposure_parameters.cash_min} to ${c.spec.exposure_parameters.cash_max}`,
  }));
  return {
    name: "Current Regime Score — baseline",
    decision: "Dynamic SPY/cash exposure",
    information_window_observations:
      policies[0].information_window_observations,
    policy_selection: "Walk-forward selection by net Sharpe after costs",
    recalibration: "At every portfolio rebalance",
    output: "Target SPY exposure and cash allocation",
    product_meaning:
      "This stage tests SPY versus cash exposure. It does not allocate capital among ETFs.",
    limitation:
      "This is a deterministic baseline rule. It is not an HMM, Markov-switching model or machine-learning classifier.",
    components,
    score_range: { minimum: 0, maximum: 100 },
    regime_thresholds: [...thresholds, { minimum_score: 0, label: "Risk-Off" }],
    weight_normalization:
      "Available weighted components are normalized by their total weight; unavailable components contribute no weight.",
    cash_exposure_mapping:
      "Within each selected cash band: cash = cash_min + (cash_max - cash_min) × (1 - score / 100), bounded to that band. SPY target = 1 - cash. Constant policies ignore the score and use their fixed exposure.",
    candidate_policy_set: policies,
    fixed_selection_metric: dataset.fixture.selection_metric,
    fixed_model_versions: defaultRegistry().versions(),
    execution:
      "Next observed close after each decision; holdings drift inside a fold. Beginning risky exposure differs from the target exposure.",
    cash_return_convention: dataset.fixture.cash_yield,
    reference_universe: dataset.fixture.reference_universe,
  };
}
