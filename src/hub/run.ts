import { rmSync, writeFileSync } from "node:fs";
import { loadConfig } from "../config.ts";
import { migrationStatus, openDb } from "../db/db.ts";
import { CLONE_ROOT, dbPath, hubJsonPath } from "../paths.ts";
import { VERSION } from "../version.ts";
import { Engine } from "./engine.ts";
import { startServer } from "./server.ts";

/** `hermes hub`: refuses while migrations are pending, then serves until SIGINT/SIGTERM. */
export function runHub(): number | undefined {
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

  const { port } = loadConfig();
  const url = `http://127.0.0.1:${port}`;
  const hubJson = hubJsonPath(); // resolved before chdir: HERMES_HOME may be relative
  // Bun resolves the HTML import's bundled asset URLs against the cwd; serve from the clone.
  process.chdir(CLONE_ROOT);
  const server = startServer(new Engine(db, url), port);
  writeFileSync(
    hubJson,
    `${JSON.stringify({ url, version: VERSION, pid: process.pid, started_at: new Date().toISOString() }, null, 2)}\n`,
  );

  const stop = () => {
    rmSync(hubJson, { force: true });
    void server.stop(true);
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(`Hermes Hub ${VERSION} on ${url}`);
  return undefined;
}
