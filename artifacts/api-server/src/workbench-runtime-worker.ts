import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, isAbsolute, sep } from "node:path";
import { canonicalJson } from "./lib/workbench/identity";
import { PRODUCT_SPEC, legacyTransport, parseProductSubmission } from "./lib/workbench/turnover-product";
import { executeRecurringCampaign } from "./lib/workbench/turnover-execution";

/** Fixed dispatcher: the parent still uses its certified, validated transport.
 * Methodology comes from the already-hashed immutable normalized spec, never
 * from an inferred UI value or a mutable environment setting. */
process.once("message", async (message: unknown) => {
  const send = (value: unknown) => {
    const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > 1024 * 1024) {
      process.send?.({ type: "workbench-capital-error", protocol_version: 1, error_class: "WORKER_RESULT_LIMIT_EXCEEDED",
        safe_message: "The empirical worker result exceeded its bounded response size.", diagnostic: "" }, () => process.disconnect?.());
      return;
    }
    process.send?.(value, () => process.disconnect?.());
  };
  try {
    const v = message as any;
    if (v?.protocol_version === 2 && /^rr_[a-f0-9]{64}$/.test(v.run_id)) {
      const configured = process.env.WORKBENCH_RUN_DIR;
      if (!configured || !isAbsolute(configured)) throw new Error("Invalid storage configuration");
      const root = realpathSync(configured);
      let cursor = root;
      for (const component of ["runs", v.run_id, "normalized-spec.json"]) {
        cursor = resolve(cursor, component);
        if (lstatSync(cursor).isSymbolicLink() || !realpathSync(cursor).startsWith(root + sep)) throw new Error("Unsafe immutable spec path");
      }
      if (lstatSync(cursor).size > 1024 * 1024) throw new Error("Immutable spec exceeds metadata bound");
      const stored = JSON.parse(readFileSync(cursor, "utf8"));
      if (stored.contract_version === PRODUCT_SPEC) {
        const { research_mode, execution_scope, universe, validation_protocol, evaluation_start, evaluation_end_exclusive,
          window_type, training_window_months, rebalance_frequency, transaction_cost_bps, selection_cost_bps,
          contract_version, turnover_constraint_methodology_version } = stored;
        const spec = parseProductSubmission({ research_mode, execution_scope, universe, validation_protocol, evaluation_start, evaluation_end_exclusive,
          window_type, training_window_months, rebalance_frequency, transaction_cost_bps, selection_cost_bps, contract_version, turnover_constraint_methodology_version });
        if (canonicalJson(v.product_spec) !== canonicalJson(legacyTransport(spec)) || Object.keys(v).sort().join("|") !== "execution_attempt_id|product_spec|protocol_version|run_id|transaction_cost_bps|type" ||
            v.type !== "execute-workbench-capital" || v.transaction_cost_bps !== spec.transaction_cost_bps ||
            !/^ea_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.execution_attempt_id)) throw new Error("Product worker transport mismatch");
        const evidence = executeRecurringCampaign({ ...v, protocol_version: 3, product_spec: spec });
        // Explicit compatibility envelope for the immutable parent transport.
        // The service verifies and restores the financial adapter identity.
        send({ type: "workbench-capital-result", protocol_version: 1, result: { ...evidence,
          product_adapter_version: evidence.adapter_version, adapter_version: "workbench-capital-calendar-2.0.0" } });
        return;
      }
    }
    // The legacy worker remains byte-identical and receives the original message.
    await import("./workbench-run-worker");
    process.emit("message", message as any);
  } catch (error) {
    send({ type: "workbench-capital-error", protocol_version: 1, error_class: "CAPITAL_ENGINE_EXECUTION_FAILED",
      safe_message: "The committed capital research engine could not complete this attempt.",
      diagnostic: Buffer.from(error instanceof Error ? error.stack ?? error.message : String(error)).subarray(0, 65536).toString("utf8") });
  }
});
