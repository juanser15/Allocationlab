import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod, link, lstat, mkdir, open, readdir, realpath, unlink,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_WORKBENCH_RUN_DIR = join(tmpdir(), "allocationlab-workbench-runs");
export const WORKBENCH_STORAGE_STATUS = "TEMPORARY_RESEARCH_STORAGE" as const;
export const WORKBENCH_RUN_ID_PATTERN = /^rr_[0-9a-f]{64}$/;
export const WORKBENCH_ATTEMPT_ID_PATTERN = /^ea_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface WorkbenchRunStoreLimits {
  maxMetadataBytes: number;
  maxLogBytes: number;
  maxEngineOutputBytes: number;
  maxEngineFiles: number;
  maxListResults: number;
}

export const DEFAULT_STORE_LIMITS: Readonly<WorkbenchRunStoreLimits> = Object.freeze({
  maxMetadataBytes: 1024 * 1024,
  maxLogBytes: 1024 * 1024,
  maxEngineOutputBytes: 64 * 1024 * 1024,
  maxEngineFiles: 512,
  maxListResults: 100,
});

export type WorkbenchRunStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "BLOCKED";
export type AttemptSource = "SUBMIT" | "RERUN";
export type AttemptRef = { runId: string; executionAttemptId: string };

export interface WorkbenchRunStoreOptions {
  root?: string;
  repositoryRoot?: string;
  forbiddenRoots?: string[];
  limits?: Partial<WorkbenchRunStoreLimits>;
}

export interface StoredRunRecord {
  run_id: string;
  created_at: string;
  normalized_spec_sha256: string;
  identity_sha256: string;
  storage_status: typeof WORKBENCH_STORAGE_STATUS;
}

export interface StoredAttemptRecord {
  run_id: string;
  execution_attempt_id: string;
  source: AttemptSource;
  requested_at: string;
}

export interface AttemptStateEvent {
  run_id: string;
  execution_attempt_id: string;
  status: WorkbenchRunStatus;
  stage: string;
  at: string;
  blocker?: unknown;
  error_class?: string;
  error_message?: string;
}

export interface AttemptView {
  attempt: StoredAttemptRecord;
  status: WorkbenchRunStatus;
  stage: string;
  started_at: string | null;
  completed_at: string | null;
  terminal: AttemptStateEvent | null;
}

export interface StoredRunView {
  run: StoredRunRecord;
  normalized_spec: unknown;
  attempt_history: AttemptView[];
  latest_status: WorkbenchRunStatus | null;
  latest_attempt: AttemptView | null;
  latest_successful_attempt: AttemptView | null;
}

export interface EngineArtifactEntry {
  path: string;
  bytes: number;
  sha256: string;
  artifact_class: "FINANCIAL" | "RUNTIME";
}

export interface EngineArtifactManifest {
  run_id: string;
  execution_attempt_id: string;
  storage_status: typeof WORKBENCH_STORAGE_STATUS;
  files: EngineArtifactEntry[];
  file_count: number;
  total_bytes: number;
  financial_result_hash: string;
  runtime_hash: string;
  sealed_at: string;
}

export interface ExecutionLeaseRecord {
  token: string;
  run_id: string;
  execution_attempt_id: string;
  pid: number;
  hostname: string;
  acquired_at: string;
  deadline: string | null;
}

export class WorkbenchRunStoreError extends Error {
  readonly name = "WorkbenchRunStoreError";
  constructor(readonly code: string, message: string, readonly cause?: unknown) {
    super(message);
  }
}

function errno(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code : undefined;
}

function assertJson(value: unknown, path = "$"): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new WorkbenchRunStoreError("INVALID_JSON", `${path} is not finite.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJson(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object")
    throw new WorkbenchRunStoreError("INVALID_JSON", `${path} is not JSON data.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new WorkbenchRunStoreError("INVALID_JSON", `${path} must be a plain JSON object.`);
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) throw new WorkbenchRunStoreError("INVALID_JSON", `${path}.${key} is undefined.`);
    assertJson(entry, `${path}.${key}`);
  }
}

