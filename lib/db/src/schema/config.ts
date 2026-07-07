import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const configTable = pgTable("config", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Config = typeof configTable.$inferSelect;
export type InsertConfig = typeof configTable.$inferInsert;
