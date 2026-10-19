/** PIPE03 integration only: no strategy generation, promotion or execution. */
import type {Input as BankInput,Result as ActiveSet} from '../bank/contracts';
import type {StrategyInput} from '../../artifacts/api-server/src/lib/allocation-core/strategy-engine/contracts';
import type {Bundle,PipelineDecision} from '../pipeline/contracts';
import type {Candidate} from '../allocation/contracts';
import type {RoutingInput,RoutingRecord,CertifiedTarget} from '../governance/contracts';
export const VERSION='active-set-pipeline-1.0.0';
export interface FrozenActiveSet {artifact:ActiveSet;available_at:string;source_path:string;source_sha256:string;bank_input_reference:{path:string;sha256:string};bank_entries:BankInput['entries'];}
export interface Request {
 request_id:string;decision_date:string;information_cutoff:string;
 active_set_hash:string;active_sets:FrozenActiveSet[];
 /** Externally supplied immutable AL05 bundles. Never fit risk/forecast models here. */
 strategy_snapshots:StrategyInput[];
 source_candidate:Candidate;bundle_template:Omit<Bundle,'native'|'original_risk_reference'>;
 session_calendar:string[];
 routing:Omit<RoutingInput,'primary'>;
}
export interface Projection {
 active_set_hash:string;source_snapshot_hash:string;methodology:'ACTIVE_AXIS_PRINCIPAL_SUBMATRIX_NO_REFIT_V1';
 active_ids:string[];excluded:Array<{entry_id:string;strategy_instance_id:string|null;status:string;reason:string}>;
 constraint_changes:Array<{path:string;reason:string;before:unknown;after:unknown}>;
 input:StrategyInput;hash:string;
}
export interface Prepared {
 active:FrozenActiveSet;projection:Projection;candidate:Candidate;bundle:Bundle;
 calendar:Array<{date:string;prices:Record<string,number>}>;
 identity:string;
}
export interface Stage {integration_id:string;sequence:number;stage:string;status:string;market_information_cutoff:string;input_hash:string;output_hash:string;output:unknown;stage_id:string;}
export interface Result {
 version:typeof VERSION;integration_id:string;request_id:string;decision_date:string;information_cutoff:string;
 active_set_id:string|null;active_set_hash:string;active_ids:string[];excluded:Projection['excluded'];bank_snapshot_hash:string|null;status:string;reason:string|null;
 projection:Projection|null;pipeline:PipelineDecision|null;
 compatibility_blocker:string|null;additional_robustness:PipelineDecision['robustness_gate'];
 certificate:CertifiedTarget|null;routing:RoutingRecord|null;stages:Stage[];
 source_unchanged:boolean;hash:string;
}
