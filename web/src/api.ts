import type { AdvisorConfig, AutoAskRule, BackupSettings, HubLimits, LogLevel } from "../../src/config.ts";
import type { AdvisorRunView, AgentView, ConfigStatus, FeedRoundView, LogEntry, LogFilter, RoundDetail, StorageInfo } from "../../src/hub/engine.ts";
import type { Draft, DismissInput, RedirectInput, SendInput } from "../../src/schema/validate.ts";
import type { HubSettings } from "../../src/settings.ts";

async function problemDetail(res: Response): Promise<string> {
  try {
    const body: { detail?: string; errors?: { pointer: string; message: string }[] } = await res.json();
    const pointers = body.errors?.map((e) => `${e.pointer}: ${e.message}`).join("; ");
    return [body.detail, pointers].filter(Boolean).join(" — ") || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(await problemDetail(res));
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(await problemDetail(res));
  return res.json();
}

export const roundDetail = (id: string): Promise<RoundDetail> => getJson(`/cc/rounds/${encodeURIComponent(id)}`);

export const fetchSettings = (): Promise<HubSettings> => getJson("/cc/settings");

export async function saveSettings(patch: Partial<HubSettings>): Promise<HubSettings> {
  const res = await fetch("/cc/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(await problemDetail(res));
  return res.json();
}

/** Settings → config.toml (read-only) and Storage. */
export interface ConfigView {
  status: ConfigStatus;
  port: number;
  log_level: LogLevel;
  limits: HubLimits;
  backups: BackupSettings;
  advisors: AdvisorConfig[];
  auto_ask: AutoAskRule[];
  storage: StorageInfo;
  /** Whether this Hub posts macOS notifications when no tab can (hub-operations spec). */
  macos_fallback: boolean;
}

export const fetchConfig = (): Promise<ConfigView> => getJson("/cc/config");

export const reportPermission = (permission: "granted" | "denied" | "default"): Promise<void> =>
  post("/cc/notifications/permission", { permission });

export async function feedRounds(): Promise<FeedRoundView[]> {
  const res = await fetch("/cc/rounds");
  if (!res.ok) throw new Error(await problemDetail(res));
  const body: { rounds: FeedRoundView[] } = await res.json();
  return body.rounds;
}

export const sendRound = (id: string, input: SendInput): Promise<void> => post(`/cc/rounds/${encodeURIComponent(id)}/send`, input);
export const dismissRound = (id: string, input: DismissInput): Promise<void> =>
  post(`/cc/rounds/${encodeURIComponent(id)}/dismiss`, input);
export const redirectRound = (id: string, input: RedirectInput): Promise<void> =>
  post(`/cc/rounds/${encodeURIComponent(id)}/redirect`, input);
export const removeFromFeed = (id: string): Promise<void> => post(`/cc/rounds/${encodeURIComponent(id)}/remove`, undefined);

export async function saveDraft(id: string, draft: Draft): Promise<void> {
  const res = await fetch(`/cc/rounds/${encodeURIComponent(id)}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!res.ok) throw new Error(await problemDetail(res));
}

export async function agentRoster(): Promise<AgentView[]> {
  const res = await fetch("/cc/agents");
  if (!res.ok) throw new Error(await problemDetail(res));
  const body: { agents: AgentView[] } = await res.json();
  return body.agents;
}

export const forgetAgent = (id: string): Promise<void> => post(`/cc/agents/${encodeURIComponent(id)}/forget`, undefined);

export async function askAdvisor(id: string, input: { advisor: string; brief?: string }): Promise<AdvisorRunView> {
  const res = await fetch(`/cc/rounds/${encodeURIComponent(id)}/advisor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await problemDetail(res));
  return res.json();
}

function logQuery(filter: LogFilter): string {
  const p = new URLSearchParams();
  if (filter.outcome !== undefined) p.set("outcome", filter.outcome);
  if (filter.session_id !== undefined) p.set("session_id", filter.session_id);
  if (filter.callsign !== undefined) p.set("callsign", filter.callsign);
  if (filter.project !== undefined) p.set("project", filter.project);
  if (filter.from !== undefined) p.set("from", filter.from);
  if (filter.to !== undefined) p.set("to", filter.to);
  if (filter.q !== undefined) p.set("q", filter.q);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export interface LogResponse {
  entries: LogEntry[];
  db_size_bytes: number;
}

export async function fetchLog(filter: LogFilter): Promise<LogResponse> {
  const res = await fetch(`/cc/log${logQuery(filter)}`);
  if (!res.ok) throw new Error(await problemDetail(res));
  return res.json();
}

export const cancelAdvisor = (id: string): Promise<void> => post(`/cc/rounds/${encodeURIComponent(id)}/advisor/cancel`, undefined);

/** `/cc/log/export`'s URL for the current filter; a plain navigation triggers the download. */
export const logExportUrl = (filter: LogFilter): string => `/cc/log/export${logQuery(filter)}`;
