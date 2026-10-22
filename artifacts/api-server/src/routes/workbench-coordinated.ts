import { Router } from "express";
import { CoordinatedService } from "../lib/workbench/coordinated-service";
import {
  coordinatedCapabilities,
  planCoordinated,
} from "../lib/workbench/coordinated-calendar";
import {
  boundaryV2,
  CalendarContractError,
} from "../lib/workbench/calendar-v2";
import { safeError } from "./workbench";
import {
  activeResearchDatasetStatus,
  activateInternalDataset,
  activateResearchDataset,
  fetchYahooResearchDataset,
  readResearchDataset,
  readResearchDatasetCsv,
  requiredResearchSymbols,
  restoreResearchDataset,
} from "../lib/workbench/research-datasets";
const router = Router();
let servicePromise: Promise<CoordinatedService> | undefined;
const service = () => (servicePromise ??= CoordinatedService.open());
router.use("/workbench/coordinated", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (Object.keys(req.query).length) {
    res.status(400).json({
      ...boundaryV2,
      error: { code: "INVALID_QUERY", message: "Unexpected query fields." },
    });
    return;
  }
  next();
});
router.get("/workbench/coordinated/capabilities", (req, res) => {
  try {
    res.json(coordinatedCapabilities());
  } catch (e) {
    safeError(req, res, e);
  }
});
router.post("/workbench/coordinated/dataset-capabilities", (req, res) => {
  try {
    if (
      !req.body ||
      Object.keys(req.body).some((k) => k !== "dataset_id") ||
      typeof req.body.dataset_id !== "string"
    )
      throw new CalendarContractError(
        "INVALID_DATASET_ID",
        "Choose a dataset snapshot.",
        {},
        422,
      );
    res.json(coordinatedCapabilities(req.body.dataset_id));
  } catch (e) {
    safeError(req, res, e);
  }
});

router.get("/workbench/coordinated/data", (_req, res) => {
  res.json({
    ...boundaryV2,
    active_dataset: activeResearchDatasetStatus(),
    required_research_symbols: requiredResearchSymbols(),
  });
});
router.get("/workbench/coordinated/data/metadata/:datasetId", (req, res) => {
  try {
    res.json({
      ...boundaryV2,
      dataset: readResearchDataset(String(req.params.datasetId)),
    });
  } catch (error) {
    safeError(
      req,
      res,
      new CalendarContractError(
        "RESEARCH_DATASET_NOT_FOUND",
        error instanceof Error
          ? error.message
          : "Research dataset was not found.",
        {},
        404,
      ),
    );
  }
});
router.get("/workbench/coordinated/data/:datasetId.csv", (req, res) => {
  try {
    const datasetId = String(req.params.datasetId);
    const csv = readResearchDatasetCsv(datasetId);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="allocationlab-${datasetId}.csv"`,
    );
    res.send(csv);
  } catch (error) {
    safeError(
      req,
      res,
      new CalendarContractError(
        "RESEARCH_DATASET_NOT_FOUND",
        error instanceof Error
          ? error.message
          : "Research dataset was not found.",
        {},
        404,
      ),
    );
  }
});
router.post("/workbench/coordinated/data/yahoo", async (req, res) => {
  try {
    const dataset = await fetchYahooResearchDataset(req.body);
    res.status(201).json({ ...boundaryV2, dataset });
  } catch (error) {
    safeError(
      req,
      res,
      new CalendarContractError(
        "YAHOO_DATA_FETCH_FAILED",
        error instanceof Error
          ? error.message
          : "Yahoo Finance data could not be fetched.",
        {},
        422,
      ),
    );
  }
});
router.post("/workbench/coordinated/data/restore", (req, res) => {
  try {
    const restored = restoreResearchDataset(req.body);
    const active = restored.activation_eligible
      ? activateResearchDataset(restored.dataset_id)
      : activeResearchDatasetStatus();
    res.json({
      ...boundaryV2,
      dataset: restored,
      active_dataset: active,
    });
  } catch (error) {
    safeError(
      req,
      res,
      new CalendarContractError(
        "DATASET_RESTORE_FAILED",
        error instanceof Error
          ? error.message
          : "Saved research dataset could not be restored.",
        {},
        422,
      ),
    );
  }
});

router.post("/workbench/coordinated/data/active", (req, res) => {
  try {
    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => key !== "dataset_id") ||
      typeof req.body.dataset_id !== "string"
    )
      throw new CalendarContractError(
        "INVALID_DATASET_SELECTION",
        "Supply exactly one dataset_id.",
        {},
        422,
      );
    const active =
      req.body.dataset_id === "internal"
        ? activateInternalDataset()
        : activateResearchDataset(req.body.dataset_id);
    res.json({ ...boundaryV2, active_dataset: active });
  } catch (error) {
    safeError(
      req,
      res,
      error instanceof CalendarContractError
        ? error
        : new CalendarContractError(
            "DATASET_ACTIVATION_FAILED",
            error instanceof Error
              ? error.message
              : "Research dataset could not be activated.",
            {},
            422,
          ),
    );
  }
});

router.post("/workbench/coordinated/plan", (req, res) => {
  try {
    res.json(planCoordinated(req.body));
  } catch (e) {
    safeError(req, res, e);
  }
});
router.post("/workbench/coordinated/runs", async (req, res) => {
  try {
    const r = await (await service()).submit(req.body);
    res
      .status(
        r.status === "BLOCKED"
          ? 429
          : r.execution_requested || r.status === "RUNNING"
            ? 202
            : 200,
      )
      .json(r);
  } catch (e) {
    safeError(req, res, e);
  }
});
router.get("/workbench/coordinated/runs", async (req, res) => {
  try {
    res.json(await (await service()).list());
  } catch (e) {
    safeError(req, res, e);
  }
});
router.get("/workbench/coordinated/runs/:runId", async (req, res) => {
  try {
    res.json(await (await service()).get(String(req.params.runId)));
  } catch (e) {
    safeError(req, res, e);
  }
});
router.post("/workbench/coordinated/runs/:runId/rerun", async (req, res) => {
  try {
    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      Object.keys(req.body).length
    )
      throw new CalendarContractError(
        "INVALID_RERUN",
        "Rerun takes an empty object.",
      );
    const r = await (await service()).rerun(String(req.params.runId));
    res.status(r.status === "BLOCKED" ? 429 : 202).json(r);
  } catch (e) {
    safeError(req, res, e);
  }
});
export default router;
