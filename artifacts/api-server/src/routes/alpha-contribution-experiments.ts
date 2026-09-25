import { Router, type IRouter } from "express";
import {
  CreateAlphaContributionExperimentBody,
  CreateAlphaContributionExperimentResponse,
  GetAlphaContributionExperimentParams,
  GetAlphaContributionExperimentResponse,
  ListAlphaContributionExperimentsResponse,
  ReplayAlphaContributionExperimentParams,
  ReplayAlphaContributionExperimentResponse,
} from "@workspace/api-zod";
import type { C1ExperimentInput } from "@workspace/api-zod";
import {
  getC1Experiment,
  listC1Experiments,
  persistC1Experiment,
  replayC1Experiment,
} from "../lib/c1-experiment-store";

const router: IRouter = Router();

function validId(raw: string): boolean {
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw));
}

router.post("/alpha-contribution-experiments", async (req, res): Promise<void> => {
  const parsed = CreateAlphaContributionExperimentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!Number.isSafeInteger(parsed.data.allocationId) ||
      !Number.isSafeInteger(parsed.data.validationPreparedInputId)) {
    res.status(400).json({ error: "allocationId and validationPreparedInputId must be positive safe integers." });
    return;
  }
  const saved = await persistC1Experiment(parsed.data as C1ExperimentInput);
  if ("error" in saved) {
    res.status(typeof saved.status === "number" ? saved.status : 409).json({ error: saved.error });
    return;
  }
  res.status(201).json(CreateAlphaContributionExperimentResponse.parse(saved.experiment));
});

router.get("/alpha-contribution-experiments", async (_req, res): Promise<void> => {
  res.json(ListAlphaContributionExperimentsResponse.parse(await listC1Experiments()));
});

router.get("/alpha-contribution-experiments/:experimentId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.experimentId) ? req.params.experimentId[0] : req.params.experimentId;
  const params = GetAlphaContributionExperimentParams.safeParse({ experimentId: raw });
  if (!validId(raw) || !params.success) {
    res.status(400).json({ error: "Invalid C1 experiment ID." });
    return;
  }
  const experiment = await getC1Experiment(params.data.experimentId);
  if (!experiment) {
    res.status(404).json({ error: "C1 experiment not found." });
    return;
  }
  res.json(GetAlphaContributionExperimentResponse.parse(experiment));
});

router.post("/alpha-contribution-experiments/:experimentId/replay", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.experimentId) ? req.params.experimentId[0] : req.params.experimentId;
  const params = ReplayAlphaContributionExperimentParams.safeParse({ experimentId: raw });
  if (!validId(raw) || !params.success) {
    res.status(400).json({ error: "Invalid C1 experiment ID." });
    return;
  }
  const replay = await replayC1Experiment(params.data.experimentId);
  if (!replay) {
    res.status(404).json({ error: "C1 experiment not found." });
    return;
  }
  res.json(ReplayAlphaContributionExperimentResponse.parse(replay));
});

export default router;