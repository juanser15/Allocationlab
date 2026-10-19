/** Research-only strategy-instance allocation. AlphaStream/ALPHA_STREAMS are
 * compatibility names, never evidence of statistical/Jensen alpha. No mandate,
 * target beta, exposure multiplier or global cash decision lives in this module. */
import type {PointInTime,Provenance,AllocationStatus,RiskSleeveAllocationResult} from '../contracts';
import type {SolverConfiguration} from '../assets-engine/contracts';
export const VERSION='strategy-allocation-1.0.1';
export type SeriesUnits='NET_RETURN_PER_UNIT_CAPITAL'|'NET_PNL_PER_UNIT_CAPITAL';
export type Objective={type:'EQUAL_CAPITAL'|'MIN_VARIANCE'|'ERC'}|{type:'MEAN_VARIANCE';gamma:number}|{type:'MAX_SHARPE';rf_stream:number};
export const OBJECTIVES={EQUAL_CAPITAL:'1.0.0',MIN_VARIANCE:'1.0.0',MEAN_VARIANCE:'1.0.0',MAX_SHARPE:'1.0.1',ERC:'1.0.0'} as const;
export interface PositionMap extends PointInTime {
 units:'instrument_exposure_per_unit_allocated_stream_capital';exposures:Record<string,number>;
 internal_residual_capital:number;residual_semantics:'STREAM_HELD_NOT_EXTERNALLY_REDEPLOYABLE';
 funding:'LONG_ONLY_FUNDED'|'SIGNED_OR_EXTERNAL_FINANCING';map_hash:string;
}
export interface StrategyInstance extends PointInTime {
 kind:'STRATEGY_INSTANCE';strategy_instance_id:string;strategy_family_id:string;underlying_universe_id:string;
 underlying_ids:string[];strategy_version:string;parameterization_hash:string;configuration:Record<string,unknown>;
 /** Only explicitly distinct execution sleeves may duplicate canonical economic identity. */
 separate_execution_sleeve_id:string|null;
 historical_series:{units:SeriesUnits;capital_basis:'BEGINNING_STREAM_CAPITAL';frequency:'DAILY';dates:string[];values:number[]};
 unit_position_map:PositionMap;forecast:ExpectedStrategyReturns|null;
 execution_convention:{signal_timing:string;rebalance_timing:string;execution_lag_sessions:number;
 internal_costs:'EMBEDDED_IN_NET_HISTORY';internal_cash_yield:'EMBEDDED_IN_NET_HISTORY';description:string};
 availability:{first_observation:string;version_available_at:string};
}
/** Legacy technical alias; a strategy instance, not residual alpha. */
export type AlphaStream=StrategyInstance;
export interface StrategyCovariance extends PointInTime {kind:'STRATEGY_RETURN_COVARIANCE';axis_ids:string[];
 series_units:SeriesUnits;capital_basis:'BEGINNING_STREAM_CAPITAL';frequency:'DAILY';covariance:number[][];artifact_hash:string;}
export interface ExpectedStrategyReturns extends PointInTime {kind:'EXTERNAL_STRATEGY_EXPECTED_RETURN';axis_ids:string[];
 series_units:SeriesUnits;capital_basis:'BEGINNING_STREAM_CAPITAL';frequency:'DAILY';values:Record<string,number>;artifact_hash:string;}
export interface BetaArtifact extends PointInTime {axis_ids:string[];values:Record<string,number>;beta_method:'STRATEGY_RETURN_SAMPLE_COV_VARIANCE'|'CURRENT_POSITION_ASSET_BETA';
 benchmark:string;window:{start:string;end:string;observations:number};artifact_hash:string;}
