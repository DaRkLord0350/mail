// Loaded before every integration test file (and before any import of
// @/lib/server/db): point Prisma at the isolated `mail_test` schema ONLY.
import { config } from "dotenv";
import path from "node:path";

config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set — refusing to run integration tests.");
  const schema = new URL(url).searchParams.get("schema");
  if (schema !== "mail_test") throw new Error(`TEST_DATABASE_URL must use ?schema=mail_test (got "${schema}") — refusing to run.`);
  return url;
}

// The Supabase session pooler allows only 15 clients in total; Prisma's default
// pool (2×CPU+1) would exceed it under the concurrency tests.
const base = testDatabaseUrl();
const u = new URL(base);
if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", process.env.TEST_DB_CONNECTION_LIMIT ?? "6");
if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "60");
const url = u.toString();
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
// Never let a test reach real Resend.
process.env.RESEND_API_KEY = "";
process.env.FROM_EMAIL = "";
process.env.FROM_NAME = "";
// Settings.dailyLimit drives the tests; keep the env ceiling out of the way.
process.env.DAILY_SEND_LIMIT = "1000";
process.env.APP_TIMEZONE = "Asia/Kolkata";
process.env.APP_URL = "http://localhost:3000";
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) process.env.ADMIN_PASSWORD = "test-admin-password-123";
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
  process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
}
