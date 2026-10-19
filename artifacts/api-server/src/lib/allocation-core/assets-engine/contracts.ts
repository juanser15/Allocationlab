import type {PointInTime,CovarianceRiskModel,ExpectedReturns,PreviousHoldings,RiskSleeveAllocationResult,AllocationStatus,BetaModel} from '../contracts';
export const ENGINE_VERSION='assets-allocation-1.0.0';
export type Objective = {type:'EQUAL_WEIGHT'|'MIN_VARIANCE'|'ERC'} | {type:'MEAN_VARIANCE';gamma:number} | {type:'MAX_SHARPE';rf_sleeve:number};
export const OBJECTIVE_REGISTRY = {
 EQUAL_WEIGHT:{version:'1.0.0',requires_mu:false},MIN_VARIANCE:{version:'1.0.0',requires_mu:false},
 MEAN_VARIANCE:{version:'1.0.0',requires_mu:true},MAX_SHARPE:{version:'1.0.1',requires_mu:true},ERC:{version:'1.0.0',requires_mu:false},
} as const;
export interface SolverConfiguration {feasibility_tolerance:number;stationarity_tolerance:number;psd_tolerance:number;
 symmetry_tolerance:number;erc_relative_tolerance:number;max_iterations:number;max_faces:number;max_supports:number;}
export const DEFAULT_SOLVER:SolverConfiguration={feasibility_tolerance:1e-10,stationarity_tolerance:1e-9,
 psd_tolerance:1e-12,symmetry_tolerance:1e-12,erc_relative_tolerance:1e-8,max_iterations:10000,max_faces:100000,max_supports:4096};
export interface SleeveConstraints {asset_bounds:Record<string,{min:number;max:number}>;
 group_caps:Array<{id:string;assets:string[];max:number}>;max_active_names:number|null;
 /** Gross L1 distance between q vectors, not NAV trades or half-L1. */
 turnover_cap:number|null;}
export interface SuppliedBetas extends PointInTime {values:Record<string,number>;beta_model:BetaModel;}
export interface AssetsEngineInput extends PointInTime {
 schema_version:typeof ENGINE_VERSION;convention:'LONG_ONLY_FULLY_INVESTED';assets:string[];
 risk_model:CovarianceRiskModel;expected_returns:ExpectedReturns|null;beta_estimates:SuppliedBetas;
 previous_holdings:PreviousHoldings|null;constraints:SleeveConstraints;objective:Objective;solver:SolverConfiguration;
}
export interface RiskDiagnostics {variance:number;annualized_volatility:number;beta_sleeve:number;
 marginal_risk:Record<string,number>;risk_contributions:Record<string,number>;risk_contribution_fractions:Record<string,number>|null;
 gross_exposure:number;net_exposure:number;hhi:number;effective_number_weights:number;largest_weight:number;top3_share:number;
 turnover_gross_l1:number|null;active_bounds:string[];covariance_effective_rank:number|null;pca_effective_risk_bets:number|null;
 eigenvalues:number[];pca_risk_shares:number[]|null;}
export interface EngineResult {status:AllocationStatus;errors:string[];warnings:string[];input_hash:string|null;result_id:string|null;
 objective:Objective;objective_version:string;weights:Record<string,number>|null;objective_value:number|null;
 diagnostics:RiskDiagnostics|null;sleeve:RiskSleeveAllocationResult|null;
 solver:{method:string;iterations:number;faces_examined:number;supports_examined:number;stationarity_residual:number|null;
 convergence_tolerance:number;constraint_tolerance:number;converged:boolean};}
