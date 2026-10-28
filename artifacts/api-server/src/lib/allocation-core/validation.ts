import { createHash } from "node:crypto";
import { CONTRACT_VERSION, WEIGHT_TOLERANCE, NUMERICAL_TOLERANCE,
  type CapitalLayerOutput, type AssetsAllocationInput, type FactorsAllocationInput,
  type AlphaStreamsAllocationInput, type AssetDecisionWeights, type AlphaCapitalDecision,
  type RiskSleeveAllocationResult, type PointInTime, type AllocationConvention,
  type ValidationResult, type AssetFactorLoadingMatrix } from "./contracts";

type RecordValue = Record<string, unknown>;
const fail = (errors: string[], path: string, reason: string) => errors.push(`${path}: ${reason}`);
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const nonempty = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const digest = (x: unknown) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const plain = (x: unknown): x is RecordValue => !!x && typeof x === "object" && !Array.isArray(x) && [Object.prototype,null].includes(Object.getPrototypeOf(x));
const orderedValues=(w:Record<string,number>)=>Object.keys(w).sort().map(k=>w[k]);
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (finite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  throw new Error("Canonical input must be finite plain JSON, without undefined/functions/prototypes");
}
export const canonicalHash = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");
function sameJson(a: unknown,b: unknown) {try{return canonicalJson(a)===canonicalJson(b);}catch{return false;}}
export function loadingMatrixHash(m: Pick<AssetFactorLoadingMatrix,"units"|"orientation"|"factor_ids"|"instrument_ids"|"values">) {
  return canonicalHash({units:m.units,orientation:m.orientation,factor_ids:m.factor_ids,instrument_ids:m.instrument_ids,values:m.values});
}
export function object(x: unknown, keys: string[], path: string, errors: string[]): RecordValue {
  if (!plain(x)) { fail(errors,path,"plain object required");return {}; }
  for(const k of Object.keys(x))if(!keys.includes(k))fail(errors,path,`unexpected field ${k} (cash targets cannot be introduced downstream)`);
  return x;
}
const text = (x: unknown,path: string,e: string[])=>{if(!nonempty(x))fail(e,path,"nonempty string required");};
const number = (x: unknown,path: string,e: string[])=>{if(!finite(x))fail(e,path,"finite number required");};
const literal = (x: unknown,allowed: readonly unknown[],path: string,e: string[])=>{if(!allowed.includes(x))fail(e,path,`expected ${allowed.join(" / ")}`);};
export function timestamp(x: unknown): number | null {
  if(typeof x!=="string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(x))return null;
  const t=Date.parse(x);if(!Number.isFinite(t))return null;
  const normalized=new Date(t).toISOString();
  return (x.length===10?normalized.slice(0,10)===x:normalized===(x.includes(".")?x:x.replace("Z",".000Z")))?t:null;
}
function date(x: unknown,path: string,e: string[]) { if(timestamp(x)===null)fail(e,path,"valid UTC ISO date/timestamp required"); }
function strings(x: unknown,path: string,e: string[]): string[] {
  if(!Array.isArray(x)){fail(e,path,"array required");return [];}
  x.forEach((v,i)=>text(v,`${path}[${i}]`,e));
  if(new Set(x).size!==x.length)fail(e,path,"unique IDs required");
  if(x.some(v=>["__proto__","constructor","prototype"].includes(v)))fail(e,path,"reserved ID");
  return x.filter(nonempty);
}
function weights(x: unknown,path: string,e: string[]): Record<string,number> {
  if(!plain(x)){fail(e,path,"keyed finite vector required");return {};}
  const values: Record<string,number>={};
  for(const [k,v] of Object.entries(x)){text(k,path,e);if(["__proto__","constructor","prototype"].includes(k))fail(e,path,"reserved ID");number(v,path+"."+k,e);if(finite(v))values[k]=v;}
  return values;
}
function exactIds(actual: string[],expected: string[],path: string,e: string[]) {
  if(actual.length!==expected.length||actual.some(k=>!expected.includes(k)))fail(e,path,"axis/key IDs must match exactly");
}
const META=["as_of","information_cutoff","provenance"];
export function metadata(x: RecordValue,path: string,e: string[],parent?: PointInTime,dataObject=false) {
  date(x.as_of,path+".as_of",e);date(x.information_cutoff,path+".information_cutoff",e);
  const a=timestamp(x.as_of),cut=timestamp(x.information_cutoff);
  if(a!==null&&cut!==null&&cut>a)fail(e,path,"information_cutoff after as_of");
  const p=object(x.provenance,["data_hash","configuration_hash","source_ids","data_available_at","model"],path+".provenance",e);
  if(!digest(p.data_hash)||!digest(p.configuration_hash))fail(e,path,"SHA256 data/configuration hashes required");
  if(!strings(p.source_ids,path+".source_ids",e).length)fail(e,path,"source IDs required");
  date(p.data_available_at,path+".data_available_at",e);
  const available=timestamp(p.data_available_at);
  if(available!==null&&cut!==null&&available>cut)fail(e,path,"data published after information cutoff");
  if(p.model!==null){const m=object(p.model,["id","version"],path+".model",e);text(m.id,path+".model.id",e);text(m.version,path+".model.version",e);}
  if(parent){
    const pc=timestamp(parent.information_cutoff),pa=timestamp(parent.as_of);
    if(a!==null&&pa!==null&&a>pa)fail(e,path,"object as_of after parent as_of");
    if(cut!==null&&pc!==null&&cut>pc)fail(e,path,"object cutoff after parent cutoff");
    if(dataObject&&a!==null&&pc!==null&&a>pc)fail(e,path,"matrix/map/forecast/history dated after decision cutoff");
    if(available!==null&&pc!==null&&available>pc)fail(e,path,"future input availability");
  }
}
function riskModel(x: unknown,axis: string[],parent: PointInTime,path: string,e: string[]) {
  const r=object(x,[...META,"representation","units","axis_ids","covariance"],path,e);metadata(r,path,e,parent,true);
  literal(r.representation,["COVARIANCE"],path,e);literal(r.units,["daily_decimal_return_squared"],path,e);
  const ids=strings(r.axis_ids,path+".axis_ids",e);exactIds(ids,axis,path,e);
  if(!Array.isArray(r.covariance)||r.covariance.length!==ids.length||!ids.length){fail(e,path,"nonempty square covariance required");return;}
  const m=r.covariance;
  if(m.some(row=>!Array.isArray(row)||row.length!==ids.length||row.some(v=>!finite(v)))){fail(e,path,"finite covariance dimensions required");return;}
  const matrix=m as number[][];
  const scale=Math.max(1,...matrix.flat().map(Math.abs));
  if(matrix.some((row,i)=>row[i]<0||row.some((v,j)=>Math.abs(v-matrix[j][i])>NUMERICAL_TOLERANCE*scale))){fail(e,path,"nonnegative symmetric covariance required");return;}
  // Contract-level PSD check (LDL), no fitting, regularization or risk-quality gate.
  const l=matrix.map(row=>row.map(()=>0)),d:number[]=[];
  for(let i=0;i<ids.length;i++){
    for(let j=0;j<i;j++){
      const v=matrix[i][j]-l[i].slice(0,j).reduce((s,a,k)=>s+a*d[k]*l[j][k],0);
      if(Math.abs(d[j])<=NUMERICAL_TOLERANCE*scale){if(Math.abs(v)>NUMERICAL_TOLERANCE*scale){fail(e,path,"covariance not PSD");return;}l[i][j]=0;}
      else l[i][j]=v/d[j];
    }
    d[i]=matrix[i][i]-l[i].slice(0,i).reduce((s,a,k)=>s+a*a*d[k],0);l[i][i]=1;
    if(!finite(d[i])||d[i]<-NUMERICAL_TOLERANCE*scale){fail(e,path,"covariance not PSD/finite");return;}
  }
}
function forecast(x: unknown,axis: string[],parent: PointInTime,path: string,e: string[]) {
  const f=object(x,[...META,"units","values"],path,e);metadata(f,path,e,parent,true);
  literal(f.units,["daily_decimal_return"],path,e);exactIds(Object.keys(weights(f.values,path+".values",e)),axis,path,e);
}
function convention(x: unknown,path: string,e: string[]) {
  const c=object(x,["kind","funding","mandate"],path,e);
  literal(c.kind,["LONG_ONLY_FULLY_INVESTED","SIGNED_EXPOSURES"],path,e);
  literal(c.funding,["NET_ONE_WITH_GLOBAL_CASH","EXPOSURES_WITH_EXTERNAL_FINANCING"],path,e);
  const m=object(c.mandate,["allow_short","allow_leverage","allow_external_financing","max_gross_exposure","min_net_exposure","max_net_exposure"],path+".mandate",e);
  for(const k of ["allow_short","allow_leverage","allow_external_financing"])literal(m[k],[true,false],path+"."+k,e);
  for(const k of ["max_gross_exposure","min_net_exposure","max_net_exposure"])number(m[k],path+"."+k,e);
  if(finite(m.max_gross_exposure)&&m.max_gross_exposure<0||finite(m.min_net_exposure)&&finite(m.max_net_exposure)&&m.min_net_exposure>m.max_net_exposure)fail(e,path,"incompatible mandate bounds");
  if(c.kind==="LONG_ONLY_FULLY_INVESTED"&&(c.funding!=="NET_ONE_WITH_GLOBAL_CASH"||m.allow_short!==false||m.allow_leverage!==false))fail(e,path,"long-only fully-invested convention cannot permit short/leverage");
}
function constraints(x: unknown,assets: string[],path: string,e: string[]) {
  const c=object(x,["convention","asset_bounds"],path,e);convention(c.convention,path+".convention",e);
  if(!plain(c.asset_bounds)){fail(e,path,"asset_bounds object required");return;}
  for(const [id,v] of Object.entries(c.asset_bounds)){
    if(!assets.includes(id))fail(e,path,"bounds reference noncandidate asset");
    const b=object(v,["min","max"],path+"."+id,e);number(b.min,path,e);number(b.max,path,e);
    if(finite(b.min)&&finite(b.max)&&b.min>b.max)fail(e,path,"min > max");
  }
}
function assets(x: unknown,path: string,e: string[]): string[] {
  if(!Array.isArray(x)){fail(e,path,"candidate assets array required");return [];}
  const ids=x.map((a,i)=>{const r=object(a,["instrument_id","kind"],`${path}[${i}]`,e);literal(r.kind,["TRADABLE_INSTRUMENT"],path,e);return r.instrument_id;});
  const out=strings(ids,path,e);if(!out.length)fail(e,path,"nonempty asset universe required");return out;
}
function finish<T>(input: unknown,e: string[],insufficient=false):ValidationResult<T> {
  try{canonicalJson(input);}catch(error){fail(e,"input",String(error));}
  return e.length?{status:insufficient?"INSUFFICIENT_DATA":"INVALID_INPUT",value:null,errors:e}:{status:"VALID",value:structuredClone(input) as T,errors:[]};
}
function base(input: unknown,mode: string,extras: string[],e: string[]) {
  const r=object(input,[...META,"schema_version","allocation_mode",...extras],"input",e);
  literal(r.schema_version,[CONTRACT_VERSION],"schema_version",e);literal(r.allocation_mode,[mode],"allocation_mode",e);metadata(r,"input",e);return r;
}
export function validateCapitalOutput(input: unknown):ValidationResult<CapitalLayerOutput> {
  const e:string[]=[],c=object(input,[...META,"schema_version","policy_id","policy_version","risk_budget","cash_budget","state","confidence","confidence_semantics","generated_at"],"capital",e);
  metadata(c,"capital",e);literal(c.schema_version,[CONTRACT_VERSION,"allocation-core-1.0.0"],"schema_version",e);
  text(c.policy_id,"policy_id",e);text(c.policy_version,"policy_version",e);date(c.generated_at,"generated_at",e);
  if(!("state" in c))fail(e,"state","explicit JSON state required (null is allowed)");
  const generated=timestamp(c.generated_at),asof=timestamp(c.as_of);if(generated!==null&&asof!==null&&generated<asof)fail(e,"capital","generated_at before as_of");
  for(const k of ["risk_budget","cash_budget"]){number(c[k],k,e);if(finite(c[k])&&(c[k]<0||c[k]>1))fail(e,k,"budget outside [0,1]");}
  if(finite(c.risk_budget)&&finite(c.cash_budget)&&Math.abs(c.risk_budget+c.cash_budget-1)>WEIGHT_TOLERANCE)fail(e,"capital","risk+cash must equal one");
  literal(c.confidence_semantics,["POLICY_DEFINED_SCORE","PROBABILITY"],"confidence_semantics",e);
  if(c.confidence!==null){number(c.confidence,"confidence",e);if(c.confidence_semantics==="PROBABILITY"&&finite(c.confidence)&&(c.confidence<0||c.confidence>1))fail(e,"confidence","declared probability outside [0,1]");}
  return finish(input,e);
}
export function validateAssetsInput(input: unknown):ValidationResult<AssetsAllocationInput> {
  const e:string[]=[],r=base(input,"ASSETS",["candidate_assets","expected_returns","risk_model","constraints","previous_holdings"],e),parent=r as unknown as PointInTime;
  const ids=assets(r.candidate_assets,"candidate_assets",e);forecast(r.expected_returns,ids,parent,"expected_returns",e);riskModel(r.risk_model,ids,parent,"risk_model",e);constraints(r.constraints,ids,"constraints",e);
  if(r.previous_holdings!==null){const h=object(r.previous_holdings,[...META,"units","asset_weights"],"previous_holdings",e);metadata(h,"previous_holdings",e,parent,true);literal(h.units,["fraction_of_risk_capital"],"holdings.units",e);weights(h.asset_weights,"holdings",e);}
  return finish(input,e);
}
export function validateAssetDecision(input: unknown,parent: PointInTime,ids: string[]):ValidationResult<AssetDecisionWeights> {
  const e:string[]=[],r=object(input,[...META,"units","asset_decision_weights","explicit_unallocated_risk_budget"],"decision",e);metadata(r,"decision",e,parent);
  if(timestamp(r.as_of)!==timestamp(parent.as_of))fail(e,"decision","decision as_of must equal input as_of");
  literal(r.units,["fraction_of_risk_capital"],"decision.units",e);
  const w=weights(r.asset_decision_weights,"decision.weights",e);if(Object.keys(w).some(id=>!ids.includes(id)))fail(e,"decision","noncandidate instrument");
  residual(r.explicit_unallocated_risk_budget,"decision.residual",e);return finish(input,e);
}
function residual(x: unknown,path: string,e: string[]) {number(x,path,e);if(finite(x)&&(x<0||x>1))fail(e,path,"residual must be risk-capital fraction [0,1]");}
export function validateFactorsInput(input: unknown):ValidationResult<FactorsAllocationInput> {
  const e:string[]=[],r=base(input,"FACTORS",["candidate_assets","target","factor_model","loading_matrix","constraints","implementation"],e),parent=r as unknown as PointInTime;
  const ids=assets(r.candidate_assets,"candidate_assets",e);constraints(r.constraints,ids,"constraints",e);
  const target=object(r.target,[...META,"units","exposures"],"target",e);metadata(target,"target",e,parent);literal(target.units,["factor_exposure"],"target.units",e);
  const t=weights(target.exposures,"target.exposures",e),model=object(r.factor_model,[...META,"model_id","model_version","factor_ids","factor_units","risk_model"],"factor_model",e);
  metadata(model,"factor_model",e,parent,true);text(model.model_id,"factor_model.id",e);text(model.model_version,"factor_model.version",e);
  const fids=strings(model.factor_ids,"factor_ids",e);if(!fids.length)fail(e,"factor_model","nonempty factor axes required");exactIds(Object.keys(t),fids,"target factors",e);
  if(!plain(model.factor_units)){fail(e,"factor_units","keyed units required");}else{exactIds(Object.keys(model.factor_units),fids,"factor_units",e);Object.values(model.factor_units).forEach(v=>text(v,"factor_units",e));}
  const pm=plain(model.provenance)?model.provenance.model:null;if(!plain(pm)||pm.id!==model.model_id||pm.version!==model.model_version)fail(e,"factor_model","model identity must match provenance");
  riskModel(model.risk_model,fids,parent,"factor_risk",e);
  const m=object(r.loading_matrix,[...META,"units","orientation","factor_ids","instrument_ids","values","matrix_hash"],"loading_matrix",e);metadata(m,"loading_matrix",e,parent,true);
  literal(m.units,["factor_exposure_per_unit_risk_weight"],"matrix.units",e);literal(m.orientation,["FACTORS_BY_ASSETS"],"matrix.orientation",e);
  const mf=strings(m.factor_ids,"matrix factors",e),mi=strings(m.instrument_ids,"matrix instruments",e);exactIds(mf,fids,"matrix factors",e);exactIds(mi,ids,"matrix assets",e);
  if(!Array.isArray(m.values)||m.values.length!==mf.length||m.values.some(v=>!Array.isArray(v)||v.length!==mi.length||v.some(n=>!finite(n))))fail(e,"matrix","finite factor×asset dimensions required");
  if(!digest(m.matrix_hash))fail(e,"matrix","matrix hash required");
  try{if(m.matrix_hash!==loadingMatrixHash(m as unknown as AssetFactorLoadingMatrix))fail(e,"matrix","matrix hash/content mismatch");}catch{fail(e,"matrix","noncanonical matrix");}
  const method=object(r.implementation,["method","regularization"],"implementation",e);literal(method.method,["UNIQUE_SQUARE_EXACT"],"implementation.method",e);literal(method.regularization,["NONE"],"regularization",e);
  return finish(input,e);
}
export function validateAlphaStreamsInput(input: unknown):ValidationResult<AlphaStreamsAllocationInput> {
  const e:string[]=[],r=base(input,"ALPHA_STREAMS",["candidate_assets","alpha_streams","risk_model","constraints"],e),parent=r as unknown as PointInTime;
  const aids=assets(r.candidate_assets,"candidate_assets",e);constraints(r.constraints,aids,"constraints",e);
  if(!Array.isArray(r.alpha_streams)){fail(e,"alpha_streams","nonempty array required");return finish(input,e);}
  const ids:string[]=[];let empty=false;
  for(const value of r.alpha_streams){
    const s=object(value,[...META,"alpha_stream_id","version","historical_series","expected_return_forecast","risk_model","unit_position_map","execution_convention"],"stream",e);
    metadata(s,"stream",e,parent,true);text(s.alpha_stream_id,"stream.id",e);text(s.version,"stream.version",e);if(nonempty(s.alpha_stream_id))ids.push(s.alpha_stream_id);
    const sp=plain(s.provenance)?s.provenance.model:null;if(!plain(sp)||sp.id!==s.alpha_stream_id||sp.version!==s.version)fail(e,"stream","stream identity/version must match provenance");
    const history=object(s.historical_series,[...META,"kind","units","observations"],"history",e);metadata(history,"history",e,parent,true);
    literal(history.kind,["REALIZED_RETURNS","REALIZED_PNL"],"history.kind",e);
    literal(history.units,[history.kind==="REALIZED_RETURNS"?"daily_decimal_return":"pnl_per_unit_stream_capital"],"history.units",e);
    if(!Array.isArray(history.observations)){fail(e,"history","observations required");}
    else{if(!history.observations.length){empty=true;fail(e,"history","no historical returns/P&L supplied");}
      let previous=-Infinity;
      for(const v of history.observations){const o=object(v,["date","value"],"observation",e);date(o.date,"observation.date",e);number(o.value,"observation.value",e);const t=timestamp(o.date),hc=timestamp(history.information_cutoff);
        if(t!==null){if(t<=previous||hc!==null&&t>hc)fail(e,"history","dates must be unique/increasing and no later than history cutoff");previous=t;}
        if(history.kind==="REALIZED_RETURNS"&&finite(o.value)&&o.value<=-1)fail(e,"history","impossible capital return <= -100%");}}
    if(s.expected_return_forecast!==null)forecast(s.expected_return_forecast,[String(s.alpha_stream_id)],parent,"stream.forecast",e);
    riskModel(s.risk_model,[String(s.alpha_stream_id)],parent,"stream.risk",e);
    const map=object(s.unit_position_map,[...META,"units","asset_exposures","explicit_unallocated_stream_capital"],"position_map",e);metadata(map,"position_map",e,parent,true);literal(map.units,["asset_exposure_per_unit_stream_capital"],"map.units",e);
    const w=weights(map.asset_exposures,"map.exposures",e);if(Object.keys(w).some(id=>!aids.includes(id)))fail(e,"map","untradable/unknown instrument");residual(map.explicit_unallocated_stream_capital,"map.residual",e);
    const ex=object(s.execution_convention,["rebalance","execution","signal_cutoff"],"execution",e);text(ex.rebalance,"rebalance",e);literal(ex.execution,["same_close","next_close","next_open"],"execution",e);
    literal(ex.signal_cutoff,[ex.execution==="next_open"?"CLOSE_T_FILL_OPEN_T_PLUS_1":"STRICT_PREVIOUS_CLOSE"],"signal_cutoff",e);
  }
  strings(ids,"stream IDs",e);if(!ids.length){empty=true;fail(e,"streams","no streams supplied");}
  riskModel(r.risk_model,ids,parent,"cross_stream_risk",e);return finish(input,e,empty);
}
export function validateAlphaDecision(input: unknown,parent: PointInTime,ids: string[]):ValidationResult<AlphaCapitalDecision> {
  const e:string[]=[],r=object(input,[...META,"units","alpha_allocations","explicit_unallocated_risk_budget"],"alpha decision",e);metadata(r,"alpha decision",e,parent);
  if(timestamp(r.as_of)!==timestamp(parent.as_of))fail(e,"decision","as_of must match input");literal(r.units,["fraction_of_risk_capital"],"alpha allocation units",e);
  const w=weights(r.alpha_allocations,"alpha_allocations",e);exactIds(Object.keys(w),ids,"alpha_allocations",e);
  if(Object.values(w).some(v=>v<0))fail(e,"alpha allocations","capital allocations cannot be negative; signs belong to position maps");
  residual(r.explicit_unallocated_risk_budget,"alpha residual",e);
  if(finite(r.explicit_unallocated_risk_budget)&&Math.abs(orderedValues(w).reduce((s,v)=>s+v,0)+r.explicit_unallocated_risk_budget-1)>WEIGHT_TOLERANCE)fail(e,"alpha allocations","capital allocations + explicit residual must equal one");
  return finish(input,e);
}
export function exposureChecks(w: Record<string,number>,c: AllocationConvention,residualRisk: number):string[] {
  const e:string[]=[],gross=orderedValues(w).reduce((s,v)=>s+Math.abs(v),0),net=orderedValues(w).reduce((s,v)=>s+v,0),m=c.mandate;
  if(!finite(gross)||!finite(net))e.push("Nonfinite exposure aggregation");
  if(!m.allow_short&&Object.values(w).some(v=>v<0))e.push("Mandate prohibits short positions");
  if(!m.allow_leverage&&gross>1+WEIGHT_TOLERANCE)e.push("Mandate prohibits risk-sleeve leverage");
  if(gross>m.max_gross_exposure+WEIGHT_TOLERANCE||net<m.min_net_exposure-WEIGHT_TOLERANCE||net>m.max_net_exposure+WEIGHT_TOLERANCE)e.push("Mandate exposure bounds violated");
  if(c.kind==="LONG_ONLY_FULLY_INVESTED"&&(Object.values(w).some(v=>v<0)||Math.abs(net+residualRisk-1)>WEIGHT_TOLERANCE))e.push("Long-only sleeve weights + residual must equal one");
  if(residualRisk!==0)e.push("Explicit unallocated risk budget is nonzero; no fully-invested composition authorized");
  if(c.funding==="NET_ONE_WITH_GLOBAL_CASH"&&Math.abs(net-1)>WEIGHT_TOLERANCE)e.push("Net-one financing convention violated");
  if(c.funding==="EXPOSURES_WITH_EXTERNAL_FINANCING"&&!m.allow_external_financing)e.push("Mandate prohibits external financing convention");
  return e;
}
export function validateRiskSleeveAllocation(input: unknown):ValidationResult<RiskSleeveAllocationResult> {
  const e:string[]=[],r=object(input,[...META,"schema_version","allocation_id","allocation_mode","input_snapshot_id","status","asset_weight_units","asset_weights_risk_sleeve","gross_exposure","net_exposure","estimated_market_beta","estimated_volatility","asset_market_betas","beta_model","risk_model_provenance","risk_measurement_status","explicit_unallocated_risk_budget","convention","turnover_estimate","mode_specific_details","warnings","errors"],"risk sleeve",e);
  metadata(r,"risk sleeve",e);literal(r.schema_version,[CONTRACT_VERSION],"schema_version",e);literal(r.allocation_mode,["ASSETS","FACTORS","ALPHA_STREAMS"],"mode",e);
  literal(r.status,["VALID","INFEASIBLE","INVALID_INPUT","NUMERICAL_FAILURE","MAPPING_FAILURE","INSUFFICIENT_DATA"],"status",e);literal(r.asset_weight_units,["fraction_of_risk_capital"],"units",e);
  if(typeof r.input_snapshot_id!=="string"||!/^snapshot_[a-f0-9]{64}$/.test(r.input_snapshot_id))fail(e,"snapshot","canonical snapshot ID required");
  convention(r.convention,"convention",e);residual(r.explicit_unallocated_risk_budget,"residual",e);
  literal(r.risk_measurement_status,["NOT_ESTIMATED","AVAILABLE"],"risk measurement",e);
  if(r.risk_measurement_status==="NOT_ESTIMATED"){
    for(const k of ["estimated_market_beta","estimated_volatility","asset_market_betas","beta_model","risk_model_provenance"])if(r[k]!==null)fail(e,k,"unestimated risk must be explicitly null");
  }else if(r.risk_measurement_status==="AVAILABLE"){
    number(r.estimated_market_beta,"sleeve beta",e);number(r.estimated_volatility,"sleeve volatility",e);if(finite(r.estimated_volatility)&&r.estimated_volatility<0)fail(e,"volatility","negative volatility");
    const betas=weights(r.asset_market_betas,"asset betas",e),w=weights(r.asset_weights_risk_sleeve,"risk weights",e);exactIds(Object.keys(betas),Object.keys(w),"asset beta axes",e);
    const beta=Object.keys(w).sort().reduce((s,k)=>s+w[k]*betas[k],0);
    if(!finite(beta)||finite(r.estimated_market_beta)&&Math.abs(beta-r.estimated_market_beta)>WEIGHT_TOLERANCE)fail(e,"beta","q dot beta_assets mismatch; sum(weights) is not market beta");
    const b=object(r.beta_model,["benchmark","estimation_window","estimator","as_of","information_cutoff","data_hash"],"beta model",e);
    text(b.benchmark,"benchmark",e);literal(b.estimator,["OLS_COV_VARIANCE_SAMPLE_V1","SUPPLIED_ASSET_BETAS_V1"],"beta estimator",e);
    if(!digest(b.data_hash))fail(e,"beta model","SHA256 required");date(b.as_of,"beta as_of",e);date(b.information_cutoff,"beta cutoff",e);
    const window=object(b.estimation_window,["start","end","observations"],"beta window",e);date(window.start,"beta window start",e);date(window.end,"beta window end",e);
    if(!Number.isInteger(window.observations)||Number(window.observations)<2)fail(e,"beta window","at least 2 observations required");
    if(timestamp(window.start)!>timestamp(window.end)!||timestamp(window.end)!>timestamp(b.information_cutoff)!||timestamp(b.information_cutoff)!>timestamp(b.as_of)!||timestamp(b.as_of)!>timestamp(r.information_cutoff)!)fail(e,"beta model","future/inconsistent estimation window");
    const p=object(r.risk_model_provenance,META,"risk estimate provenance",e);metadata(p,"risk estimate provenance",e,r as unknown as PointInTime,true);
    if(plain(p.provenance)&&p.provenance.data_hash!==b.data_hash)fail(e,"risk estimate provenance","beta data hash mismatch");
    if(timestamp(b.as_of)!>timestamp(p.as_of)!||timestamp(b.information_cutoff)!>timestamp(p.information_cutoff)!)fail(e,"beta model","beta model exceeds its risk estimate artifact cutoff");
  }
  if(r.turnover_estimate!==null){number(r.turnover_estimate,"turnover",e);if(finite(r.turnover_estimate)&&r.turnover_estimate<0)fail(e,"turnover","negative estimate");}
  for(const field of ["warnings","errors"]){if(!Array.isArray(r[field])||(r[field] as unknown[]).some(v=>!nonempty(v)))fail(e,field,"string array required");}
  const d=object(r.mode_specific_details,["allocation_mode","asset_decision_weights","implementation","aggregation","failure"],"mode details",e);
  if(d.allocation_mode!==r.allocation_mode)fail(e,"mode details","mode mismatch");
  if(r.status==="VALID"){
    const w=weights(r.asset_weights_risk_sleeve,"canonical weights",e),gross=orderedValues(w).reduce((s,v)=>s+Math.abs(v),0),net=orderedValues(w).reduce((s,v)=>s+v,0);
    number(r.gross_exposure,"gross",e);number(r.net_exposure,"net",e);
    if(finite(r.gross_exposure)&&Math.abs(gross-r.gross_exposure)>WEIGHT_TOLERANCE||finite(r.net_exposure)&&Math.abs(net-r.net_exposure)>WEIGHT_TOLERANCE)fail(e,"exposures","gross/net mismatch");
    if(Array.isArray(r.errors)&&r.errors.length)fail(e,"status","warnings/errors cannot convert failure into VALID");
    if(!e.length)e.push(...exposureChecks(w,r.convention as unknown as AllocationConvention,r.explicit_unallocated_risk_budget as number));
    if(r.allocation_mode==="ASSETS") {exactIds(Object.keys(d),["allocation_mode","asset_decision_weights"],"details fields",e);if(!sameJson(d.asset_decision_weights,w))fail(e,"details","asset decision mismatch");}
    if(r.allocation_mode==="FACTORS"){
      exactIds(Object.keys(d),["allocation_mode","implementation"],"details fields",e);
      const f=object(d.implementation,[...META,"factor_model_identity","target_factor_exposures","achieved_factor_exposures","implementation_asset_weights","asset_weight_units","tracking_residual","tracking_error","tracking_error_definition","feasibility_status","method","regularization","matrix_date","matrix_information_cutoff","matrix_hash","mapping_provenance"],"implementation result",e);
      metadata(f,"factor implementation",e,r as unknown as PointInTime);
      const fm=object(f.factor_model_identity,[...META,"model_id","model_version"],"factor identity",e);metadata(fm,"factor identity",e,r as unknown as PointInTime,true);text(fm.model_id,"model_id",e);text(fm.model_version,"model_version",e);
      const fp=plain(fm.provenance)?fm.provenance.model:null;if(!plain(fp)||fp.id!==fm.model_id||fp.version!==fm.model_version)fail(e,"factor identity","model identity differs from provenance");
      if(f.feasibility_status!=="VALID"||f.asset_weight_units!=="fraction_of_risk_capital"||!sameJson(f.implementation_asset_weights,w))fail(e,"implementation","failed/mismatched factor implementation");
      number(f.tracking_error,"tracking_error",e);const target=weights(f.target_factor_exposures,"target exposure",e),achieved=weights(f.achieved_factor_exposures,"achieved exposure",e),res=weights(f.tracking_residual,"tracking residual",e);
      exactIds(Object.keys(achieved),Object.keys(target),"achieved axes",e);exactIds(Object.keys(res),Object.keys(target),"residual axes",e);
      for(const k of Object.keys(target))if(Math.abs((achieved[k]-target[k])-res[k])>WEIGHT_TOLERANCE)fail(e,"tracking residual","achieved-target mismatch");
      if(finite(f.tracking_error)&&(f.tracking_error<0||Math.abs(Math.hypot(...Object.values(res))-f.tracking_error)>WEIGHT_TOLERANCE))fail(e,"tracking_error","Euclidean residual mismatch");
      literal(f.method,["UNIQUE_SQUARE_EXACT"],"method",e);literal(f.regularization,["NONE"],"regularization",e);literal(f.tracking_error_definition,["EUCLIDEAN_EXPOSURE_RESIDUAL_NOT_ANNUALIZED_RISK"],"tracking units",e);
      if(!digest(f.matrix_hash))fail(e,"matrix hash","missing hash");metadata({as_of:f.matrix_date,information_cutoff:f.matrix_information_cutoff,provenance:f.mapping_provenance},"mapping provenance",e,r as unknown as PointInTime,true);
    }
    if(r.allocation_mode==="ALPHA_STREAMS"){
      exactIds(Object.keys(d),["allocation_mode","aggregation"],"details fields",e);
      const a=object(d.aggregation,[...META,"alpha_allocations","aggregated_asset_exposures","pre_netting_gross_exposure","contributions","stream_versions","position_map_provenance"],"aggregation",e);metadata(a,"alpha aggregation",e,r as unknown as PointInTime);
      const allocations=weights(a.alpha_allocations,"alpha allocations",e);number(a.pre_netting_gross_exposure,"pre-netting gross",e);
      if(Object.values(allocations).some(v=>v<0)||Math.abs(orderedValues(allocations).reduce((s,v)=>s+v,0)-1)>WEIGHT_TOLERANCE)fail(e,"alpha allocations","capital allocations must sum one and be nonnegative");
      if(!sameJson(a.aggregated_asset_exposures,w))fail(e,"aggregation","asset aggregation mismatch");
      if(!plain(a.contributions)||!plain(a.stream_versions)||!plain(a.position_map_provenance))fail(e,"aggregation","contributions/versions/maps required");
      else{
        const totals:Record<string,number>={};let pre=0;
        for(const [id,values] of Object.entries(a.contributions)){const contribution=weights(values,"contribution",e);for(const [k,v] of Object.entries(contribution)){totals[k]=(totals[k]??0)+v;pre+=Math.abs(v);}text(a.stream_versions[id],"stream version",e);
          const p=object(a.position_map_provenance[id],META,"map provenance",e);metadata(p,"map provenance",e,r as unknown as PointInTime,true);}
        exactIds(Object.keys(a.contributions),Object.keys(allocations),"contribution streams",e);
        for(const k of new Set([...Object.keys(totals),...Object.keys(w)]))if(Math.abs((totals[k]??0)-(w[k]??0))>WEIGHT_TOLERANCE)fail(e,"aggregation","algebraic netting mismatch");
        if(finite(a.pre_netting_gross_exposure)&&Math.abs(pre-a.pre_netting_gross_exposure)>WEIGHT_TOLERANCE)fail(e,"aggregation","pre-netting gross mismatch");
      }
    }
  }else if(r.asset_weights_risk_sleeve!==null||r.gross_exposure!==null||r.net_exposure!==null||!Array.isArray(r.errors)||!r.errors.length)fail(e,"failure","failures require no executable weights/exposures and explicit errors");
  try{const {allocation_id,...body}=r;if(allocation_id!=="allocation_"+canonicalHash(body))fail(e,"allocation_id","content hash mismatch");}catch{fail(e,"allocation_id","noncanonical result");}
  return finish(input,e);
}
