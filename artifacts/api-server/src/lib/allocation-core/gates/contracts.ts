/** AL06 isolated observers. No optimization, routing, forecasts, fallback or promotion. */
import type {PointInTime,RiskMandate} from '../contracts';
import type {AssetsEngineInput,EngineResult} from '../assets-engine/contracts';
import type {FactorsInput,FactorImplementationResult} from '../factors-engine/contracts';
import type {StrategyInput,StrategyResult} from '../strategy-engine/contracts';
export const VERSION='allocation-gates-1.0.3';
export type GateStatus='PASS'|'FAIL'|'INSUFFICIENT_DATA'|'INVALID_INPUT'|'NUMERICAL_FAILURE';
export type GateType='SIGNAL_QUALITY'|'PORTFOLIO_ROBUSTNESS';
export interface Threshold {operator:'MIN'|'MAX';value:number;units:string;}
export interface GatePolicy extends PointInTime {
 gate_policy_id:string;gate_policy_version:string;gate_type:GateType;
 mandatory_checks:string[];warning_checks:string[];thresholds:Record<string,Threshold>;minimum_observations:number;
 failure_behavior:'RETURN_RESULT_ONLY';coverage_failure_status:'FAIL'|'INSUFFICIENT_DATA';
 clock:{evaluation_dates:string[];signal_frequency:string;allocation_frequency:string;recalibration_frequency:string;gate_frequency:string};
 signal_methodology:{version:'CANONICAL_SIGNAL_STRUCTURE_1.0.0';legacy_node3_certification:'LEGACY_NODE3_SOURCE_NOT_PRESENT_IN_CURRENT_REPOSITORY';
 dispersion_ddof:0|1;rank_window_snapshots:number;minimum_rank_intersection_fraction:number;maximum_staleness_calendar_days:number;minimum_rank_snapshots:number};
 robustness_methodology:{allow_approximate_factor_residual:boolean;allow_declared_controller_clip:boolean;correlation_cluster_threshold:number;sensitivity_required_families:string[];require_risk_artifact:boolean};
 /** Explicitly declared numerical tolerances; not economic thresholds. */
 numerics:{absolute:number;covariance_psd:number;eigen_iterations:number};
 policy_hash:string;
}
export interface SignalObservation {value:number|null;observed_at:string;available_at:string;}
export interface RankingSnapshot extends PointInTime {scores:Record<string,SignalObservation>;}
export interface SignalQualityInput extends PointInTime {
 kind:'RESEARCH_SIGNAL_ARTIFACT';signal_artifact_id:string;signal_model_id:string;signal_model_version:string;
 decision_universe:string[];eligible_assets:string[];units:'RANKING_SCORE'|'EXPECTED_DAILY_RETURN';
 normalization:{method:string;version:string;configuration_hash:string;semantics:'EXTERNALLY_SUPPLIED_NO_GATE_TRANSFORM'};
 current_ranking:RankingSnapshot;
 signal_matrix:PointInTime & {orientation:'ASSETS_BY_SIGNAL_FEATURES';feature_ids:string[];rows:Record<string,Array<number|null>>};
 historical_rankings:RankingSnapshot[];artifact_hash:string;
}
export interface Component {check:string;category:'HARD'|'POLICY'|'WARNING';status:GateStatus;value:unknown;
 threshold:Threshold|null;observations:number|null;methodology:string;details:unknown;reason:string|null;}
export interface GateResult {
 schema_version:typeof VERSION;gate_type:GateType;gate_id:string|null;policy_id:string|null;policy_version:string|null;
 as_of:string|null;information_cutoff:string|null;status:GateStatus;
 eligible_for_allocation:boolean;eligible_for_promotion:boolean;
 components:Component[];hard_failures:string[];policy_failures:string[];warnings:string[];errors:string[];
 diagnostics:Record<string,unknown>;semantic_input_hash:string|null;policy_hash:string|null;
 source_hashes:Record<string,string>;no_routing_or_execution:true;
}
export interface SensitivityRow {scenario:string;family:'COVARIANCE'|'MU'|'GAMMA'|'TURNOVER'|'BOUNDS'|'FACTOR_TARGET'|'LOADING'|'FACTOR_COVARIANCE'|'SPECIFIC_RISK'|'STRATEGY_MAP'|'COST';status:string;
 allocation_l1:number|null;max_weight_change:number|null;beta_change:number|null;vol_change:number|null;
 residual_change:number|null;exposure_l1:number|null;objective_degradation:number|null;return_beta_change:number|null;}
export interface SensitivityArtifact extends PointInTime {base_weights_hash:string;methodology_version:string;rows:SensitivityRow[];artifact_hash:string;}
export type AllocationSource={mode:'ASSETS';input:AssetsEngineInput;result:EngineResult}|
 {mode:'FACTORS';input:FactorsInput;result:FactorImplementationResult|null;source_status:string}|
 {mode:'STRATEGY_STREAMS';input:StrategyInput;result:StrategyResult};
export interface PortfolioRobustnessInput extends PointInTime {
 kind:'COMPUTED_ALLOCATION_FOR_OBSERVATION';source:AllocationSource;sensitivity:SensitivityArtifact|null;
 risk_mandate:RiskMandate;reported_controller:{target_clipped:boolean;requested_target:number;achieved_target:number|null}|null;
 /** Completed/external estimated incremental costs only, never synthesized from stream turnover. */
 incremental_cost:{amount:number;units:'FRACTION_RISK_CAPITAL'|'CAPITAL_CURRENCY';basis:string;embedded_in_history:false}|null;
 source_payload_hash:string;
}
