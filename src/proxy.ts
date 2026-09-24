// Runs before every route (Node.js runtime): authentication, CSRF defence and
// API rate limiting.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/server/auth";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

const PUBLIC_PAGES = ["/login", "/unsubscribe"];
// Routes that authenticate themselves (cron: Bearer secret; unsubscribe: signed token).
const SELF_AUTH_API = ["/api/auth/login", "/api/unsubscribe", "/api/cron/"];
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isPrefix(path: string, list: string[]) {
  return list.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));
}

function apiError(status: number, error: string, headers?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers });
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const ip = clientIp(req);

  if (isApi) {
    // Rate limits (per IP, per process).
    const isLogin = pathname === "/api/auth/login";
    const bucket = isLogin ? "login" : pathname.startsWith("/api/unsubscribe") ? "unsub" : "api";
    // Unsubscribe is generous: mail providers send one-click POSTs from shared IPs.
    const limit = isLogin ? 10 : 600;
    const rl = rateLimit(`${bucket}:${ip}`, limit, 60_000);
    if (!rl.ok) return apiError(429, "Too many requests — slow down.", { "Retry-After": String(rl.retryAfter) });

    const selfAuth = isPrefix(pathname, SELF_AUTH_API);

    if (MUTATING.has(req.method) && !pathname.startsWith("/api/cron/") && !pathname.startsWith("/api/unsubscribe")) {
      // CSRF: require the custom header (cannot be sent cross-site without a
      // CORS preflight, which we never approve) and a same-origin Origin.
      if (req.headers.get("x-requested-with") !== "mail") return apiError(403, "Missing X-Requested-With header");
      const origin = req.headers.get("origin");
      if (origin) {
        const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
        let originHost = "";
        try {
          originHost = new URL(origin).host;
        } catch {
          /* invalid */
        }
        if (!host || originHost !== host) return apiError(403, "Cross-origin request blocked");
      }
    }

    if (!selfAuth && !verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) {
      return apiError(401, "Not authenticated");
    }
    return NextResponse.next();
  }

  if (isPrefix(pathname, PUBLIC_PAGES)) return NextResponse.next();
  if (!verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Every /api path is always matched (even ones ending in ".png" etc.), so no
// API route can ever bypass auth/CSRF/rate limiting via a file-like URL.
export const config = {
  matcher: ["/api/:path*", "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|svg|ico|webp|txt)$).*)"],
};
