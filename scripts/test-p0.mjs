import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
await require('esbuild').build({entryPoints:['scripts/p0-test-support.ts'],outfile:'artifacts/api-server/dist/p0-test-support.mjs',bundle:true,platform:'node',format:'esm',external:['pg-native'],banner:{js:"import{createRequire as __testReq}from'node:module';globalThis.require=__testReq(import.meta.url);"}});
const result=spawnSync(process.execPath,['--test','scripts/p0-unit.test.mjs'],{stdio:'inherit',env:process.env});process.exit(result.status??1);
