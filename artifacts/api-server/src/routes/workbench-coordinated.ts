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
const router = Router();
let servicePromise: Promise<CoordinatedService> | undefined;
const service = () => (servicePromise ??= CoordinatedService.open());
router.use("/workbench/coordinated", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (Object.keys(req.query).length) {
    res
      .status(400)
      .json({
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
