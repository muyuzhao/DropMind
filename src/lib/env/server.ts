import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url().default("postgres://dropmind:dropmind@localhost:5432/dropmind"),
});

export const env = serverEnvSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
});
