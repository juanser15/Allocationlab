import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  PIT_CLASSIFICATION,
  RESEARCH_BOUNDARY,
  STORAGE_CLASSIFICATION,
} from "./contracts";

export const WORKBENCH_PREVIEW_TOKEN_ENV = "WORKBENCH_PREVIEW_TOKEN";

type TokenSource = () => string | undefined;

const boundary = () => ({
  research_boundary: RESEARCH_BOUNDARY,
  storage_classification: STORAGE_CLASSIFICATION,
  pit_classification: PIT_CLASSIFICATION,
});

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
function tokenMatches(supplied: string, expected: string): boolean {
  return timingSafeEqual(digest(supplied), digest(expected));
}

function bearerToken(request: Request): string | null {
  const authorization = request.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

export function createWorkbenchPreviewAccess(
  tokenSource: TokenSource = () => process.env[WORKBENCH_PREVIEW_TOKEN_ENV],
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    // Explicit temporary preview policy. Default remains token-protected.
    if (process.env.WORKBENCH_PREVIEW_OPEN === "1") {
      next();
      return;
    }
    const expected = tokenSource();
    if (!expected || expected.trim().length === 0) {
      response.status(503).json({
        ...boundary(),
        error: {
          code: "WORKBENCH_PREVIEW_ACCESS_NOT_CONFIGURED",
          message: "Workbench preview access is not configured on this service.",
        },
      });
      return;
    }

    const supplied = bearerToken(request);
    if (!supplied || !tokenMatches(supplied, expected)) {
      response.set("WWW-Authenticate", 'Bearer realm="Allocation Lab Workbench Preview"');
      response.status(401).json({
        ...boundary(),
        error: {
          code: "WORKBENCH_PREVIEW_UNAUTHORIZED",
          message: "A valid Workbench preview token is required.",
        },
      });
      return;
    }

    next();
  };
}
