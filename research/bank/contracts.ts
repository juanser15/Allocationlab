/** BANK-01: eligibility only. StrategyStream is not statistical alpha. */
import type {PromotionState} from '../governance/contracts';
export const VERSION='active-set-bank-1.0.0';
export interface Point {as_of:string;information_cutoff:string;available_at:string;}
export interface Provenance {data_hash:string;configuration_hash:string;source_ids:string[];}
export interface Entry extends Point {
 signal_metadata:{signal_model_id:string;signal_model_version:string;signal_units:string;artifact_hash:string}|null;
 entry_id:string;entry_type:'SIGNAL'|'STRATEGY_INSTANCE';scope:'QA_ONLY'|'RESEARCH_GOVERNANCE';
 strategy_instance_id:string|null;strategy_family_id:string|null;underlying_ids:string[];
 market_tags:string[];region_tags:string[];sector_tags:string[];strategy_version:string;parameterization_hash:string;
 separate_execution_sleeve_id:string|null;valid_from:string;valid_until:string|null;
 version_available_at:string;signal_gate_required:boolean;
 allowed_regimes:string[];preferred_regimes:string[];prohibited_regimes:string[];
 provenance:Provenance;hash:string;
}
export interface State extends Point {
 entry_id:string;effective_at:string;promotion_status:PromotionState;
 /** Upstream manual prohibition is independent of computed BANK inactivity. */
 manual_hold:boolean;reason:string;evidence_hash:string;promotion_decision_hash:string|null;promotion_decision_time:string|null;
 source:'PIPE02_VERIFIED_REGISTRY'|'QA_ONLY_EXTERNAL_FIXTURE';hash:string;
}
export interface Observation {date:string;available_at:string;value:number;}
export interface ReturnHistory {units:'NET_RETURN_PER_UNIT_CAPITAL'|'NET_PNL_PER_UNIT_CAPITAL';capital_basis:'BEGINNING_STREAM_CAPITAL';version:string;observations:Observation[];}
export interface Regime extends Point {regime_id:string;state:string;provenance:Provenance;hash:string;}
export interface Gate extends Point {entry_id:string;status:'PASS'|'FAIL'|'INSUFFICIENT_DATA'|'INVALID_INPUT'|'NUMERICAL_FAILURE';gate_id:string;hash:string;}
export interface Evidence extends Point {entry_id:string;promotion_evidence_hash:string;research_score:number|null;psr:number|null;turnover:number|null;hash:string;}
export interface Position extends Point {entry_id:string;units:'instrument_exposure_per_unit_stream_capital';exposures:Record<string,number>;internal_residual_capital:number;hash:string;}
export interface Exposure extends Point {entry_id:string;benchmark:string;market_beta:number;factor_model_id:string|null;factor_exposures:Record<string,number>|null;hash:string;}
export interface AssetRisk extends Point {asset_ids:string[];covariance:number[][];units:'daily_decimal_return_squared';hash:string;}
export type Selector='LEXICOGRAPHIC_POLICY'|'BEST_FROZEN_RESEARCH_SCORE'|'HIGHEST_PSR_FROM_PROMOTION_EVIDENCE'|'LOWEST_TURNOVER'|'LOWEST_CORRELATION_TO_ACTIVE_SET';
export interface Policy extends Point {
 policy_id:string;version:string;scope:Entry['scope'];evaluation_frequency:string;
 correlation:{method:'SAMPLE_PEARSON_COMMON_SESSIONS_V1';window_sessions:63|126|252;minimum_observations:number;maximum_data_age_days:number;missing_data:'INACTIVATE_INCOMPLETE_WINDOW';};
 clustering:{method:'HIERARCHICAL_CORRELATION';distance:'SQRT_HALF_ONE_MINUS_RHO';linkage:'SINGLE'|'COMPLETE'|'AVERAGE';correlation_threshold:number;};
 minimum_strategy_history:number;maximum_total_active:number|null;
 maximum_per_family:Record<string,number>;maximum_per_underlying:Record<string,number>;maximum_per_cluster:number|null;
 maximum_pairwise_correlation:number|null;minimum_marginal_effective_rank_gain:number|null;
 representative_selector:Selector;require_correlation_for_activation:boolean;
 regime_allowed:string[];signal_gate_maximum_age_days:number;signal_gate_requirement:'ENTRY_DECLARED_PASS_REQUIRED'|'ALL_ENTRIES_PASS_REQUIRED';
 diagnostic_reference:'EQUAL_UNIT_REFERENCE_NOT_ALLOCATION';numerical_tolerance:number;
 provenance:Provenance;hash:string;
}
export interface Input {
 decision_date:string;information_cutoff:string;policy:Policy;
 entries:Entry[];states:State[];returns:Record<string,ReturnHistory>;session_calendar:string[];
 regimes:Regime[];signal_gates:Gate[];evidence:Evidence[];position_maps:Position[];
 exposures:Exposure[];asset_risk:AssetRisk[];
 /** Required for real scope; state is derived using certified PIPE02 validation. */
 governance_registry:import('../governance/contracts').BankRegistry|null;
}
export type Activation='ELIGIBLE_ACTIVE'|'INACTIVE_DATA'|'INACTIVE_REGIME'|'INACTIVE_REDUNDANCY'|'INACTIVE_CLUSTER_LIMIT'|'INACTIVE_POLICY_LIMIT'|'INACTIVE_SUSPENDED'|'INACTIVE_NOT_PROMOTED'|'INSUFFICIENT_DATA';
export interface Eligibility {entry_id:string;strategy_instance_id:string|null;entry_type:Entry['entry_type'];promotion_status:PromotionState;eligible:boolean;status:Activation;reason:string;history_observations:number;state_hash:string|null;gate_hash:string|null;}
export interface Correlation {version:string;model_id:string;information_cutoff:string;data_hash:string;policy_hash:string;axis_ids:string[];dates:string[];window_dates:string[];covariance:number[][];correlation:number[][];excluded:Record<string,string>;status:'VALID'|'INSUFFICIENT_DATA';hash:string;}
export interface Cluster {cluster_id:string;members:string[];size:number;within_average_correlation:number|null;}
export interface Clustering {cluster_artifact_id:string;model_hash:string;policy_hash:string;clusters:Cluster[];between:Array<{left:string;right:string;average_correlation:number}>;merges:Array<{left:string[];right:string[];distance:number}>;hash:string;}
export interface Breadth {count:number;covariance_effective_rank:number|null;pca_effective_bets:number|null;pc1_variance_share:number|null;average_pairwise_correlation:number|null;predicted_daily_variance:number|null;smallest_eigenvalue:number|null;pca_repeated_eigenvalue_caveat:boolean;}
export interface Marginal {strategy_instance_id:string;reference:'EQUAL_UNIT_REFERENCE_NOT_ALLOCATION';before:Breadth;after:Breadth;effective_rank_gain:number|null;}
export interface Result {
 version:string;active_set_id:string;decision_date:string;information_cutoff:string;scope:Entry['scope'];
 status:'VALID';policy_id:string;policy_version:string;policy_hash:string;bank_snapshot_hash:string;
 regime_artifact_reference:string|null;correlation_model_id:string;cluster_artifact_id:string;
 active_strategy_ids:string[];active_signal_ids:string[];inactive:Array<{entry_id:string;strategy_instance_id:string|null;status:Activation;reason:string}>;
 entries:Eligibility[];correlation:Correlation;clustering:Clustering;
 diagnostics:{strategy:Breadth;nominal_strategy_count:number;effective_strategy_count_reference:number;strategy_allocation_hhi:null;effective_strategy_allocation_count:null;nominal_underlying_count:number;strategies_per_underlying:Record<string,number>;strategies_per_family:Record<string,number>;within_underlying_correlations:Record<string,number|null>;underlying_hhi_reference:number|null;mapped_asset_effective_count_reference:number|null;asset_pca_effective_bets_reference:number|null;mapping_coverage:number;potential_unit_exposure_maps:Record<string,Record<string,number>>;internal_residual_reference:number|null;systematic_similarity:Array<Record<string,unknown>>;marginal:Marginal[];warnings:string[];};
 provenance:Provenance;hash:string;
}
