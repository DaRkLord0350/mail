"use client";

import { useState } from "react";
import { CircleCheck, MailX, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

type State = { kind: "idle" } | { kind: "pending" } | { kind: "done" } | { kind: "error"; message: string };

export function UnsubscribeForm({ email, token }: { email: string; token: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const valid = Boolean(email && token);

  async function confirm() {
    setState({ kind: "pending" });
    try {
      const res = await fetch(`/api/unsubscribe?e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "X-Requested-With": "mail" },
        cache: "no-store",
      });
      if (res.ok) {
        setState({ kind: "done" });
        return;
      }
      let message = "This unsubscribe link is invalid or has expired.";
      try {
        const data = (await res.json()) as { error?: string };
        if (data?.error) message = data.error;
      } catch {
        // ignore non-JSON errors
      }
      if (res.status === 429) message = "Too many requests. Please try again in a minute.";
      setState({ kind: "error", message });
    } catch {
      setState({ kind: "error", message: "Network error. Please check your connection and try again." });
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        {!valid ? (
          <>
            <Icon tone="red">
              <TriangleAlert className="size-5" />
            </Icon>
            <h1 className="mt-4 text-lg font-semibold text-slate-900">Invalid unsubscribe link</h1>
            <p className="mt-2 text-sm text-slate-500">
              This link is missing information. Please use the unsubscribe link exactly as it appears in the email, or simply reply asking to be
              removed.
            </p>
          </>
        ) : state.kind === "done" ? (
          <>
            <Icon tone="green">
              <CircleCheck className="size-5" />
            </Icon>
            <h1 className="mt-4 text-lg font-semibold text-slate-900">You&apos;ve been unsubscribed</h1>
            <p className="mt-2 text-sm break-words text-slate-500">
              <span className="font-medium text-slate-700">{email}</span> will not receive any further emails from us.
            </p>
          </>
        ) : (
          <>
            <Icon tone="indigo">
              <MailX className="size-5" />
            </Icon>
            <h1 className="mt-4 text-lg font-semibold break-words text-slate-900">
              Unsubscribe <span className="text-indigo-700">{email}</span>?
            </h1>
            <p className="mt-2 text-sm text-slate-500">You will no longer receive outreach emails at this address.</p>
            {state.kind === "error" && (
              <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {state.message}
              </p>
            )}
            <Button className="mt-6 w-full" onClick={confirm} loading={state.kind === "pending"}>
              Unsubscribe
            </Button>
          </>
        )}
      </div>
    </main>
  );
}

function Icon({ tone, children }: { tone: "red" | "green" | "indigo"; children: React.ReactNode }) {
  const cls = { red: "bg-red-50 text-red-600", green: "bg-emerald-50 text-emerald-600", indigo: "bg-indigo-50 text-indigo-600" }[tone];
  return <div className={`mx-auto flex size-11 items-center justify-center rounded-full ${cls}`}>{children}</div>;
}
