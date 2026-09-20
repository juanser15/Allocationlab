import { Router, type IRouter } from "express";
import {
  GetFactorLibraryResponse,
  RestoreFactorLibraryParams,
  RestoreFactorLibraryResponse,
  UpdateFactorLibraryBody,
  UpdateFactorLibraryResponse,
} from "@workspace/api-zod";
import { getFactorLibrary, restoreFactorLibrary, saveFactorLibrary } from "../lib/factor-library";

const router: IRouter = Router();

router.get("/factors/library", async (_req, res): Promise<void> => {
  res.json(GetFactorLibraryResponse.parse(await getFactorLibrary()));
});

router.put("/factors/library", async (req, res): Promise<void> => {
  const parsed = UpdateFactorLibraryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    res.json(UpdateFactorLibraryResponse.parse(await saveFactorLibrary(parsed.data.factors)));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid factor configuration." });
  }
});

router.post("/factors/library/restore/:version", async (req, res): Promise<void> => {
  const parsed = RestoreFactorLibraryParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const restored = await restoreFactorLibrary(parsed.data.version);
  if (!restored) {
    res.status(404).json({ error: "Factor-set version not found." });
    return;
  }
  res.json(RestoreFactorLibraryResponse.parse(restored));
});

export default router;