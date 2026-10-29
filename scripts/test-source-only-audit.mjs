/** Supplemental public source-only inventory. Private data/DB access is never substituted.
 * Runs the audited historical suites in addition to test-optimizer-repair.mjs.
 * A known pre-existing assertion remains a failure; this runner does not hide it.
 * Usage: node scripts/test-source-only-audit.mjs [absolute temporary output directory]
 */
import {createRequire} from 'node:module';
import {dirname,resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdirSync,mkdtempSync,symlinkSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const supplied=process.argv[2];
if(supplied&&!isAbsolute(supplied))throw Error('Output must be an absolute temporary directory outside the repository.');
const out=supplied??mkdtempSync(join(tmpdir(),'allocationlab-source-audit-'));
mkdirSync(out,{recursive:true});
const canonical=realpathSync(out),repository=realpathSync(repo);
if(canonical===repository||canonical.startsWith(repository+'/')||repository.startsWith(canonical+'/'))throw Error('Source-audit output cannot overlap the repository.');
const manifest=JSON.parse(readFileSync(join(repo,'scripts/source-only-audit-manifest.json'),'utf8'));
const require=createRequire(join(repo,'artifacts/api-server/package.json')),uiRequire=createRequire(join(repo,'artifacts/allocation-lab/package.json'));
const {build}=require('esbuild');
const env={...process.env,NODE_ENV:'production',DATABASE_URL:'',WORKBENCH_DATASET_DIR:join(out,'dataset-store')};
for(const k of Object.keys(env))if(/ACCEPTANCE|_SEED_|WORKBENCH_B3A_PIT/.test(k)||['WORKBENCH_RUN_DIR','WORKBENCH_REPOSITORY_ROOT'].includes(k))delete env[k];
const syntheticRoot=join(out,'certified-runtime');mkdirSync(syntheticRoot,{recursive:true});
try{symlinkSync(join(repo,'research'),join(syntheticRoot,'research'),'dir');}catch(e){if(e.code!=='EEXIST')throw e;}
for(const directory of ['reports/al01/amendment-a','reports/al04','reports/cl04','reports/bank01'])mkdirSync(join(syntheticRoot,directory),{recursive:true});
const results=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const baseline=manifest.known_baseline_failure;
const proof=baseline.proof_files.map(file=>{const before=execFileSync('git',['show',baseline.baseline_commit+':'+file],{cwd:repo}),after=readFileSync(join(repo,file));return{file,baseline_sha256:hash(before),current_sha256:hash(after),byte_identical:before.equals(after)};});
function report(){
 const counts=Object.fromEntries(['tests','pass','fail','skipped'].map(k=>[k,results.reduce((s,r)=>s+(r[k]??0),0)]));
 writeFileSync(join(out,'results.json'),JSON.stringify({scope:'SUPPLEMENTAL_SOURCE_ONLY_NO_PRIVATE_RUNTIME_CERTIFICATION',totals:counts,results,unavailable_cases:manifest.mixed_coordinated.unavailable_cases,unavailable_suites:manifest.unavailable_suites,known_baseline_failure:{...baseline,proof},database_access:'FORBIDDEN_BY_TEST_SHIM',synthetic_sources:'Committed test generators only; no private CSV restored or replaced.'},null,2)+'\n');
}
const escape=x=>Array.from(x,c=>'^$.*+?()[]{}|'.includes(c)||c.charCodeAt(0)===92?String.fromCharCode(92)+c:c).join('');
for(const literal of ['(', '[', 'a.b+$', String.fromCharCode(92)])if(!new RegExp('^'+escape(literal)+'$').test(literal))throw Error('Test-name escaping failed');
async function run(file,{kind='node',cwd=repo,selected,skipped,contents}={}){
 const id=String(results.length).padStart(3,'0')+'-'+file.replace(/[^a-zA-Z0-9.-]/g,'_'),target=join(out,id+'.mjs');
 try{
 await build({...(contents?{stdin:{contents,resolveDir:repo,loader:'ts'}}:{entryPoints:[join(repo,file)]}),outfile:target,bundle:true,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},
  define:{'import.meta.url':JSON.stringify(pathToFileURL(join(repo,file)).href)},
  alias:{'@workspace/db/schema':join(repo,'lib/db/src/schema/index.ts'),react:uiRequire.resolve('react'),'react/jsx-runtime':uiRequire.resolve('react/jsx-runtime'),'react-dom/server':uiRequire.resolve('react-dom/server')},
  banner:{js:`import {createRequire as cr} from 'node:module';globalThis.require=cr(${JSON.stringify(join(repo,'artifacts/api-server/package.json'))});`},
  plugins:[{name:'forbid-database',setup(b){b.onResolve({filter:/^@workspace\/db$/},()=>({path:'forbidden',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export * from ${JSON.stringify(join(repo,'lib/db/src/schema/index.ts'))};const forbidden=()=>{throw Error('SOURCE_ONLY_DATABASE_FORBIDDEN')};export const pool={query:forbidden,connect:forbidden,end:async()=>{}};export const db=new Proxy({}, {get(){return forbidden}});`,resolveDir:repo,loader:'ts'}));}}],logLevel:'silent'});
 const args=kind==='node'?['--test','--test-reporter=tap',...(selected?['--test-name-pattern=^(?:'+selected.map(escape).join('|')+')$']:[]),...(skipped?['--test-skip-pattern='+skipped]:[]),target]:[target,join(out,id+'-artifacts')];
 const child=spawnSync(process.execPath,args,{cwd,env,encoding:'utf8',timeout:120000,maxBuffer:20*1024*1024});
 const log=(child.stdout??'')+(child.stderr??'');writeFileSync(join(out,id+'.log'),log);
 const count=k=>Number(log.match(new RegExp('^# '+k+' (\\d+)','m'))?.[1]??0);
 const counts=kind==='node'?Object.fromEntries(['tests','pass','fail','skipped'].map(k=>[k,count(k)])):{pass:log.split('\n').filter(l=>l.startsWith('PASS ')).length,fail:log.split('\n').filter(l=>l.startsWith('FAIL ')).length,skipped:0};if(kind!=='node')counts.tests=counts.pass+counts.fail;
 results.push({file,kind,exit_code:child.status,signal:child.signal,error:child.error?.message??null,status:child.status===0?'PASS':'FAIL',...counts,log:id+'.log',selected_test_names:selected??null,excluded_pattern:skipped??null});
 }catch(e){results.push({file,status:'BUILD_BLOCKED',error:String(e.message).slice(0,3000)});}
 report();console.log(results.at(-1).status,file,results.at(-1).tests??'');
}
for(const file of manifest.standalone_source_files)await run(file);
for(const {file,kind} of manifest.certified_source_suites)await run(file,{kind,cwd:syntheticRoot});
await run('artifacts/api-server/src/lib/workbench/repository-root.test.ts');
await run('artifacts/api-server/src/lib/workbench/workbench.test.ts',{skipped:'integrated application|empirical API acceptance'});
await run('artifacts/api-server/src/lib/workbench/interactive.test.ts',{selected:['Arbitrary dates and arbitrary finite nonnegative costs are explicit; unknown/invalid values fail closed',baseline.test]});
await run('research/coordinated/mixed-source-audit.test.ts',{selected:manifest.mixed_coordinated.selected_test_names,contents:manifest.mixed_coordinated.entrypoints.map(file=>`import ${JSON.stringify(join(repo,file))};`).join('\n')});
console.log('Source-only report:',join(out,'results.json'));
process.exitCode=results.some(r=>r.status!=='PASS')?1:0;
