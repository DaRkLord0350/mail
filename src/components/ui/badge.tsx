import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "gray" | "green" | "yellow" | "red" | "blue" | "indigo" | "purple" | "slate" | "orange";

const tones: Record<BadgeTone, string> = {
  gray: "bg-slate-100 text-slate-600 ring-slate-500/15",
  slate: "bg-slate-100 text-slate-700 ring-slate-500/20",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  yellow: "bg-amber-50 text-amber-800 ring-amber-600/25",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  purple: "bg-purple-50 text-purple-700 ring-purple-600/20",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/20",
};

const dots: Record<BadgeTone, string> = {
  gray: "bg-slate-400",
  slate: "bg-slate-500",
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-sky-500",
  indigo: "bg-indigo-500",
  purple: "bg-purple-500",
  orange: "bg-orange-500",
};

export function Badge({
  tone = "gray",
  children,
  className,
  dot,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dots[tone])} aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * One colour map for every status in the app (delivery, lead and campaign):
 * SENT/COMPLETED green · PENDING/PAUSED yellow · FAILED/STOPPED red ·
 * SKIPPED/DRAFT gray · PROCESSING/RUNNING blue · READY indigo · SCHEDULED purple.
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  SENT: "green",
  COMPLETED: "green",
  PENDING: "yellow",
  PAUSED: "yellow",
  FAILED: "red",
  STOPPED: "red",
  SKIPPED: "gray",
  DRAFT: "gray",
  PROCESSING: "blue",
  RUNNING: "blue",
  READY: "indigo",
  SCHEDULED: "purple",
};

export function statusTone(status: string): BadgeTone {
  return STATUS_TONES[status] ?? "gray";
}

function titleCase(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = statusTone(status);
  return (
    <Badge tone={tone} dot className={className}>
      {titleCase(status)}
      {status === "RUNNING" || status === "PROCESSING" ? <span className="sr-only"> (in progress)</span> : null}
    </Badge>
  );
}
