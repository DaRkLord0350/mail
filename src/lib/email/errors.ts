// Classify Resend / transport errors into how the queue should react. Pure.

export type ErrorKind = "PERMANENT" | "TRANSIENT" | "AUTH" | "UNKNOWN_OUTCOME";

export interface SendErrorInfo {
  /** Resend error name, e.g. "validation_error", or "timeout" / "network_error". */
  code: string;
  message: string;
  statusCode: number | null;
}

export interface Classification {
  kind: ErrorKind;
  /** Keep the idempotency key for the retry? True whenever Resend may have accepted the request. */
  keepIdempotencyKey: boolean;
  /** Should the whole sending pipeline halt (bad API key / sender)? */
  haltAll: boolean;
}

const AUTH_CODES = new Set(["missing_api_key", "invalid_api_key", "restricted_api_key", "invalid_access"]);
// Configuration problems that affect every email (sender domain not verified…).
const CONFIG_CODES = new Set(["invalid_from_address"]);
const QUOTA_CODES = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);
const PERMANENT_CODES = new Set([
  "validation_error",
  "invalid_parameter",
  "missing_required_field",
  "invalid_attachment",
  "not_found",
  "method_not_allowed",
  "security_error",
  "invalid_region",
]);

export function classifySendError(err: SendErrorInfo): Classification {
  const code = err.code;
  const status = err.statusCode;

  if (AUTH_CODES.has(code) || status === 401) return { kind: "AUTH", keepIdempotencyKey: false, haltAll: true };
  if (CONFIG_CODES.has(code)) return { kind: "AUTH", keepIdempotencyKey: false, haltAll: true };
  // Resend-side account quota: nothing more can be sent today → halt, retry later.
  if (QUOTA_CODES.has(code)) return { kind: "AUTH", keepIdempotencyKey: false, haltAll: true };
  // Same key reused with a different payload: the original request reached
  // Resend, so the email may already have been delivered. Never resend blindly.
  // Malformed key: rejected outright (400), nothing sent — a code bug affecting every send.
  if (code === "invalid_idempotency_key") return { kind: "PERMANENT", keepIdempotencyKey: false, haltAll: true };
  if (code === "invalid_idempotent_request") {
    return { kind: "UNKNOWN_OUTCOME", keepIdempotencyKey: true, haltAll: false };
  }
  // Another request with the same key is in flight: retry later with the same key.
  if (code === "concurrent_idempotent_requests" || status === 409) {
    return { kind: "TRANSIENT", keepIdempotencyKey: true, haltAll: false };
  }
  // Rate limited: definitely not processed → a fresh key is fine.
  if (code === "rate_limit_exceeded" || status === 429) return { kind: "TRANSIENT", keepIdempotencyKey: false, haltAll: false };
  // Network error / timeout / 5xx: outcome unknown → retry with the SAME key so Resend dedupes.
  if (status === null || code === "timeout" || code === "network_error" || (status >= 500 && status <= 599)) {
    return { kind: "TRANSIENT", keepIdempotencyKey: true, haltAll: false };
  }
  if (code === "application_error" || code === "internal_server_error") {
    return { kind: "TRANSIENT", keepIdempotencyKey: true, haltAll: false };
  }
  if (status === 403) return { kind: "AUTH", keepIdempotencyKey: false, haltAll: true };
  if (PERMANENT_CODES.has(code) || (status >= 400 && status <= 499)) {
    return { kind: "PERMANENT", keepIdempotencyKey: false, haltAll: false };
  }
  return { kind: "TRANSIENT", keepIdempotencyKey: true, haltAll: false };
}

/** Exponential backoff with a little jitter: 1m, 5m, 25m, … capped at 2h. */
export function retryDelayMs(attempt: number): number {
  const base = 60_000 * Math.pow(5, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 15_000);
  return Math.min(base, 2 * 60 * 60_000) + jitter;
}
