import { handler, json } from "@/lib/server/http";
import { getTransport } from "@/lib/email/resend";
import { clearHalt } from "@/lib/server/worker";
import { getSettings } from "@/lib/server/settings";

// Verifies authentication with Resend without sending an email.
export const POST = handler(async () => {
  const r = await getTransport().testConnection((await getSettings()).fromEmail);
  if (r.ok) await clearHalt();
  return json(r);
});
