import { Router, type IRouter } from "express";
import { db, configTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GetConstraintsResponse,
  UpdateConstraintsBody,
  UpdateConstraintsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const DEFAULT_CONSTRAINTS = {
  cashMin: 0.50,
  cashMax: 0.60,
  maxEtfWeight: 0.10,
  minInclusionThreshold: 5,
  targetActiveEtfs: 8,
  diversificationEnabled: true,
};

export async function getConstraintsConfig() {
  const row = await db
    .select()
    .from(configTable)
    .where(eq(configTable.key, "constraints"))
    .then((rows) => rows[0]);

  if (!row) return { ...DEFAULT_CONSTRAINTS, updatedAt: new Date().toISOString() };

  const parsed = JSON.parse(row.value);
  return { ...parsed, updatedAt: row.updatedAt.toISOString() };
}

router.get("/constraints", async (req, res): Promise<void> => {
  const constraints = await getConstraintsConfig();
  res.json(GetConstraintsResponse.parse(constraints));
});

router.put("/constraints", async (req, res): Promise<void> => {
  const parsed = UpdateConstraintsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const value = JSON.stringify(parsed.data);
  const existing = await db
    .select()
    .from(configTable)
    .where(eq(configTable.key, "constraints"))
    .then((rows) => rows[0]);

  if (existing) {
    await db
      .update(configTable)
      .set({ value, updatedAt: new Date() })
      .where(eq(configTable.key, "constraints"));
  } else {
    await db.insert(configTable).values({ key: "constraints", value });
  }

  const updated = await getConstraintsConfig();
  res.json(UpdateConstraintsResponse.parse(updated));
});

export default router;
