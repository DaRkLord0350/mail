// Classify Gmail API transport errors into queue actions.
export type ErrorKind = "PERMANENT" | "TRANSIENT" | "AUTH" | "UNKNOWN_OUTCOME";

export interface SendErrorInfo {
  code: string;
  message: string;
  statusCode: number | null;
}

export interface Classification {
  kind: ErrorKind;
  /** Gmail API does not provide provider-level idempotency; this flag is kept for queue compatibility. */
  keepIdempotencyKey: boolean;
  /** Halt when credentials/permissions/account access are broken. */
  haltAll: boolean;
}

export function classifySendError(err: SendErrorInfo): Classification {
  const status = err.statusCode;
  if (status === 401 || err.code === "invalid_access") return { kind: "AUTH", keepIdempotencyKey: false, haltAll: true };
  if (status === 403 || err.code === "permission_denied") return { kind: "AUTH", keepIdempotencyKey: false, haltAll: true };
  if (status === 429 || err.code === "rate_limit_exceeded") return { kind: "TRANSIENT", keepIdempotencyKey: false, haltAll: false };
  if (err.code === "timeout" || err.code === "network_error" || status === null || (status >= 500 && status <= 599)) {
    return { kind: "TRANSIENT", keepIdempotencyKey: false, haltAll: false };
  }
  if (status >= 400 && status <= 499) return { kind: "PERMANENT", keepIdempotencyKey: false, haltAll: false };
  return { kind: "TRANSIENT", keepIdempotencyKey: false, haltAll: false };
}

/** Exponential backoff with jitter: 1m, 5m, 25m … capped at 2h. */
export function retryDelayMs(attempt: number): number {
  const base = 60_000 * Math.pow(5, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 15_000);
  return Math.min(base, 2 * 60 * 60_000) + jitter;
}
