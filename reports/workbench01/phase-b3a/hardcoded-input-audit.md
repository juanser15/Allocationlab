# Workbench B3A input audit

The certified engine distinguishes **selection cost** from **OOS evaluation cost**. `Campaign.selection_cost_bps` selects the training jobs used to rank candidates; `Campaign.transaction_cost_bps` lists scenarios computed for both training and selected-candidate OOS. V2 therefore requires both `selection_cost_bps` and `transaction_cost_bps`. They are never collapsed, rounded, or replaced with a fixture value. The engine receives the sorted unique union of the two explicit costs.

| Input | Classification | V2 treatment |
| --- | --- | --- |
| 2020–2024 campaign dates | CERTIFICATION_FIXTURE_ONLY | Removed from ordinary API; evaluation/OOS dates required from user |
| 24-month training | CERTIFICATION_FIXTURE_ONLY | Positive user-selected `training_window_months`, checked against actual observations |
| 12-month test and step | CERTIFICATION_FIXTURE_ONLY | Derived as 1 or 3 months from user cadence |
| Rolling-only window | USER_CONFIGURABLE | ROLLING or EXPANDING |
| Monthly-only rebalance | USER_CONFIGURABLE | MONTHLY or QUARTERLY |
| Independent recalibration | DERIVED_FROM_USER_INPUT | Equals rebalance cadence; no independent API field |
| 0/5 scenario list | CERTIFICATION_FIXTURE_ONLY | Any explicit finite nonnegative number; selection and OOS fees separate |
| Hidden 5-bps selection | CERTIFICATION_FIXTURE_ONLY | Required explicit `selection_cost_bps` |
| Unused nested 12/6/6 clock | CERTIFICATION_FIXTURE_ONLY | Omitted from V2 campaigns |
| Current regime, 252-row lookback, identity transform | MODEL_DEFINITION_FIXED | Versioned existing model; stateless fit is declared; no learned estimator invented |
| 252-observation warmup | MODEL_DEFINITION_FIXED | Explicit model/history rule, separate from user training window |
| Training observation minimum | MODEL_DEFINITION_FIXED | Stateless fit requires no learned-history minimum; training ranking needs at least two returns and a defined score. The 252-row warmup is not imposed as a training-window minimum. |
| Candidate exposure grid, information universe, constraints | MODEL_DEFINITION_FIXED | Existing committed model definition, fully expanded in normalized spec |
| SPY operated sleeve, cash/reference daily yield 0, slippage 0 | MODEL_DEFINITION_FIXED | Explicit fixed model terms; no silent defaults |
| NAV 100 per independent fold, next-close execution | MODEL_DEFINITION_FIXED | Existing engine semantics retained and disclosed |
| Grid search and 200 candidate ceiling | MODEL_DEFINITION_FIXED | Existing five-candidate model grid; no candidate-budget control |
| 2000 estimated-job ceiling, timeout, output/log bounds | MODEL_DEFINITION_FIXED | Operational resource limits; plans exceeding limits are blocked |

The original fixture and V1 identity/result implementation remain unchanged. V1 is explicitly exposed at `/api/workbench/v1/**`; `/api/workbench/**` is V2. The existing B2 frontend fails its capability gate on V2 and cannot silently submit the obsolete five-field request.
