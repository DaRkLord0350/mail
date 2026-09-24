"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Search } from "lucide-react";
import { qs } from "@/lib/client/api";
import { useApiQuery, useDebouncedValue } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

export interface LeadOption {
  id: string;
  email: string;
  name: string;
  companyName: string | null;
}

export function leadOptionLabel(o: LeadOption) {
  const who = o.name || o.email;
  return o.companyName ? `${who} - ${o.companyName}` : who;
}

/**
 * Searchable combobox backed by GET /api/leads/options?search=.
 * When `autoSelectFirst` is set and nothing is selected, the first result is picked.
 */
export function LeadSelect({
  id,
  value,
  onChange,
  autoSelectFirst,
  className,
  onEmpty,
}: {
  id?: string;
  value: LeadOption | null;
  onChange: (lead: LeadOption) => void;
  autoSelectFirst?: boolean;
  className?: string;
  /** Called once when the initial (unfiltered) option list is empty. */
  onEmpty?: () => void;
}) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-lead`;
  const listId = `${autoId}-list`;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(search, 250);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, loading } = useApiQuery<{ items: LeadOption[] }>(`/api/leads/options${qs({ search: debounced.trim() })}`);
  const items = data?.items ?? [];

  // Auto-select the first lead once options arrive.
  const onChangeRef = useRef(onChange);
  const onEmptyRef = useRef(onEmpty);
  useEffect(() => {
    onChangeRef.current = onChange;
    onEmptyRef.current = onEmpty;
  }, [onChange, onEmpty]);
  useEffect(() => {
    if (!autoSelectFirst || value || !data || debounced) return;
    if (data.items[0]) onChangeRef.current(data.items[0]);
    else onEmptyRef.current?.();
  }, [autoSelectFirst, value, data, debounced]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function choose(o: LeadOption) {
    onChange(o);
    setOpen(false);
    setSearch("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      if (open && items[active]) {
        e.preventDefault();
        choose(items[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${listId}-${items[active].id}` : undefined}
          autoComplete="off"
          placeholder={value ? leadOptionLabel(value) : "Search leads by name, company or email…"}
          value={open ? search : value ? leadOptionLabel(value) : ""}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onChange={(e) => {
            setSearch(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="h-9 w-full truncate rounded-lg border border-slate-300 bg-white pr-9 pl-9 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none"
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-slate-400">
          {loading && open ? <Spinner className="size-4" /> : <ChevronDown className="size-4" aria-hidden="true" />}
        </span>
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Leads"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">{loading ? "Searching…" : "No leads found"}</li>
          ) : (
            items.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${o.id}`}
                role="option"
                aria-selected={value?.id === o.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                onMouseEnter={() => setActive(i)}
                className={cn("cursor-pointer px-3 py-2 text-sm", i === active ? "bg-indigo-50" : "", value?.id === o.id && "font-medium")}
              >
                <div className="truncate text-slate-900">{leadOptionLabel(o)}</div>
                <div className="truncate text-xs text-slate-500">{o.email}</div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
