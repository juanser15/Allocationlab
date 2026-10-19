/** Frozen AL07 selected jobs only. No search, rank, fit, universe/parameter change. */
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalHash} from '../../artifacts/api-server/src/lib/allocation-core/validation';
import {frozenAssetsData} from '../allocation/data';
import {gatePolicy} from '../allocation/decision';
import type {Candidate,Job,SelectionRecord} from '../allocation/contracts';
import {makeContext} from './decision';
import type {BookRequest,Bundle,PipelineDecision} from './contracts';
export const CAMPAIGNS=['AL07_REAL_NESTED_ROLLING','AL07_REAL_TRADITIONAL_EXPANDING'];
const load=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
export const shaFile=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
export function realRequests(){
 const data=frozenAssetsData(),requests:BookRequest[]=[],comparators:Record<string,Job>={},sourceHashes:Record<string,string>={};
 for(const campaign of CAMPAIGNS){
  const root='reports/al07/campaigns/'+campaign,candidates=load<Candidate[]>(root+'/candidates.json');sourceHashes[root+'/candidates.json']=shaFile(root+'/candidates.json');
  for(const file of readdirSync(root+'/jobs').sort()){
   const path=root+'/jobs/'+file,envelope=load<{value_hash:string;value:Job}>(path),job=envelope.value;
   if(job.stage!=='outer')continue;if(canonicalHash(job)!==envelope.value_hash)throw Error('Frozen job tampered');
   const selectionPath=root+'/selections/'+job.outer_fold+'.json',selection=load<SelectionRecord>(selectionPath);
   if(selection.candidate_id!==job.candidate_id)throw Error('Frozen job not persisted selected candidate');
   const candidate=candidates.find(c=>c.candidate_id===job.candidate_id)!;
   if(!candidate||job.status!=='VALID'||candidate.spec.allocation_mode!=='ASSETS')throw Error('Unsupported frozen historical selected job');
   sourceHashes[path]=shaFile(path);sourceHashes[selectionPath]=shaFile(selectionPath);
   const prices=data.prices.filter(p=>p.date<job.interval_end);
   const decisions=job.decisions.map(d=>{
    const current=data.snapshots.find(s=>s.decision_date===d.date&&s.reference_id===candidate.spec.risk_model.id);
    if(!current||!d.allocation||canonicalHash(current.mandate)!==d.mandate_hash)throw Error('Frozen mandate/native decision missing');
    const bundle:Bundle={native:{mode:d.allocation.mode,input:structuredClone(d.allocation.input)} as Bundle['native'],mandate:structuredClone(current.mandate),signal:structuredClone(current.signal),sensitivity:structuredClone(d.sensitivity),signal_policy:gatePolicy(candidate.spec.signal_gate.policy,d.date,d.cutoff!),robustness_policy:gatePolicy(candidate.spec.portfolio_gate,d.date,d.cutoff!),original_risk_reference:structuredClone(d.model_reference??null)};
    const context=makeContext(candidate,bundle,prices,{candidate_id:selection.candidate_id!,selection_hash:shaFile(selectionPath),outer_fold:job.outer_fold,source_id:selectionPath},job.scenario_bps);
    return{context,bundle};
   });
   for(const track of ['RAW','NORMALIZED'] as const){const book_id=campaign+'_'+job.outer_fold+'_'+job.scenario_bps+'bps_'+track;comparators[book_id]=job;
    requests.push({book_id,benchmark:'SPY',start:job.interval_start,end_exclusive:job.interval_end,track,prices,decisions,reference:{campaign,job_id:job.job_id,outer_fold:job.outer_fold,scenario_bps:job.scenario_bps,frozen_ledger:job.tracks[track]!.ledger}});
   }
  }
 }
 return{requests,comparators,sourceHashes};
}
export function compareDecision(d:PipelineDecision,frozen:Job['decisions'][number]){
 const projection=frozen.projection as {portfolio:{exposure_multiplier:number;expected_final_beta:number;expected_final_volatility:number;composition_id:string}};
 const current=d.projection as typeof projection|null;
 return{candidate:d.context.candidate.candidate_id,status:d.status,selected_candidate_equal:d.context.candidate.candidate_id===d.context.selection_lock.candidate_id,
 q_equal:canonicalHash(d.sleeve?.asset_weights_risk_sleeve??null)===canonicalHash(frozen.raw),allocation_equal:canonicalHash(d.allocation)===canonicalHash(frozen.allocation),
 mandate_equal:d.context.risk_mandate_hash===frozen.mandate_hash,lambda_equal:current?.portfolio.exposure_multiplier===projection.portfolio.exposure_multiplier,
 final_weights_equal:canonicalHash(d.final_target?.final_asset_weights??null)===canonicalHash(frozen.normalized),
 composition_equal:canonicalHash(d.projection)===canonicalHash(frozen.projection),robustness_equal:canonicalHash(d.robustness_gate)===canonicalHash(frozen.portfolio_gate),
 expected_risk_equal:d.final_target?.expected_final_beta===projection.portfolio.expected_final_beta&&d.final_target?.expected_final_volatility===projection.portfolio.expected_final_volatility};
}
