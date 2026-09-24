import { handler, json } from "@/lib/server/http";
import { templateVariables } from "@/lib/server/leads";

export const GET = handler(async () => json({ variables: await templateVariables() }));
