import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env/server";

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };
const sql = globalForDb.sql ?? postgres(env.DATABASE_URL, { max: 10 });

if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

export const db = drizzle(sql);
