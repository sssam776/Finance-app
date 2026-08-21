import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import * as schema from "./schema";

/**
 * Local dev / quick-version driver: better-sqlite3 against a file DB.
 * Schema and queries are written in Drizzle's SQLite dialect so the same
 * schema.ts can later target Cloudflare D1 via drizzle-orm/d1 without a
 * rewrite (see ADR-002).
 */

const DB_PATH = process.env.SQLITE_DB_PATH ?? path.join(process.cwd(), "data", "ramwall.db");

declare global {
  // eslint-disable-next-line no-var
  var __ramwallSqlite: Database.Database | undefined;
}

function getSqlite() {
  if (!globalThis.__ramwallSqlite) {
    globalThis.__ramwallSqlite = new Database(DB_PATH);
    globalThis.__ramwallSqlite.pragma("journal_mode = WAL");
    globalThis.__ramwallSqlite.pragma("foreign_keys = ON");
  }
  return globalThis.__ramwallSqlite;
}

export const db = drizzle(getSqlite(), { schema });
export type DbClient = typeof db;
