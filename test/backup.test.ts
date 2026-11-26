import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDb } from "../src/db/db.ts";
import {
  backupNow,
  dailyBackupPath,
  ensureDailyBackup,
  manualBackupPath,
  pruneDailyBackups,
  restoreBackup,
} from "../src/hub/backup.ts";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "hermes-backup-test-"));
}

describe("backup", () => {
  test("backupNow: VACUUM INTO a fresh file; refuses to overwrite one that exists", () => {
    const dir = tmpDir();
    try {
      const db = new Database(":memory:", { strict: true });
      migrate(db);
      const dest = join(dir, "snap.db");
      backupNow(db, dest);
      expect(existsSync(dest)).toBe(true);
      const copy = new Database(dest, { readonly: true });
      expect(copy.query("SELECT 1 AS one").get()).toEqual({ one: 1 });
      copy.close();
      expect(() => backupNow(db, dest)).toThrow();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ensureDailyBackup: creates today's backup once, is a no-op on a second call", () => {
    const dir = tmpDir();
    try {
      const db = new Database(":memory:", { strict: true });
      migrate(db);
      ensureDailyBackup(dir, db, 7);
      const path = dailyBackupPath(dir);
      expect(existsSync(path)).toBe(true);
      const mtime1 = Bun.file(path).lastModified;
      ensureDailyBackup(dir, db, 7); // a second call on the same day must not re-create it
      expect(Bun.file(path).lastModified).toBe(mtime1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pruneDailyBackups: keeps only the newest `keep`, by filename date", () => {
    const dir = tmpDir();
    try {
      for (const date of ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]) {
        writeFileSync(join(dir, `hub-${date}.db`), "");
      }
      writeFileSync(join(dir, "hub-manual-2026-11-12T00-00-00-000Z.db"), ""); // never pruned here
      pruneDailyBackups(dir, 2);
      const remaining = readdirSync(dir).sort();
      expect(remaining).toEqual(["hub-2026-11-12.db", "hub-2026-11-13.db", "hub-manual-2026-11-12T00-00-00-000Z.db"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("manualBackupPath and dailyBackupPath land under the given backups dir", () => {
    const dir = tmpDir();
    try {
      expect(manualBackupPath(dir).startsWith(dir)).toBe(true);
      expect(dailyBackupPath(dir)).toBe(join(dir, `hub-${new Date().toISOString().slice(0, 10)}.db`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("restoreBackup: round-trips the database, keeping a copy of the pre-restore one aside", () => {
    const dir = tmpDir();
    const previousHome = process.env.HERMES_HUB_HOME;
    try {
      process.env.HERMES_HUB_HOME = dir; // migrate() backs up into the data folder: keep it in the temp dir
      const dbPath = join(dir, "hub.db");
      let db = openDb(dbPath);
      migrate(db);
      db.query("INSERT INTO sessions (id, token, kind, session_key, created_at, last_seen) VALUES ('s_one', 't1', 'test', 'k1', '2026-01-01', '2026-01-01')").run();
      const backupDest = join(dir, "backup.db");
      backupNow(db, backupDest);
      db.query("INSERT INTO sessions (id, token, kind, session_key, created_at, last_seen) VALUES ('s_two', 't2', 'test', 'k2', '2026-01-01', '2026-01-01')").run();
      db.close();

      const aside = restoreBackup(openDb, dbPath, backupDest);
      expect(existsSync(aside)).toBe(true);

      db = openDb(dbPath);
      const ids = db.query<{ id: string }, []>("SELECT id FROM sessions ORDER BY id").all().map((r) => r.id);
      expect(ids).toEqual(["s_one"]); // s_two, added after the backup, is gone
      db.close();

      const asideDb = new Database(aside, { readonly: true });
      const asideIds = asideDb.query<{ id: string }, []>("SELECT id FROM sessions ORDER BY id").all().map((r) => r.id);
      expect(asideIds).toEqual(["s_one", "s_two"]); // the pre-restore state is preserved
      asideDb.close();
    } finally {
      if (previousHome === undefined) delete process.env.HERMES_HUB_HOME;
      else process.env.HERMES_HUB_HOME = previousHome;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("migrate() takes a backup before applying, for a real (non-in-memory) database only", () => {
    const dir = tmpDir();
    const home = mkdtempSync(join(tmpdir(), "hermes-home-test-"));
    const previousHome = process.env.HERMES_HUB_HOME;
    try {
      process.env.HERMES_HUB_HOME = home;
      const dbPath = join(dir, "hub.db");
      const db = openDb(dbPath);
      migrate(db);
      db.close();
      const backups = join(home, "backups");
      const files = existsSync(backups) ? readdirSync(backups) : [];
      expect(files.some((f) => f.startsWith("hub-pre-migrate-"))).toBe(true);

      // an in-memory database (as the test suite's own fixtures use) never backs up.
      const mem = new Database(":memory:", { strict: true });
      migrate(mem);
      mem.close();
      const filesAfter = existsSync(backups) ? readdirSync(backups) : [];
      expect(filesAfter.length).toBe(files.length);
    } finally {
      if (previousHome === undefined) delete process.env.HERMES_HUB_HOME;
      else process.env.HERMES_HUB_HOME = previousHome;
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
