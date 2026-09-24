"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn, formatNumber } from "@/lib/utils";

export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
}

/** Underline-style tabs. Scrolls horizontally inside itself on narrow screens. */
export function Tabs<V extends string>({
  tabs,
  value,
  onChange,
  className,
  ariaLabel,
  idPrefix,
}: {
  tabs: TabItem<V>[];
  value: V;
  onChange: (v: V) => void;
  className?: string;
  ariaLabel: string;
  idPrefix?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const idx = tabs.findIndex((t) => t.value === value);
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    onChange(tabs[next].value);
    const btn = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
    btn?.focus();
  }

  return (
    <div className={cn("-mx-1 overflow-x-auto px-1", className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="flex min-w-max gap-1 border-b border-slate-200"
      >
        {tabs.map((t) => {
          const active = t.value === value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              id={idPrefix ? `${idPrefix}-tab-${t.value}` : undefined}
              aria-selected={active}
              aria-controls={idPrefix ? `${idPrefix}-panel` : undefined}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(t.value)}
              className={cn(
                "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none",
                active ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
              )}
            >
              {t.icon}
              {t.label}
              {typeof t.count === "number" && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums",
                    active ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {formatNumber(t.count)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
