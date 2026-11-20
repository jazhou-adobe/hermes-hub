/**
 * HTTP status per error code (transports spec; `hub_unavailable` is client-side only).
 * `invalid_answer` and `internal` belong to the Command Center endpoints.
 */
export const HTTP_STATUS: Record<string, number> = {
  invalid_round: 422,
  too_large: 413,
  unsupported_schema: 422,
  idempotency_conflict: 409,
  round_ended: 409,
  not_found: 404,
  flood_cap: 429,
  unknown_session: 401,
  forbidden: 403,
  advisor_cannot_ask: 403,
  invalid_answer: 422,
  internal: 500,
};

/** CLI exit codes (transports spec). */
export function exitCodeFor(code: string): number {
  if (code === "hub_unavailable") return 3;
  if (code === "unknown_session" || code === "forbidden") return 5;
  return 4;
}

export class HubError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
