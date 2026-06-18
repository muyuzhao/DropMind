import { boolean, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const itemStatus = pgEnum("item_status", ["processing", "ready", "failed", "archived"]);

export const inboxItems = pgTable("inbox_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull().default("local-user"),
  rawContent: text("raw_content").notNull(),
  status: itemStatus("status").notNull().default("ready"),
  isFavorite: boolean("is_favorite").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InboxItem = typeof inboxItems.$inferSelect;
