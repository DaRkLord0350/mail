import { z } from "zod";
import { NextResponse } from "next/server";
import { checkPassword, createSessionToken, MIN_PASSWORD_LENGTH, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/server/auth";
import { rateLimit } from "@/lib/server/rate-limit";
import { env } from "@/lib/server/env";
import { handler, HttpError, readJson } from "@/lib/server/http";

const Body = z.object({ password: z.string().min(1).max(500) });

export const POST = handler(async (req) => {
  if (!env.adminPassword || env.sessionSecret.length < 16) {
    throw new HttpError(503, "Login is not configured: set ADMIN_PASSWORD and SESSION_SECRET in the server environment.");
  }
  if (env.adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(503, `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters. Update the server environment.`);
  }
  // Global (IP-independent) cap on failed attempts, on top of the per-IP limit.
  if (!rateLimit("login-failures", 30, 15 * 60_000, Date.now(), true).ok) {
    throw new HttpError(429, "Too many failed login attempts. Try again in 15 minutes.");
  }
  const { password } = await readJson(req, Body);
  if (!checkPassword(password)) {
    rateLimit("login-failures", 30, 15 * 60_000);
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    throw new HttpError(401, "Incorrect password");
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction && (env.appUrl.startsWith("https://") || req.headers.get("x-forwarded-proto") === "https"),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
});
