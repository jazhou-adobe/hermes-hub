import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { DEFAULT_REMOTE_USER, MIN_PASSWORD_LENGTH, readRemoteAuth, removeRemoteAuth, writeRemoteAuth } from "../hub/auth.ts";
import { hubHome, remoteAuthPath } from "../paths.ts";

/** One line from stdin; on a terminal the prompt is shown and typing is not echoed. */
async function readSecret(prompt: string): Promise<string> {
  const tty = process.stdin.isTTY;
  if (tty) {
    process.stdout.write(prompt);
    spawnSync("stty", ["-echo"], { stdio: "inherit" });
  }
  try {
    for await (const line of console) return line;
    return "";
  } finally {
    if (tty) {
      spawnSync("stty", ["echo"], { stdio: "inherit" });
      process.stdout.write("\n");
    }
  }
}

/**
 * `hermes-hub password [--user <name>] [--remove]` (security spec): sets the Basic auth credentials
 * other devices sign in with, stored as an argon2id hash in `remote-auth.json`. The running Hub picks
 * the change up on the next request. `--remove` deletes the file, which refuses every remote request.
 */
export async function runPassword(opts: { user?: string; remove?: boolean }): Promise<number> {
  const path = remoteAuthPath();
  if (opts.remove) {
    console.log(removeRemoteAuth(path) ? `removed ${path}; other devices are now refused` : "no remote password was set");
    return 0;
  }
  const user = opts.user ?? readRemoteAuth(path)?.username ?? DEFAULT_REMOTE_USER;
  if (!/^[^:\s]+$/.test(user)) {
    console.error("hermes-hub password: the username can't be empty or contain spaces or ':'");
    return 1;
  }
  const password = await readSecret(`New password for remote user "${user}": `);
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`hermes-hub password: use at least ${MIN_PASSWORD_LENGTH} characters`);
    return 1;
  }
  if (process.stdin.isTTY && (await readSecret("Repeat it: ")) !== password) {
    console.error("hermes-hub password: the two entries differ; nothing changed");
    return 1;
  }
  mkdirSync(hubHome(), { recursive: true });
  await writeRemoteAuth(path, user, password);
  console.log(`remote access: user "${user}", password saved as a hash in ${path} (applies at once, no restart)`);
  return 0;
}
