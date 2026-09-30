import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const serverRequire = createRequire(new URL("../../package.json", import.meta.url));
const dbRequire = createRequire(new URL("../../../../lib/db/package.json", import.meta.url));

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("node:") || specifier.startsWith(".") ||
      specifier.startsWith("/") || specifier.startsWith("file:"))
    return nextResolve(specifier, context);

  for (const resolveFrom of [serverRequire, dbRequire]) {
    try {
      return {
        url: pathToFileURL(resolveFrom.resolve(specifier)).href,
        shortCircuit: true,
      };
    } catch {
      // Try the other workspace package's dependency graph.
    }
  }
  return nextResolve(specifier, context);
}