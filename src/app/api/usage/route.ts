import { handler, json } from "@/lib/server/http";
import { getSettings } from "@/lib/server/settings";
import { getUsage } from "@/lib/server/quota";

export const GET = handler(async () => {
  const s = await getSettings();
  return json(await getUsage(s.timezone, s.dailyLimit));
});
