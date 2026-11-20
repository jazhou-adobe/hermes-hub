import type { PendingRoundView } from "../../src/hub/engine.ts";
import type { SendInput } from "../../src/schema/validate.ts";

async function problemDetail(res: Response): Promise<string> {
  try {
    const body: { detail?: string; errors?: { pointer: string; message: string }[] } = await res.json();
    const pointers = body.errors?.map((e) => `${e.pointer}: ${e.message}`).join("; ");
    return [body.detail, pointers].filter(Boolean).join(" — ") || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function pendingRounds(): Promise<PendingRoundView[]> {
  const res = await fetch("/cc/rounds");
  if (!res.ok) throw new Error(await problemDetail(res));
  const body: { rounds: PendingRoundView[] } = await res.json();
  return body.rounds;
}

export async function sendRound(id: string, input: SendInput): Promise<void> {
  const res = await fetch(`/cc/rounds/${encodeURIComponent(id)}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await problemDetail(res));
}
