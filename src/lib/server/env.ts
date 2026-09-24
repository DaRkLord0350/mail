// Server-only environment access. Never import this from client components.
// All values are server-side; nothing is NEXT_PUBLIC_.

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(name: string): string {
  return (process.env[name] ?? "").trim();
}

export const env = {
  // Gmail API / OAuth
  get googleClientId() { return str("GOOGLE_CLIENT_ID"); },
  get googleClientSecret() { return str("GOOGLE_CLIENT_SECRET"); },
  get googleRedirectUri() { return str("GOOGLE_REDIRECT_URI"); },
  get googleRefreshToken() { return str("GOOGLE_REFRESH_TOKEN"); },
  get fromEmail() { return str("FROM_EMAIL") || "ventorynex@gmail.com"; },
  get fromName() { return str("FROM_NAME") || "NexVentory"; },

  /** Application safety ceiling. Google may impose a lower account limit. */
  get dailySendLimit() { return int("DAILY_SEND_LIMIT", 100, 1, 500); },
  get defaultSendDelaySeconds() { return int("DEFAULT_SEND_DELAY_SECONDS", 60, 0, 3600); },
  get cronBatchSize() { return int("CRON_BATCH_SIZE", 5, 1, 50); },
  get cronMaxRuntimeSeconds() { return int("CRON_MAX_RUNTIME_SECONDS", 50, 5, 900); },
  get cronSecret() { return str("CRON_SECRET"); },
  get adminPassword() { return str("ADMIN_PASSWORD"); },
  get sessionSecret() { return str("SESSION_SECRET"); },
  get appUrl() { return (str("APP_URL") || "http://localhost:3000").replace(/\\/+$/, ""); },
  get timezone() { return str("APP_TIMEZONE") || "Asia/Kolkata"; },
  get enableInternalWorker() { return str("ENABLE_INTERNAL_WORKER") === "true"; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
};
