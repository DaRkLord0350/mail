import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { handler, json, pagination, searchParams } from "@/lib/server/http";
import { deliveryDTO, deliveryInclude } from "@/lib/server/dto";
import { DELIVERY_STATUSES, type DeliveryStatus } from "@/lib/types";

export const GET = handler(async (req) => {
  const sp = searchParams(req);
  const { page, pageSize, skip, take } = pagination(sp);
  const where: Prisma.EmailDeliveryWhereInput = {};
  const statuses = (sp.get("status") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is DeliveryStatus => DELIVERY_STATUSES.includes(s as DeliveryStatus));
  if (statuses.length) where.status = { in: statuses };
  const campaignId = sp.get("campaignId");
  if (campaignId) where.campaignId = campaignId;
  const search = sp.get("search")?.trim().slice(0, 200);
  if (search) {
    const c = { contains: search, mode: "insensitive" as const };
    where.OR = [{ email: c }, { renderedSubject: c }, { providerMessageId: c }, { lead: { companyName: c } }, { campaign: { name: c } }];
  }
  const queueView = statuses.length > 0 && statuses.every((s) => s === "PENDING" || s === "PROCESSING");
  const orderBy: Prisma.EmailDeliveryOrderByWithRelationInput[] = queueView
    ? [{ nextAttemptAt: "asc" }, { createdAt: "asc" }]
    : [{ lastAttemptAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }];
  const [items, total] = await Promise.all([
    prisma.emailDelivery.findMany({ where, orderBy: [...orderBy, { id: "asc" }], skip, take, include: deliveryInclude }),
    prisma.emailDelivery.count({ where }),
  ]);
  return json({ items: items.map(deliveryDTO), total, page, pageSize });
});
