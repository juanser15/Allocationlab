/** Reuse the already-certified AL03/04/05 SYNTHETIC fixtures. Not financial data. */
import {readFileSync} from 'node:fs';
import {syntheticInput} from '../../artifacts/api-server/src/lib/allocation-core/assets-engine/artifacts';
import {allocateAssets} from '../../artifacts/api-server/src/lib/allocation-core/assets-engine/engine';
import {betaMandate} from '../../artifacts/api-server/src/lib/allocation-core/risk-analytics/diagnostics';
import {qaPolicy,signalFixture} from '../../artifacts/api-server/src/lib/allocation-core/gates/fixtures';
import {candidateTemplate} from '../allocation/fixtures';
import {candidateId} from '../allocation/spec';
import {canonicalHash} from '../../artifacts/api-server/src/lib/allocation-core/validation';
import {policyHash} from '../../artifacts/api-server/src/lib/allocation-core/gates/common';
import {makeContext} from './decision';
import type {BookRequest,Bundle} from './contracts';
const load=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
export function fixture(mode:'ASSETS'|'FACTORS'|'STRATEGY_STREAMS'='ASSETS',target=.3,bps=0){
 let native:NonNullable<Bundle['native']>,sleeve;
 if(mode==='ASSETS'){const input=syntheticInput([[.0001]],{type:'EQUAL_WEIGHT'}),result=allocateAssets(input);native={mode,input};sleeve=result.sleeve!;}
 else if(mode==='FACTORS'){const f=load('reports/al04/synthetic-fixtures.json').find((x:{id:string})=>x.id==='square-exact');native={mode,input:f.input};sleeve=f.response.result.controller_projection.sleeve;}
 else {const f=load('reports/al05/synthetic-results.json').find((x:{id:string})=>x.id==='same-underlying-distinct-instance');native={mode,input:f.input};sleeve=f.result.controller_projection;}
 const spec=candidateTemplate(mode);spec.objective=structuredClone(native.mode==='FACTORS'?native.input.implementation:native.input.objective) as typeof spec.objective;
 spec.constraints=structuredClone(native.mode==='STRATEGY_STREAMS'?{strategy_constraints:native.input.strategy_constraints,implementation_constraints:native.input.implementation_constraints}:native.input.constraints) as typeof spec.constraints;
 const mandate=betaMandate(target,sleeve),signal_policy=qaPolicy('SIGNAL_QUALITY'),robustness_policy=qaPolicy('PORTFOLIO_ROBUSTNESS');
 robustness_policy.mandatory_checks=['largest_weight','hhi'];robustness_policy.policy_hash=policyHash(robustness_policy);
 spec.portfolio_gate=structuredClone(robustness_policy);spec.signal_gate.policy=structuredClone(signal_policy);
 spec.costs.scenarios_bps=[0,5];
 const bundle:Bundle={native,mandate,signal:null,sensitivity:[],signal_policy,robustness_policy,original_risk_reference:{synthetic_certified_fixture:true}};
 const candidate={candidate_id:candidateId(spec),spec},ids=Object.keys(sleeve.asset_weights_risk_sleeve),prices=['2020-12-31','2021-01-01','2021-01-04','2021-01-05','2021-01-06'].map((date,i)=>({date,prices:Object.fromEntries([...new Set([...ids,'SPY'])].map(a=>[a,100*(i<3?1:i===3?1.02:1.01)]))}));
 const lock={candidate_id:candidate.candidate_id,selection_hash:canonicalHash({synthetic_selection_frozen:true}),outer_fold:0,source_id:'SYNTHETIC_ONLY_NO_SEARCH'},context=makeContext(candidate,bundle,prices,lock,bps);
 return{bundle,candidate,context,prices,signal:signalFixture()};
}
export function fixtureBook(mode:'ASSETS'|'FACTORS'|'STRATEGY_STREAMS'='ASSETS',bps=0):BookRequest{
 const f=fixture(mode,.3,bps);return{book_id:'SYNTHETIC_'+mode+'_'+bps,benchmark:'SPY',start:'2021-01-01',end_exclusive:'2021-01-07',track:'NORMALIZED',prices:f.prices,decisions:[{context:f.context,bundle:f.bundle}],reference:{campaign:'SYNTHETIC_CERTIFICATION',job_id:'SYNTHETIC_NO_SEARCH',outer_fold:0,scenario_bps:bps,frozen_ledger:null}};
}
