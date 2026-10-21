/** Operational limits only. None of these values belongs to financial identity. */
export interface ExecutionCapacity {
  max_jobs: number;
  max_engine_files: number;
  timeout_ms: number;
  max_output_bytes: number;
}
export const DEFAULT_EXECUTION_CAPACITY: Readonly<ExecutionCapacity> = Object.freeze({
  max_jobs: 2000, max_engine_files: 512, timeout_ms: 120000, max_output_bytes: 64 * 1024 * 1024,
});
const names: Record<keyof ExecutionCapacity, string> = {
  max_jobs: "WORKBENCH_MAX_JOBS", max_engine_files: "WORKBENCH_MAX_ENGINE_FILES",
  timeout_ms: "WORKBENCH_EXECUTION_TIMEOUT_MS", max_output_bytes: "WORKBENCH_MAX_OUTPUT_BYTES",
};
export function readExecutionCapacity(env: NodeJS.ProcessEnv = process.env): Readonly<ExecutionCapacity> {
  const result = { ...DEFAULT_EXECUTION_CAPACITY };
  for (const field of Object.keys(names) as (keyof ExecutionCapacity)[]) {
    const value = env[names[field]];
    if (value === undefined) continue;
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0 ||
        (field === "timeout_ms" && Number(value) > 2147483647)) {
      // Do not print the supplied environment value.
      throw new Error(`Invalid execution capacity configuration: ${names[field]} must be a positive safe integer${field === "timeout_ms" ? " <= 2147483647" : ""}.`);
    }
    result[field] = Number(value);
  }
  return Object.freeze(result);
}
