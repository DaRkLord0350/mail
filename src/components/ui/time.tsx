"use client";

import { cn, formatDateTime, formatRelative, isDue } from "@/lib/utils";

/** Relative time with the absolute timestamp as tooltip, e.g. "5 minutes ago". */
export function TimeAgo({ value, fallback = "—", className }: { value: string | null | undefined; fallback?: string; className?: string }) {
  if (!value) return <span className={className}>{fallback}</span>;
  return (
    <time dateTime={value} title={formatDateTime(value)} className={className} suppressHydrationWarning>
      {formatRelative(value)}
    </time>
  );
}

/** Absolute timestamp with relative time underneath. */
export function DateStack({ value, fallback = "—" }: { value: string | null | undefined; fallback?: string }) {
  if (!value) return <span className="text-slate-400">{fallback}</span>;
  return (
    <span className="flex flex-col" suppressHydrationWarning>
      <time dateTime={value} className="whitespace-nowrap text-slate-900">
        {formatDateTime(value)}
      </time>
      <span className="text-xs text-slate-500">{formatRelative(value)}</span>
    </span>
  );
}

/** Future time for something scheduled: "in 5 minutes", or "Due now" once it has passed (never "5 minutes ago"). */
export function DueTime({ value, fallback = "—", className }: { value: string | null | undefined; fallback?: string; className?: string }) {
  if (!value) return <span className={className}>{fallback}</span>;
  return (
    <time dateTime={value} title={formatDateTime(value)} className={cn(isDue(value) && "font-medium text-amber-700", className)} suppressHydrationWarning>
      {isDue(value) ? "Due now" : formatRelative(value)}
    </time>
  );
}
