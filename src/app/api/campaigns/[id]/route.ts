import { z } from "zod";
import { handler, json, readJson } from "@/lib/server/http";
import { campaignDTOById, deleteCampaign, updateCampaign } from "@/lib/server/campaigns";

const Body = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  templateId: z.string().min(1).nullable().optional(),
  subjectTemplate: z.string().max(998).optional(),
  bodyTemplate: z.string().max(100_000).optional(),
  dailyLimit: z.number().int().min(1).max(100_000).optional(),
});

export const GET = handler<{ id: string }>(async (_req, { params }) => json(await campaignDTOById((await params).id)));

export const PATCH = handler<{ id: string }>(async (req, { params }) => json(await updateCampaign((await params).id, await readJson(req, Body))));

export const DELETE = handler<{ id: string }>(async (_req, { params }) => {
  await deleteCampaign((await params).id);
  return json({ ok: true });
});
