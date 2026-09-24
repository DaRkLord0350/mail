import { z } from "zod";
import { handler, json, readJson } from "@/lib/server/http";
import { sendTestEmail } from "@/lib/server/test-email";

const Body = z.object({ to: z.string().min(3).max(254), leadId: z.string().min(1), subject: z.string().max(998), body: z.string().max(100_000) });

export const POST = handler(async (req) => json(await sendTestEmail(await readJson(req, Body))));
