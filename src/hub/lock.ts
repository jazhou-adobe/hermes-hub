import { readFileSync, rmSync, writeFileSync } from "node:fs";

export interface LockInfo {
  pid: number;
  url: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err instanceof Error && "code" in err && err.code === "EPERM";
  }
}

function readLockFile(path: string): LockInfo | null {
  try {
    const info: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (info && typeof info === "object" && "pid" in info && typeof info.pid === "number" && "url" in info && typeof info.url === "string") {
      return { pid: info.pid, url: info.url };
    }
  } catch {
    // missing, or unreadable
  }
  return null;
}

export type LockResult = { ok: true } | { ok: false; holder: LockInfo };

/**
 * Atomically creates `hub.lock` (`wx`: fails if it exists). A lock held by a dead pid (a crash) is
 * removed and the create retried once; a lock held by a live pid refuses.
 */
export function acquireLock(path: string, url: string): LockResult {
  try {
    writeFileSync(path, JSON.stringify({ pid: process.pid, url }), { flag: "wx" });
    return { ok: true };
  } catch (err) {
    if (!(err instanceof Error) || !("code" in err) || err.code !== "EEXIST") throw err;
  }
  const holder = readLockFile(path);
  if (holder && pidAlive(holder.pid)) return { ok: false, holder };
  rmSync(path, { force: true });
  writeFileSync(path, JSON.stringify({ pid: process.pid, url }), { flag: "wx" });
  return { ok: true };
}

export function releaseLock(path: string): void {
  rmSync(path, { force: true });
}

/** For `hermes restore`: is a Hub currently running on this data folder? */
export function runningHub(path: string): LockInfo | null {
  const holder = readLockFile(path);
  return holder && pidAlive(holder.pid) ? holder : null;
}
