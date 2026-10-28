import {canonicalHash,metadata,object,timestamp} from '../validation';
import {eigen} from '../assets-engine/numerics';
import {FACTOR_ENGINE_VERSION,type FactorsInput,type AssetFactorLoadingMatrix,type FactorRiskModel,type FactorTrackingMetric} from './contracts';
export function loadingHash(b:AssetFactorLoadingMatrix):string {
 const fs=[...b.factor_ids].sort(),as=[...b.asset_ids].sort();return canonicalHash({orientation:b.orientation,units:b.units,factor_ids:fs,asset_ids:as,factor_units:b.factor_units,factor_kinds:b.factor_kinds,loadings:fs.map(f=>as.map(a=>b.loadings[b.factor_ids.indexOf(f)][b.asset_ids.indexOf(a)])),model_id:b.model_id,model_version:b.model_version});
}
export function riskHash(r:FactorRiskModel):string {
 const fs=[...r.factor_ids].sort(),as=[...r.asset_ids].sort(),d=r.specific_risk;
 const specific=d.representation==='ZERO_SPECIFIC_RISK'?d:d.representation==='DIAGONAL_VARIANCES'?{...d,values:as.map(a=>d.values[r.asset_ids.indexOf(a)])}:{...d,values:as.map(a=>as.map(b=>d.values[r.asset_ids.indexOf(a)][r.asset_ids.indexOf(b)]))};
 return canonicalHash({factor_ids:fs,asset_ids:as,factor_units:r.factor_units,factor_return_units:r.factor_return_units,covariance_units:r.covariance_units,phi:fs.map(f=>fs.map(g=>r.phi[r.factor_ids.indexOf(f)][r.factor_ids.indexOf(g)])),specific_risk:specific,model_id:r.model_id,model_version:r.model_version});
}
export function trackingHash(w:FactorTrackingMetric):string {
 const fs=[...w.factor_ids].sort();return canonicalHash({factor_ids:fs,units:w.units,weights:fs.map(f=>fs.map(g=>w.weights[w.factor_ids.indexOf(f)][w.factor_ids.indexOf(g)])),metric_id:w.metric_id,metric_version:w.metric_version});
}
export function matrices(x:FactorsInput) {
 const assets=[...x.assets].sort(),factors=[...x.target.factor_ids].sort(),B=factors.map(f=>assets.map(a=>x.loadings.loadings[x.loadings.factor_ids.indexOf(f)][x.loadings.asset_ids.indexOf(a)])),rawP=factors.map(f=>factors.map(g=>x.risk_model.phi[x.risk_model.factor_ids.indexOf(f)][x.risk_model.factor_ids.indexOf(g)])),sr=x.risk_model.specific_risk;
 const rawD=assets.map(a=>assets.map(b=>sr.representation==='ZERO_SPECIFIC_RISK'?0:sr.representation==='DIAGONAL_VARIANCES'?(a===b?sr.values[x.risk_model.asset_ids.indexOf(a)]:0):sr.values[x.risk_model.asset_ids.indexOf(a)][x.risk_model.asset_ids.indexOf(b)]));
 const rawW=factors.map(f=>factors.map(g=>x.tracking_metric.weights[x.tracking_metric.factor_ids.indexOf(f)][x.tracking_metric.factor_ids.indexOf(g)]));
 // Validation checks raw asymmetry first. Only its declared numerical symmetric part is used; no eigenvalue lift.
 const symmetric=(m:number[][])=>m.map((r,i)=>r.map((v,j)=>(v+m[j][i])/2)),P=symmetric(rawP),D=symmetric(rawD),W=symmetric(rawW);
 const Sigma=assets.map((_,i)=>assets.map((_,j)=>D[i][j]+factors.reduce((s,_,k)=>s+factors.reduce((t,_,l)=>t+B[k][i]*P[k][l]*B[l][j],0),0)));
 return{assets,factors,B,P,D,W,rawP,rawD,rawW,Sigma,target:factors.map(f=>x.target.target_exposures[f])};
}
export function validateFactors(value:unknown):string[] {
 const errors:string[]=[];
 try {
 const r=object(value,['schema_version','allocation_mode','convention','assets','target','loadings','risk_model','tracking_metric','beta_estimates','previous_holdings','constraints','implementation','solver','as_of','information_cutoff','provenance'],'factor_input',errors);metadata(r,'input',errors);const x=r as unknown as FactorsInput;
 if(x.schema_version!==FACTOR_ENGINE_VERSION||x.allocation_mode!=='FACTORS'||x.convention!=='LONG_ONLY_FULLY_INVESTED')errors.push('Version/mode/convention invalid');
 if(timestamp(x.information_cutoff)===null||timestamp(x.as_of)===null||timestamp(x.information_cutoff)!>=timestamp(x.as_of)!)errors.push('Strict prior-decision information cutoff required');
 const ids=(v:unknown,name:string)=>{if(!Array.isArray(v)||!v.length||v.some(a=>typeof a!=='string'||!a.trim()||['__proto__','constructor','prototype','CASH','masterCash','totalCash'].includes(a))||new Set(v).size!==v.length)errors.push(name+': unique nonempty noncash IDs required');return v as string[];};
 const same=(a:string[],b:string[])=>a.length===b.length&&[...a].sort().every((v,i)=>v===[...b].sort()[i]);
 const point=(v:unknown,name:string,keys:string[])=>{const p=object(v,[...keys,'as_of','information_cutoff','provenance'],name,errors);metadata(p,name,errors,x,true);return p;};
 const assets=ids(x.assets,'assets');
 const cfg=object(x.solver,['feasibility_tolerance','stationarity_tolerance','psd_tolerance','symmetry_tolerance','erc_relative_tolerance','max_iterations','max_faces','max_supports','factor_tolerance','rank_tolerance','tracking_tie_tolerance','secondary_tie_tolerance'],'solver',errors);
 if(Object.keys(cfg).length!==12)errors.push('All numerical settings explicitly required');
 for(const[k,v]of Object.entries(cfg))if(typeof v!=='number'||!Number.isFinite(v)||v<=0||k.startsWith('max_')&&!Number.isInteger(v))errors.push('Invalid solver setting '+k);
 const t=point(x.target,'target',['kind','target_id','target_version','factor_ids','units','factor_units','target_exposures']),factors=ids(t.factor_ids,'target factors');
 if(t.kind!=='FACTOR_EXPOSURE_TARGET'||t.units!=='factor_exposure'||typeof t.target_id!=='string'||!t.target_id||typeof t.target_version!=='string'||!t.target_version)errors.push('Explicit versioned exposure target required; scores/capital weights are not targets');
 const vector=(v:Record<string,number>,axis:string[],name:string)=>{if(!v||!same(Object.keys(v),axis)||Object.values(v).some(z=>!Number.isFinite(z)))errors.push(name+': finite same-axis vector required');};
 vector(x.target.target_exposures,factors,'target exposures');
 const unitMap=(units:Record<string,string>,name:string)=>{if(!units||!same(Object.keys(units),factors)||Object.values(units).some(u=>!['DIMENSIONLESS','DAILY_RETURN_LOADING'].includes(u)))errors.push(name+': declared factor exposure units required');};unitMap(x.target.factor_units,'target');
 const b=point(x.loadings,'loadings',['kind','orientation','factor_ids','asset_ids','units','factor_units','factor_kinds','loadings','model_id','model_version','matrix_hash']);
 if(b.kind!=='FACTOR_LOADING_MATRIX'||b.orientation!=='FACTORS_BY_ASSETS'||b.units!=='factor_exposure_per_unit_risk_weight')errors.push('B requires explicit loading semantics and FACTORS_BY_ASSETS orientation');
 if(!same(ids(b.factor_ids,'loading factors'),factors)||!same(ids(b.asset_ids,'loading assets'),assets))errors.push('Loading axes mismatch');
 unitMap(x.loadings.factor_units,'loadings');if(canonicalHash(x.loadings.factor_units)!==canonicalHash(x.target.factor_units))errors.push('Target/loading units mismatch');
 if(!same(Object.keys(x.loadings.factor_kinds),factors)||Object.values(x.loadings.factor_kinds).some(k=>!['STATISTICAL_FACTOR','ECONOMIC_FACTOR','TRADABLE_FACTOR_PORTFOLIO'].includes(k)))errors.push('Scoring/SIGNAL_FEATURE definitions cannot be loadings');
 const matrix=(m:number[][],n:number,k:number,name:string,psd=false)=>{
  if(!Array.isArray(m)||m.length!==n||m.some(r=>!Array.isArray(r)||r.length!==k||r.some(z=>!Number.isFinite(z)))){errors.push(name+': finite dimensions invalid');return;}
  if(psd){if(m.some((r,i)=>r[i]<0||r.some((z,j)=>Math.abs(z-m[j][i])>x.solver.symmetry_tolerance))){errors.push(name+': nonnegative symmetric matrix required');return;}
   const sym=m.map((r,i)=>r.map((z,j)=>(z+m[j][i])/2)),e=eigen(sym,x.solver.max_iterations);if(!e.converged||Math.min(...e.values)<-x.solver.psd_tolerance)errors.push(name+': PSD/eigendecomposition check failed');}}
 matrix(x.loadings.loadings,factors.length,assets.length,'B');
 if(x.loadings.provenance.model?.id!==x.loadings.model_id||x.loadings.provenance.model?.version!==x.loadings.model_version||!x.loadings.model_version||x.loadings.matrix_hash!==loadingHash(x.loadings))errors.push('Loading model identity/content hash invalid');
 const risk=point(x.risk_model,'factor risk',['kind','factor_ids','asset_ids','factor_units','factor_return_units','covariance_units','phi','specific_risk','model_id','model_version','model_hash']);
 if(risk.kind!=='FACTOR_RISK_MODEL'||risk.covariance_units!=='factor_return_covariance_in_declared_units'||!same(ids(risk.factor_ids,'risk factors'),factors)||!same(ids(risk.asset_ids,'risk assets'),assets))errors.push('Factor risk units/axes invalid');
 unitMap(x.risk_model.factor_units,'risk');if(canonicalHash(x.risk_model.factor_units)!==canonicalHash(x.target.factor_units))errors.push('Risk/target factor exposure units mismatch');
 if(!same(Object.keys(x.risk_model.factor_return_units),factors))errors.push('Factor-return units required on exact factor axis');
 for(const f of factors){const required=x.risk_model.factor_units[f]==='DIMENSIONLESS'?'DAILY_DECIMAL_RETURN':'STANDARDIZED_DAILY_SHOCK';if(x.risk_model.factor_return_units[f]!==required)errors.push('Factor return/loading dimensions do not imply daily asset return variance: '+f);}
 matrix(x.risk_model.phi,factors.length,factors.length,'Phi',true);
 const d=x.risk_model.specific_risk,specific=object(d,['representation','units',...(d?.representation==='ZERO_SPECIFIC_RISK'?[]:['values'])],'specific risk',errors);
 if(specific.units!=='daily_decimal_return_squared')errors.push('Specific risk daily variance units invalid');
 if(d.representation==='FULL_COVARIANCE')matrix(d.values,assets.length,assets.length,'D',true);
 else if(d.representation==='DIAGONAL_VARIANCES'){if(!Array.isArray(d.values)||d.values.length!==assets.length||d.values.some(v=>!Number.isFinite(v)||v<0))errors.push('Specific variances finite nonnegative same asset axis required');}
 else if(d.representation!=='ZERO_SPECIFIC_RISK')errors.push('Specific risk missing; explicit ZERO_SPECIFIC_RISK required for zero');
 if(x.risk_model.provenance.model?.id!==x.risk_model.model_id||x.risk_model.provenance.model?.version!==x.risk_model.model_version||!x.risk_model.model_version||x.risk_model.model_hash!==riskHash(x.risk_model))errors.push('Risk model identity/content hash invalid');
 const w=point(x.tracking_metric,'tracking metric',['factor_ids','units','weights','metric_id','metric_version','metric_hash']);
 if(w.units!=='inverse_factor_exposure_squared'||!same(ids(w.factor_ids,'W factors'),factors)||!x.tracking_metric.metric_id||!x.tracking_metric.metric_version||x.tracking_metric.metric_hash!==trackingHash(x.tracking_metric))errors.push('Explicit tracking metric W units/axes/version/hash invalid');matrix(x.tracking_metric.weights,factors.length,factors.length,'W',true);
 const betas=point(x.beta_estimates,'betas',['values','beta_model']);vector(x.beta_estimates.values,assets,'market betas');
 const bm=object(x.beta_estimates.beta_model,['benchmark','estimation_window','estimator','as_of','information_cutoff','data_hash'],'beta model',errors),win=x.beta_estimates.beta_model.estimation_window;
 if(!bm.benchmark||!['OLS_COV_VARIANCE_SAMPLE_V1','SUPPLIED_ASSET_BETAS_V1'].includes(String(bm.estimator))||timestamp(bm.as_of)===null||timestamp(bm.as_of)!>timestamp(x.information_cutoff)!||timestamp(bm.information_cutoff)===null||timestamp(bm.information_cutoff)!>timestamp(bm.as_of)!||bm.data_hash!==x.beta_estimates.provenance.data_hash||!win||timestamp(win.start)===null||timestamp(win.end)===null||win.start>win.end||win.end>String(bm.information_cutoff)||!Number.isInteger(win.observations)||win.observations<2)errors.push('Invalid/future beta estimate metadata');
 void betas;
 const c=object(x.constraints,['asset_bounds','group_caps','max_active_names','turnover_cap'],'constraints',errors);if(Object.keys(c).length!==4)errors.push('Constraints explicitly required');
 for(const[a,v]of Object.entries(x.constraints.asset_bounds)){object(v,['min','max'],'bound',errors);if(!assets.includes(a)||!Number.isFinite(v.min)||!Number.isFinite(v.max)||v.min<0||v.max>1)errors.push('Invalid sleeve asset bound');}
 for(const g of x.constraints.group_caps){object(g,['id','assets','max'],'group',errors);if(!g.id||!g.assets.length||new Set(g.assets).size!==g.assets.length||g.assets.some(a=>!assets.includes(a))||!Number.isFinite(g.max)||g.max<0||g.max>1)errors.push('Invalid sleeve group cap');}
 if(x.constraints.max_active_names!==null&&(!Number.isInteger(x.constraints.max_active_names)||x.constraints.max_active_names<1||x.constraints.max_active_names>assets.length))errors.push('Invalid max active names');
 if(x.constraints.turnover_cap!==null&&(!Number.isFinite(x.constraints.turnover_cap)||x.constraints.turnover_cap<0||x.constraints.turnover_cap>2||!x.previous_holdings))errors.push('Turnover cap requires previous sleeve q and gross-L1 budget[0,2]');
 if(x.previous_holdings){const prev=point(x.previous_holdings,'previous',['units','asset_weights']);vector(x.previous_holdings.asset_weights,assets,'previous q');if(prev.units!=='fraction_of_risk_capital'||Object.values(x.previous_holdings.asset_weights).some(v=>v<0)||Math.abs(Object.values(x.previous_holdings.asset_weights).reduce((s,v)=>s+v,0)-1)>x.solver.feasibility_tolerance)errors.push('Previous q must be long-only fully invested on same asset axis');}
 const impl=object(x.implementation,['mode','secondary',...(x.implementation?.mode==='MIN_FACTOR_TRACKING_ERROR'?['secondary_rule']:[])],'implementation',errors);
 if(!['EXACT_FACTOR_TARGET','MIN_FACTOR_TRACKING_ERROR'].includes(String(impl.mode)))errors.push('Explicit implementation mode required');
 if(impl.secondary!==null&&!['SPECIFIC_VARIANCE','TOTAL_VARIANCE','TURNOVER'].includes(String(impl.secondary))||impl.mode==='EXACT_FACTOR_TARGET'&&impl.secondary===null)errors.push('Declared secondary criterion required for exact implementation');
 if(impl.mode==='MIN_FACTOR_TRACKING_ERROR'&&impl.secondary_rule!=='EXACT_LEXICOGRAPHIC_ARGMIN')errors.push('Approximate secondary must be explicitly lexicographic');
 if(impl.secondary==='TURNOVER'&&!x.previous_holdings)errors.push('TURNOVER objective requires previous q');
 canonicalHash(value);
 }catch(error){errors.push('Malformed/nonfinite factor input: '+String(error));}
 return errors;
}
/** Select complete supplied artifact snapshots; no model fitting or score conversion. */
export function selectPointInTime(history:FactorsInput[],decisionDate:string):{status:'VALID'|'INVALID_INPUT'|'INSUFFICIENT_DATA';input:FactorsInput|null;errors:string[]} {
 const time=timestamp(decisionDate);if(time===null)return{status:'INVALID_INPUT',input:null,errors:['Invalid decision date']};
 const eligible=history.filter(x=>timestamp(x.as_of)!==null&&timestamp(x.as_of)!<=time).sort((a,b)=>timestamp(b.as_of)!-timestamp(a.as_of)!);
 if(!eligible.length)return{status:'INSUFFICIENT_DATA',input:null,errors:['No supplied factor artifact snapshot as of decision']};
 if(eligible.length>1&&eligible[0].as_of===eligible[1].as_of)return{status:'INVALID_INPUT',input:null,errors:['Ambiguous same-as-of factor snapshots; no implicit model selection']};
 const input={...structuredClone(eligible[0]),as_of:decisionDate},errors=validateFactors(input);return errors.length?{status:'INVALID_INPUT',input:null,errors}:{status:'VALID',input,errors:[]};
}
