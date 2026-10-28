/** PIPE-02 ends at immutable target choice. No execution interface exists. */
import type {FinalPortfolioTarget} from '../pipeline/contracts';
export const VERSION='promotion-routing-1.0.2';
export type Scope='RESEARCH_GOVERNANCE'|'QA_ONLY';
export type Mode='ASSETS'|'FACTORS'|'STRATEGY_STREAMS';
export type PromotionState='RESEARCH'|'VALIDATED'|'PROMOTABLE'|'PROMOTED'|'SUSPENDED'|'RETIRED';
export type Activation='ACTIVE'|'INACTIVE';
export type EvaluationStatus='PROMOTABLE'|'NOT_PROMOTABLE'|'DEFERRED_BLOCKED';
export interface Provenance {data_hash:string;configuration_hash:string;source_ids:string[];available_at:string;}
export interface Point {as_of:string;information_cutoff:string;provenance:Provenance;}
export interface FrozenRef {source_id:string;path:string;sha256:string;available_at:string;}
export interface Identity {artifact_id:string;version:string;candidate_id:string;allocation_mode:Mode;configuration_hash:string;}
export type EconomicMetric='cagr'|'capm_alpha'|'psr'|'max_drawdown'|'average_beta'|'downside_beta'|'tail_beta'|'turnover';
export interface PromotionPolicy extends Point {
 promotion_policy_id:string;version:string;scope:Scope;eligible_modes:Mode[];
 required_certifications:string[];required_gates:string[];minimum_oos_folds:number;minimum_observations:number;
 economic_hurdles:Partial<Record<EconomicMetric,{operator:'MIN'|'MAX';value:number}>>;
 required_robustness_status:'PASS';required_reproducibility_status:'PASS';allowed_unresolved_blockers:string[];
 manual_approval_required:boolean;authority_id:string;hash:string;
}
export interface PromotionEvidence extends Point {
 evidence_id:string;scope:Scope;identity:Identity;frozen_campaign_id:string;refs:FrozenRef[];
 /** Values copied from the cited frozen OOS rows, never recomputed. */
 observations:number;oos_folds:number;metrics:Record<EconomicMetric,number|null>;
 certifications:Record<string,string>;gate_statuses:Record<string,string>;robustness_status:string;reproducibility_status:string;
 cost_scenario_bps:number;risk_mandate_hashes:string[];code_hashes:string[];data_hashes:string[];
 blockers:string[];hash:string;
}
export interface PromotionEvaluation {
 evaluation_id:string;identity:Identity;scope:Scope;evidence_hash:string;policy_hash:string;as_of:string;information_cutoff:string;
 status:EvaluationStatus;components:Array<{check:string;status:'PASS'|'FAIL'|'BLOCKED';observed:unknown;required:unknown}>;hash:string;
}
export interface Authority extends Point {authority_id:string;scope:Scope;kind:'EXTERNAL_MANUAL'|'QA_SIMULATION';actor_refs:string[];allowed_actions:Array<'APPROVE'|'REJECT'|'DEFER'|'SUSPEND'|'RESUME'|'RETIRE'|'ACTIVATE'|'DEACTIVATE'>;valid_from:string;valid_until:string|null;hash:string;}
export interface PromotionDecision {
 decision_id:string;scope:Scope;identity:Identity;evidence_hash:string;policy_hash:string;evaluation_hash:string;
 decision:'APPROVE'|'REJECT'|'DEFER';authorized_by:string;authority_hash:string;decision_time:string;available_at:string;reason:string;hash:string;
}
export interface BankDefinition extends Point {
 entry_id:string;entry_type:'SIGNAL'|'STRATEGY_INSTANCE'|'FACTOR_MODEL'|'ALLOCATION_CONFIGURATION';scope:Scope;identity:Identity;
 strategy_family_id:string|null;underlying_ids:string[];market_tags:string[];region_tags:string[];
 analysis_references:{strategy_returns:FrozenRef|null;correlations:FrozenRef|null;clusters:FrozenRef|null;marginal_diversification:FrozenRef|null};
 valid_from:string;valid_until:string|null;evidence_hash:string;hash:string;
}
export type BankAction='VALIDATE'|'MAKE_PROMOTABLE'|'APPROVE'|'REJECT'|'DEFER'|'SUSPEND'|'RESUME'|'RETIRE'|'ACTIVATE'|'DEACTIVATE';
export type ActivationReason='REGIME_NOT_APPLICABLE'|'DATA_UNAVAILABLE'|'TEMPORARILY_SUSPENDED'|'REDUNDANCY_POLICY_FUTURE'|'MANUAL_HOLD'|'ACTIVE';
export interface BankEvent {
 event_id:string;entry_id:string;definition_hash:string;scope:Scope;sequence:number;previous_event_hash:string|null;
 action:BankAction;from_state:PromotionState;to_state:PromotionState;activation_status:Activation;activation_reason:ActivationReason;
 effective_at:string;available_at:string;actor_ref:string|null;authority_hash:string|null;
 evidence_hash:string;evaluation_hash:string|null;promotion_decision_hash:string|null;reason:string;hash:string;
}
export interface BankState {entry_id:string;definition_hash:string;promotion_status:PromotionState;activation_status:Activation;activation_reason:ActivationReason;last_event_hash:string|null;promotion_decision_hash:string|null;evidence_hash:string;}
export interface BankRegistry {definitions:BankDefinition[];events:BankEvent[];evidence:PromotionEvidence[];policies:PromotionPolicy[];evaluations:PromotionEvaluation[];decisions:PromotionDecision[];authorities:Authority[];}
export interface CertifiedTarget extends Point {
 certificate_id:string;scope:Scope;identity:Identity;origin_decision_date:string;target:FinalPortfolioTarget;
 target_hash:string;certification_status:'VALID';certifications:Record<string,string>;gate_statuses:Record<string,string>;
 source:FrozenRef;hash:string;
}
export interface PrimaryOutcome {
 decision_context_id:string;origin_decision_date:string;candidate_id:string;risk_mandate_hash:string;
 status:string;reason:string|null;target_certificate_hash:string|null;hash:string;
}
export type Condition='PRIMARY_PIPELINE_PASS'|'SIGNAL_GATE_FAIL'|'SIGNAL_INSUFFICIENT_DATA'|'ALLOCATION_FAILURE'|'ROBUSTNESS_GATE_FAIL'|'RISK_TARGET_INFEASIBLE'|'MISSING_ARTIFACT'|'PROMOTION_NOT_ALLOWED'|'ENTRY_INACTIVE'|'DATA_STALE';
export type Action='USE_PRIMARY_TARGET'|'HOLD_PREVIOUS_CERTIFIED_TARGET'|'USE_PREAPPROVED_FALLBACK'|'NO_NEW_TARGET'|'BLOCKED';
export interface RoutingPolicy extends Point {
 routing_policy_id:string;version:string;scope:Scope;condition_priority:Condition[];
 rules:Partial<Record<Condition,{action:Action;fallback_hash:string|null}>>;
 primary_max_age_days:number;maximum_data_age_days:number;
 accepted_data_health_kinds:Array<'MARKET_INFORMATION'|'ARCHIVAL_ARTIFACT_INTEGRITY'|'SYNTHETIC_INFORMATION_SET'>;
 hold:{maximum_target_age_days:number;require_current_data_health:boolean;risk_mandate_must_match:boolean;require_mechanical_recertification:boolean;recertification_checks:string[];maximum_consecutive_holds:number;on_invalid:'NO_NEW_TARGET'|'BLOCKED'};
 fallback:{allow_different_preapproved_risk_mandate:boolean;on_invalid:'NO_NEW_TARGET'|'BLOCKED'};
 required_certifications:string[];required_gates:string[];hash:string;
}
export interface FallbackDefinition extends Point {
 fallback_id:string;version:string;scope:Scope;fallback_type:'FROZEN_CERTIFIED_TARGET';
 allocation_configuration:Identity;risk_mandate_hash:string;risk_mandate_policy_ref:string;
 gate_requirements:string[];required_certifications:string[];certification_evidence_hash:string;
 bank_entry_id:string;target_certificate_hash:string;valid_from:string;valid_until:string|null;hash:string;
}
export interface DataHealth extends Point {health_id:string;kind:'MARKET_INFORMATION'|'ARCHIVAL_ARTIFACT_INTEGRITY'|'SYNTHETIC_INFORMATION_SET';status:'HEALTHY'|'STALE'|'MISSING';data_as_of:string;hash:string;}
export interface Recertification extends Point {target_certificate_hash:string;status:'VALID'|'INVALID';required_checks:Record<string,string>;hash:string;}
export interface RoutingRecord {
 routing_id:string;decision_context_id:string;routing_stream_id:string;scope:Scope;origin_decision_date:string;
 primary_status:string;primary_target_id:string|null;primary_hash:string;promotion_status:PromotionState|null;activation_status:Activation|null;
 conditions:Condition[];selected_condition:Condition|null;primary_failure_reason:string|null;route_reason:string|null;
 routing_policy_id:string;routing_policy_hash:string;action:Action;status:'VALID'|'BLOCKED';
 previous_target_reference:string|null;fallback_reference:string|null;selected_certificate_hash:string|null;selected_certified_target:FinalPortfolioTarget|null;
 routing_timestamp:string;information_cutoff:string;input_hash:string;provenance:Provenance;hash:string;
}
export interface RoutingInput {
 routing_stream_id:string;scope:Scope;as_of:string;information_cutoff:string;primary:PrimaryOutcome;primary_entry_id:string;
 policy:RoutingPolicy;registry:BankRegistry;certificates:CertifiedTarget[];fallbacks:FallbackDefinition[];
 previous_target_hash:string|null;previous_routes:RoutingRecord[];data_health:DataHealth|null;recertifications:Recertification[];
}
