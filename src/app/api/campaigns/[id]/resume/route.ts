import { handler, json } from "@/lib/server/http";
import { resumeCampaign } from "@/lib/server/campaigns";

export const POST = handler<{ id: string }>(async (_req, { params }) => json(await resumeCampaign((await params).id)));
