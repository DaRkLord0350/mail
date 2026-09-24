import { handler, json } from "@/lib/server/http";
import { getTransport } from "@/lib/email/resend";

export const POST = handler(async () => json(await getTransport().testConnection()));
