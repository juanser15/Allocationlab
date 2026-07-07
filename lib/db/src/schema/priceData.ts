import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const priceDataTable = pgTable("price_data", {
  id: serial("id").primaryKey(),
  csvContent: text("csv_content").notNull(),
  tickers: text("tickers").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  rowCount: integer("row_count").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PriceData = typeof priceDataTable.$inferSelect;
export type InsertPriceData = typeof priceDataTable.$inferInsert;
