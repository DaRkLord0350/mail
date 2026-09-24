"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ListSkeleton } from "@/components/ui/feedback";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Server sort key; makes the header clickable. */
  sortKey?: string;
  className?: string;
  headerClassName?: string;
  /** Hide in the stacked mobile card layout. */
  hideOnMobile?: boolean;
  /** Rendered as the card title on mobile (first such column wins). */
  primary?: boolean;
  /** Omit the "label:" prefix in mobile cards. */
  mobileNoLabel?: boolean;
}

export interface SortState {
  key: string;
  order: "asc" | "desc";
}

/**
 * Responsive table: a real <table> from `md` up, stacked cards below.
 * Rows can be clickable (mouse + Enter/Space keyboard).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowLabel,
  loading,
  empty,
  sort,
  onSortChange,
  caption,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Accessible label for a clickable row, e.g. "Open lead Rahul". */
  rowLabel?: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  sort?: SortState;
  onSortChange?: (s: SortState) => void;
  caption: string;
  rowClassName?: (row: T) => string | undefined;
}) {
  if (!rows) return <ListSkeleton />;
  if (rows.length === 0) return <>{empty}</>;

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile);

  function onKey(e: KeyboardEvent, row: T) {
    if (!onRowClick) return;
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick(row);
    }
  }

  function toggleSort(key: string) {
    if (!onSortChange) return;
    if (sort?.key === key) onSortChange({ key, order: sort.order === "asc" ? "desc" : "asc" });
    else onSortChange({ key, order: "asc" });
  }

  return (
    <div className={cn("relative transition-opacity", loading && "opacity-60")} aria-busy={loading || undefined}>
      {/* Desktop */}
      {/* `relative` keeps absolutely-positioned sr-only content inside the scroll container. */}
      <div className="relative hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              {columns.map((c) => {
                const active = sort?.key === c.sortKey;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={c.sortKey && active ? (sort?.order === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("px-4 py-2.5 text-xs font-semibold tracking-wide whitespace-nowrap text-slate-500 uppercase first:pl-5 last:pr-5", c.headerClassName)}
                  >
                    {c.sortKey && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.sortKey!)}
                        className="-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
                      >
                        {c.header}
                        {active ? (
                          sort?.order === "asc" ? (
                            <ArrowUp className="size-3.5 text-indigo-600" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="size-3.5 text-indigo-600" aria-hidden="true" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3.5 text-slate-300" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => onKey(e, row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={onRowClick && rowLabel ? rowLabel(row) : undefined}
                className={cn(
                  "align-middle",
                  onRowClick &&
                    "cursor-pointer hover:bg-slate-50 focus-visible:bg-indigo-50/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500",
                  rowClassName?.(row),
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-3 text-slate-700 first:pl-5 last:pr-5", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <div
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              aria-label={onRowClick && rowLabel ? rowLabel(row) : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => onKey(e, row) : undefined}
              className={cn(
                "space-y-2 px-4 py-3",
                onRowClick && "cursor-pointer active:bg-slate-50 focus-visible:bg-indigo-50/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500",
                rowClassName?.(row),
              )}
            >
              <div className="min-w-0 font-medium text-slate-900">{primary.cell(row)}</div>
              {rest.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {rest.map((c) => (
                    <div key={c.key} className="min-w-0">
                      {!c.mobileNoLabel && <dt className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{c.header}</dt>}
                      <dd className="min-w-0 break-words text-slate-700">{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
