import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { pool } from "@workspace/db";
import { canonicalJson } from "./identity";
import { sha256, CalendarContractError } from "./calendar-v2";
import {
  WorkbenchRunStore, WorkbenchRunStoreError, DEFAULT_STORE_LIMITS,
  WORKBENCH_RUN_ID_PATTERN, WORKBENCH_ATTEMPT_ID_PATTERN,
  type StoredRunView, type StoredRunRecord, type AttemptView, type AttemptRef,
  type ExecutionLeaseRecord, type WorkbenchRunStoreLimits,
} from "./run-store";

export const DURABLE_RESEARCH = "PERSISTENT_POSTGRES_RESEARCH_STORAGE";
const digest = (v: unknown) => sha256(canonicalJson(v));
const fail = (code: string, message: string): never => { throw new WorkbenchRunStoreError(code, message); };
const missing = (e: unknown) => e instanceof WorkbenchRunStoreError && ["RUN_NOT_FOUND", "ATTEMPT_NOT_FOUND"].includes(e.code);
const cleanJson = (v: unknown) => JSON.parse(JSON.stringify(v));

/** PostgreSQL is authoritative for new P0 research. Filesystem records remain read-only.
 * No startup DDL, automatic financial replay, lease expiry takeover or source fallback.
 */
export class DurableResearchStore {
  readonly storageStatus = DURABLE_RESEARCH;
  readonly limits: Readonly<WorkbenchRunStoreLimits>;
  private constructor(private legacy: WorkbenchRunStore, private database: typeof pool, limits: Partial<WorkbenchRunStoreLimits>) {
    this.limits = Object.freeze({ ...DEFAULT_STORE_LIMITS, ...limits });
  }
  static async open(options: { limits?: Partial<WorkbenchRunStoreLimits>; legacyRoot?: string; database?: typeof pool } = {}) {
    const legacy = await WorkbenchRunStore.open({ root: options.legacyRoot, limits: options.limits });
    return new DurableResearchStore(legacy, options.database ?? pool, options.limits ?? {});
  }
  private bounded(value: unknown, max = this.limits.maxMetadataBytes) {
    const bytes = Buffer.byteLength(canonicalJson(value));
    if (bytes > max) fail("STORE_RECORD_TOO_LARGE", "Research record exceeds its configured size limit.");
  }
  private runId(id: string) { if (!WORKBENCH_RUN_ID_PATTERN.test(id)) fail("INVALID_RUN_ID", "Invalid research identity."); }
  private ref(ref: AttemptRef) {
    this.runId(ref.runId);
    if (!WORKBENCH_ATTEMPT_ID_PATTERN.test(ref.executionAttemptId)) fail("INVALID_ATTEMPT_ID", "Invalid attempt identity.");
  }
  async withSubmissionLock<T>(operation: () => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query("SELECT pg_advisory_lock(2810202601)");
      return await operation();
    } finally {
      await client.query("SELECT pg_advisory_unlock(2810202601)");
      client.release();
    }
  }
  async ensureRun(id: string, spec: unknown): Promise<StoredRunRecord> {
    this.runId(id); this.bounded(spec);
    const hash = digest(spec), now = new Date().toISOString();
    const record = { run_id: id, created_at: now, normalized_spec_sha256: hash, identity_sha256: id.slice(3), storage_status: DURABLE_RESEARCH };
    await this.database.query("INSERT INTO allocationlab_research_runs(run_id,record,spec,spec_hash,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [id, record, spec, hash, now]);
    const row = (await this.database.query("SELECT record,spec_hash FROM allocationlab_research_runs WHERE run_id=$1", [id])).rows[0];
    if (row.spec_hash !== hash) fail("IMMUTABLE_RUN_CONFLICT", "Research identity already has a different frozen specification.");
    return row.record as StoredRunRecord;
  }
  async getRun(id: string): Promise<StoredRunView> {
    this.runId(id);
    const row = (await this.database.query("SELECT * FROM allocationlab_research_runs WHERE run_id=$1", [id])).rows[0];
    if (!row) return this.legacy.getRun(id);
    if (row.spec_hash !== digest(row.spec)) fail("CORRUPT_STORE_RECORD", "Frozen research specification failed its integrity check.");
    const attempts = (await this.database.query("SELECT view FROM allocationlab_research_attempts WHERE run_id=$1 ORDER BY view->'attempt'->>'requested_at',attempt_id", [id])).rows.map(r => r.view as AttemptView);
    return { run: row.record, normalized_spec: row.spec, attempt_history: attempts, latest_status: attempts.at(-1)?.status ?? null, latest_attempt: attempts.at(-1) ?? null, latest_successful_attempt: [...attempts].reverse().find(a => a.status === "SUCCESS") ?? null };
  }
  async listRuns(): Promise<StoredRunView[]> {
    const rows = await this.database.query("SELECT run_id FROM allocationlab_research_runs ORDER BY created_at DESC,run_id LIMIT $1", [this.limits.maxListResults]);
    const current = await Promise.all(rows.rows.map(r => this.getRun(r.run_id)));
    const historical = await this.legacy.listRuns();
    return [...current, ...historical.filter(r => !current.some(x => x.run.run_id === r.run.run_id))]
      .sort((a, b) => b.run.created_at.localeCompare(a.run.created_at)).slice(0, this.limits.maxListResults);
  }
  /** Explicit archival only: original payloads and their original methodology
   * remain unchanged, with no claim that a newer engine recalculated them. */
  async archiveLegacy() {
    const records = (await this.legacy.listRuns()).filter(r => (r.normalized_spec as any)?.identity_namespace === "allocationlab-persistent-data-1.0.0");
    let archived = 0;
    for (const old of records) {
      const row = await this.database.query("SELECT run_id FROM allocationlab_research_runs WHERE run_id=$1", [old.run.run_id]);
      if (row.rowCount) continue;
      const entries = [];
      for (const view of old.attempt_history) {
        const ref = { runId: old.run.run_id, executionAttemptId: view.attempt.execution_attempt_id };
        let result = null;
        if (["SUCCESS", "FAILED", "BLOCKED"].includes(view.status)) {
          try { result = await this.legacy.readAttemptResult(ref); }
          catch (error) { if (!(error instanceof WorkbenchRunStoreError) || error.code !== "RESULT_NOT_AVAILABLE") throw error; }
        }
        entries.push({ view, result });
      }
      const client = await this.database.connect();
      try {
        await client.query("BEGIN");
        const inserted = await client.query("INSERT INTO allocationlab_research_runs(run_id,record,spec,spec_hash,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [old.run.run_id, old.run, old.normalized_spec, digest(old.normalized_spec), old.run.created_at]);
        if (inserted.rowCount) {
          for (const entry of entries) await client.query("INSERT INTO allocationlab_research_attempts(attempt_id,run_id,view,result,result_hash) VALUES($1,$2,$3,$4,$5)", [entry.view.attempt.execution_attempt_id, old.run.run_id, entry.view, entry.result, entry.result ? digest(entry.result) : null]);
          archived++;
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    }
    return { archived, original_methodology_unchanged: true };
  }
  async createAttempt(id: string, options: { source?: "SUBMIT" | "RERUN" } = {}): Promise<AttemptView> {
    const row = (await this.database.query("SELECT run_id FROM allocationlab_research_runs WHERE run_id=$1", [id])).rows[0];
    if (!row) fail("HISTORICAL_READ_ONLY", "Historical filesystem research is read-only. Duplicate its design to calculate a new version.");
    const n = await this.database.query("SELECT count(*)::int AS n FROM allocationlab_research_attempts WHERE run_id=$1", [id]);
    if (n.rows[0].n >= this.limits.maxListResults) fail("ATTEMPT_LIMIT_REACHED", "Research attempt limit reached.");
    const attempt = { run_id: id, execution_attempt_id: `ea_${randomUUID()}`, source: options.source ?? "SUBMIT", requested_at: new Date().toISOString() };
    const view: AttemptView = { attempt, status: "PENDING", stage: "QUEUED", started_at: null, completed_at: null, terminal: null };
    await this.database.query("INSERT INTO allocationlab_research_attempts(attempt_id,run_id,view) VALUES($1,$2,$3)", [attempt.execution_attempt_id, id, view]);
    return view;
  }
  async getAttempt(ref: AttemptRef): Promise<AttemptView> {
    this.ref(ref);
    const row = (await this.database.query("SELECT view FROM allocationlab_research_attempts WHERE run_id=$1 AND attempt_id=$2", [ref.runId, ref.executionAttemptId])).rows[0];
    return row ? row.view : this.legacy.getAttempt(ref);
  }
  async markRunning(ref: AttemptRef, options: { stage?: string } = {}) {
    const previous = await this.getAttempt(ref);
    if (previous.status === "RUNNING") return previous;
    if (previous.status !== "PENDING") fail("INVALID_STATUS_TRANSITION", "Only pending research may start.");
    const view = { ...previous, status: "RUNNING", stage: options.stage ?? "EXECUTING", started_at: new Date().toISOString() };
    const result = await this.database.query("UPDATE allocationlab_research_attempts SET view=$3 WHERE run_id=$1 AND attempt_id=$2 AND view->>'status'='PENDING'", [ref.runId, ref.executionAttemptId, view]);
    if (!result.rowCount) fail("INVALID_STATUS_TRANSITION", "Attempt changed before execution started.");
    return view as AttemptView;
  }
  private async finish(ref: AttemptRef, status: "SUCCESS" | "FAILED" | "BLOCKED", result: unknown, stage: string, diagnostic: unknown = null) {
    const previous = await this.getAttempt(ref);
    if (!["PENDING", "RUNNING"].includes(previous.status) || (status === "SUCCESS" && previous.status !== "RUNNING"))
      fail("INVALID_STATUS_TRANSITION", "A terminal attempt cannot be replaced.");
    const payload = cleanJson(result); this.bounded(payload);
    if (diagnostic) this.bounded(diagnostic, this.limits.maxLogBytes);
    const now = new Date().toISOString();
    const view = { ...previous, status, stage, completed_at: now, terminal: { at: now, execution_attempt_id: ref.executionAttemptId, run_id: ref.runId, stage, status } };
    const updated = await this.database.query("UPDATE allocationlab_research_attempts SET view=$3,result=$4,result_hash=$5,diagnostic=$6 WHERE run_id=$1 AND attempt_id=$2 AND view->>'status' IN ('PENDING','RUNNING')", [ref.runId, ref.executionAttemptId, view, payload, digest(payload), diagnostic]);
    if (!updated.rowCount) fail("INVALID_STATUS_TRANSITION", "Attempt already terminated.");
    return view as AttemptView;
  }
  completeSuccess(ref: AttemptRef, result: unknown, options: { stage?: string } = {}) { return this.finish(ref, "SUCCESS", result, options.stage ?? "RESULTS_READY"); }
  completeFailure(ref: AttemptRef, options: { errorClass: string; safeMessage: string; result: unknown; diagnostic: unknown; stage: string }) {
    return this.finish(ref, "FAILED", options.result, options.stage, options.diagnostic);
  }
  completeBlocked(ref: AttemptRef, blocker: unknown) { return this.finish(ref, "BLOCKED", { blocker }, "BLOCKED"); }
  async readAttemptResult(ref: AttemptRef): Promise<unknown> {
    this.ref(ref);
    const row = (await this.database.query("SELECT result,result_hash FROM allocationlab_research_attempts WHERE run_id=$1 AND attempt_id=$2", [ref.runId, ref.executionAttemptId])).rows[0];
    if (!row) return this.legacy.readAttemptResult(ref);
    if (row.result === null) fail("RESULT_NOT_AVAILABLE", "No terminal result exists for this attempt.");
    if (digest(row.result) !== row.result_hash) fail("CORRUPT_STORE_RECORD", "Persisted result failed its integrity check.");
    return row.result;
  }
  async readResult(ref: AttemptRef) {
    if ((await this.getAttempt(ref)).status !== "SUCCESS") fail("RESULT_NOT_AVAILABLE", "A successful result is required.");
    return this.readAttemptResult(ref);
  }
  async inspectExecutionLease(): Promise<ExecutionLeaseRecord | null> {
    const row = (await this.database.query("SELECT lease FROM allocationlab_research_leases WHERE name='p0'", [])).rows[0];
    return row?.lease ?? null;
  }
  async acquireExecutionLease(ref: AttemptRef, timeout: number) {
    const lease: ExecutionLeaseRecord = { token: randomUUID(), run_id: ref.runId, execution_attempt_id: ref.executionAttemptId, pid: process.pid, hostname: hostname(), acquired_at: new Date().toISOString(), deadline: new Date(Date.now() + timeout).toISOString() };
    const r = await this.database.query("INSERT INTO allocationlab_research_leases(name,lease) VALUES('p0',$1) ON CONFLICT DO NOTHING", [lease]);
    return { acquired: !!r.rowCount, lease };
  }
  async releaseExecutionLease(token: string) { await this.database.query("DELETE FROM allocationlab_research_leases WHERE name='p0' AND lease->>'token'=$1", [token]); }
  async reviews(id: string) {
    const run = await this.getRun(id);
    const attempt = run.latest_successful_attempt;
    const rows = await this.database.query("SELECT event FROM allocationlab_research_reviews WHERE run_id=$1 ORDER BY created_at,id", [id]);
    const events = rows.rows.map(r => r.event);
    const relevant = events.filter(e => e.execution_attempt_id === attempt?.attempt.execution_attempt_id);
    const result: any = attempt ? await this.readResult({ runId: id, executionAttemptId: attempt.attempt.execution_attempt_id }) : null;
    const blockers: string[] = [];
    if (!attempt || run.latest_status !== "SUCCESS") blockers.push("The latest attempt must be successful.");
    if (result?.storage_policy !== DURABLE_RESEARCH) blockers.push("Historical evidence is not in the durable research contract.");
    if (!result?.accounting?.cash_policy) blockers.push("Explicit cash-policy evidence is missing.");
    if (!result?.validation_evidence?.accounting?.passed) blockers.push("Independent accounting reconciliation is missing or failed.");
    if (result?.research_scope !== "CAPITAL_EXPOSURE" && !result?.quality_gate_evidence?.every_rebalance) blockers.push("Per-rebalance Quality Gate evidence is missing.");
    if (result?.mandate_evidence?.some((e: any) => !e.passed)) blockers.push("Mandate validation failed.");
    return { state: relevant.at(-1)?.decision ?? (attempt ? "CALCULATED" : "DRAFT"), events, approval_blockers: blockers };
  }
  async review(id: string, input: { execution_attempt_id: string; decision: string; actor: string; note: string }) {
    if (!input || Object.keys(input).sort().join() !== ["actor", "decision", "execution_attempt_id", "note"].sort().join() ||
      !["REVIEWED", "APPROVED", "REJECTED"].includes(input.decision) ||
      typeof input.actor !== "string" || !input.actor.trim() || input.actor.length > 120 ||
      typeof input.note !== "string" || !input.note.trim() || input.note.length > 2000)
      throw new CalendarContractError("INVALID_REVIEW", "Provide a decision, declared reviewer and note.", {}, 422);
    return this.withSubmissionLock(async () => {
      const run = await this.getRun(id), latest = run.latest_successful_attempt;
      if (!latest || run.latest_status !== "SUCCESS" || latest.attempt.execution_attempt_id !== input.execution_attempt_id)
        throw new CalendarContractError("STALE_REVIEW", "Review must reference the latest successful attempt. Refresh the result.", {}, 409);
      const before = await this.reviews(id);
      if (input.decision === "APPROVED" && (before.state !== "REVIEWED" || before.approval_blockers.length))
        throw new CalendarContractError("APPROVAL_BLOCKED", "Review the current attempt and resolve all blockers before approval.", { blockers: before.approval_blockers }, 409);
      const result = await this.readResult({ runId: id, executionAttemptId: input.execution_attempt_id });
      const event = { id: randomUUID(), run_id: id, ...input, actor: input.actor.trim(), note: input.note.trim(), result_hash: digest(result), created_at: new Date().toISOString(), actor_type: "DECLARED_NOT_AUTHENTICATED" };
      await this.database.query("INSERT INTO allocationlab_research_reviews(id,run_id,attempt_id,event,created_at) VALUES($1,$2,$3,$4,$5)", [event.id, id, input.execution_attempt_id, event, event.created_at]);
      return this.reviews(id);
    });
  }
}