function canonicalJson(value: unknown): string {
  assertJson(value);
  const render = (entry: unknown): string => {
    if (entry === null || typeof entry !== "object") return JSON.stringify(entry);
    if (Array.isArray(entry)) return `[${entry.map(render).join(",")}]`;
    const record = entry as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${render(record[key])}`).join(",")}}`;
  };
  return render(value);
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function iso(value = new Date().toISOString()): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new WorkbenchRunStoreError("INVALID_TIMESTAMP", "Timestamp must be an RFC 3339 UTC value.");
  return value;
}

function insideOrEqual(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if (errno(error) === "ENOENT") return false; throw error; }
}

async function syncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EBADF"].includes(errno(error) ?? "")) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function safeRead(path: string, maxBytes: number): Promise<Buffer> {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile()) throw new WorkbenchRunStoreError("UNSAFE_STORE_ENTRY", "Store entry is not a regular file.");
    if (info.size > maxBytes) throw new WorkbenchRunStoreError("STORE_RECORD_TOO_LARGE", "Store entry exceeds its byte limit.");
    const value = await handle.readFile();
    if (value.byteLength > maxBytes) throw new WorkbenchRunStoreError("STORE_RECORD_TOO_LARGE", "Store entry exceeds its byte limit.");
    return value;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readJson<T>(path: string, maxBytes: number): Promise<T> {
  try {
    const parsed = JSON.parse((await safeRead(path, maxBytes)).toString("utf8")) as T;
    assertJson(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof WorkbenchRunStoreError) throw error;
    throw new WorkbenchRunStoreError("CORRUPT_STORE_RECORD", "Store record is not valid JSON.", error);
  }
}

async function ensureDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
    await syncDirectory(dirname(path));
  } catch (error) {
    if (errno(error) !== "EEXIST") throw error;
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new WorkbenchRunStoreError("UNSAFE_STORE_ENTRY", "Store directory is not a real directory.");
  }
}

async function publishImmutable(path: string, value: Buffer, maxBytes: number): Promise<"created" | "reused"> {
  if (value.byteLength > maxBytes)
    throw new WorkbenchRunStoreError("STORE_RECORD_TOO_LARGE", "Store record exceeds its byte limit.");
  const parent = dirname(path);
  await ensureDirectory(parent);
  const temporary = join(parent, `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`);
  let handle;
  try {
    handle = await open(temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    await handle.writeFile(value);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, path);
      await syncDirectory(parent);
      return "created";
    } catch (error) {
      if (errno(error) !== "EEXIST") throw error;
      const prior = await safeRead(path, maxBytes);
      if (!prior.equals(value))
        throw new WorkbenchRunStoreError("IMMUTABLE_RECORD_CONFLICT", "An immutable store record already has different content.");
      return "reused";
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch((error: unknown) => {
      if (errno(error) !== "ENOENT") throw error;
    });
  }
}

