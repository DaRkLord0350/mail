"use client";

// Browser-side API helper. Every mutating request carries the
// `X-Requested-With: mail` header, which the server requires (CSRF defence
// together with SameSite cookies and an Origin check).

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown> | unknown[];

async function request<T>(method: string, url: string, body?: Json | FormData): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "mail" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiClientError("Network error — is the server running?", 0);
  }
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth")) {
    // Full reload on purpose: the session expired, drop all client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: string; details?: unknown } | null) ?? null;
    throw new ApiClientError(err?.error ?? `Request failed (${res.status})`, res.status, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: Json | FormData) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body?: Json) => request<T>("PUT", url, body ?? {}),
  patch: <T>(url: string, body?: Json) => request<T>("PATCH", url, body ?? {}),
  del: <T>(url: string) => request<T>("DELETE", url),
};

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
