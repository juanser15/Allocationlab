/** One support convention for construction, validation and public audit. */
export const CONSTRAINED_OPTIMIZER_VERSION = "cardinality-active-support-2.0.0";
/** Holdings and position-size limits constrain the strategic construction target,
 * not subsequent capital-overlay targets or drifted realized holdings. */
export const PORTFOLIO_CONSTRAINT_SCOPE = "STRATEGIC_NAV_TARGET_AT_SCHEDULED_REBALANCE";
export const SUPPORT_TOLERANCE = 1e-10;
export const CONSTRAINT_TOLERANCE = 1e-8;
/** Selected assets must be strictly above the support threshold even when the
 * economic floor is zero. This representational floor is disclosed, not a
 * portfolio floor applied after optimization. */
export const MIN_ACTIVE_WEIGHT = 2 * SUPPORT_TOLERANCE;
