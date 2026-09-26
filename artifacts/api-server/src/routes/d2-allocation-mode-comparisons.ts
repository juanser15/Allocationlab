import { Router, type IRouter, type Response } from "express";
import {
  D2AllocationModeComparisonError,
  getD2AllocationModeComparison,
  listD2AllocationModeComparisons,
  persistD2AllocationModeComparison,
  replayD2AllocationModeComparison,
} from "../lib/d2-allocation-mode-comparison";

const router: IRouter = Router();
const MODES = ["CAPITAL_LONG_ONLY", "SIGNED_OVERLAY"] as const;
type Mode = (typeof MODES)[number];

function positiveSafeId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
function validBody(value: unknown): value is {
  allocationIds: Record<Mode, number>;
  validationRunIds: Record<Mode, number>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const exactKeys = (item: unknown) => item !== null && typeof item === "object" &&
    !Array.isArray(item) && Object.keys(item).sort().join(",") === [...MODES].sort().join(",");
  if (Object.keys(body).sort().join(",") !== "allocationIds,validationRunIds" ||
      !exactKeys(body.allocationIds) || !exactKeys(body.validationRunIds)) return false;
  const allocations = body.allocationIds as Record<string, unknown>;
  const validations = body.validationRunIds as Record<string, unknown>;
  return MODES.every((mode) => positiveSafeId(allocations[mode]) && positiveSafeId(validations[mode]));
}
function pathId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
function sendError(error: unknown, res: Response): void {
  if (error instanceof D2AllocationModeComparisonError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  throw error;
}

router.post("/allocation-mode-comparisons", async (req, res): Promise<void> => {
  if (!validBody(req.body)) {
    res.status(400).json({
      error: "Request must contain exactly allocationIds and validationRunIds, each keyed by CAPITAL_LONG_ONLY and SIGNED_OVERLAY with positive integer IDs.",
    });
    return;
  }
  try {
    res.status(201).json(await persistD2AllocationModeComparison(req.body));
  } catch (error) {
    sendError(error, res);
  }
});

router.get("/allocation-mode-comparisons", async (_req, res): Promise<void> => {
  res.json({ comparisons: await listD2AllocationModeComparisons() });
});

router.get("/allocation-mode-comparisons/:comparisonId", async (req, res): Promise<void> => {
  const id = pathId(req.params.comparisonId);
  if (id === null) {
    res.status(400).json({ error: "comparisonId must be a positive safe integer." });
    return;
  }
  const comparison = await getD2AllocationModeComparison(id);
  if (!comparison) {
    res.status(404).json({ error: "D2 allocation-mode comparison not found." });
    return;
  }
  res.json(comparison);
});

router.post("/allocation-mode-comparisons/:comparisonId/replay", async (req, res): Promise<void> => {
  const id = pathId(req.params.comparisonId);
  if (id === null) {
    res.status(400).json({ error: "comparisonId must be a positive safe integer." });
    return;
  }
  try {
    const replay = await replayD2AllocationModeComparison(id);
    if (!replay) {
      res.status(404).json({ error: "D2 allocation-mode comparison not found." });
      return;
    }
    res.json(replay);
  } catch (error) {
    sendError(error, res);
  }
});

export default router;