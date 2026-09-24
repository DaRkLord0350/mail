import { handler, json } from "@/lib/server/http";
import { stopCampaign } from "@/lib/server/campaigns";

export const POST = handler<{ id: string }>(async (_req, { params }) => json(await stopCampaign((await params).id)));
