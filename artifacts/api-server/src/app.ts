import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  PIT_CLASSIFICATION,
  RESEARCH_BOUNDARY,
  STORAGE_CLASSIFICATION,
} from "./lib/workbench/contracts";

const app: Express = express();
const WORKBENCH_MAX_BODY_BYTES = 16 * 1024;

const workbenchErrorEnvelope = (code: string, message: string) => ({
  research_boundary: RESEARCH_BOUNDARY,
  storage_classification: STORAGE_CLASSIFICATION,
  pit_classification: PIT_CLASSIFICATION,
  error: { code, message },
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Workbench run specifications are intentionally small. Parse them with the
// service's tighter bound before the broader upload-oriented API parser.
app.use("/api/workbench", (request, response, next) => {
  const contentLength = request.get("content-length");
  const declaredBytes = contentLength && /^\d+$/.test(contentLength)
    ? Number(contentLength)
    : null;
  if (declaredBytes !== null && declaredBytes > WORKBENCH_MAX_BODY_BYTES) {
    response.status(413).json(workbenchErrorEnvelope(
      "PAYLOAD_TOO_LARGE",
      "Workbench request body exceeds the 16 KiB limit",
    ));
    return;
  }

  const hasRequestBody =
    (declaredBytes !== null && declaredBytes > 0) ||
    request.get("transfer-encoding") !== undefined;
  const contentType = request.get("content-type");
  if ((hasRequestBody || contentType !== undefined) && !request.is("application/json")) {
    response.status(415).json(workbenchErrorEnvelope(
      "UNSUPPORTED_MEDIA_TYPE",
      "Workbench request bodies must use application/json",
    ));
    return;
  }
  next();
});
app.use("/api/workbench", express.json({ limit: "16kb" }));
app.use(
  "/api/workbench",
  (
    error: unknown,
    _request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    const parserError = error as { status?: unknown; type?: unknown };
    const parserStatus = typeof parserError.status === "number"
      ? parserError.status
      : null;
    if (parserStatus === null || parserStatus < 400 || parserStatus >= 500) {
      next(error);
      return;
    }
    const code = parserStatus === 413
      ? "PAYLOAD_TOO_LARGE"
      : parserStatus === 415
        ? "UNSUPPORTED_MEDIA_TYPE"
        : "INVALID_REQUEST_BODY";
    const message = parserStatus === 413
      ? "Workbench request body exceeds the 16 KiB limit"
      : parserStatus === 415
        ? "Workbench request body uses an unsupported JSON encoding"
        : "Workbench request body could not be parsed as valid JSON";
    response.status(parserStatus).json(workbenchErrorEnvelope(code, message));
  },
);
// A multi-year, multi-ticker adjusted-OHLC upload is larger than Express's
// 100 KB default. Keep a bounded limit instead of silently rejecting valid CSVs.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Keep unknown Workbench paths and router-level errors inside the same safe,
// labelled API boundary. Express can raise decoding errors before a handler is
// entered, so route-local catch blocks alone are insufficient.
app.use("/api/workbench", (_request, response) => {
  response.status(404).json(workbenchErrorEnvelope(
    "WORKBENCH_ROUTE_NOT_FOUND",
    "The requested Workbench route does not exist",
  ));
});
app.use(
  "/api/workbench",
  (
    error: unknown,
    request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    const candidate = error as { status?: unknown; statusCode?: unknown };
    const suppliedStatus = typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : 500;
    const status = suppliedStatus >= 400 && suppliedStatus < 500
      ? suppliedStatus
      : 500;
    const malformedPath = error instanceof URIError;
    request.log?.error?.(
      { err: error, status },
      "Workbench request rejected before its route handler",
    );
    response.status(status).json(workbenchErrorEnvelope(
      malformedPath
        ? "INVALID_REQUEST_PATH"
        : status === 500
          ? "WORKBENCH_INTERNAL_ERROR"
          : "INVALID_WORKBENCH_REQUEST",
      malformedPath
        ? "Workbench request path is malformed"
        : status === 500
          ? "The research service could not complete the request"
          : "Workbench request could not be accepted",
    ));
  },
);

export default app;
