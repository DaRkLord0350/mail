import { createHash } from "node:crypto";
import { env } from "./env";
import { hmac, safeEqual } from "./tokens";

export const SESSION_COOKIE = "mail_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export const MIN_PASSWORD_LENGTH = 12;

// Sessions are bound to the current password: changing ADMIN_PASSWORD
// invalidates every existing session (revocation without server state).
function sessionPurpose(): string {
  return `session:${createHash("sha256").update(env.adminPassword).digest("hex").slice(0, 16)}`;
}

/** Signed, stateless session token: v1.<expiresAtMs>.<hmac>. */
export function createSessionToken(now = Date.now()): string {
  const exp = now + SESSION_TTL_SECONDS * 1000;
  const payload = `v1.${exp}`;
  return `${payload}.${hmac(sessionPurpose(), payload)}`;
}

export function verifySessionToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < now) return false;
  try {
    if (!env.adminPassword) return false;
    return safeEqual(parts[2], hmac(sessionPurpose(), `${parts[0]}.${parts[1]}`));
  } catch {
    return false;
  }
}

export function checkPassword(candidate: string): boolean {
  const expected = env.adminPassword;
  if (!expected) return false;
  // Compare fixed-length digests to avoid leaking length/timing.
  const a = createHash("sha256").update(candidate).digest("hex");
  const b = createHash("sha256").update(expected).digest("hex");
  return safeEqual(a, b);
}

export function isCronAuthorized(req: Request): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  const a = createHash("sha256").update(token).digest("hex");
  const b = createHash("sha256").update(secret).digest("hex");
  return safeEqual(a, b);
}
