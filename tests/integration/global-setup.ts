// Runs once before the integration suite: apply migrations to `mail_test`.
import { execSync } from "node:child_process";
import path from "node:path";
import { testDatabaseUrl } from "./env";

export default function setup() {
  const url = testDatabaseUrl();
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: "inherit",
  });
}
