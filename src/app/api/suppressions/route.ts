import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { badRequest, handler, json, pagination, readJson, searchParams } from "@/lib/server/http";
import { suppressionDTO } from "@/lib/server/dto";
import { isValidEmail, normalizeEmail } from "@/lib/email-address";

const Body = z.object({ email: z.string().min(3).max(254), reason: z.string().max(500).optional() });

export const GET = handler(async (req) => {
  const sp = searchParams(req);
  const { page, pageSize, skip, take } = pagination(sp);
  const search = sp.get("search")?.trim().slice(0, 200);
  const where: Prisma.SuppressionWhereInput = search ? { email: { contains: search, mode: "insensitive" } } : {};
  const [items, total] = await Promise.all([
    prisma.suppression.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.suppression.count({ where }),
  ]);
  return json({ items: items.map(suppressionDTO), total, page, pageSize });
});

export const POST = handler(async (req) => {
  const { email: raw, reason } = await readJson(req, Body);
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) throw badRequest("Enter a valid email address.");
  // Pending deliveries to this address are skipped by the worker before sending.
  const s = await prisma.suppression.upsert({
    where: { email },
    update: { reason: reason ?? undefined },
    create: { email, reason: reason || null, source: "MANUAL" },
  });
  return json(suppressionDTO(s), 201);
});