async function discoverRepositoryRoot(): Promise<string | null> {
  const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  const visited = new Set<string>();
  for (const start of starts) {
    let current = resolve(start);
    while (!visited.has(current)) {
      visited.add(current);
      if (
        await exists(join(current, ".git")) &&
        await exists(join(current, "configs/capital-research/acceptance-traditional.json")) &&
        await exists(join(current, "research/capital/engine.ts"))
      ) return realpath(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return null;
}

/** Resolve an absent path through its nearest existing ancestor without creating it. */
async function prospectiveRealPath(path: string): Promise<string> {
  const missing: string[] = [];
  let cursor = resolve(path);
  while (!(await exists(cursor))) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(basename(cursor));
    cursor = parent;
  }
  const base = await realpath(cursor);
  return resolve(base, ...missing);
}

function validateRunId(runId: string): void {
  if (!WORKBENCH_RUN_ID_PATTERN.test(runId))
    throw new WorkbenchRunStoreError("INVALID_RUN_ID", "run_id has an invalid format.");
}

function validateAttemptId(attemptId: string): void {
  if (!WORKBENCH_ATTEMPT_ID_PATTERN.test(attemptId))
    throw new WorkbenchRunStoreError("INVALID_ATTEMPT_ID", "execution_attempt_id has an invalid format.");
}

export class WorkbenchRunStore {
  readonly storageStatus = WORKBENCH_STORAGE_STATUS;
  readonly limits: Readonly<WorkbenchRunStoreLimits>;
  private submissionTail: Promise<void> = Promise.resolve();

  private constructor(readonly root: string, limits: Readonly<WorkbenchRunStoreLimits>) {
    this.limits = limits;
  }

  static async open(options: WorkbenchRunStoreOptions = {}): Promise<WorkbenchRunStore> {
    const requested = options.root ?? process.env.WORKBENCH_RUN_DIR ?? DEFAULT_WORKBENCH_RUN_DIR;
    if (!isAbsolute(requested))
      throw new WorkbenchRunStoreError("RUN_ROOT_NOT_ABSOLUTE", "WORKBENCH_RUN_DIR must be absolute.");
    const repositoryRoot = options.repositoryRoot
      ? await realpath(options.repositoryRoot).catch(() => resolve(options.repositoryRoot!))
      : await discoverRepositoryRoot();
    if (!repositoryRoot)
      throw new WorkbenchRunStoreError(
        "REPOSITORY_ROOT_NOT_FOUND",
        "The certified repository root could not be resolved before initializing Workbench storage.",
      );
    const forbidden = [repositoryRoot, ...(options.forbiddenRoots ?? [])];
    const prospectiveRoot = await prospectiveRealPath(requested);
    const sharedTemporaryRoot = await realpath(tmpdir());
    if (prospectiveRoot === resolve("/") || prospectiveRoot === sharedTemporaryRoot)
      throw new WorkbenchRunStoreError(
        "UNSAFE_RUN_ROOT",
        "Workbench run root must be a dedicated directory, not a shared filesystem root.",
      );
    for (const entry of forbidden) {
      const denied = await realpath(entry).catch(() => resolve(entry));
      if (insideOrEqual(denied, prospectiveRoot) || insideOrEqual(prospectiveRoot, denied))
        throw new WorkbenchRunStoreError("UNSAFE_RUN_ROOT", "Workbench run root overlaps a protected repository path.");
    }

    // Mutation begins only after lexical and symlink-resolved overlap checks.
    const requestedExisted = await exists(requested);
    await mkdir(requested, { recursive: true, mode: 0o700 });
    const requestedInfo = await lstat(requested);
    if (!requestedInfo.isDirectory() || requestedInfo.isSymbolicLink())
      throw new WorkbenchRunStoreError("UNSAFE_RUN_ROOT", "Workbench run root must be a real directory.");
    if (typeof process.getuid === "function" && requestedInfo.uid !== process.getuid())
      throw new WorkbenchRunStoreError("UNSAFE_RUN_ROOT", "Workbench run root is owned by another user.");
    const root = await realpath(requested);
    for (const entry of forbidden) {
      const denied = await realpath(entry).catch(() => resolve(entry));
      if (insideOrEqual(denied, root) || insideOrEqual(root, denied))
        throw new WorkbenchRunStoreError("UNSAFE_RUN_ROOT", "Workbench run root overlaps a protected repository path.");
    }
    if (!requestedExisted) await chmod(root, 0o700);

    const limits = Object.freeze({ ...DEFAULT_STORE_LIMITS, ...options.limits });
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isSafeInteger(value) || value < 1)
        throw new WorkbenchRunStoreError("INVALID_STORE_LIMIT", `${name} must be a positive safe integer.`);
    }
    const store = new WorkbenchRunStore(root, limits);
    await ensureDirectory(store.runsRoot());
    await ensureDirectory(store.comparisonsRoot());
    await publishImmutable(join(root, "store.json"), jsonBytes({
      schema_version: "workbench-run-store-1.0.0",
      storage_status: WORKBENCH_STORAGE_STATUS,
      durability_claim: "NONE",
    }), limits.maxMetadataBytes);
    return store;
  }

  describe() {
    return { storage_status: WORKBENCH_STORAGE_STATUS, durability_claim: "NONE", root: this.root } as const;
  }

  async withSubmissionLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.submissionTail;
    let release!: () => void;
    this.submissionTail = new Promise<void>((resolveTail) => { release = resolveTail; });
    await previous;
    try { return await operation(); }
    finally { release(); }
  }

  async ensureRun(runId: string, normalizedSpec: unknown, options: {
    createdAt?: string; identitySha256?: string;
  } = {}): Promise<StoredRunRecord> {
    validateRunId(runId);
    const identity = options.identitySha256 ?? runId.slice(3);
    if (!/^[0-9a-f]{64}$/.test(identity) || identity !== runId.slice(3))
      throw new WorkbenchRunStoreError("RUN_IDENTITY_MISMATCH", "run_id does not match its supplied identity digest.");
    const specBytes = jsonBytes(normalizedSpec);
    const runDir = this.runDirectory(runId);
    const created = !(await exists(runDir));
    await ensureDirectory(runDir);
    await ensureDirectory(join(runDir, "attempts"));
    await publishImmutable(join(runDir, "normalized-spec.json"), specBytes, this.limits.maxMetadataBytes);
    if (created) {
      const record: StoredRunRecord = {
        run_id: runId,
        created_at: iso(options.createdAt),
        normalized_spec_sha256: sha256(specBytes),
        identity_sha256: identity,
        storage_status: WORKBENCH_STORAGE_STATUS,
      };
      await publishImmutable(join(runDir, "run.json"), jsonBytes(record), this.limits.maxMetadataBytes);
      await publishImmutable(join(runDir, "ready.json"), jsonBytes({ ready: true }), this.limits.maxMetadataBytes);
      return record;
    }
    const record = await readJson<StoredRunRecord>(join(runDir, "run.json"), this.limits.maxMetadataBytes);
    if (record.run_id !== runId || record.normalized_spec_sha256 !== sha256(specBytes) || record.identity_sha256 !== identity)
      throw new WorkbenchRunStoreError("IMMUTABLE_RUN_CONFLICT", "run_id is already bound to another normalized specification.");
    return record;
  }

  async readNormalizedSpec(runId: string): Promise<unknown> {
    validateRunId(runId);
    return readJson(join(this.runDirectory(runId), "normalized-spec.json"), this.limits.maxMetadataBytes);
  }

  async getRun(runId: string): Promise<StoredRunView> {
    const run = await this.requireRun(runId);
    const normalizedSpec = await this.readNormalizedSpec(runId);
    const attempts = await this.listAttempts(runId);
    const latest = attempts.at(-1) ?? null;
    const latestSuccess = [...attempts].reverse().find((attempt) => attempt.status === "SUCCESS") ?? null;
    return {
      run,
      normalized_spec: normalizedSpec,
      attempt_history: attempts,
      latest_status: latest?.status ?? null,
      latest_attempt: latest,
      latest_successful_attempt: latestSuccess,
    };
  }

  async listRuns(limit = this.limits.maxListResults): Promise<StoredRunView[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.limits.maxListResults)
      throw new WorkbenchRunStoreError("INVALID_LIST_LIMIT", "Run list limit is outside the allowed range.");
    const entries = await readdir(this.runsRoot(), { withFileTypes: true });
    const ids = entries.filter((entry) => entry.isDirectory() && WORKBENCH_RUN_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name);
    const records = await Promise.all(ids.map(async (runId) => ({
      runId,
      record: await this.requireRun(runId),
    })));
    records.sort((a, b) => b.record.created_at.localeCompare(a.record.created_at) || b.runId.localeCompare(a.runId));
    return Promise.all(records.slice(0, limit).map(({ runId }) => this.getRun(runId)));
  }

  async createAttempt(runId: string, options: {
    executionAttemptId?: string; source?: AttemptSource; requestedAt?: string;
  } = {}): Promise<AttemptView> {
    await this.requireRun(runId);
    const attemptEntries = await readdir(join(this.runDirectory(runId), "attempts"), {
      withFileTypes: true,
    });
    const attemptCount = attemptEntries.filter((entry) =>
      entry.isDirectory() && WORKBENCH_ATTEMPT_ID_PATTERN.test(entry.name)).length;
    if (attemptCount >= this.limits.maxListResults)
      throw new WorkbenchRunStoreError(
        "ATTEMPT_LIMIT_REACHED",
        "The temporary run has reached its immutable execution-attempt limit.",
      );
    const attemptId = options.executionAttemptId ?? `ea_${randomUUID()}`;
    validateAttemptId(attemptId);
    const dir = this.attemptDirectory({ runId, executionAttemptId: attemptId });
    if (await exists(dir)) throw new WorkbenchRunStoreError("ATTEMPT_ID_CONFLICT", "execution_attempt_id already exists.");
    await ensureDirectory(dir);
    await ensureDirectory(join(dir, "states"));
    const attempt: StoredAttemptRecord = {
      run_id: runId,
      execution_attempt_id: attemptId,
      source: options.source ?? "SUBMIT",
      requested_at: iso(options.requestedAt),
    };
    const pending: AttemptStateEvent = {
      run_id: runId, execution_attempt_id: attemptId, status: "PENDING", stage: "QUEUED", at: attempt.requested_at,
    };
    await publishImmutable(join(dir, "attempt.json"), jsonBytes(attempt), this.limits.maxMetadataBytes);
    await publishImmutable(join(dir, "states", "pending.json"), jsonBytes(pending), this.limits.maxMetadataBytes);
    await publishImmutable(join(dir, "ready.json"), jsonBytes({ ready: true }), this.limits.maxMetadataBytes);
    return this.getAttempt({ runId, executionAttemptId: attemptId });
  }

  async markRunning(ref: AttemptRef, options: { stage?: string; startedAt?: string } = {}): Promise<AttemptView> {
    const current = await this.getAttempt(ref);
    if (current.status === "RUNNING") return current;
    if (current.status !== "PENDING")
      throw new WorkbenchRunStoreError("INVALID_STATUS_TRANSITION", "Only a pending attempt can start.");
    const event: AttemptStateEvent = {
      run_id: ref.runId, execution_attempt_id: ref.executionAttemptId, status: "RUNNING",
      stage: options.stage ?? "EXECUTING", at: iso(options.startedAt),
    };
    await publishImmutable(this.statePath(ref, "running.json"), jsonBytes(event), this.limits.maxMetadataBytes);
    return this.getAttempt(ref);
  }

  async completeSuccess(ref: AttemptRef, result: unknown, options: {
    stage?: string; completedAt?: string; artifactManifest?: EngineArtifactManifest;
  } = {}): Promise<AttemptView> {
    const current = await this.getAttempt(ref);
    if (current.status !== "RUNNING")
      throw new WorkbenchRunStoreError("INVALID_STATUS_TRANSITION", "Only a running attempt can succeed.");
    if (options.artifactManifest)
      await publishImmutable(join(this.attemptDirectory(ref), "artifact-manifest.json"),
        jsonBytes(options.artifactManifest), this.limits.maxMetadataBytes);
    await publishImmutable(join(this.attemptDirectory(ref), "result.json"), jsonBytes(result), this.limits.maxMetadataBytes);
    await this.publishTerminal(ref, {
      run_id: ref.runId, execution_attempt_id: ref.executionAttemptId, status: "SUCCESS",
      stage: options.stage ?? "COMPLETE", at: iso(options.completedAt),
    });
    return this.getAttempt(ref);
  }

  async completeFailure(ref: AttemptRef, input: {
    errorClass: string; safeMessage: string; diagnostic: unknown; result?: unknown;
    stage?: string; completedAt?: string;
  }): Promise<AttemptView> {
    const current = await this.getAttempt(ref);
    if (current.status !== "PENDING" && current.status !== "RUNNING")
      throw new WorkbenchRunStoreError("INVALID_STATUS_TRANSITION", "A terminal attempt cannot be replaced by failure evidence.");
    await publishImmutable(join(this.attemptDirectory(ref), "diagnostic.json"), jsonBytes(input.diagnostic), this.limits.maxMetadataBytes);
    await publishImmutable(join(this.attemptDirectory(ref), "safe-error.json"), jsonBytes({
      error_class: input.errorClass, error_message: input.safeMessage,
    }), this.limits.maxMetadataBytes);
    if (input.result !== undefined)
      await publishImmutable(join(this.attemptDirectory(ref), "result.json"),
        jsonBytes(input.result), this.limits.maxMetadataBytes);
    await this.publishTerminal(ref, {
      run_id: ref.runId, execution_attempt_id: ref.executionAttemptId, status: "FAILED",
      stage: input.stage ?? "FAILED", at: iso(input.completedAt),
      error_class: input.errorClass, error_message: input.safeMessage,
    });
    return this.getAttempt(ref);
  }

  async completeBlocked(ref: AttemptRef, blocker: unknown, options: {
    result?: unknown; stage?: string; completedAt?: string;
  } = {}): Promise<AttemptView> {
    const current = await this.getAttempt(ref);
    if (current.status !== "PENDING" && current.status !== "RUNNING")
      throw new WorkbenchRunStoreError("INVALID_STATUS_TRANSITION", "A terminal attempt cannot be replaced by a blocker.");
    await publishImmutable(join(this.attemptDirectory(ref), "blocker.json"), jsonBytes(blocker), this.limits.maxMetadataBytes);
    if (options.result !== undefined)
      await publishImmutable(join(this.attemptDirectory(ref), "result.json"),
        jsonBytes(options.result), this.limits.maxMetadataBytes);
    await this.publishTerminal(ref, {
      run_id: ref.runId, execution_attempt_id: ref.executionAttemptId, status: "BLOCKED",
      stage: options.stage ?? "BLOCKED", at: iso(options.completedAt), blocker,
    });
    return this.getAttempt(ref);
  }

  async getAttempt(ref: AttemptRef): Promise<AttemptView> {
    this.validateRef(ref);
    const dir = this.attemptDirectory(ref);
    if (!(await exists(join(dir, "ready.json"))))
      throw new WorkbenchRunStoreError("ATTEMPT_NOT_FOUND", "Execution attempt was not found.");
    const attempt = await readJson<StoredAttemptRecord>(join(dir, "attempt.json"), this.limits.maxMetadataBytes);
    const terminal = await this.maybeJson<AttemptStateEvent>(join(dir, "states", "terminal.json"));
    const running = await this.maybeJson<AttemptStateEvent>(join(dir, "states", "running.json"));
    const state = terminal ?? running ?? await readJson<AttemptStateEvent>(join(dir, "states", "pending.json"), this.limits.maxMetadataBytes);
    return {
      attempt, status: state.status, stage: state.stage,
      started_at: running?.at ?? null, completed_at: terminal?.at ?? null, terminal,
    };
  }

  async listAttempts(runId: string): Promise<AttemptView[]> {
    await this.requireRun(runId);
    const dir = join(this.runDirectory(runId), "attempts");
    const entries = await readdir(dir, { withFileTypes: true });
    const ids = entries.filter((entry) => entry.isDirectory() && WORKBENCH_ATTEMPT_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name);
    if (ids.length > this.limits.maxListResults)
      throw new WorkbenchRunStoreError("LIST_LIMIT_EXCEEDED", "Attempt history exceeds the bounded list limit.");
    const attempts = await Promise.all(ids.map((executionAttemptId) => this.getAttempt({ runId, executionAttemptId })));
    return attempts.sort((a, b) => a.attempt.requested_at.localeCompare(b.attempt.requested_at) ||
      a.attempt.execution_attempt_id.localeCompare(b.attempt.execution_attempt_id));
  }

  async findReusableAttempt(runId: string): Promise<AttemptView | null> {
    const attempts = (await this.listAttempts(runId)).reverse();
    return attempts.find((attempt) => attempt.status === "PENDING" || attempt.status === "RUNNING") ??
      attempts.find((attempt) => attempt.status === "SUCCESS") ?? null;
  }

  async readResult(ref: AttemptRef): Promise<unknown> {
    const attempt = await this.getAttempt(ref);
    if (attempt.status !== "SUCCESS")
      throw new WorkbenchRunStoreError("RESULT_NOT_AVAILABLE", "Only a successful attempt has a result.");
    return readJson(join(this.attemptDirectory(ref), "result.json"), this.limits.maxMetadataBytes);
  }

  /** Reads a persisted result envelope for any terminal attempt that has one. */
  async readAttemptResult(ref: AttemptRef): Promise<unknown> {
    const attempt = await this.getAttempt(ref);
    if (attempt.status === "PENDING" || attempt.status === "RUNNING")
      throw new WorkbenchRunStoreError("RESULT_NOT_AVAILABLE", "An in-progress attempt has no terminal result.");
    const path = join(this.attemptDirectory(ref), "result.json");
    if (!(await exists(path)))
      throw new WorkbenchRunStoreError("RESULT_NOT_AVAILABLE", "The terminal attempt has no result envelope.");
    return readJson(path, this.limits.maxMetadataBytes);
  }

  async prepareEngineOutput(ref: AttemptRef): Promise<string> {
    const attempt = await this.getAttempt(ref);
    if (attempt.status !== "RUNNING")
      throw new WorkbenchRunStoreError("INVALID_STATUS_TRANSITION", "Engine output can be prepared only for a running attempt.");
    const path = join(this.attemptDirectory(ref), "engine");
    if (await exists(path)) throw new WorkbenchRunStoreError("ENGINE_OUTPUT_ALREADY_EXISTS", "Attempt engine output cannot be reused.");
    await ensureDirectory(path);
    return path;
  }

  /** Returns a validated, still-absent engine root for a worker that creates it itself. */
  async engineOutputPath(ref: AttemptRef): Promise<string> {
    const attempt = await this.getAttempt(ref);
    if (attempt.status !== "RUNNING")
      throw new WorkbenchRunStoreError("INVALID_STATUS_TRANSITION", "Engine output belongs only to a running attempt.");
    const path = join(this.attemptDirectory(ref), "engine");
    if (await exists(path)) throw new WorkbenchRunStoreError("ENGINE_OUTPUT_ALREADY_EXISTS", "Attempt engine output cannot be reused.");
    return path;
  }

  async sealEngineArtifacts(ref: AttemptRef, sealedAt?: string): Promise<EngineArtifactManifest> {
    await this.getAttempt(ref);
    const engineRoot = join(this.attemptDirectory(ref), "engine");
    if (!(await exists(engineRoot))) throw new WorkbenchRunStoreError("ENGINE_OUTPUT_MISSING", "Engine output directory is missing.");
    const files: EngineArtifactEntry[] = [];
    let totalBytes = 0;
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new WorkbenchRunStoreError("UNSAFE_ENGINE_ARTIFACT", "Engine output contains a symbolic link.");
        if (entry.isDirectory()) { await walk(path); continue; }
        if (!entry.isFile()) throw new WorkbenchRunStoreError("UNSAFE_ENGINE_ARTIFACT", "Engine output contains a non-file artifact.");
        const bytes = await safeRead(path, this.limits.maxEngineOutputBytes);
        totalBytes += bytes.byteLength;
        if (totalBytes > this.limits.maxEngineOutputBytes)
          throw new WorkbenchRunStoreError("ENGINE_OUTPUT_LIMIT_EXCEEDED", "Engine output exceeds its byte limit.");
        if (files.length + 1 > this.limits.maxEngineFiles)
          throw new WorkbenchRunStoreError("ENGINE_FILE_LIMIT_EXCEEDED", "Engine output exceeds its file-count limit.");
        const relativePath = relative(engineRoot, path).split(sep).join("/");
        if (relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath))
          throw new WorkbenchRunStoreError("UNSAFE_ENGINE_ARTIFACT", "Engine artifact escaped its attempt directory.");
        const runtime = relativePath === "progress.json" || relativePath === "storage-failures.jsonl";
        files.push({ path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes), artifact_class: runtime ? "RUNTIME" : "FINANCIAL" });
      }
    };
    await walk(engineRoot);
    files.sort((a, b) => a.path.localeCompare(b.path));
    const digest = (kind: EngineArtifactEntry["artifact_class"]) => sha256(canonicalJson(files
      .filter((entry) => entry.artifact_class === kind)
      .map(({ path, bytes, sha256: hash }) => ({ path, bytes, sha256: hash }))));
    const manifest: EngineArtifactManifest = {
      run_id: ref.runId, execution_attempt_id: ref.executionAttemptId,
      storage_status: WORKBENCH_STORAGE_STATUS, files, file_count: files.length, total_bytes: totalBytes,
      financial_result_hash: digest("FINANCIAL"), runtime_hash: digest("RUNTIME"), sealed_at: iso(sealedAt),
    };
    await publishImmutable(join(this.attemptDirectory(ref), "artifact-manifest.json"),
      jsonBytes(manifest), this.limits.maxMetadataBytes);
    return manifest;
  }

  async appendLog(ref: AttemptRef, chunk: string | Buffer): Promise<{ written_bytes: number; truncated: boolean }> {
    await this.getAttempt(ref);
    const logDir = join(this.attemptDirectory(ref), "logs");
    await ensureDirectory(logDir);
    const existing = (await readdir(logDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^\d{6}\.log$/.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
    let used = 0;
    for (const entry of existing) used += (await lstat(join(logDir, entry.name))).size;
    const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    const remaining = Math.max(0, this.limits.maxLogBytes - used);
    const output = input.subarray(0, remaining);
    if (output.byteLength) {
      await publishImmutable(join(logDir, `${String(existing.length).padStart(6, "0")}.log`), output, this.limits.maxLogBytes);
    }
    const truncated = output.byteLength < input.byteLength;
    if (truncated) await publishImmutable(join(logDir, "truncated.json"), jsonBytes({ truncated: true }), this.limits.maxMetadataBytes);
    return { written_bytes: output.byteLength, truncated };
  }

  async acquireExecutionLease(ref: AttemptRef, timeoutMs?: number): Promise<{
    acquired: boolean; lease: ExecutionLeaseRecord;
  }> {
    await this.getAttempt(ref);
    if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1))
      throw new WorkbenchRunStoreError("INVALID_TIMEOUT", "Execution timeout must be a positive safe integer.");
    const acquiredAt = new Date();
    const lease: ExecutionLeaseRecord = {
      token: randomUUID(), run_id: ref.runId, execution_attempt_id: ref.executionAttemptId,
      pid: process.pid, hostname: hostname(), acquired_at: acquiredAt.toISOString(),
      deadline: timeoutMs === undefined ? null : new Date(acquiredAt.getTime() + timeoutMs).toISOString(),
    };
    const path = this.executionLeasePath();
    const temporary = join(this.root, `.execution-lock-${lease.token}`);
    await publishImmutable(temporary, jsonBytes(lease), this.limits.maxMetadataBytes);
    try {
      await link(temporary, path);
      await syncDirectory(this.root);
      return { acquired: true, lease };
    } catch (error) {
      if (errno(error) !== "EEXIST") throw error;
      return { acquired: false, lease: await readJson(path, this.limits.maxMetadataBytes) };
    } finally {
      await unlink(temporary).catch((error: unknown) => { if (errno(error) !== "ENOENT") throw error; });
    }
  }

  async inspectExecutionLease(): Promise<ExecutionLeaseRecord | null> {
    if (!(await exists(this.executionLeasePath()))) return null;
    return readJson(this.executionLeasePath(), this.limits.maxMetadataBytes);
  }

  async releaseExecutionLease(token: string): Promise<void> {
    const lease = await this.inspectExecutionLease();
    if (!lease) return;
    if (lease.token !== token)
      throw new WorkbenchRunStoreError("EXECUTION_LEASE_LOST", "Execution lease is owned by another attempt.");
    await unlink(this.executionLeasePath());
    await syncDirectory(this.root);
  }

  private runsRoot(): string { return join(this.root, "runs"); }
  private comparisonsRoot(): string { return join(this.root, "comparisons"); }
  private executionLeasePath(): string { return join(this.root, ".execution.lock"); }
  private runDirectory(runId: string): string { validateRunId(runId); return join(this.runsRoot(), runId); }
  private attemptDirectory(ref: AttemptRef): string {
    this.validateRef(ref); return join(this.runDirectory(ref.runId), "attempts", ref.executionAttemptId);
  }
  private statePath(ref: AttemptRef, name: string): string { return join(this.attemptDirectory(ref), "states", name); }
  private validateRef(ref: AttemptRef): void { validateRunId(ref.runId); validateAttemptId(ref.executionAttemptId); }

  private async requireRun(runId: string): Promise<StoredRunRecord> {
    validateRunId(runId);
    const dir = this.runDirectory(runId);
    if (!(await exists(join(dir, "ready.json")))) throw new WorkbenchRunStoreError("RUN_NOT_FOUND", "Research run was not found.");
    return readJson(join(dir, "run.json"), this.limits.maxMetadataBytes);
  }

  private async maybeJson<T>(path: string): Promise<T | null> {
    if (!(await exists(path))) return null;
    return readJson<T>(path, this.limits.maxMetadataBytes);
  }

  private async publishTerminal(ref: AttemptRef, event: AttemptStateEvent): Promise<void> {
    if (await exists(this.statePath(ref, "terminal.json")))
      throw new WorkbenchRunStoreError("ATTEMPT_ALREADY_TERMINAL", "Execution attempt already has immutable terminal evidence.");
    await publishImmutable(this.statePath(ref, "terminal.json"), jsonBytes(event), this.limits.maxMetadataBytes);
  }
}
