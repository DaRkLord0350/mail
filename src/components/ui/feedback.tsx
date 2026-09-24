import type { ReactNode } from "react";
import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && (
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 [&_svg]:size-5">{icon}</div>
      )}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Couldn't load this",
  message,
  onRetry,
  action,
  className,
}: {
  title?: string;
  message?: string | null;
  onRetry?: () => void;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)} role="alert">
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-red-50 text-red-600">
        <TriangleAlert className="size-5" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {message && <p className="mt-1 max-w-md text-sm break-words text-slate-500">{message}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

type AlertTone = "info" | "warning" | "error" | "success";

const alertStyles: Record<AlertTone, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

const alertIcons: Record<AlertTone, ReactNode> = {
  info: <Info className="size-4 text-sky-600" />,
  warning: <TriangleAlert className="size-4 text-amber-600" />,
  error: <CircleX className="size-4 text-red-600" />,
  success: <CircleCheck className="size-4 text-emerald-600" />,
};

export function Alert({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-start", alertStyles[tone], className)}
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
    >
      <div className="flex min-w-0 flex-1 gap-2.5">
        <span className="mt-0.5 shrink-0">{alertIcons[tone]}</span>
        <div className="min-w-0 space-y-1">
          {title && <p className="font-medium">{title}</p>}
          {children && <div className="break-words opacity-90">{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-slate-200/70", className)} aria-hidden="true" />;
}

export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("divide-y divide-slate-100", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="ml-auto h-5 w-16 rounded-full" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <Skeleton className="h-14 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function ProgressBar({
  segments,
  max,
  className,
  label,
  size = "md",
}: {
  segments: { value: number; className: string; label?: string }[];
  max: number;
  className?: string;
  label: string;
  size?: "sm" | "md" | "lg";
}) {
  const total = Math.max(max, 0);
  const done = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  const heights = { sm: "h-1.5", md: "h-2", lg: "h-3" };
  return (
    <div
      className={cn("flex w-full overflow-hidden rounded-full bg-slate-100", heights[size], className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total || 100}
      aria-valuenow={Math.min(done, total || 100)}
    >
      {total > 0 &&
        segments.map((s, i) =>
          s.value > 0 ? (
            <div
              key={i}
              className={cn("h-full transition-[width] duration-500", s.className)}
              style={{ width: `${Math.min(100, (s.value / total) * 100)}%` }}
              title={s.label}
            />
          ) : null,
        )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "slate",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "slate" | "indigo" | "green" | "yellow" | "red" | "gray" | "blue" | "purple";
  className?: string;
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    indigo: "bg-indigo-50 text-indigo-600",
    green: "bg-emerald-50 text-emerald-600",
    yellow: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    gray: "bg-slate-100 text-slate-500",
    blue: "bg-sky-50 text-sky-600",
    purple: "bg-purple-50 text-purple-600",
  };
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
        {icon && <span className={cn("flex size-7 items-center justify-center rounded-lg [&_svg]:size-3.5", tones[tone])}>{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && <div className="mb-2">{back}</div>}
        <h1 className="text-xl font-semibold tracking-tight break-words text-slate-900 sm:text-2xl">{title}</h1>
        {description && <div className="mt-1 text-sm text-slate-500">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KeyValue({ label, children, mono }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 py-2 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-xs font-medium text-slate-500 sm:text-sm">{label}</dt>
      <dd className={cn("min-w-0 text-sm break-words text-slate-900", mono && "font-mono text-xs")}>{children}</dd>
    </div>
  );
}
