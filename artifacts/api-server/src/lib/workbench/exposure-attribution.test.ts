import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import apiApp from "../../app";
import { BETA_MATCH_TOLERANCE } from "./exposure-controls";

const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
test(
  "B3C real empirical API: immutable dynamics, four aligned controls, beta matching, attribution and deterministic reruns",
  {
    skip: process.env.WORKBENCH_B3C_ACCEPTANCE !== "1",
    timeout: 12 * 60000,
  },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "allocationlab-b3c-acceptance-"));
    const oldRoot = process.env.WORKBENCH_RUN_DIR,
      oldToken = process.env.WORKBENCH_PREVIEW_TOKEN;
    process.env.WORKBENCH_RUN_DIR = root;
    process.env.WORKBENCH_PREVIEW_TOKEN = "b3c-injected-acceptance-token";
    const server = apiApp.listen(0);
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as any).port}/api/workbench`;
    t.after(async () => {
      await new Promise<void>((r) => server.close(() => r()));
      if (oldRoot === undefined) delete process.env.WORKBENCH_RUN_DIR;
      else process.env.WORKBENCH_RUN_DIR = oldRoot;
      if (oldToken === undefined) delete process.env.WORKBENCH_PREVIEW_TOKEN;
      else process.env.WORKBENCH_PREVIEW_TOKEN = oldToken;
      // Keep successful temporary empirical evidence inspectable for this task.
    });
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: "Bearer b3c-injected-acceptance-token",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value = (await response.json()) as any;
      assert.ok(response.ok, JSON.stringify(value));
      return value;
    };
    const terminal = async (id: string) => {
      const end = Date.now() + 180000;
      while (Date.now() < end) {
        const d = await request(`/runs/${id}`);
        if (["SUCCESS", "FAILED", "BLOCKED"].includes(d.latest_status))
          return d;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("Empirical attempt timed out");
    };
    const cap = await request("/capabilities");
    assert.equal(cap.model_definition.name, "Current Regime Score — baseline");
    assert.equal(cap.model_definition.components.length, 10);
    assert.equal(
      cap.benchmark_methodology_version,
      "capital-exposure-controls-1.0.0",
    );
    const certified = JSON.parse(
      await readFile(
        "reports/workbench01/phase-b3b/api-integration.json",
        "utf8",
      ),
    );
    const evidence: unknown[] = [];
    for (const old of certified.matrix) {
      const plan = await request("/plan", old.spec),
        receipt = await request("/runs", old.spec);
      const detail = await terminal(receipt.run_id);
      assert.equal(detail.latest_status, "SUCCESS");
      const r = detail.latest_successful_result;
      assert.equal(
        r.attribution.status,
        "AVAILABLE",
        JSON.stringify(r.attribution),
      );
      assert.deepEqual(r.metrics, old.metrics);
      assert.deepEqual(r.costs, old.costs);
      assert.equal(r.financial_result_hash, old.financial_result_hash);
      assert.equal(receipt.run_id, old.run_id);
      assert.deepEqual(r.validation_diagnostics.exact_fold_plan, plan.folds);
      const tracks = Object.values(r.benchmark_tracks) as any[];
      const dates = r.time_series.points.map((p: any) => p.date);
      for (const track of tracks) {
        assert.deepEqual(
          track.points.map((p: any) => p.date),
          dates,
        );
        assert.deepEqual(track.fold_boundaries, plan.folds);
      }
      assert.equal(r.matched_beta_diagnostic.status, "MATCHED");
      assert.ok(
        Math.abs(r.matched_beta_diagnostic.remaining_beta_difference) <=
          BETA_MATCH_TOLERANCE,
      );
      const a = r.attribution.values;
      assert.ok(
        Math.abs(
          a.total_dynamic_effect_cagr_difference -
            a.exposure_level_effect_cagr_difference -
            a.timing_residual_cagr_difference,
        ) < 1e-12,
      );
      assert.ok(
        Math.abs(
          a.total_dynamic_effect_total_return_difference -
            a.exposure_level_effect_total_return_difference -
            a.timing_residual_total_return_difference,
        ) < 1e-12,
      );
      assert.equal(r.attribution.alpha_claim, "NONE");
      assert.ok(
        r.selected_policy_by_fold.every(
          (p: any) =>
            p.information_cutoff < p.decision_date &&
            typeof p.training_net_sharpe === "number",
        ),
      );
      const file = join(
        root,
        "runs",
        receipt.run_id,
        "attempts",
        receipt.execution_attempt_id,
        "result.json",
      );
      const before = digest(await readFile(file));
      await request(`/runs/${receipt.run_id}`);
      const after = digest(await readFile(file));
      assert.equal(before, after);
      const raw = JSON.parse((await readFile(file)).toString());
      assert.equal(raw.benchmark_tracks, undefined);
      assert.equal(raw.financial_result_hash, old.financial_result_hash);
      assert.deepEqual(
        r.reproducibility,
        raw.reproducibility,
        "Existing dynamic provenance must not be replaced by benchmark metadata",
      );
      const repeatedReceipt = await request(
          `/runs/${receipt.run_id}/rerun`,
          {},
        ),
        repeated = (await terminal(receipt.run_id)).latest_successful_result;
      assert.notEqual(
        repeatedReceipt.execution_attempt_id,
        receipt.execution_attempt_id,
      );
      assert.equal(repeatedReceipt.run_id, receipt.run_id);
      for (const key of [
        "financial_result_hash",
        "passive_control_hash",
        "matched_beta_control_hash",
        "attribution_hash",
      ])
        assert.equal(repeated[key], r[key], key);
      assert.deepEqual(repeated.benchmark_tracks, r.benchmark_tracks);
      assert.deepEqual(repeated.attribution, r.attribution);
      evidence.push({
        name: old.name,
        request: old.spec,
        standard_mode:
          old.spec.selection_cost_bps === old.spec.transaction_cost_bps,
        compatibility_note:
          "Prior B3A/B3B full specifications are intentionally retained here to prove exact financial regression. The standard UI separately submits equal costs.",
        run_id: receipt.run_id,
        execution_attempt_id: receipt.execution_attempt_id,
        rerun_execution_attempt_id: repeatedReceipt.execution_attempt_id,
        dynamic_metrics: r.metrics,
        dynamic_costs: r.costs,
        dynamic_financial_result_hash: r.financial_result_hash,
        passive_control_hash: r.passive_control_hash,
        matched_beta_control_hash: r.matched_beta_control_hash,
        attribution_hash: r.attribution_hash,
        matched_beta_diagnostic: r.matched_beta_diagnostic,
        benchmark_metrics: r.benchmark_metrics,
        attribution: r.attribution,
        selected_policy_by_fold: r.selected_policy_by_fold,
        dates_aligned: true,
        folds_aligned: true,
        raw_dynamic_result_sha256_before: before,
        raw_dynamic_result_sha256_after: after,
        rerun_all_hashes_identical: true,
        actual_dynamic_recalculation: r.execution,
        original_result_file_unchanged: true,
      });
    }
    await writeFile(
      "/tmp/allocationlab-b3c-empirical-acceptance.json",
      JSON.stringify(
        {
          status: "PASS",
          matrix: evidence,
          empirical_attempts: 8,
          temporary_store: root,
          alpha_claim: "NONE",
        },
        null,
        2,
      ) + "\n",
    );
  },
);
