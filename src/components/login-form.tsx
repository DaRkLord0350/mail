"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { api, ApiClientError } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { errorMessage, safeNextPath } from "@/lib/utils";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The submit button is disabled while pending, which drops focus to <body>; put it back on the field.
  function refocus() {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Enter the admin password.");
      refocus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { password });
      router.replace(safeNextPath(next));
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) setError("Incorrect password.");
      else if (err instanceof ApiClientError && err.status === 429) setError("Too many attempts. Please wait a minute and try again.");
      else setError(errorMessage(err));
      setPending(false);
      refocus();
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
            <Mail className="size-5" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-xl font-bold tracking-[0.2em] text-slate-900">MAIL</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to the outreach dashboard</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm" noValidate>
          <Field label="Password" htmlFor="password" error={error}>
            <Input
              id="password"
              ref={inputRef}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "password-error" : undefined}
            />
          </Field>
          <Button type="submit" className="w-full" loading={pending}>
            Sign in
          </Button>
        </form>
      </div>
    </main>
  );
}
