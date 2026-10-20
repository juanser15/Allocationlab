import { Router, type IRouter, type Request, type Response } from "express";
import {
  PIT_CLASSIFICATION,
  RESEARCH_BOUNDARY,
  STORAGE_CLASSIFICATION,
  WorkbenchContractValidationError,
} from "../lib/workbench/contracts";
import { WORKBENCH_CAPABILITIES } from "../lib/workbench/capabilities";
import { WorkbenchRunStoreError } from "../lib/workbench/run-store";
import { WorkbenchService, createWorkbenchService } from "../lib/workbench/service";

const MAX_REQUEST_BYTES = 16 * 1024;

type ServiceSource = WorkbenchService | Promise<WorkbenchService> | (() => Promise<WorkbenchService>);

const responseBoundary = {
  research_boundary: RESEARCH_BOUNDARY,
  pit_classification: PIT_CLASSIFICATION,
  storage_classification: STORAGE_CLASSIFICATION,
} as const;

function logicalBodyBytes(req: Request): number {
  const contentLength = req.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength)) return Number(contentLength);
  try { return Buffer.byteLength(JSON.stringify(req.body ?? {})); }
  catch { return MAX_REQUEST_BYTES + 1; }
}

function safeError(req: Request, res: Response, error: unknown): void {
  let status = 500;
  let code = "WORKBENCH_INTERNAL_ERROR";
  let message = "The research service could not complete the request.";
  let issues: unknown;
  if (error instanceof WorkbenchContractValidationError) {
    status = error.statusCode;
    code = error.code;
    message = "The research run specification is invalid.";
    issues = error.issues;
  } else if (error instanceof WorkbenchRunStoreError) {
    code = error.code;
    message = error.message;
    if (["RUN_NOT_FOUND", "ATTEMPT_NOT_FOUND"].includes(error.code)) status = 404;
    else if (error.code === "ATTEMPT_LIMIT_REACHED") status = 429;
    else if (["COMPARE_REQUIRES_SUCCESS", "COMPARE_RESULT_INCOMPLETE", "IMMUTABLE_RUN_CONFLICT",
      "IMMUTABLE_RECORD_CONFLICT", "EXECUTION_LEASE_LOST"].includes(error.code)) status = 409;
    else if (error.code.startsWith("INVALID_") || error.code === "RUN_IDENTITY_MISMATCH") status = 400;
  }
  req.log?.error?.({ err: error, code, status }, "Workbench request failed");
  res.status(status).json({
    ...responseBoundary,
    error: { code, message, ...(issues === undefined ? {} : { issues }) },
  });
}

function requireBoundedBody(req: Request, res: Response): boolean {
  if (logicalBodyBytes(req) <= MAX_REQUEST_BYTES) return true;
  res.status(413).json({
    ...responseBoundary,
    error: {
      code: "WORKBENCH_REQUEST_TOO_LARGE",
      message: `Workbench request bodies may not exceed ${MAX_REQUEST_BYTES} bytes.`,
    },
  });
  return false;
}

function noUnexpectedQuery(req: Request, allowed: readonly string[]): boolean {
  return Object.keys(req.query).every((key) => allowed.includes(key));
}

export function createWorkbenchRouter(source?: ServiceSource): IRouter {
  const router: IRouter = Router();
  let cached: Promise<WorkbenchService> | null = null;
  const service = async (): Promise<WorkbenchService> => {
    if (source instanceof WorkbenchService) return source;
    if (source instanceof Promise) return source;
    if (source) return source();
    cached ??= createWorkbenchService();
    return cached;
  };

  router.get("/workbench/capabilities", (req, res): void => {
    if (!noUnexpectedQuery(req, [])) {
      res.status(400).json({ ...responseBoundary, error: {
        code: "INVALID_QUERY", message: "Capabilities does not accept query parameters.",
      } });
      return;
    }
    res.json(WORKBENCH_CAPABILITIES);
  });

  router.post("/workbench/runs", async (req, res): Promise<void> => {
    if (!noUnexpectedQuery(req, [])) {
      res.status(400).json({ ...responseBoundary, error: {
        code: "INVALID_QUERY", message: "Run submission does not accept query parameters.",
      } });
      return;
    }
    if (!requireBoundedBody(req, res)) return;
    try {
      const submitted = await (await service()).submit(req.body);
      const status = submitted.status === "BLOCKED" ? 429
        : submitted.execution_requested || submitted.status === "RUNNING" || submitted.status === "PENDING" ? 202 : 200;
      res.status(status).json(submitted);
    } catch (error) { safeError(req, res, error); }
  });

  router.get("/workbench/runs", async (req, res): Promise<void> => {
    if (!noUnexpectedQuery(req, [])) {
      res.status(400).json({ ...responseBoundary, error: {
        code: "INVALID_QUERY", message: "The run list does not accept query parameters.",
      } });
      return;
    }
    try { res.json(await (await service()).listRuns()); }
    catch (error) { safeError(req, res, error); }
  });

  router.get("/workbench/runs/:runId", async (req, res): Promise<void> => {
    if (!noUnexpectedQuery(req, [])) {
      res.status(400).json({ ...responseBoundary, error: {
        code: "INVALID_QUERY", message: "Run retrieval does not accept query parameters.",
      } });
      return;
    }
    const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
    try { res.json(await (await service()).getRun(runId)); }
    catch (error) { safeError(req, res, error); }
  });

  router.post("/workbench/runs/:runId/rerun", async (req, res): Promise<void> => {
    if (!noUnexpectedQuery(req, [])) {
      res.status(400).json({ ...responseBoundary, error: {
        code: "INVALID_QUERY", message: "Rerun does not accept query parameters.",
      } });
      return;
    }
    if (!requireBoundedBody(req, res)) return;
    if (req.body !== undefined && (typeof req.body !== "object" || req.body === null ||
        Array.isArray(req.body) || Object.keys(req.body).length > 0)) {
      res.status(400).json({ ...responseBoundary, error: {
        code: "UNEXPECTED_RERUN_FIELDS",
        message: "Rerun accepts no request fields and reuses the immutable normalized specification.",
      } });
      return;
    }
    const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
    try {
      const submitted = await (await service()).rerun(runId);
      res.status(submitted.status === "BLOCKED" ? 429 : 202).json(submitted);
    } catch (error) { safeError(req, res, error); }
  });

  router.get("/workbench/compare", async (req, res): Promise<void> => {
    if (!noUnexpectedQuery(req, ["leftRunId", "rightRunId"])) {
      res.status(400).json({ ...responseBoundary, error: {
        code: "INVALID_QUERY", message: "Compare accepts only leftRunId and rightRunId.",
      } });
      return;
    }
    const left = req.query.leftRunId;
    const right = req.query.rightRunId;
    if (typeof left !== "string" || typeof right !== "string") {
      res.status(400).json({ ...responseBoundary, error: {
        code: "INVALID_COMPARE_REQUEST", message: "Compare requires one leftRunId and one rightRunId.",
      } });
      return;
    }
    try { res.json(await (await service()).compare(left, right)); }
    catch (error) { safeError(req, res, error); }
  });

  return router;
}

export default createWorkbenchRouter();
