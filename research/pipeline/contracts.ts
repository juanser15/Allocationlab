/** PIPE-01 is offline orchestration. Certified modules own all financial math. */
import type {RiskMandate,RiskSleeveAllocationResult} from '../../artifacts/api-server/src/lib/allocation-core/contracts';
import type {AllocationSource,GatePolicy,SignalQualityInput,SensitivityRow,GateResult} from '../../artifacts/api-server/src/lib/allocation-core/gates/contracts';
import type {Candidate} from '../allocation/contracts';
import type {PriceRow,BacktestLedgerEntry,ExecutionTiming} from '../../artifacts/api-server/src/lib/calculator';
export const VERSION='canonical-research-pipeline-1.0.2';
export const STAGES=['VALIDATE_CONTEXT','RESOLVE_MANDATE','SIGNAL_GATE','ALLOCATOR','SLEEVE_RISK','ROBUSTNESS_GATE','EXPOSURE_CONTROLLER','FINAL_TARGET','EXECUTION','ACCOUNTING_ATTRIBUTION'] as const;
export type Stage=typeof STAGES[number];
export type Status='VALID'|'INVALID_INPUT'|'BLOCKED_MISSING_ARTIFACTS'|'SIGNAL_GATE_FAIL'|'SIGNAL_GATE_INSUFFICIENT_DATA'|'SIGNAL_GATE_INVALID_INPUT'|'SIGNAL_GATE_NUMERICAL_FAILURE'|'ALLOCATION_INFEASIBLE'|'ALLOCATION_NUMERICAL_FAILURE'|'ALLOCATION_INVALID_INPUT'|'ALLOCATION_INSUFFICIENT_DATA'|'MISSING_SLEEVE_RISK'|'ROBUSTNESS_GATE_FAIL'|'EXPOSURE_INFEASIBLE'|'EXECUTION_FAILURE'|'ACCOUNTING_FAILURE';
export type NativeInput={mode:'ASSETS';input:Extract<AllocationSource,{mode:'ASSETS'}>['input']}|{mode:'FACTORS';input:Extract<AllocationSource,{mode:'FACTORS'}>['input']}|{mode:'STRATEGY_STREAMS';input:Extract<AllocationSource,{mode:'STRATEGY_STREAMS'}>['input']};
export interface Bundle {
 native:NativeInput|null;mandate:RiskMandate;signal:SignalQualityInput|null;sensitivity:SensitivityRow[]|null;
 signal_policy:GatePolicy;robustness_policy:GatePolicy;
 /** Actual historical source identity, not a new model fit/publication. */
 original_risk_reference:unknown;
}
export interface DecisionContext {
 schema_version:typeof VERSION;decision_context_id:string;decision_date:string;information_cutoff:string;
 execution:{date:string;convention:ExecutionTiming;rebalance_frequency:'monthly'|'quarterly'};
 eligible_universe:string[];previous_holdings:unknown;
 candidate:Candidate;selection_lock:{candidate_id:string;selection_hash:string;outer_fold:number;source_id:string};
 signal_gate_required:boolean;signal_exemption_reason:string|null;
 risk_mandate_hash:string;signal_policy_hash:string;robustness_policy_hash:string;
 artifact_hashes:{native:string|null;signal:string|null;sensitivity:string|null;original_risk_reference:string};
 costs:{bps:number;slippage_bps:0;basis:'ACTUAL_INSTRUMENT_NOTIONAL';embedded_strategy_costs:'NOT_RECHARGED';cash_yield_daily:number};
 provenance:{information_prices_hash:string;source_ids:string[];bundle_hash:string;code_version:typeof VERSION};
}
export interface StageRecord {decision_context_id:string;stage:Stage;stage_id:string;status:string;input_hash:string;output_hash:string;output:unknown;}
export interface FinalPortfolioTarget {
 target_id:string;decision_context_id:string;risk_mandate_hash:string;allocation_id:string;robustness_gate_id:string;composition_id:string;
 final_asset_weights:Record<string,number>;implementation_cash:number;expected_final_beta:number|null;expected_final_volatility:number|null;
 gross_exposure:number;net_exposure:number;execution:DecisionContext['execution'];status:'VALID';provenance:DecisionContext['provenance'];
}
export interface PipelineDecision {
 decision_context_id:string;context:DecisionContext;status:Status;reason:string|null;stages:StageRecord[];
 allocation:AllocationSource|null;sleeve:RiskSleeveAllocationResult|null;signal_gate:GateResult|null;
 signal_status:GateResult['status']|'NOT_REQUIRED'|null;robustness_gate:GateResult|null;projection:unknown;
 final_target:FinalPortfolioTarget|null;source_unchanged:boolean;
}
export interface BookRequest {
 book_id:string;benchmark:string;start:string;end_exclusive:string;track:'RAW'|'NORMALIZED';
 /** Valuation/fill data is separate from decision information sets. */
 prices:PriceRow[];decisions:Array<{context:DecisionContext;bundle:Bundle}>;
 reference:{campaign:string;job_id:string;outer_fold:number;scenario_bps:number;frozen_ledger:BacktestLedgerEntry[]|null};
}
export interface BookResult {book_id:string;status:'VALID'|'EXECUTION_FAILURE'|'ACCOUNTING_FAILURE'|'UPSTREAM_FAILURE';reason:string|null;decisions:PipelineDecision[];ledger:BacktestLedgerEntry[];reconciliation:Array<Record<string,unknown>>;attribution:unknown;}
