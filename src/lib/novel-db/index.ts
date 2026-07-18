import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initializeNovelDatabase } from "./initialize";

type AppConnection = {
  sqlite: Database.Database;
  db: ReturnType<typeof initializeNovelDatabase>;
};

const globalForNovelDb = globalThis as unknown as { novelConnection?: AppConnection };

function openAppConnection(): AppConnection {
  if (globalForNovelDb.novelConnection) return globalForNovelDb.novelConnection;
  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(path.join(dataDir, "novels.db"));
  const connection = { sqlite, db: initializeNovelDatabase(sqlite) };
  if (process.env.NODE_ENV !== "production") globalForNovelDb.novelConnection = connection;
  return connection;
}

export function getNovelSqlite() {
  return openAppConnection().sqlite;
}

export function getNovelDb() {
  return openAppConnection().db;
}

export { initializeNovelDatabase } from "./initialize";
