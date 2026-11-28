import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";

/**
 * Remote access (security spec): requests from another machine need HTTP Basic auth against the
 * username and password hash in `remote-auth.json` (written by `hermes-hub password`). Requests from
 * this Mac (loopback) never do, so the CLI, the MCP shim, Agents and the macOS app work unchanged.
 */

export interface RemoteCredentials {
  username: string;
  /** `Bun.password.hash` output (argon2id), never the password itself. */
  password_hash: string;
}

export const DEFAULT_REMOTE_USER = "hermes";
/** The shortest password `hermes-hub password` accepts. */
export const MIN_PASSWORD_LENGTH = 12;

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}

/** Writes the credentials file readable by this user only. */
export async function writeRemoteAuth(path: string, username: string, password: string): Promise<void> {
  const creds: RemoteCredentials = { username, password_hash: await Bun.password.hash(password, "argon2id") };
  writeFileSync(path, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function removeRemoteAuth(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

export function readRemoteAuth(path: string): RemoteCredentials | null {
  if (!existsSync(path)) return null;
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof (raw as RemoteCredentials).username !== "string" ||
    typeof (raw as RemoteCredentials).password_hash !== "string"
  ) {
    throw new Error(`${path}: expected {"username", "password_hash"}; run hermes-hub password again`);
  }
  return raw as RemoteCredentials;
}

export type RemoteVerdict = "ok" | "no_password" | "denied";

/**
 * Checks a remote request's `Authorization` header. The file is re-read when it changes, so a new
 * password applies without a restart. A header that verified once is remembered until the file
 * changes: argon2 is deliberately slow, and the Command Center sends one request per asset and stream.
 */
export class RemoteAuth {
  private mtimeMs = -1;
  private creds: RemoteCredentials | null = null;
  private verified = new Set<string>();

  constructor(private readonly path: string) {}

  private load(): RemoteCredentials | null {
    const mtimeMs = existsSync(this.path) ? statSync(this.path).mtimeMs : 0;
    if (mtimeMs !== this.mtimeMs) {
      this.mtimeMs = mtimeMs;
      this.verified.clear();
      this.creds = mtimeMs ? readRemoteAuth(this.path) : null;
    }
    return this.creds;
  }

  async check(header: string | null): Promise<RemoteVerdict> {
    const creds = this.load();
    if (!creds) return "no_password";
    if (!header?.startsWith("Basic ")) return "denied";
    if (this.verified.has(header)) return "ok";
    let decoded: string;
    try {
      decoded = atob(header.slice("Basic ".length).trim());
    } catch {
      return "denied";
    }
    const colon = decoded.indexOf(":");
    if (colon < 0) return "denied";
    const user = decoded.slice(0, colon);
    const password = decoded.slice(colon + 1);
    if (user !== creds.username || !(await Bun.password.verify(password, creds.password_hash))) return "denied";
    this.verified.add(header);
    return "ok";
  }
}

/**
 * Host names the browser guard accepts (security spec): `localhost`, any IP literal, and this
 * machine's own name with or without `.local`. DNS rebinding needs an attacker-controlled name, so
 * IP literals stay safe; any other name is refused.
 */
export function hostAllowed(hostHeader: string | null, port: number): boolean {
  if (!hostHeader) return false;
  const m = /^(\[[0-9a-f:.]+\]|[^:]+):(\d+)$/i.exec(hostHeader);
  if (!m || Number(m[2]) !== port) return false;
  const host = m[1]!.toLowerCase();
  if (host === "localhost" || host.startsWith("[")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  const own = hostname().toLowerCase();
  const short = own.replace(/\.local$/, "");
  return host === own || host === short || host === `${short}.local`;
}

/** The URLs other devices can use: every external IPv4 address, when bound to all interfaces. */
export function networkUrls(host: string, port: number): string[] {
  if (host !== "0.0.0.0") return [];
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => `http://${a!.address}:${port}/`);
}

/** The line `hub` and `start` print about other devices, or null when the Hub stays on this Mac. */
export function remoteAccessLine(host: string, port: number, authPath: string): string | null {
  const urls = networkUrls(host, port);
  if (urls.length === 0) return null;
  return `other devices: ${urls.join(", ")} (${existsSync(authPath) ? "Basic auth" : "refused until you run hermes-hub password"})`;
}
