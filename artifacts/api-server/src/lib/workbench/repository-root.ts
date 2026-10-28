import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const WORKBENCH_REPOSITORY_MARKERS = Object.freeze([
  "configs/capital-research/acceptance-traditional.json",
  "research/capital/engine.ts",
  "artifacts/api-server/package.json",
  "package.json",
] as const);

export interface WorkbenchRepositoryDiscoveryOptions {
  moduleUrl?: string;
  cwd?: string;
}

export class WorkbenchRepositoryRootError extends Error {
  readonly code = "REPOSITORY_ROOT_NOT_FOUND";

  constructor() {
    super("The certified Allocation Lab repository root could not be resolved from its required file markers.");
    this.name = "WorkbenchRepositoryRootError";
  }
}

function insideOrEqual(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function hasCertifiedMarkers(candidate: string): boolean {
  let root: string;
  try {
    root = realpathSync(candidate);
  } catch {
    return false;
  }
  return WORKBENCH_REPOSITORY_MARKERS.every((marker) => {
    const markerPath = resolve(root, marker);
    try {
      const info = lstatSync(markerPath);
      return info.isFile() && !info.isSymbolicLink() &&
        insideOrEqual(root, realpathSync(markerPath));
    } catch {
      return false;
    }
  });
}

/** Locate the runtime repository from committed, repository-specific files. */
export function resolveWorkbenchRepositoryRoot(
  options: WorkbenchRepositoryDiscoveryOptions = {},
): string {
  const starts = [
    dirname(fileURLToPath(options.moduleUrl ?? import.meta.url)),
    options.cwd ?? process.cwd(),
  ];
  const visited = new Set<string>();
  for (const start of starts) {
    let cursor = resolve(start);
    while (!visited.has(cursor)) {
      visited.add(cursor);
      if (existsSync(cursor) && hasCertifiedMarkers(cursor)) return realpathSync(cursor);
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  throw new WorkbenchRepositoryRootError();
}