export interface AssetCovariance extends PointInTime {kind:'CURRENT_ASSET_RETURN_COVARIANCE';axis_ids:string[];covariance:number[][];units:'daily_decimal_return_squared';artifact_hash:string;}
export interface StrategyConstraints {
 bounds:Record<string,{min:number;max:number}>;
 family_caps:Array<{id:string;max:number}>;underlying_group_caps:Array<{id:string;underlying_ids:string[];max:number}>;
 max_active_strategies:number|null;turnover_cap:number|null;
}
export interface ImplementationConstraints {
 instrument_bounds:Record<string,{max_absolute:number|null;min_net:number|null;max_net:number|null}>;
 group_limits:Array<{id:string;instruments:string[];basis:'NET'|'GROSS';min:number|null;max:number|null}>;
 max_gross:number|null;min_net:number|null;max_net:number|null;
}
export interface PreviousAllocation extends PointInTime {units:'fraction_of_strategy_risk_capital';allocations:Record<string,number>;instrument_exposures:Record<string,number>;}
export interface IncrementalCost extends PointInTime {
 source:'NET';basis:'ACTUAL_INSTRUMENT_TRADE_NOTIONAL';units:'CAPITAL_CURRENCY';methodology:'ABS_NOTIONAL_TIMES_BPS_V1';
 embedded_in_stream_history:false;bps:number;trades:Array<{instrument_id:string;trade_id:string;signed_notional:number}>;
}
export interface StrategyInput extends PointInTime {
 schema_version:typeof VERSION;allocation_mode:'ALPHA_STREAMS';convention:'NONNEGATIVE_FULLY_ALLOCATED_STRATEGY_CAPITAL';
 streams:StrategyInstance[];risk_model:StrategyCovariance;expected_returns:ExpectedStrategyReturns|null;
 strategy_betas:BetaArtifact|null;asset_betas:BetaArtifact|null;asset_covariance:AssetCovariance|null;
 previous_allocation:PreviousAllocation|null;strategy_constraints:StrategyConstraints;implementation_constraints:ImplementationConstraints;
 objective:Objective;solver:SolverConfiguration;incremental_cost:IncrementalCost|null;
}
export interface RiskDiagnostics {variance:number;annualized_volatility:number;expected_return:number|null;marginal:Record<string,number>;
 contributions:Record<string,number>;normalized_shares:Record<string,number>|null;hhi:number;effective_allocations:number;
 covariance_effective_rank:number|null;pca_effective_risk_bets:number|null;eigenvalues:number[];correlations:Array<Array<number|null>>;
 correlation_clusters:string[][];clustering_method:'ABS_CORRELATION_GE_0.90_CONNECTED_COMPONENTS_DIAGNOSTIC_ONLY';}
export interface Aggregation {instrument_exposures:Record<string,number>;contributions:Record<string,Record<string,number>>;
 instruments:Record<string,{gross_positive:number;gross_negative_absolute:number;net:number;contributing_streams:string[]}>;
 pre_net_gross:number;post_net_gross:number;post_net_net:number;netting_benefit:number;internal_residual_capital:number;
 nominal_strategy_count:number;nominal_underlying_count:number;absolute_normalized_asset_hhi:number|null;effective_asset_count:number|null;
 strategy_turnover_l1:number|null;instrument_turnover_l1:number|null;}
export interface StrategyResult {schema_version:typeof VERSION;allocation_mode:'ALPHA_STREAMS';terminology:'STRATEGY_INSTANCE_NOT_STATISTICAL_ALPHA';as_of:string|null;information_cutoff:string|null;provenance:Provenance|null;allocation_units:'fraction_of_strategy_risk_capital';instrument_units:'instrument_exposure_per_unit_strategy_risk_capital';status:AllocationStatus;errors:string[];warnings:string[];
 input_hash:string|null;result_id:string|null;objective:Objective;objective_version:string;allocations:Record<string,number>|null;
 objective_value:number|null;return_risk:RiskDiagnostics|null;aggregation:Aggregation|null;
 strategy_return_beta:number|null;current_position_beta:number|null;beta_provenance:{strategy:BetaArtifact|null;position:BetaArtifact|null};
 implementation_risk:Omit<RiskDiagnostics,'hhi'|'effective_allocations'|'expected_return'>|null;
 controller_compatibility:'CONTROLLER_COMPATIBLE_LONG_ONLY_NET_ONE'|'SIGNED_OR_NON_NET_ONE_EXPOSURE'|'NOT_EVALUATED';
 controller_projection:RiskSleeveAllocationResult|null;controller_projection_status:string;
 incremental_cost:{amount:number;embedded_internal_costs_recharged:false;basis:string;trade_count:number}|null;
 solver:{method:string;iterations:number;faces:number;supports:number;converged:boolean;stationarity_residual:number|null;
 active_constraints:string[];numerical_canonicalization_l1:number;tolerance:number;max_iterations:number};
}
