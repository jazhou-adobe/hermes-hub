import { rmSync, writeFileSync } from "node:fs";
import { loadConfig, type HubConfig } from "../config.ts";
import { migrationStatus, openDb } from "../db/db.ts";
import { backupsDir, configPath, dbPath, hubJsonPath, hubLockPath, logPath } from "../paths.ts";
import { VERSION } from "../version.ts";
import { ensureDailyBackup } from "./backup.ts";
import { watchConfig } from "./configWatcher.ts";
import { Engine } from "./engine.ts";
import { acquireLock, releaseLock } from "./lock.ts";
import { createLogger } from "./log.ts";
import { Notifier, osascriptPoster } from "./notify.ts";
import { startServer } from "./server.ts";

/** How many ports above the configured one to try before giving up (two Hubs, different folders). */
const MAX_PORT_ATTEMPTS = 20;
/** "Once per day while running" (hub-operations spec) is the bar; checking hourly is simple and safe. */
const DAILY_BACKUP_CHECK_MS = 60 * 60_000;

function isAddrInUse(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "EADDRINUSE";
}

/** The next free port from `start`, probed with a throwaway listener (same trick the tests use). */
function freePortFrom(start: number): number {
  for (let port = start; port < start + MAX_PORT_ATTEMPTS; port++) {
    try {
      const probe = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } });
      probe.stop(true);
      return port;
    } catch (err) {
      if (!isAddrInUse(err)) throw err;
    }
  }
  throw new Error(`no free port found from ${start} to ${start + MAX_PORT_ATTEMPTS - 1}`);
}

/**
 * `hermes hub`: refuses while migrations are pending, or while `hub.lock` is held by another live
 * Hub on this data folder. Otherwise finds the next free port from the configured one, fires
 * overdue policies, and serves until SIGINT/SIGTERM.
 */
export async function runHub(): Promise<number | undefined> {
  const db = openDb(dbPath());
  const status = migrationStatus(db);
  if (status.current > status.latest) {
    console.error(`hermes hub: the database (version ${status.current}) is newer than this checkout (${status.latest})`);
    return 1;
  }
  if (status.pending.length > 0) {
    console.error("hermes hub: database migrations are pending; run hermes migrate");
    return 1;
  }

  let config: HubConfig = loadConfig();
  const logger = createLogger(logPath(), config.log_level);
  const port = freePortFrom(config.port);
  const url = `http://127.0.0.1:${port}`;
  const lockPath = hubLockPath();
  const lock = acquireLock(lockPath, url);
  if (!lock.ok) {
    console.error(`hermes hub: already running at ${lock.holder.url} (pid ${lock.holder.pid})`);
    db.close();
    return 1;
  }

  const hubJson = hubJsonPath(); // resolved before the server may chdir: HERMES_HOME may be relative
  const cfgPath = configPath();
  const engine = new Engine(db, url, undefined, config, logger);
  engine.setConfigSource(cfgPath);
  engine.start();
  const poster = osascriptPoster();
  const notifier = poster ? new Notifier(engine, poster, undefined, logger) : undefined;
  notifier?.start();
  const server = await startServer(engine, port, logger, notifier);
  writeFileSync(
    hubJson,
    `${JSON.stringify({ url, version: VERSION, pid: process.pid, started_at: new Date().toISOString() }, null, 2)}\n`,
  );

  const backups = backupsDir();
  ensureDailyBackup(backups, db, config.backups.keep);
  const backupTimer = setInterval(() => {
    try {
      ensureDailyBackup(backups, db, config.backups.keep);
    } catch (err) {
      logger.log("error", "backup.failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }, DAILY_BACKUP_CHECK_MS);

  const stopWatching = watchConfig(
    cfgPath,
    () => config,
    (reload) => {
      config = reload.config;
      logger.setLevel(config.log_level);
      engine.setConfig(config, reload.restartNeeded);
      if (reload.restartNeeded) {
        logger.log("warn", "config.restart_needed", { setting: "port" });
        console.warn("hermes hub: config.toml's port changed; restart needed to apply it");
      } else {
        logger.log("info", "config.reloaded", {});
      }
    },
    (err) => {
      engine.configFailed(err.message);
      logger.log("error", "config.invalid", { error: err.message });
      console.error(`hermes hub: ${err.message}`);
    },
  );

  const stop = () => {
    stopWatching();
    clearInterval(backupTimer);
    releaseLock(lockPath);
    rmSync(hubJson, { force: true });
    notifier?.stop();
    engine.stop();
    void server.stop(true);
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(`Hermes Hub ${VERSION} on ${url}`);
  return undefined;
}
