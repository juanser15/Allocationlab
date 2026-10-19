/** Read-only PIPE02 promotion boundary and AL05 eligibility handoff. No promotion,
 * activation event, allocation, normalization or target-generation call. */
import {bankState} from '../governance/bank';
import type {BankRegistry} from '../governance/contracts';
import {canonicalHash,seal,verify} from '../governance/common';
import {validateInput as validateStrategyInput} from '../../artifacts/api-server/src/lib/allocation-core/strategy-engine/validation';
import type {StrategyInput} from '../../artifacts/api-server/src/lib/allocation-core/strategy-engine/contracts';
import type {Entry,Result,State,Evidence} from './contracts';
export function stateFromCertifiedRegistry(registry:BankRegistry,entry:Entry,at:string,cutoff:string):State|null {
 const resolved=bankState(registry,entry.entry_id,at,cutoff);if(!resolved)return null;const{definition:d,state:s}=resolved;
 if(d.entry_type!==entry.entry_type||d.scope!==entry.scope||d.identity.version!==entry.strategy_version||d.identity.configuration_hash!==entry.provenance.configuration_hash||canonicalHash([...d.underlying_ids].sort())!==canonicalHash([...entry.underlying_ids].sort())||d.strategy_family_id!==entry.strategy_family_id||d.valid_from!==entry.valid_from||d.valid_until!==entry.valid_until)throw Error('INVALID_INPUT: incomplete PIPE02 identity adapter');
 return seal({as_of:cutoff,information_cutoff:cutoff,available_at:cutoff,entry_id:entry.entry_id,effective_at:cutoff,promotion_status:s.promotion_status,manual_hold:s.activation_status==='INACTIVE'&&['MANUAL_HOLD','TEMPORARILY_SUSPENDED'].includes(s.activation_reason),reason:s.activation_reason,evidence_hash:s.evidence_hash,promotion_decision_hash:s.promotion_decision_hash,promotion_decision_time:registry.decisions.find(d=>d.hash===s.promotion_decision_hash)?.decision_time??null,source:'PIPE02_VERIFIED_REGISTRY' as const});
}
/** Consumer must supply an AL05 PIT bundle already reconstructed on EXACTLY this
 * axis. We never drop constraints, rescale previous weights, fit models or solve. */
export function assertAllocatorUniverse(active:Result,bundle:StrategyInput,entries:Entry[]):{active_set_id:string;eligible_strategy_ids:string[];handoff_id:string} {
 verify(active);if(bundle.as_of!==active.decision_date||bundle.information_cutoff!==active.information_cutoff)throw Error('INVALID_INPUT: AL05 decision/cutoff mismatch');
 const axis=bundle.streams.map(s=>s.strategy_instance_id).sort();if(canonicalHash(axis)!==canonicalHash(active.active_strategy_ids))throw Error('INVALID_INPUT: inactive/unknown/missing strategy in AL05 universe');
 const errors=validateStrategyInput(bundle);if(errors.length)throw Error('INVALID_INPUT: AL05 certified input validation: '+errors.join('; '));
 for(const s of bundle.streams){const e=entries.find(e=>e.strategy_instance_id===s.strategy_instance_id);if(!e||e.strategy_version!==s.strategy_version||e.parameterization_hash!==s.parameterization_hash||e.strategy_family_id!==s.strategy_family_id||canonicalHash([...e.underlying_ids].sort())!==canonicalHash([...s.underlying_ids].sort()))throw Error('INVALID_INPUT: AL05 strategy identity mismatch');}
 const body={active_set_id:active.active_set_id,eligible_strategy_ids:axis};return{...body,handoff_id:'handoff_'+canonicalHash(body)};
}

/** Frozen governance evidence only. No reinterpretation of CAGR as a research score. */
export function evidenceFromCertifiedRegistry(registry:BankRegistry,s:State):Evidence|null {
 const e=registry.evidence.find(e=>e.hash===s.evidence_hash);if(!e)return null;return seal({as_of:e.as_of,information_cutoff:e.information_cutoff,available_at:e.provenance.available_at,entry_id:s.entry_id,promotion_evidence_hash:e.hash,research_score:null,psr:e.metrics.psr,turnover:e.metrics.turnover});
}
