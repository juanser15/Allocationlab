import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  resolveWorkbenchRepositoryRoot,
  WorkbenchRepositoryRootError,
  WORKBENCH_REPOSITORY_MARKERS,
} from "./repository-root";
import { WorkbenchRunStore, WorkbenchRunStoreError } from "./run-store";

async function markerRepository(options: {
  git?: boolean;
  omit?: string;
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "allocationlab-root-fixture-"));
  for (const marker of WORKBENCH_REPOSITORY_MARKERS) {
    if (marker === options.omit) continue;
    const path = join(root, marker);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, marker.endsWith(".json") ? "{}\n" : "// marker\n", "utf8");
  }
  if (options.git) await mkdir(join(root, ".git"));
  return root;
}

function discoverFrom(root: string): string {
  return resolveWorkbenchRepositoryRoot({
    moduleUrl: pathToFileURL(join(root, "artifacts/api-server/dist/index.mjs")).href,
    cwd: join(root, "artifacts/api-server"),
  });
}

test("A/B: certified markers resolve the real repository root with or without .git", async (t) => {
  const withGit = await markerRepository({ git: true });
  const withoutGit = await markerRepository();
  t.after(() => Promise.all([
    rm(withGit, { recursive: true, force: true }),
    rm(withoutGit, { recursive: true, force: true }),
  ]));
  assert.equal(discoverFrom(withGit), withGit);
  assert.equal(discoverFrom(withoutGit), withoutGit);
});

for (const [label, marker] of [
  ["C: missing campaign", "configs/capital-research/acceptance-traditional.json"],
  ["D: missing capital engine", "research/capital/engine.ts"],
  ["E: missing API package", "artifacts/api-server/package.json"],
] as const) {
  test(`${label} fails closed`, async (t) => {
    const root = await markerRepository({ omit: marker });
    t.after(() => rm(root, { recursive: true, force: true }));
    assert.throws(() => discoverFrom(root), WorkbenchRepositoryRootError);
  });
}

test("F: an arbitrary directory containing only package.json fails closed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "allocationlab-arbitrary-root-"));
  await writeFile(join(root, "package.json"), "{}\n", "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.throws(() => discoverFrom(root), WorkbenchRepositoryRootError);
});

test("G/H: a symlinked repository root cannot weaken repository/store overlap rejection", async (t) => {
  const repository = await markerRepository();
  const parent = await mkdtemp(join(tmpdir(), "allocationlab-root-link-"));
  const alias = join(parent, "repository-link");
  await symlink(repository, alias, "dir");
  t.after(() => Promise.all([
    rm(parent, { recursive: true, force: true }),
    rm(repository, { recursive: true, force: true }),
  ]));
  const discovered = discoverFrom(alias);
  assert.equal(discovered, repository);
  await assert.rejects(
    WorkbenchRunStore.open({ root: join(alias, "workbench-runs"), repositoryRoot: discovered }),
    (error: unknown) => error instanceof WorkbenchRunStoreError && error.code === "UNSAFE_RUN_ROOT",
  );
});

test("I: a repository nested inside WORKBENCH_RUN_DIR is rejected", async (t) => {
  const runRoot = await mkdtemp(join(tmpdir(), "allocationlab-parent-store-"));
  const repository = join(runRoot, "repository");
  await mkdir(repository);
  for (const marker of WORKBENCH_REPOSITORY_MARKERS) {
    const path = join(repository, marker);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, marker.endsWith(".json") ? "{}\n" : "// marker\n", "utf8");
  }
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  await assert.rejects(
    WorkbenchRunStore.open({ root: runRoot, repositoryRoot: repository }),
    (error: unknown) => error instanceof WorkbenchRunStoreError && error.code === "UNSAFE_RUN_ROOT",
  );
});

test("J: a dedicated temporary run directory remains allowed", async (t) => {
  const repository = await markerRepository();
  const runRoot = await mkdtemp(join(tmpdir(), "allocationlab-safe-store-"));
  t.after(() => Promise.all([
    rm(repository, { recursive: true, force: true }),
    rm(runRoot, { recursive: true, force: true }),
  ]));
  const store = await WorkbenchRunStore.open({ root: runRoot, repositoryRoot: repository });
  assert.equal(store.root, runRoot);
});

test("K: run store, execution adapter and worker use the same marker resolver", async () => {
  const sources = await Promise.all([
    readFile("artifacts/api-server/src/lib/workbench/run-store.ts", "utf8"),
    readFile("artifacts/api-server/src/lib/workbench/execution-adapter.ts", "utf8"),
    readFile("artifacts/api-server/src/workbench-run-worker.ts", "utf8"),
  ]);
  for (const source of sources) assert.match(source, /resolveWorkbenchRepositoryRoot/);
  for (const source of sources) assert.doesNotMatch(source, /function findRepositoryRoot/);
});
