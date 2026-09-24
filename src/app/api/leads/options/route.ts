import { handler, json, searchParams } from "@/lib/server/http";
import { leadOptions } from "@/lib/server/leads";

export const GET = handler(async (req) => json({ items: await leadOptions(searchParams(req).get("search")?.slice(0, 200) || undefined) }));
