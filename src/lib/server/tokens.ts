import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

function secret(): string {
  const s = env.sessionSecret;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET is not configured (needs 16+ chars).");
  return s;
}

export function hmac(purpose: string, value: string, key = secret()): string {
  return createHmac("sha256", key).update(`${purpose}:${value}`).digest("base64url");
}

function unsubscribeKey(): string {
  const s = env.unsubscribeSecret;
  if (!s || s.length < 16) throw new Error("UNSUBSCRIBE_SECRET / SESSION_SECRET is not configured (needs 16+ chars).");
  return s;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Unsubscribe links are deterministic per address (HMAC of the email), so the
// email payload is byte-identical across retries (required for Resend
// idempotency keys) and links never expire.
export function unsubscribeToken(email: string): string {
  return hmac("unsubscribe", email.toLowerCase(), unsubscribeKey()).slice(0, 32);
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  if (!email || !token) return false;
  try {
    return safeEqual(unsubscribeToken(email), token);
  } catch {
    return false;
  }
}

export function unsubscribeUrl(email: string): string {
  const e = email.toLowerCase();
  return `${env.appUrl}/unsubscribe?e=${encodeURIComponent(e)}&t=${unsubscribeToken(e)}`;
}

export function unsubscribePostUrl(email: string): string {
  const e = email.toLowerCase();
  return `${env.appUrl}/api/unsubscribe?e=${encodeURIComponent(e)}&t=${unsubscribeToken(e)}`;
}
