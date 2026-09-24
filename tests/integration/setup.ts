// Per-file setup for integration tests: clean `mail_test` before every test.
import { afterAll, beforeEach } from "vitest";
import { resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  const { setTransport } = await import("@/lib/email/resend");
  setTransport(null);
  const { prisma } = await import("@/lib/server/db");
  await prisma.$disconnect();
});
