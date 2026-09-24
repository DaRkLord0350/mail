import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <>
      <LoaderCircle className={cn("size-4 animate-spin", className)} aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </>
  );
}

export function PageSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500" role="status">
      <Spinner className="size-5" />
      <span>{label}</span>
    </div>
  );
}
