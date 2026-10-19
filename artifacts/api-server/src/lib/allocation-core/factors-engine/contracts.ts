import type {PointInTime,PreviousHoldings,AllocationStatus,RiskSleeveAllocationResult,BetaModel} from '../contracts';
import {DEFAULT_SOLVER,type SolverConfiguration,type SleeveConstraints,type SuppliedBetas,type RiskDiagnostics} from '../assets-engine/contracts';
export const FACTOR_ENGINE_VERSION='factor-implementation-1.0.2';
export type FactorKind='STATISTICAL_FACTOR'|'ECONOMIC_FACTOR'|'TRADABLE_FACTOR_PORTFOLIO';
export interface FactorExposureTarget extends PointInTime {
 kind:'FACTOR_EXPOSURE_TARGET';target_id:string;target_version:string;factor_ids:string[];
 units:'factor_exposure';factor_units:Record<string,string>;target_exposures:Record<string,number>;
}
export interface AssetFactorLoadingMatrix extends PointInTime {
 kind:'FACTOR_LOADING_MATRIX';orientation:'FACTORS_BY_ASSETS';factor_ids:string[];asset_ids:string[];
 units:'factor_exposure_per_unit_risk_weight';factor_units:Record<string,string>;
 factor_kinds:Record<string,FactorKind>;loadings:number[][];model_id:string;model_version:string;matrix_hash:string;
}
export type SpecificRisk = {representation:'FULL_COVARIANCE';units:'daily_decimal_return_squared';values:number[][]} |
 {representation:'DIAGONAL_VARIANCES';units:'daily_decimal_return_squared';values:number[]} |
 {representation:'ZERO_SPECIFIC_RISK';units:'daily_decimal_return_squared'};
export interface FactorRiskModel extends PointInTime {
 kind:'FACTOR_RISK_MODEL';factor_ids:string[];asset_ids:string[];factor_units:Record<string,string>;
 factor_return_units:Record<string,string>;covariance_units:'factor_return_covariance_in_declared_units';
 phi:number[][];specific_risk:SpecificRisk;model_id:string;model_version:string;model_hash:string;
}
export interface FactorTrackingMetric extends PointInTime {
 factor_ids:string[];units:'inverse_factor_exposure_squared';weights:number[][];metric_id:string;metric_version:string;metric_hash:string;
}
export type Secondary='SPECIFIC_VARIANCE'|'TOTAL_VARIANCE'|'TURNOVER';
export type Implementation = {mode:'EXACT_FACTOR_TARGET';secondary:Secondary} |
 {mode:'MIN_FACTOR_TRACKING_ERROR';secondary:Secondary|null;secondary_rule:'EXACT_LEXICOGRAPHIC_ARGMIN'};
export interface FactorSolver extends SolverConfiguration {factor_tolerance:number;rank_tolerance:number;tracking_tie_tolerance:number;secondary_tie_tolerance:number;}
export const DEFAULT_FACTOR_SOLVER:FactorSolver={...DEFAULT_SOLVER,factor_tolerance:1e-9,rank_tolerance:1e-12,tracking_tie_tolerance:1e-12,secondary_tie_tolerance:1e-12};
export interface FactorsInput extends PointInTime {
 schema_version:typeof FACTOR_ENGINE_VERSION;allocation_mode:'FACTORS';convention:'LONG_ONLY_FULLY_INVESTED';
 assets:string[];target:FactorExposureTarget;loadings:AssetFactorLoadingMatrix;risk_model:FactorRiskModel;
 tracking_metric:FactorTrackingMetric;beta_estimates:SuppliedBetas;previous_holdings:PreviousHoldings|null;
 constraints:SleeveConstraints;implementation:Implementation;solver:FactorSolver;
}
export interface FactorDiagnostics {
 target_factor_exposures:Record<string,number>;achieved_factor_exposures:Record<string,number>;
 residual:Record<string,number>;absolute_residual:Record<string,number>;l2_residual:number;weighted_residual_objective:number;
 maximum_absolute_miss:number;exact_within_declared_tolerance:boolean;
 systematic_variance:number;specific_variance:number;total_variance:number;asset_covariance_variance:number;
 annualized_volatility:number;factor_marginal_contributions:Record<string,number>;factor_risk_contributions:Record<string,number>;
 factor_risk_shares:Record<string,number>|null;specific_risk_share:number|null;
 factor_dimensions:number;factor_covariance_effective_rank:number|null;dominant_factor_eigenvalue_share:number|null;
 systematic_risk_concentration:number|null;systematic_factor_entropy_bets:number|null;entropy_reason:string|null;
 factor_eigenvalues:number[];asset_diagnostics:RiskDiagnostics;
}
/** General FACTORS envelope. Frozen AL01 only accepts square-exact details; no false method label. */
export interface FactorImplementationResult extends PointInTime {
 schema_version:typeof FACTOR_ENGINE_VERSION;allocation_mode:'FACTORS';result_id:string|null;input_hash:string|null;
 status:AllocationStatus;asset_weight_units:'fraction_of_risk_capital';asset_weights_risk_sleeve:Record<string,number>|null;
 gross_exposure:number|null;net_exposure:number|null;estimated_market_beta:number|null;estimated_volatility:number|null;
 asset_market_betas:Record<string,number>;beta_model:BetaModel;
 mapping_provenance:PointInTime & {model_id:string;model_version:string;matrix_hash:string;orientation:'FACTORS_BY_ASSETS'};
 factor_risk_model_reference:PointInTime & {model_id:string;model_version:string;model_hash:string;specific_representation:SpecificRisk['representation']};
 target_reference:PointInTime & {target_id:string;target_version:string;factor_units:Record<string,string>};
 tracking_metric_reference:PointInTime & {metric_id:string;metric_version:string;metric_hash:string};
 implementation:Implementation;secondary_value:number|null;diagnostics:FactorDiagnostics|null;
 /** Explicit instrument projection only; original factor result identity/provenance remain attached. */
 controller_projection:{origin_mode:'FACTORS';origin_result_id:string;sleeve:RiskSleeveAllocationResult}|null;
 solver:{method:'CONSTRAINED_MULTI_EQUALITY_KKT_FACES_V1';faces_examined:number;supports_examined:number;
 equality_rank:number|null;stationarity_residual:number|null;converged:boolean;
 numerical_canonicalization:{original_weights:number[];applied_weights:number[];maximum_adjustment:number}|null};
 warnings:string[];errors:string[];
}
