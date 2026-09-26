import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// PostgreSQL may close an idle pooled connection during a service restart.
// pg removes that client; handle its event so the server can use a new connection.
pool.on("error", (error) => {
  console.error("Database idle connection lost:", error.message);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
