import type { FeedRoundView } from "../../src/hub/engine.ts";
import type { Draft, DismissInput, RedirectInput, SendInput } from "../../src/schema/validate.ts";

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
  const res = await fetch(path, { method: body === undefined ? "POST" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(await problemDetail(res));
}

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
