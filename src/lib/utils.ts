import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const numberFmt = new Intl.NumberFormat();
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Sep 24, 2026, 4:21 PM" */
export function formatDateTime(value: string | Date | null | undefined, fallback = "—"): string {
  const d = toDate(value);
  return d ? dateTimeFmt.format(d) : fallback;
}

/** "Sep 24, 2026" */
export function formatDate(value: string | Date | null | undefined, fallback = "—"): string {
  const d = toDate(value);
  return d ? dateFmt.format(d) : fallback;
}

/** Date/time rendered in a given IANA timezone. */
export function formatDateTimeInZone(value: string | Date | null | undefined, timeZone: string, fallback = "—") {
  const d = toDate(value);
  if (!d) return fallback;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(d) + ` (${timeZone})`;
  } catch {
    return dateTimeFmt.format(d);
  }
}

const REL_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** "3 minutes ago" / "in 2 hours" */
/** True when a scheduled time has already passed (e.g. a queued email that is due now). */
export function isDue(value: string | Date | null | undefined): boolean {
  const d = toDate(value);
  return !!d && d.getTime() <= Date.now();
}

export function formatRelative(value: string | Date | null | undefined, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return diffSec > 0 ? "in a few seconds" : "just now";
  for (const [unit, secs] of REL_UNITS) {
    if (abs >= secs) return relFmt.format(Math.round(diffSec / secs), unit);
  }
  return fallback;
}

export function formatNumber(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? numberFmt.format(n) : "—";
}

export function formatPercent(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function pluralize(n: number, singular: string, plural = `${singular}s`) {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

/** Same normalisation the server uses for a CSV header -> variable key ("Company Name" -> "company_name"). */
export function toVariableKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function leadDisplayName(lead: {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
}): string {
  const full = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  return full || lead.displayName || "";
}

/** Only allow same-origin relative redirect targets. */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/")) return fallback;
  // Control chars (tab/newline) are stripped by URL parsers: "/\t/evil.com" -> "//evil.com".
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, "http://mail.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://mail.invalid" || url.pathname.startsWith("/login")) return fallback;
  return url.pathname + url.search + url.hash;
}
