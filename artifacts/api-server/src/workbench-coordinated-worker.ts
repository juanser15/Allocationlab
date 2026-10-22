import {
  preparedDataset,
  normalizeCoordinated,
  coordinatedRunId,
} from "./lib/workbench/coordinated-calendar";
const { runCoordinated } = require("../../../research/coordinated/engine") as {
  runCoordinated: (...args: any[]) => any;
};
// Fixed IPC protocol. No client-supplied executable, file path or shell fragment.
process.on("disconnect", () => process.exit(0));
process.on("message", (message: any) => {
  if (
    !message ||
    message.type !== "EXECUTE" ||
    typeof message.run_id !== "string"
  )
    return;
  try {
    const t = performance.now(),
      data = preparedDataset(),
      spec = normalizeCoordinated(message.request, data);
    if (coordinatedRunId(spec) !== message.run_id)
      throw new Error(
        "Worker financial identity differs from the validated submission",
      );
    const result = runCoordinated(spec, data, (progress: unknown) =>
      process.send?.({ type: "PROGRESS", run_id: message.run_id, progress }),
    );
    result.execution_profile.worker_wall_ms = performance.now() - t;
    const bytes = Buffer.byteLength(JSON.stringify(result));
    if (bytes > message.max_output_bytes)
      throw Object.assign(
        new Error("Compact output exceeded the configured size limit"),
        { code: "OUTPUT_OR_LOG_LIMIT" },
      );
    process.send?.({ type: "RESULT", run_id: message.run_id, result });
  } catch (error) {
    const e = error as any;
    process.send?.({
      type: "FAILURE",
      run_id: message.run_id,
      code: e.code ?? "INTERACTIVE_WORKER_FAILURE",
      safe_message: e.code
        ? e.message
        : "The research worker could not complete this attempt.",
      details: e.details ?? {},
      private_diagnostic: String(e.stack ?? e).slice(0, 65536),
    });
  }
});
