import { describe, expect, it } from "vitest";
import { classifySendError, retryDelayMs } from "@/lib/email/errors";

const c = (code: string, statusCode: number | null) => classifySendError({ code, message: code, statusCode });

describe("send error classification", () => {
  it("invalid_api_key (401) → AUTH, halts everything", () => {
    expect(c("invalid_api_key", 401)).toEqual({ kind: "AUTH", keepIdempotencyKey: false, haltAll: true });
    expect(c("missing_api_key", null).haltAll).toBe(true);
    expect(c("restricted_api_key", 401).haltAll).toBe(true);
    expect(c("whatever", 401).haltAll).toBe(true);
  });

  it("403 validation_error (Resend testing-domain restriction) → halt", () => {
    const r = c("validation_error", 403);
    expect(r.haltAll).toBe(true);
    expect(r.kind).toBe("AUTH");
  });

  it("invalid_from_address → halt", () => {
    expect(c("invalid_from_address", 422).haltAll).toBe(true);
  });

  it("422 validation_error → PERMANENT, no halt", () => {
    expect(c("validation_error", 422)).toEqual({ kind: "PERMANENT", keepIdempotencyKey: false, haltAll: false });
    expect(c("invalid_parameter", 400).kind).toBe("PERMANENT");
  });

  it("429 → TRANSIENT, idempotency key dropped", () => {
    expect(c("rate_limit_exceeded", 429)).toEqual({ kind: "TRANSIENT", keepIdempotencyKey: false, haltAll: false });
    expect(c("something", 429).keepIdempotencyKey).toBe(false);
  });

  it("500 / network error / timeout → TRANSIENT, key kept", () => {
    for (const r of [c("internal_server_error", 500), c("application_error", 503), c("network_error", null), c("timeout", null)]) {
      expect(r).toEqual({ kind: "TRANSIENT", keepIdempotencyKey: true, haltAll: false });
    }
  });

  it("invalid_idempotent_request → UNKNOWN_OUTCOME (never resent blindly)", () => {
    expect(c("invalid_idempotent_request", 409)).toEqual({ kind: "UNKNOWN_OUTCOME", keepIdempotencyKey: true, haltAll: false });
  });

  it("concurrent_idempotent_requests → TRANSIENT with the same key", () => {
    expect(c("concurrent_idempotent_requests", 409)).toEqual({ kind: "TRANSIENT", keepIdempotencyKey: true, haltAll: false });
  });

  it("daily_quota_exceeded → halt", () => {
    expect(c("daily_quota_exceeded", 429).haltAll).toBe(true);
    expect(c("monthly_quota_exceeded", 429).haltAll).toBe(true);
  });

  it("retry backoff grows and is capped at ~2h", () => {
    expect(retryDelayMs(1)).toBeGreaterThanOrEqual(60_000);
    expect(retryDelayMs(1)).toBeLessThan(75_000);
    expect(retryDelayMs(2)).toBeGreaterThanOrEqual(300_000);
    expect(retryDelayMs(20)).toBeLessThan(2 * 3600_000 + 15_000);
  });
});
