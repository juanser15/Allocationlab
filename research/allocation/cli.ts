import {readFileSync,mkdirSync} from 'node:fs';
import {canonicalHash} from '../../artifacts/api-server/src/lib/allocation-core/validation';
import {atomicJson} from '../capital/storage';
import {runCampaign,planning} from './engine';
import {frozenAssetsData,acceptanceSpec,codeHashes,sourcePaths,shaFile} from './data';
import {candidates} from './spec';
import type {Campaign} from './contracts';
const args=process.argv.slice(2),root='reports/al07';mkdirSync(root+'/configs',{recursive:true});
if(args.includes('--prepare')){for(const mode of ['TRADITIONAL_WALK_FORWARD','NESTED_WALK_FORWARD'] as const){const c=acceptanceSpec(mode);atomicJson(root+'/configs/'+c.campaign_id+'.json',c);}console.log('Prepared fixed acceptance definitions, no performance');}
else{const file=args.find(a=>a.endsWith('.json'));if(!file||['DRY_RUN','EXECUTE'].filter(m=>args.includes('--'+m)).length!==1)throw Error('Usage: campaign.json --DRY_RUN | --EXECUTE [--max-new-jobs N]');
 const c=JSON.parse(readFileSync(file,'utf8')) as Campaign,data=frozenAssetsData(),hashes=codeHashes(),code=canonicalHash(hashes),dir=root+'/campaigns/'+c.campaign_id,mode=args.includes('--EXECUTE')?'EXECUTE':'DRY_RUN';
 const index=args.indexOf('--max-new-jobs'),result=runCampaign(c,data,dir,{mode,code_hash:code,max_new_jobs:index>=0?Number(args[index+1]):undefined});
 atomicJson(dir+'/code-hashes.json',hashes);atomicJson(dir+'/source-hashes.json',Object.fromEntries(sourcePaths.map(p=>[p,shaFile(p)])));atomicJson(dir+'/last-invocation.json',{mode,status:result.status,new_jobs:result.new_jobs,reused_jobs:result.reused_jobs,backtests:result.backtests});console.log(JSON.stringify({campaign:c.campaign_id,...planning(c,data),...{status:result.status,new_jobs:result.new_jobs,reused_jobs:result.reused_jobs,backtests:result.backtests}}));
}
