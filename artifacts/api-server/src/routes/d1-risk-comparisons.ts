import { Router, type IRouter, type Response } from "express";
import {
  D1RiskComparisonError,
  getD1RiskModelComparison,
  listD1RiskModelComparisons,
  persistD1RiskModelComparison,
  replayD1RiskModelComparison,
} from "../lib/d1-risk-comparison";

const router: IRouter = Router();
const SLOTS = ["SAMPLE", "DIAGONAL_SHRINKAGE", "STATISTICAL_FACTOR"] as const;

function positiveSafeId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
function validBody(value: unknown): value is {
  allocationIds: Record<(typeof SLOTS)[number], number>;
  validationRunIds: Record<(typeof SLOTS)[number], number>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const exactKeys = (item: unknown) => item !== null && typeof item === "object" &&
    !Array.isArray(item) &&
    Object.keys(item).sort().join(",") === [...SLOTS].sort().join(",");
  if (Object.keys(body).sort().join(",") !== "allocationIds,validationRunIds" ||
      !exactKeys(body.allocationIds) || !exactKeys(body.validationRunIds)) return false;
  const allocations = body.allocationIds as Record<string, unknown>;
  const validations = body.validationRunIds as Record<string, unknown>;
  return SLOTS.every((slot) => positiveSafeId(allocations[slot]) && positiveSafeId(validations[slot]));
}
function pathId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
function sendError(error: unknown, res: Response): void {
  if (error instanceof D1RiskComparisonError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  throw error;
}

router.post("/risk-model-comparisons", async (req, res): Promise<void> => {
  if (!validBody(req.body)) {
    res.status(400).json({
      error: "Request must contain exactly allocationIds and validationRunIds, each keyed by SAMPLE, DIAGONAL_SHRINKAGE, and STATISTICAL_FACTOR with positive integer IDs.",
    });
    return;
  }
  try {
    res.status(201).json(await persistD1RiskModelComparison(req.body));
  } catch (error) {
    sendError(error, res);
  }
});

router.get("/risk-model-comparisons", async (_req, res): Promise<void> => {
  res.json({ comparisons: await listD1RiskModelComparisons() });
});

router.get("/risk-model-comparisons/:comparisonId", async (req, res): Promise<void> => {
  const id = pathId(req.params.comparisonId);
  if (id === null) {
    res.status(400).json({ error: "comparisonId must be a positive safe integer." });
    return;
  }
  const comparison = await getD1RiskModelComparison(id);
  if (!comparison) {
    res.status(404).json({ error: "Risk-model comparison not found." });
    return;
  }
  res.json(comparison);
});

router.post("/risk-model-comparisons/:comparisonId/replay", async (req, res): Promise<void> => {
  const id = pathId(req.params.comparisonId);
  if (id === null) {
    res.status(400).json({ error: "comparisonId must be a positive safe integer." });
    return;
  }
  try {
    const replay = await replayD1RiskModelComparison(id);
    if (!replay) {
      res.status(404).json({ error: "Risk-model comparison not found." });
      return;
    }
    res.json(replay);
  } catch (error) {
    sendError(error, res);
  }
});

export default router;