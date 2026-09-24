import { z } from "zod";
import { handler, json, readJson } from "@/lib/server/http";
import { getCampaignOr404 } from "@/lib/server/campaigns";
import { sendTestEmail } from "@/lib/server/test-email";

const Body = z.object({ to: z.string().min(3).max(254), leadId: z.string().min(1) });

export const POST = handler<{ id: string }>(async (req, { params }) => {
  const c = await getCampaignOr404((await params).id);
  const { to, leadId } = await readJson(req, Body);
  return json(await sendTestEmail({ to, leadId, subject: c.subjectTemplate, body: c.bodyTemplate, campaignId: c.id }));
});
