import { handler, json } from "@/lib/server/http";
import { getTransport } from "@/lib/email/resend";
import { clearHalt } from "@/lib/server/worker";
import { getSettings } from "@/lib/server/settings";

// Legacy route kept stable so the existing Settings page/API contract does not break.
// It now tests the Gmail API transport.
export const POST = handler(async () => {
  const r = await getTransport().testConnection((await getSettings()).fromEmail);
  if (r.ok) await clearHalt();
  return json(r);
});
