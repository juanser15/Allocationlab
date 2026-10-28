/** External diagnostic adapter to frozen AL02 PIT estimator; no signals/alpha fits. */
import {estimatePitSleeve,type ReturnVector} from '../risk-analytics/estimators';
import {canonicalHash} from '../validation';
import {betaHash} from './validation';
import type {BetaArtifact} from './contracts';
export function estimateStrategyBetas(rows:ReturnVector[],ids:string[],decision:string,window:63|126|252=252,minimum=window,benchmark='SPY'):{status:string;errors:string[];artifact:BetaArtifact|null}{
 const pit=estimatePitSleeve(rows,Object.fromEntries(ids.map(id=>[id,1/ids.length])),decision,{benchmark,window_sessions:window,minimum_observations:minimum});
 if(pit.status!=='VALID')return{status:pit.status,errors:pit.errors,artifact:null};
 const cutoff=pit.information_cutoff!,artifact:BetaArtifact={as_of:cutoff,information_cutoff:cutoff,provenance:{data_hash:pit.data_hash,configuration_hash:pit.configuration_hash,source_ids:['SUPPLIED_NET_STRATEGY_RETURN_HISTORY',benchmark],data_available_at:cutoff,model:{id:'STRATEGY_RETURN_SAMPLE_COV_VARIANCE',version:pit.version}},axis_ids:[...ids].sort(),values:Object.fromEntries(pit.asset_betas.map(b=>[b.asset,b.beta])),beta_method:'STRATEGY_RETURN_SAMPLE_COV_VARIANCE',benchmark,window:{start:pit.window_start!,end:pit.window_end!,observations:pit.observations},artifact_hash:''};artifact.artifact_hash=betaHash(artifact);canonicalHash(artifact);return{status:'VALID',errors:[],artifact};
}
