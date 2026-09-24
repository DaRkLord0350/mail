import { z } from "zod";
import { handler, json, readJson } from "@/lib/server/http";
import { previewCampaign } from "@/lib/server/campaigns";

const Body = z.object({ leadIds: z.array(z.string().min(1)).max(50).optional(), limit: z.number().int().min(1).max(50).optional() });

// Dry run: renders every recipient, sends nothing.
export const POST = handler<{ id: string }>(async (req, { params }) => json(await previewCampaign((await params).id, await readJson(req, Body))));
