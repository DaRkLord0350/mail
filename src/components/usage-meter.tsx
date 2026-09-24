"use client";

import type { UsageDTO } from "@/lib/types";
import { useApiQuery, useUsageChanged } from "@/lib/client/hooks";
import { cn, formatNumber } from "@/lib/utils";

export function usageTone(sent: number, limit: number): "ok" | "warn" | "full" {
  if (limit <= 0) return "full";
  const ratio = sent / limit;
  if (ratio >= 1) return "full";
  if (ratio >= 0.8) return "warn";
  return "ok";
}

const toneText = { ok: "text-emerald-700", warn: "text-amber-700", full: "text-red-700" };
const toneBar = { ok: "bg-emerald-500", warn: "bg-amber-500", full: "bg-red-500" };
const toneBg = { ok: "bg-emerald-50 ring-emerald-600/15", warn: "bg-amber-50 ring-amber-600/20", full: "bg-red-50 ring-red-600/20" };

/** Compact top-bar meter. Polls /api/usage every 30 s and on `notifyUsageChanged()`. */
export function UsageMeter() {
  const { data, error, reload } = useApiQuery<UsageDTO>("/api/usage", { refreshMs: 30_000 });
  useUsageChanged(reload);

  if (!data) {
    return (
      <div className="h-8 w-40 animate-pulse rounded-lg bg-slate-100" aria-hidden={!error} title={error ?? undefined}>
        {error && <span className="sr-only">Usage unavailable</span>}
      </div>
    );
  }

  const tone = usageTone(data.sent, data.limit);
  const pct = data.limit > 0 ? Math.min(100, (data.sent / data.limit) * 100) : 100;
  return (
    <div
      className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 ring-1 ring-inset", toneBg[tone])}
      title={`${formatNumber(data.remaining)} remaining today (${data.timezone})`}
    >
      <p className={cn("text-xs font-medium whitespace-nowrap tabular-nums", toneText[tone])}>
        Today&apos;s usage:{" "}
        <span className="font-semibold">{formatNumber(data.sent)}</span> / {formatNumber(data.limit)}
      </p>
      <div
        className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-white/80 sm:block"
        role="progressbar"
        aria-label="Daily sending quota used"
        aria-valuemin={0}
        aria-valuemax={data.limit}
        aria-valuenow={data.sent}
      >
        <div className={cn("h-full rounded-full transition-[width]", toneBar[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
