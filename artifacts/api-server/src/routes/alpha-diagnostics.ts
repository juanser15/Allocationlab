import { Router, type IRouter } from "express";
import {
  CreateAlphaDiagnosticExperimentBody,
  CreateAlphaDiagnosticExperimentResponse,
  GetAlphaDiagnosticExperimentParams,
  GetAlphaDiagnosticExperimentResponse,
  ListAlphaDiagnosticExperimentsResponse,
  ReplayAlphaDiagnosticExperimentParams,
  ReplayAlphaDiagnosticExperimentResponse,
} from "@workspace/api-zod";
import {
  getC2Experiment,
  listC2Experiments,
  persistC2Experiment,
  replayC2Experiment,
} from "../lib/c2-experiment-store";

const router: IRouter = Router();
const INPUT_KEYS = new Set([
  "allocationId", "validationPreparedInputId", "c1ExperimentId", "alphaIds", "startDate", "endDate",
  "regimeSource", "regimeMapping", "rollingWindow", "rollingStep", "contributionWindow",
  "contributionStep", "minRollingPaired", "minRegimePaired", "minSharpeObservations",
  "highCorrelationThreshold", "materialCorrelationGap",
]);

function validId(raw: string): boolean {
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw));
}

router.post("/alpha-diagnostics", async (req, res): Promise<void> => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => !INPUT_KEYS.has(key))) {
    res.status(400).json({ error: "C2 request must be an object containing only supported fields." });
    return;
  }
  const parsed = CreateAlphaDiagnosticExperimentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!Number.isSafeInteger(parsed.data.allocationId) || parsed.data.allocationId < 1 ||
      !Number.isSafeInteger(parsed.data.validationPreparedInputId) || parsed.data.validationPreparedInputId < 1 ||
      (parsed.data.c1ExperimentId !== null &&
       (!Number.isSafeInteger(parsed.data.c1ExperimentId) || parsed.data.c1ExperimentId < 1))) {
    res.status(400).json({ error: "allocationId, validationPreparedInputId, and c1ExperimentId must be positive safe integer IDs (or null for C1)." });
    return;
  }
  const saved = await persistC2Experiment(parsed.data);
  if ("error" in saved) {
    res.status(typeof saved.status === "number" ? saved.status : 409).json({ error: saved.error });
    return;
  }
  res.status(201).json(CreateAlphaDiagnosticExperimentResponse.parse(saved.experiment));
});

router.get("/alpha-diagnostics", async (_req, res): Promise<void> => {
  res.json(ListAlphaDiagnosticExperimentsResponse.parse(await listC2Experiments()));
});

router.get("/alpha-diagnostics/:experimentId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.experimentId) ? req.params.experimentId[0] : req.params.experimentId;
  const params = GetAlphaDiagnosticExperimentParams.safeParse({ experimentId: raw });
  if (!validId(raw) || !params.success) {
    res.status(400).json({ error: "Invalid C2 experiment ID." });
    return;
  }
  const experiment = await getC2Experiment(params.data.experimentId);
  if (!experiment) {
    res.status(404).json({ error: "C2 experiment not found." });
    return;
  }
  res.json(GetAlphaDiagnosticExperimentResponse.parse(experiment));
});

router.post("/alpha-diagnostics/:experimentId/replay", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.experimentId) ? req.params.experimentId[0] : req.params.experimentId;
  const params = ReplayAlphaDiagnosticExperimentParams.safeParse({ experimentId: raw });
  if (!validId(raw) || !params.success) {
    res.status(400).json({ error: "Invalid C2 experiment ID." });
    return;
  }
  const replay = await replayC2Experiment(params.data.experimentId);
  if (!replay) {
    res.status(404).json({ error: "C2 experiment not found." });
    return;
  }
  res.json(ReplayAlphaDiagnosticExperimentResponse.parse(replay));
});

export default router;