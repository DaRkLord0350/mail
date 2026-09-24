import { prisma } from "@/lib/server/db";
import { badRequest, handler, json, searchParams } from "@/lib/server/http";
import { verifyUnsubscribeToken } from "@/lib/server/tokens";
import { normalizeEmail } from "@/lib/email-address";

// Public, token-authenticated. Used by the /unsubscribe page and by mail
// clients' RFC 8058 one-click (List-Unsubscribe-Post) requests.
export const POST = handler(async (req) => {
  const sp = searchParams(req);
  const email = normalizeEmail(sp.get("e"));
  const token = sp.get("t") ?? "";
  if (!email || !verifyUnsubscribeToken(email, token)) throw badRequest("This unsubscribe link is invalid.");
  await prisma.suppression.upsert({
    where: { email },
    update: {},
    create: { email, source: "UNSUBSCRIBE", reason: "Unsubscribed via link" },
  });
  return json({ ok: true, email });
});
