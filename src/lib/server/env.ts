// Server-only environment access. Never import this from client components:
// none of these variables are NEXT_PUBLIC_, so they are never inlined into
// browser bundles, but keeping all reads here makes that easy to audit.

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
  get resendApiKey() {
    return str("RESEND_API_KEY");
  },
  get fromEmail() {
    return str("FROM_EMAIL");
  },
  get fromName() {
    return str("FROM_NAME");
  },
  /** Hard ceiling for campaign sends per day. */
  get dailySendLimit() {
    return int("DAILY_SEND_LIMIT", 100, 0, 100_000);
  },
  get defaultSendDelaySeconds() {
    return int("DEFAULT_SEND_DELAY_SECONDS", 30, 0, 3600);
  },
  get cronBatchSize() {
    return int("CRON_BATCH_SIZE", 10, 1, 100);
  },
  get cronMaxRuntimeSeconds() {
    return int("CRON_MAX_RUNTIME_SECONDS", 50, 5, 900);
  },
  get cronSecret() {
    return str("CRON_SECRET");
  },
  get adminPassword() {
    return str("ADMIN_PASSWORD");
  },
  get sessionSecret() {
    return str("SESSION_SECRET");
  },
  /** Optional separate key for unsubscribe links (falls back to SESSION_SECRET). */
  get unsubscribeSecret() {
    return str("UNSUBSCRIBE_SECRET") || str("SESSION_SECRET");
  },
  get appUrl() {
    return (str("APP_URL") || "http://localhost:3000").replace(/\/+$/, "");
  },
  get timezone() {
    return str("APP_TIMEZONE") || "Asia/Kolkata";
  },
  get enableInternalWorker() {
    return str("ENABLE_INTERNAL_WORKER") === "true";
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
};

/** "re_…abcd" style hint; never reveals the key. */
export function maskKey(key: string): string | null {
  if (!key) return null;
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}
