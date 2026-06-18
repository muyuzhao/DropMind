import { z } from "zod";

export const createItemSchema = z.object({
  rawContent: z.string().trim().min(1, "请输入要保存的内容").max(50_000, "内容不能超过 50,000 字"),
});

export const updateItemSchema = z.object({
  isFavorite: z.boolean().optional(),
  status: z.enum(["ready", "archived"]).optional(),
});
