import { z } from "zod";
export const candidateFailureSchema = z.object({
  exposure_policy: z.enum(["cash_band", "constant"]),
  parameters: z.record(z.number().finite()).optional(),
  annualized_turnover: z
    .union([z.number().finite(), z.literal("NOT_SUPPORTED")])
    .optional(),
  annualized_turnover_lower_bound: z.number().finite().optional(),
  maximum_annualized_turnover: z
    .union([z.number().finite(), z.literal("NOT_CONFIGURED")])
    .optional(),
  violated_constraints: z.array(z.string().regex(/^[A-Z_]+$/)).optional(),
});
export const failureContextSchema = z.object({
  candidates: z.array(candidateFailureSchema).optional(),
  failure_diagnostic: z
    .object({ candidates: z.array(candidateFailureSchema) })
    .optional(),
});
export const failureConstraintsSchema = z.object({
  max_turnover: z.number().finite().optional(),
});
export function readFailureConstraints(definition: unknown) {
  const parsed = z
    .object({ constraints: failureConstraintsSchema })
    .safeParse(definition);
  return parsed.success ? parsed.data.constraints : undefined;
}
const publicText = z
  .string()
  .max(3000)
  .refine(
    (s) =>
      !/(?:^|\s)(?:\/[\w.-]+\/|[A-Za-z]:\\)|\n\s*at |Bearer\s|\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/.test(
        s,
      ),
    "Private diagnostic text is not a public failure field",
  );
export const failureFields = {
  failure_diagnostic: z
    .object({ candidates: z.array(candidateFailureSchema) })
    .passthrough()
    .optional(),
  failed_stage: z
    .string()
    .regex(/^[A-Z_]+$/)
    .optional(),
  failed_fold_id: z.number().int().nonnegative().nullable().optional(),
  failed_decision_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  safe_message: publicText.optional(),
  actionable_explanation: publicText.optional(),
  suggested_user_action: publicText.optional(),
  diagnostic_reference: z
    .string()
    .refine((s) =>
      /^(?:runs\/rr_[a-f0-9]{64}\/attempts\/ea_[a-f0-9-]{36}\/(?:failure-diagnostic-v1|diagnostic)\.json|PRE_RUN_NO_ATTEMPT_CREATED|NOT_(?:AVAILABLE|SAFELY_AVAILABLE))$/.test(
        s,
      ),
    )
    .optional(),
};
export const safeFailureSchema = z.object({
  error_class: z.string().regex(/^[A-Z_]+$/),
  failed_stage: failureFields.failed_stage.unwrap(),
  failed_fold_id: failureFields.failed_fold_id.unwrap(),
  failed_decision_date: failureFields.failed_decision_date.unwrap(),
  safe_message: publicText,
  actionable_explanation: publicText,
  suggested_user_action: publicText,
  diagnostic_reference: failureFields.diagnostic_reference.unwrap(),
});
export type SafeFailure = z.infer<typeof safeFailureSchema>;
