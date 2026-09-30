import { useCallback, useEffect, useRef, useState } from "react";
import {
  createValidationJob,
  getValidationJob,
  type ValidationJob,
  type ValidationRunInput,
} from "@workspace/api-client-react";
import {
  mayApplyValidationJobError,
  mayApplyValidationJobResponse,
  shouldRestoreValidationRun,
  validationJobRecoveryAction,
  type ValidationJobRequestIdentity,
} from "./validation-job-state";

type StoredValidationJob = {
  idempotencyKey: string;
  request: ValidationRunInput;
  job: ValidationJob | null;
  submissionError: string | null;
};

function readStored(key: string): StoredValidationJob | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as StoredValidationJob : null;
  } catch {
    return null;
  }
}

function persist(key: string, value: StoredValidationJob | null): void {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(key, JSON.stringify(value));
  else window.localStorage.removeItem(key);
}

function newIdempotencyKey(): string {
  if (typeof window === "undefined" || !window.crypto?.randomUUID)
    throw new Error("This browser cannot create a secure validation job key.");
  return window.crypto.randomUUID();
}

function httpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown; response?: { status?: unknown }; statusCode?: unknown };
  const value = candidate.status ?? candidate.response?.status ?? candidate.statusCode;
  return typeof value === "number" ? value : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Validation job request failed.";
}

export function useValidationJob(
  storageKey: string,
  onCompleted: (job: ValidationJob) => void,
) {
  const [stored, setStored] = useState<StoredValidationJob | null>(() => readStored(storageKey));
  const [reconnecting, setReconnecting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const busy = useRef(false);
  const completedNotified = useRef<string | null>(null);
  const terminalVerified = useRef<string | null>(null);
  const generation = useRef(0);
  const onCompletedRef = useRef(onCompleted);
  const pollNow = useRef<() => void>(() => undefined);
  onCompletedRef.current = onCompleted;

  const updateStored = useCallback((next: StoredValidationJob | null) => {
    setStored(next);
    persist(storageKey, next);
  }, [storageKey]);

  const start = useCallback((request: ValidationRunInput) => {
    const current = readStored(storageKey);
    if (current && !current.submissionError &&
        (!current.job || current.job.status === "queued" || current.job.status === "running")) return;
    const next: StoredValidationJob = {
      idempotencyKey: newIdempotencyKey(),
      request,
      job: null,
      submissionError: null,
    };
    updateStored(next);
    setReconnecting(false);
    window.setTimeout(() => pollNow.current(), 0);
  }, [storageKey, updateStored]);

  useEffect(() => {
    const latest = readStored(storageKey);
    setStored(latest);
    setReconnecting(false);
  }, [storageKey]);

  useEffect(() => {
    let active = true;
    const scopeGeneration = ++generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delay: number) => {
      if (active) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { void poll(); }, delay);
      }
    };

    const poll = async (forceTerminalRefresh = false) => {
      if (!active) return;
      if (busy.current) {
        schedule(500);
        return;
      }
      const current = readStored(storageKey);
      const action = validationJobRecoveryAction(
        current,
        terminalVerified.current,
        forceTerminalRefresh,
      );
      if (action.type === "idle" || !current) return;
      const identity: ValidationJobRequestIdentity = {
        storageKey,
        generation: scopeGeneration,
        idempotencyKey: current.idempotencyKey,
        jobId: action.type === "get" ? action.jobId : null,
      };
      busy.current = true;
      try {
        const job = action.type === "get"
          ? await getValidationJob(action.jobId)
          : await createValidationJob({
              idempotencyKey: action.idempotencyKey,
              request: action.request,
            });
        if (!active) return;
        const latest = readStored(storageKey);
        if (!mayApplyValidationJobResponse(identity, storageKey, generation.current, latest, job)) {
          schedule(0);
          return;
        }
        setReconnecting(false);
        const next = { ...latest!, job, submissionError: null };
        updateStored(next);
        if (job.status === "completed" || job.status === "failed")
          terminalVerified.current = job.jobId;
        if (shouldRestoreValidationRun(job, completedNotified.current)) {
          completedNotified.current = job.jobId;
          onCompletedRef.current(job);
        }
        if (job.status === "queued" || job.status === "running") schedule(2000);
      } catch (error) {
        if (!active) return;
        const latest = readStored(storageKey);
        if (!mayApplyValidationJobError(identity, storageKey, generation.current, latest)) {
          schedule(0);
          return;
        }
        const status = httpStatus(error);
        if (!identity.jobId && status !== null && status >= 400 && status < 500) {
          const next = { ...latest!, submissionError: message(error) };
          updateStored(next);
        } else {
          setReconnecting(true);
          schedule(3000);
        }
      } finally {
        busy.current = false;
      }
    };

    pollNow.current = () => {
      if (timer) clearTimeout(timer);
      void poll();
    };
    void poll();
    const resume = () => { if (!busy.current) void poll(true); };
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) {
        setStored(readStored(storageKey));
        resume();
      }
    };
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      if (generation.current === scopeGeneration) generation.current += 1;
      if (timer) clearTimeout(timer);
      pollNow.current = () => undefined;
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("storage", onStorage);
    };
  }, [storageKey, updateStored]);

  useEffect(() => {
    if (!stored?.job || (stored.job.status !== "queued" && stored.job.status !== "running")) {
      setSeconds(0);
      return;
    }
    const startedAt = Date.parse(stored.job.startedAt ?? stored.job.createdAt);
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [stored?.job]);

  const job = stored?.job ?? null;
  const active = !!stored && !stored.submissionError &&
    (!job || job.status === "queued" || job.status === "running");

  return {
    job,
    request: stored?.request ?? null,
    active,
    submitting: !!stored && !job && !stored.submissionError,
    reconnecting,
    seconds,
    submissionError: stored?.submissionError ?? null,
    start,
  };
}

export function formatJobElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}