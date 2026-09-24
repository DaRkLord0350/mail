import { z } from "zod";
import { handler, json, readJson } from "@/lib/server/http";
import { startCampaign } from "@/lib/server/campaigns";

export const maxDuration = 300;

const Body = z.object({
  schedule: z.object({ date: z.string(), time: z.string(), timezone: z.string().min(1).max(100) }).nullable().optional(),
});

export const POST = handler<{ id: string }>(async (req, { params }) => {
  const { schedule } = await readJson(req, Body);
  return json(await startCampaign((await params).id, schedule ?? undefined));
});
