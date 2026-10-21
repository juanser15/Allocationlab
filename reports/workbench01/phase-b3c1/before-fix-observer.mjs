// Passive reproduction observer; never imported by the product server.
import { createRequire, syncBuiltinESMExports } from "node:module";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const cp = require("node:child_process");
const original = cp.fork;
cp.fork = function (...args) {
  const child = original.apply(this, args);
  if (String(args[0]).endsWith("workbench-run-worker.mjs")) {
    child.on("message", (m) => {
      if (m?.type === "workbench-capital-error")
        appendFileSync(
          process.env.B3C1_OBSERVER_FILE,
          JSON.stringify({
            event: "worker_error_message",
            error_class: m.error_class,
            safe_message: m.safe_message,
            diagnostic: m.diagnostic,
          }) + "\n",
          { mode: 0o600 },
        );
    });
    child.on("exit", (code, signal) =>
      appendFileSync(
        process.env.B3C1_OBSERVER_FILE,
        JSON.stringify({ event: "worker_exit", exit_code: code, signal }) +
          "\n",
        { mode: 0o600 },
      ),
    );
  }
  return child;
};
syncBuiltinESMExports();
await import(
  pathToFileURL(resolve(process.cwd(), "artifacts/api-server/dist/index.mjs"))
    .href
);
