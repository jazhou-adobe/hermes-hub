import type { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

/** `VACUUM INTO`: a consistent point-in-time copy of `db`, independent of WAL state. Fails if
 * `destPath` already exists (deliberately: callers pick a fresh name per backup). */
export function backupNow(db: Database, destPath: string): void {
  mkdirSync(dirname(destPath), { recursive: true });
  db.query("VACUUM INTO ?").run(destPath);
}

/** `backups/hub-YYYY-MM-DD.db`: the daily automatic backup, one per calendar day (UTC). */
export function dailyBackupPath(backupsDir: string, date = new Date()): string {
  return join(backupsDir, `hub-${date.toISOString().slice(0, 10)}.db`);
}

/** The default destination for `hermes-hub backup` without a path given. */
export function manualBackupPath(backupsDir: string, date = new Date()): string {
  return join(backupsDir, `hub-manual-${date.toISOString().replace(/[:.]/g, "-")}.db`);
}

/** Taken automatically before `hermes-hub migrate` applies anything. */
export function migrationBackupPath(backupsDir: string, date = new Date()): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return join(backupsDir, `hub-pre-migrate-${date.toISOString().replace(/[:.]/g, "-")}-${rand}.db`);
}

const DAILY_NAME = /^hub-\d{4}-\d{2}-\d{2}\.db$/;

/** Deletes the oldest daily backups beyond `keep` (filenames sort lexicographically by date). */
export function pruneDailyBackups(backupsDir: string, keep: number): void {
  let files: string[];
  try {
    files = readdirSync(backupsDir);
  } catch {
    return; // nothing backed up yet
  }
  const daily = files.filter((f) => DAILY_NAME.test(f)).sort();
  const excess = daily.length - keep;
  for (let i = 0; i < excess; i++) unlinkSync(join(backupsDir, daily[i]!));
}

/** Creates today's daily backup if it doesn't exist yet, then prunes. Safe to call repeatedly. */
export function ensureDailyBackup(backupsDir: string, db: Database, keep: number): void {
  const path = dailyBackupPath(backupsDir);
  if (!existsSync(path)) backupNow(db, path);
  pruneDailyBackups(backupsDir, keep);
}

/**
 * Stops the Hub standalone (caller confirms no Hub is running first): switches the current database
 * off WAL (flushing it into the main file, so the aside copy below is a self-contained single file),
 * copies it aside as `hub.db.before-restore-<timestamp>`, then replaces it with `backupPath`.
 * Returns the aside path.
 */
export function restoreBackup(openDb: (path: string) => Database, dbPath: string, backupPath: string): string {
  if (existsSync(dbPath)) {
    const db = openDb(dbPath);
    db.exec("PRAGMA journal_mode = DELETE;");
    db.close();
  }
  const aside = `${dbPath}.before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  if (existsSync(dbPath)) copyFileSync(dbPath, aside);
  for (const ext of ["-wal", "-shm"]) {
    const sidecar = `${dbPath}${ext}`;
    if (existsSync(sidecar)) rmSync(sidecar, { force: true });
  }
  copyFileSync(backupPath, dbPath);
  return aside;
}
