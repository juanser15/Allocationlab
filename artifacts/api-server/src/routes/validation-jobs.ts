import { Router, type IRouter } from "express";
import {
  CreateValidationJobBody, GetValidationJobResponse, ListValidationJobsResponse,
} from "@workspace/api-zod";
import {
  getValidationJob, listValidationJobs, submitValidationJob,
} from "../lib/validation-job-store";
import { d6Error, d6Trace, d6TraceContext, withD6Trace } from "../lib/d6-trace";

const router: IRouter = Router();

router.post("/validation-jobs", async (req, res): Promise<void> => {
  const traceContext = d6TraceContext();
  const trace = (stage: string, metadata: Record<string, string | number | boolean | null> = {}) =>
    withD6Trace(traceContext, () => d6Trace(stage, { action: "validation", ...metadata }));
  trace("receive", { method: req.method, path: req.originalUrl });
  res.once("finish", () => trace("response.finish", { statusCode: res.statusCode }));
  res.once("close", () => trace("response.close", {
    statusCode: res.statusCode, writableFinished: res.writableFinished,
  }));
  const parsed = CreateValidationJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const submitted = await submitValidationJob(parsed.data.idempotencyKey, parsed.data.request, traceContext.id);
    if (submitted.conflict) {
      res.status(409).json({ error: "This idempotency key has already been used with a different validation request." });
      return;
    }
    res.status(202).json(GetValidationJobResponse.parse(submitted.job));
  } catch (error) {
    trace("request.exception", d6Error(error));
    const message = error instanceof Error ? error.message : "Validation job could not be queued.";
    const status = error && typeof error === "object" && "httpStatus" in error &&
      typeof error.httpStatus === "number" ? error.httpStatus : 500;
    req.log.error({ err: error, status }, "Validation job submission failed");
    res.status(status).json({ error: message });
  }
});

router.get("/validation-jobs", async (req, res): Promise<void> => {
  const sessionId = req.query.sessionId === undefined ? undefined : Number(req.query.sessionId);
  const allocationId = req.query.allocationId === undefined ? undefined : Number(req.query.allocationId);
  if (sessionId !== undefined && (!Number.isSafeInteger(sessionId) || sessionId < 1) ||
      allocationId !== undefined && (!Number.isSafeInteger(allocationId) || allocationId < 1) ||
      sessionId !== undefined && allocationId !== undefined) {
    res.status(400).json({ error: "Use at most one valid positive sessionId or allocationId filter." });
    return;
  }
  res.json(ListValidationJobsResponse.parse(await listValidationJobs({ sessionId, allocationId })));
});

router.get("/validation-jobs/:jobId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = await getValidationJob(rawId);
  if (!job) {
    res.status(404).json({ error: "Validation job not found." });
    return;
  }
  res.json(GetValidationJobResponse.parse(job));
});

export default router;