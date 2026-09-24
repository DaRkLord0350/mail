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

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
