/** Public source-only suite. Never supplies the absent private CSV or DB state. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const require = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const uiRequire = createRequire(new URL('../artifacts/allocation-lab/package.json', import.meta.url));
const { build } = require('esbuild');
const cases = {
  solver: 'research/coordinated/constrained-optimizer.test.ts',
  oracle: 'research/coordinated/optimizer-oracle.test.ts',
  preflight: 'research/coordinated/optimizer-preflight.test.ts',
  frontend: 'artifacts/allocation-lab/src/research/optimizer-inputs.test.tsx',
  overlay: 'research/coordinated/optimizer-overlay.test.ts',
  api: 'research/coordinated/optimizer-api.test.ts',
  errors: 'research/coordinated/optimizer-errors.test.ts',
};
for (const file of Object.values(cases)) if (!existsSync(file)) throw Error(`Missing source-only test file: ${file}`);
const outdir = resolve('artifacts/api-server/dist/optimizer-repair-tests');
await build({ entryPoints: cases, outdir, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' },
  alias: { express: require.resolve('express'), '@workspace/db': resolve('research/coordinated/institutional-unit-db-shim.ts'), react: uiRequire.resolve('react'), 'react/jsx-runtime': uiRequire.resolve('react/jsx-runtime'), 'react-dom/server': uiRequire.resolve('react-dom/server') },
  banner: { js: "import {createRequire as cr} from 'node:module';globalThis.require=cr(import.meta.url);" } });
console.log('SOURCE_ONLY_SYNTHETIC_TESTS: no private historical dataset, PostgreSQL, deployed worker or Replit runtime certification.');
const test = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...Object.keys(cases).map(name => resolve(outdir, name + '.mjs'))], { stdio: 'inherit' });
process.exit(test.status ?? 1);
