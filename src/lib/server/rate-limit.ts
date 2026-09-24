// Simple in-memory fixed-window rate limiter (per process). Good enough for a
// single-admin internal tool; put a platform firewall in front for more.
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

/** Count one hit (or, with `peek`, only check) against a fixed window. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now(), peek = false): { ok: boolean; retryAfter: number; remaining: number } {
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  if (peek) return { ok: b.count < limit, retryAfter: Math.ceil((b.resetAt - now) / 1000), remaining: Math.max(0, limit - b.count) };
  b.count++;
  return { ok: b.count <= limit, retryAfter: Math.ceil((b.resetAt - now) / 1000), remaining: Math.max(0, limit - b.count) };
}

/**
 * Best-effort client IP. Prefers X-Real-IP (set by Vercel / typical nginx
 * configs); otherwise the LAST X-Forwarded-For hop (the one appended by the
 * proxy in front of us), since earlier entries are client-controlled.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return "local";
}
