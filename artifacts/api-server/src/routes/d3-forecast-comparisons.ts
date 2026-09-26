import { Router, type IRouter, type Response } from "express";
import {
  CreateForecastComparisonBody,
  CreateForecastComparisonResponse,
  GetForecastComparisonParams,
  GetForecastComparisonResponse,
  ListForecastComparisonsResponse,
  ReplayForecastComparisonParams,
  ReplayForecastComparisonResponse,
} from "@workspace/api-zod";
import {
  D3ForecastComparisonError,
  getD3ForecastComparison,
  listD3ForecastComparisons,
  persistD3ForecastComparison,
  replayD3ForecastComparison,
} from "../lib/d3-forecast-comparison";

const router: IRouter = Router();

function sendError(error: unknown, res: Response): void {
  if (error instanceof D3ForecastComparisonError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  throw error;
}

router.post("/forecast-comparisons", async (req, res): Promise<void> => {
  const body = CreateForecastComparisonBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid D3 forecast-comparison request.", details: body.error.issues });
    return;
  }
  try {
    const payload = await persistD3ForecastComparison(body.data);
    const response = CreateForecastComparisonResponse.safeParse(payload);
    if (!response.success) {
      res.status(500).json({ error: "D3 forecast-comparison response failed its generated schema." });
      return;
    }
    res.status(201).json(response.data);
  } catch (error) {
    sendError(error, res);
  }
});

router.get("/forecast-comparisons", async (_req, res): Promise<void> => {
  const payload = { comparisons: await listD3ForecastComparisons() };
  const response = ListForecastComparisonsResponse.safeParse(payload);
  if (!response.success) {
    res.status(500).json({ error: "D3 forecast-comparison list response failed its generated schema." });
    return;
  }
  res.json(response.data);
});

router.get("/forecast-comparisons/:comparisonId", async (req, res): Promise<void> => {
  const params = GetForecastComparisonParams.safeParse(req.params);
  if (!params.success || !Number.isSafeInteger(params.data.comparisonId)) {
    res.status(400).json({ error: "comparisonId must be a positive safe integer." });
    return;
  }
  const comparison = await getD3ForecastComparison(params.data.comparisonId);
  if (!comparison) {
    res.status(404).json({ error: "D3 forecast comparison not found." });
    return;
  }
  const response = GetForecastComparisonResponse.safeParse(comparison);
  if (!response.success) {
    res.status(500).json({ error: "D3 forecast-comparison response failed its generated schema." });
    return;
  }
  res.json(response.data);
});

router.post("/forecast-comparisons/:comparisonId/replay", async (req, res): Promise<void> => {
  const params = ReplayForecastComparisonParams.safeParse(req.params);
  if (!params.success || !Number.isSafeInteger(params.data.comparisonId)) {
    res.status(400).json({ error: "comparisonId must be a positive safe integer." });
    return;
  }
  try {
    const replay = await replayD3ForecastComparison(params.data.comparisonId);
    if (!replay) {
      res.status(404).json({ error: "D3 forecast comparison not found." });
      return;
    }
    const response = ReplayForecastComparisonResponse.safeParse(replay);
    if (!response.success) {
      res.status(500).json({ error: "D3 forecast-comparison replay response failed its generated schema." });
      return;
    }
    res.json(response.data);
  } catch (error) {
    sendError(error, res);
  }
});

export default router;