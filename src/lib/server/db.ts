import { PrismaClient } from "@prisma/client";

// Single PrismaClient per process (survives Next.js dev hot reloads).
const globalForPrisma = globalThis as unknown as { __mailPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.__mailPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.__mailPrisma = prisma;

export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
