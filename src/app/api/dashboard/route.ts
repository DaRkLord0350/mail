import { handler, json } from "@/lib/server/http";
import { getDashboard } from "@/lib/server/dashboard";

export const GET = handler(async () => json(await getDashboard()));
