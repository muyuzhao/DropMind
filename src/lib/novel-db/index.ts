import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initializeNovelDatabase, seedDefaultPromptScheme } from "./initialize";

const BUILT_IN_PROMPT_SEED_VERSION = "fantasy-romance-high-conflict-v1";

type AppConnection = {
  sqlite: Database.Database;
  db: ReturnType<typeof initializeNovelDatabase>;
  builtInPromptSeedVersion?: string;
};

const globalForNovelDb = globalThis as unknown as { novelConnection?: AppConnection };

function openAppConnection(): AppConnection {
  if (globalForNovelDb.novelConnection) {
    if (globalForNovelDb.novelConnection.builtInPromptSeedVersion !== BUILT_IN_PROMPT_SEED_VERSION) {
      seedDefaultPromptScheme(globalForNovelDb.novelConnection.sqlite);
      globalForNovelDb.novelConnection.builtInPromptSeedVersion = BUILT_IN_PROMPT_SEED_VERSION;
    }
    return globalForNovelDb.novelConnection;
  }
  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(path.join(dataDir, "novels.db"));
  const connection = { sqlite, db: initializeNovelDatabase(sqlite), builtInPromptSeedVersion: BUILT_IN_PROMPT_SEED_VERSION };
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
