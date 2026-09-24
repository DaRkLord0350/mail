"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center" role="alert">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600">
        <TriangleAlert className="size-6" />
      </div>
      <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
      <p className="mt-2 text-sm break-words text-slate-500">{error.message || "An unexpected error occurred while rendering this page."}</p>
      {error.digest && <p className="mt-1 font-mono text-xs text-slate-400">Ref: {error.digest}</p>}
      <div className="mt-6 flex gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <ButtonLink href="/" variant="secondary">
          Go to dashboard
        </ButtonLink>
      </div>
    </div>
  );
}
