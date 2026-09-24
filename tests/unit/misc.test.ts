import { beforeAll, describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail } from "@/lib/email-address";
import { dayKey } from "@/lib/server/quota";
import { zonedTimeToUtc } from "@/lib/server/campaigns";
import { createSessionToken, SESSION_TTL_SECONDS, verifySessionToken } from "@/lib/server/auth";
import { unsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from "@/lib/server/tokens";
import { HttpError } from "@/lib/server/http";

beforeAll(() => {
  process.env.SESSION_SECRET = "unit-test-session-secret-0123456789";
  process.env.ADMIN_PASSWORD = "unit-test-admin-password";
  process.env.APP_URL = "https://mail.example.com";
  delete process.env.UNSUBSCRIBE_SECRET;
});

describe("email validation", () => {
  it.each([
    "a@b.co",
    "first.last@example.com",
    "user+tag@sub.domain.io",
    "o'brien@example.ie",
    "x_y-z@ex-ample.com",
    "user@xn--bcher-kva.example",
    "u@example.xn--p1ai",
  ])("valid: %s", (e) => expect(isValidEmail(e)).toBe(true));

  it.each([
    "",
    "plain",
    "@example.com",
    "user@",
    "user@localhost",
    "user@@example.com",
    "a@b@c.com",
    "user@example.c",
    "user@example.123",
    "user@-example.com",
    "user@example-.com",
    "user@exa mple.com",
    "us er@example.com",
    ".user@example.com",
    "user.@example.com",
    "us..er@example.com",
    "user@example..com",
    `${"a".repeat(65)}@example.com`,
    `a@${"b".repeat(250)}.com`,
  ])("invalid: %s", (e) => expect(isValidEmail(e)).toBe(false));

  it("normalizeEmail trims, lowercases and strips mailto:/angle brackets", () => {
    expect(normalizeEmail("  John@Example.COM ")).toBe("john@example.com");
    expect(normalizeEmail("mailto:Me@X.com")).toBe("me@x.com");
    expect(normalizeEmail("John Doe <John@Doe.com>")).toBe("john@doe.com");
    expect(normalizeEmail(null)).toBe("");
  });
});

describe("time zones", () => {
  it("zonedTimeToUtc: 09:00 Asia/Kolkata = 03:30Z", () => {
    expect(zonedTimeToUtc("2026-09-24", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-09-24T03:30:00.000Z");
  });

  it("zonedTimeToUtc: America/New_York across the March DST switch", () => {
    expect(zonedTimeToUtc("2026-03-07", "09:00", "America/New_York").toISOString()).toBe("2026-03-07T14:00:00.000Z"); // EST
    expect(zonedTimeToUtc("2026-03-09", "09:00", "America/New_York").toISOString()).toBe("2026-03-09T13:00:00.000Z"); // EDT
    expect(zonedTimeToUtc("2026-03-08", "09:00", "America/New_York").toISOString()).toBe("2026-03-08T13:00:00.000Z"); // switch day, after 2am
  });

  it("zonedTimeToUtc: America/New_York across the November DST switch", () => {
    expect(zonedTimeToUtc("2026-10-31", "09:00", "America/New_York").toISOString()).toBe("2026-10-31T13:00:00.000Z"); // EDT
    expect(zonedTimeToUtc("2026-11-01", "09:00", "America/New_York").toISOString()).toBe("2026-11-01T14:00:00.000Z"); // EST
    expect(zonedTimeToUtc("2026-11-02", "09:00", "America/New_York").toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });

  it("zonedTimeToUtc: UTC and invalid input", () => {
    expect(zonedTimeToUtc("2026-01-01", "00:00", "UTC").toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(() => zonedTimeToUtc("2026-1-1", "9:00", "UTC")).toThrow(HttpError);
    expect(() => zonedTimeToUtc("2026-01-01", "09:00", "Mars/Olympus")).toThrow(HttpError);
  });

  it("dayKey formats YYYY-MM-DD in the given zone (resets at local midnight)", () => {
    const d = new Date("2026-09-24T19:00:00Z"); // 00:30 on the 25th in IST
    expect(dayKey("Asia/Kolkata", d)).toBe("2026-09-25");
    expect(dayKey("UTC", d)).toBe("2026-09-24");
    expect(dayKey("America/New_York", d)).toBe("2026-09-24");
    expect(dayKey("Asia/Kolkata", new Date("2026-09-24T18:29:59Z"))).toBe("2026-09-24");
    expect(dayKey("Asia/Kolkata", new Date("2026-09-24T18:30:00Z"))).toBe("2026-09-25");
  });
});

describe("auth tokens", () => {
  it("a fresh session token verifies", () => {
    const now = Date.now();
    const tok = createSessionToken(now);
    expect(verifySessionToken(tok, now + 1000)).toBe(true);
  });

  it("an expired session token is rejected", () => {
    const now = Date.now();
    const tok = createSessionToken(now);
    expect(verifySessionToken(tok, now + SESSION_TTL_SECONDS * 1000 - 1)).toBe(true);
    expect(verifySessionToken(tok, now + SESSION_TTL_SECONDS * 1000 + 1)).toBe(false);
  });

  it("tampered session tokens are rejected", () => {
    const now = Date.now();
    const tok = createSessionToken(now);
    const [v, exp, sig] = tok.split(".");
    expect(verifySessionToken(`${v}.${Number(exp) + 10 ** 9}.${sig}`, now)).toBe(false); // extended expiry
    expect(verifySessionToken(`${v}.${exp}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, now)).toBe(false);
    expect(verifySessionToken(`v2.${exp}.${sig}`, now)).toBe(false);
    expect(verifySessionToken("garbage", now)).toBe(false);
    expect(verifySessionToken("", now)).toBe(false);
    expect(verifySessionToken(null, now)).toBe(false);
  });

  it("session tokens are invalidated by a secret or password change", () => {
    const now = Date.now();
    const tok = createSessionToken(now);
    const oldPw = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "a-different-password";
    expect(verifySessionToken(tok, now)).toBe(false);
    process.env.ADMIN_PASSWORD = oldPw;
    const oldSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "another-secret-0123456789abcdef";
    expect(verifySessionToken(tok, now)).toBe(false);
    process.env.SESSION_SECRET = oldSecret;
    expect(verifySessionToken(tok, now)).toBe(true);
  });

  it("unsubscribe tokens verify per address (case-insensitive) and reject tampering", () => {
    const tok = unsubscribeToken("Lead@Example.com");
    expect(verifyUnsubscribeToken("lead@example.com", tok)).toBe(true);
    expect(verifyUnsubscribeToken("other@example.com", tok)).toBe(false);
    expect(verifyUnsubscribeToken("lead@example.com", tok.slice(0, -1) + (tok.endsWith("a") ? "b" : "a"))).toBe(false);
    expect(verifyUnsubscribeToken("lead@example.com", "")).toBe(false);
    expect(verifyUnsubscribeToken("", tok)).toBe(false);
    // Deterministic (payload identical across retries).
    expect(unsubscribeToken("lead@example.com")).toBe(tok);
    const url = new URL(unsubscribeUrl("Lead@Example.com"));
    expect(url.origin).toBe("https://mail.example.com");
    expect(url.searchParams.get("e")).toBe("lead@example.com");
    expect(verifyUnsubscribeToken(url.searchParams.get("e")!, url.searchParams.get("t")!)).toBe(true);
  });
});
