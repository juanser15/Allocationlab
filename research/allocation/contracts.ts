/** ARE is research orchestration, not an allocator or exposure policy. */
import type {PriceRow,BacktestLedgerEntry} from '../../artifacts/api-server/src/lib/calculator';
import type {RiskMandate} from '../../artifacts/api-server/src/lib/allocation-core/contracts';
import type {AllocationSource,GatePolicy,SignalQualityInput,SensitivityRow,GateResult} from '../../artifacts/api-server/src/lib/allocation-core/gates/contracts';
import type {Fold} from '../capital/spec';
export const VERSION='allocation-research-1.0.1';
export type Mode='ASSETS'|'FACTORS'|'STRATEGY_STREAMS';
export type Status='VALID'|'BLOCKED'|'INFEASIBLE'|'INSUFFICIENT_DATA'|'NUMERICAL_FAILURE'|'GATE_FAIL'|'INVALID_INPUT';
export type Clock='once'|'monthly'|'quarterly'|'yearly';
export type Metric='SHARPE'|'SORTINO'|'CAGR'|'MAX_DRAWDOWN_ADJUSTED'|'CAPM_ALPHA'|'UTILITY_RETURN_MINUS_RISK'|'MULTI_METRIC_LEXICOGRAPHIC';
export interface Ref {id:string;version:string;configuration_hash:string;}
export interface CandidateSpec {
 allocation_mode:Mode;objective:Record<string,unknown>;constraints:Record<string,unknown>;
 risk_model:Ref;expected_return:Ref|null;factor_target:Ref|null;strategy_universe:Ref|null;
 signal_gate:{required:boolean;policy:GatePolicy;exemption_reason:string|null};portfolio_gate:GatePolicy;
 clocks:{signal:Clock;rebalance:'monthly'|'quarterly';risk_recalibration:Clock;forecast_recalibration:Clock;gate:'EACH_ALLOCATION_DECISION'};
 estimation:{window_sessions:63|126|252;minimum_observations:number};
 costs:{scenarios_bps:number[];slippage_bps:0;basis:'ACTUAL_INSTRUMENT_NOTIONAL';embedded_strategy_costs:'ALREADY_NET_NOT_RECHARGED'};
 risk_mandate:Ref;model_config_hashes:Record<string,string>;
}
export interface Candidate {candidate_id:string;spec:CandidateSpec;}
export interface Selection {
 version:'ARE_SELECTION_1.0.0';metric:Metric;lexicographic:Array<{metric:Exclude<Metric,'MULTI_METRIC_LEXICOGRAPHIC'>;direction:'MAX'|'MIN'}>;
 utility_risk_aversion:number|null;selection_scenario_bps:number;
 hurdles:Partial<Record<'min_incremental_cagr'|'min_alpha'|'max_beta'|'max_downside_beta'|'max_tail_beta'|'max_drawdown'|'max_turnover',number>>;
}
export interface Campaign {
 campaign_id:string;validation_mode:'TRADITIONAL_WALK_FORWARD'|'NESTED_WALK_FORWARD';window_type:'ROLLING'|'EXPANDING';
 dates:{start:string;end_exclusive:string};train_months:number;test_months:number;step_months:number;
 inner_window_type?:'ROLLING'|'EXPANDING';inner_train_months?:number;inner_test_months?:number;inner_step_months?:number;
 search:'GRID'|'RANDOM_REPRODUCIBLE';candidate_budget?:number;hard_max_candidates:number;seed?:number|string;grid_reduction?:{indices:number[]};
 space:Array<{base:CandidateSpec;axes?:Record<string,unknown[]>}>;selection:Selection;
 controls:{candidate_ids:string[];same_average_beta:boolean;same_volatility:boolean;label:'DECLARED_BEFORE_RUN';};
 cost_scenarios_bps:number[];cash_yield_daily:number;risk_free_daily:number;benchmark:string;max_jobs:number;
 decay_horizons:number[];cross_sectional:{enabled:boolean;buckets:number};data_reference:string;
}
export interface Snapshot {
 reference_id:string;risk_definition:Ref;decision_date:string;source:AllocationSource;mandate:RiskMandate;
 signal:SignalQualityInput|null;signal_fit_cutoff?:string|'NO_FIT_OBSERVED_FEATURES';sensitivity:SensitivityRow[]|null;
 /** Frozen stress reuse is legal only for exactly these economic definitions/weights. */
 certified_objective_hash:string;certified_constraints_hash:string;certified_weights_hash:string;
 /** Actual external stream unit NAV history; NET histories include internal costs.
  * No stream history is manufactured by ARE. Scope: pure long-only mapped streams only. */
 stream_unit_nav?:PriceRow[];
 stream_execution_certification?:'PIT_MAP_HISTORY_MATCHES_UNIT_NAV_AND_NO_EXTRA_INTERNAL_RESIDUAL';
}
export interface DataStore {prices:PriceRow[];snapshots:Snapshot[];provenance:string;}
export interface Decision {
 date:string;cutoff:string|null;status:Status;reason:string|null;eligible_universe:string[];
 input_hash:string|null;allocation:AllocationSource|null;signal_gate:GateResult|null;portfolio_gate:GateResult|null;
 mandate_hash:string|null;raw:Record<string,number>|null;normalized:Record<string,number>|null;
 projection:unknown;model_reference?:unknown;sensitivity:SensitivityRow[]|null;
}
export interface Track {ledger:BacktestLedgerEntry[];metrics:Record<string,any>;attribution:Record<string,any>;}
export interface Job {
 job_id:string;candidate_id:string;outer_fold:number;inner_fold:number|null;stage:'train'|'inner'|'outer'|'control';scenario_bps:number;
 interval_start:string;interval_end:string;information_identity:string;status:Status;reason:string|null;
 decisions:Decision[];tracks:{RAW:Track|null;NORMALIZED:Track|null};
}
export interface Ranking {candidate_id:string;status:string;rank:number|null;metrics:Record<string,any>|null;reason:string|null;}
export interface SelectionRecord {outer_fold:number;candidate_id:string|null;ranking:Ranking[];selection_input_hash:string;allowed_end_exclusive:string;input_job_ids:string[];}
export interface RunResult {status:'COMPLETE'|'PAUSED';new_jobs:number;reused_jobs:number;backtests:number;selections:SelectionRecord[];jobs:Job[];}
export type {Fold,PriceRow};
