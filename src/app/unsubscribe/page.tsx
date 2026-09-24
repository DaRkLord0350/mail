import type { Metadata } from "next";
import { UnsubscribeForm } from "@/components/unsubscribe-form";
import { verifyUnsubscribeToken } from "@/lib/server/tokens";
import { normalizeEmail } from "@/lib/email-address";

export const metadata: Metadata = { title: "Unsubscribe" };

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const email = typeof sp.e === "string" ? sp.e : "";
  const token = typeof sp.t === "string" ? sp.t : "";
  if (!verifyUnsubscribeToken(normalizeEmail(email), token)) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Invalid unsubscribe link</h1>
          <p className="mt-2 text-sm text-slate-600">This link is incomplete or has been altered. Please use the link from the email you received.</p>
        </div>
      </main>
    );
  }
  return <UnsubscribeForm email={email} token={token} />;
}
