import { z } from "zod";
import { handler, json, readJson } from "@/lib/server/http";
import { sendTestEmail } from "@/lib/server/test-email";
import { sendTemplateTestEmail } from "@/lib/server/test-email-template";

const Body = z.object({ to: z.string().min(3).max(254), leadId: z.string().min(1), subject: z.string().max(998), body: z.string().max(100_000), templateId: z.string().min(1).optional() });

export const POST = handler(async (req) => {
  const input = await readJson(req, Body);
  return json(input.templateId ? await sendTemplateTestEmail(input as { to: string; leadId: string; subject: string; body: string; templateId: string }) : await sendTestEmail(input));
});
