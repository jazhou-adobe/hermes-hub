import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export function openDb(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return db;
}

/** Numbered `NNN_name.sql` files in the clone, in order. */
export function listMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .map((file) => /^(\d{3})_(.+)\.sql$/.exec(file))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ version: Number(m[1]), name: m[2]!, sql: readFileSync(join(MIGRATIONS_DIR, m[0]), "utf8") }))
    .sort((a, b) => a.version - b.version);
}

export interface MigrationStatus {
  current: number;
  latest: number;
  pending: Migration[];
}

export function migrationStatus(db: Database): MigrationStatus {
  const current = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  const all = listMigrations();
  return { current, latest: all.at(-1)?.version ?? 0, pending: all.filter((m) => m.version > current) };
}

export class DowngradeError extends Error {}

/** Applies pending migrations in one transaction. Refuses a database newer than this checkout. */
export function migrate(db: Database): Migration[] {
  const status = migrationStatus(db);
  if (status.current > status.latest) {
    throw new DowngradeError(
      `database is at version ${status.current}, newer than this checkout (${status.latest}); update the clone`,
    );
  }
  db.transaction(() => {
    for (const m of status.pending) {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
    }
  })();
  return status.pending;
}
