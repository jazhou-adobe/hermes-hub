import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { remoteAccessLine } from "../hub/auth.ts";
import { pidAlive, runningHub } from "../hub/lock.ts";
import { CLI_MAIN, hubHome, hubJsonPath, hubLockPath, remoteAuthPath } from "../paths.ts";

/** How long `start` waits for the Hub to write `hub.json`; the first start bundles the Command Center. */
const START_TIMEOUT_MS = 60_000;
/** How long `stop` waits for the Hub to exit after SIGTERM. */
const STOP_TIMEOUT_MS = 15_000;
const POLL_MS = 100;

/** The Hub's stdout and stderr when it runs in the background, appended across starts. */
export const hubOutPath = () => join(hubHome(), "logs", "hub.out");

function startedUrl(pid: number): string | undefined {
  try {
    const info: unknown = JSON.parse(readFileSync(hubJsonPath(), "utf8"));
    if (info && typeof info === "object" && "pid" in info && info.pid === pid && "url" in info && typeof info.url === "string") return info.url;
  } catch {
    // not written yet
  }
  return undefined;
}

/**
 * `hermes-hub start`: runs `hub` detached in the data folder, then waits until it has written
 * `hub.json` (it is serving) or has exited (for example, migrations pending), and reports which.
 */
export async function startHub(): Promise<number> {
  const home = hubHome();
  const holder = runningHub(hubLockPath());
  if (holder) {
    console.error(`hermes-hub start: already running at ${holder.url} (pid ${holder.pid})`);
    return 1;
  }
  const outPath = hubOutPath();
  mkdirSync(join(home, "logs"), { recursive: true });
  const fd = openSync(outPath, "a");
  const offset = statSync(outPath).size;
  const child = spawn(process.execPath, [CLI_MAIN, "hub"], {
    cwd: home,
    env: { ...process.env, HERMES_HUB_HOME: home },
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  let exitCode: number | null | undefined;
  child.once("exit", (code) => (exitCode = code));
  child.unref();
  const pid = child.pid!;

  for (const deadline = Date.now() + START_TIMEOUT_MS; Date.now() < deadline; ) {
    const url = startedUrl(pid);
    if (url) {
      console.log(`Hermes Hub on ${url} (pid ${pid}); data in ${home}; output in ${outPath}`);
      // The Hub started with this config, so it parses; the port is the one it found free.
      const remote = remoteAccessLine(loadConfig().host, Number(new URL(url).port), remoteAuthPath());
      if (remote) console.log(remote);
      return 0;
    }
    if (exitCode !== undefined) {
      const output = readFileSync(outPath, "utf8").slice(offset).trim();
      console.error(`hermes-hub start: the Hub exited with code ${exitCode}${output ? `:\n${output}` : ""}`);
      return 1;
    }
    await Bun.sleep(POLL_MS);
  }
  console.error(`hermes-hub start: the Hub (pid ${pid}) did not report ready within ${START_TIMEOUT_MS / 1000} s; see ${outPath}`);
  return 1;
}

/** `hermes-hub stop`: SIGTERM to the Hub holding this data folder's `hub.lock`, then waits for it to exit. */
export async function stopHub(): Promise<number> {
  const holder = runningHub(hubLockPath());
  if (!holder) {
    console.error(`hermes-hub stop: no Hub is running in ${hubHome()}`);
    return 1;
  }
  process.kill(holder.pid, "SIGTERM");
  for (const deadline = Date.now() + STOP_TIMEOUT_MS; Date.now() < deadline; ) {
    if (!pidAlive(holder.pid)) {
      console.log(`stopped Hermes Hub at ${holder.url} (pid ${holder.pid})`);
      return 0;
    }
    await Bun.sleep(POLL_MS);
  }
  console.error(`hermes-hub stop: pid ${holder.pid} is still running ${STOP_TIMEOUT_MS / 1000} s after SIGTERM`);
  return 1;
}

/**
 * `hermes-hub restart`: stops the Hub running on this data folder, if any, then starts it again, so it picks up new code
 * and rebuilds the Command Center. Stops short if the old Hub does not exit.
 */
export async function restartHub(): Promise<number> {
  if (runningHub(hubLockPath())) {
    const stopped = await stopHub();
    if (stopped !== 0) return stopped;
  }
  return startHub();
}
