import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { handler, json, readJson } from "@/lib/server/http";
import { createCampaign, toDTOs } from "@/lib/server/campaigns";

const Body = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  templateId: z.string().min(1).nullable().optional(),
  subjectTemplate: z.string().max(998).optional(),
  bodyTemplate: z.string().max(100_000).optional(),
  dailyLimit: z.number().int().min(1).max(100_000).optional(),
});

export const GET = handler(async () => {
  const campaigns = await prisma.campaign.findMany({ orderBy: { createdAt: "desc" } });
  return json({ items: await toDTOs(campaigns) });
});

export const POST = handler(async (req) => json(await createCampaign(await readJson(req, Body)), 201));
