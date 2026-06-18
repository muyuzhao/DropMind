import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import { createItemSchema, updateItemSchema } from "./schemas";

export async function createItem(input: unknown) {
  const data = createItemSchema.parse(input);
  const [item] = await db.insert(inboxItems).values(data).returning();
  return item;
}

export function listItems() {
  return db.select().from(inboxItems).orderBy(desc(inboxItems.createdAt));
}

export async function getItem(id: string) {
  const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, id)).limit(1);
  return item;
}

export async function updateItem(id: string, input: unknown) {
  const data = updateItemSchema.parse(input);
  const [item] = await db
    .update(inboxItems)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(inboxItems.id, id))
    .returning();
  return item;
}
