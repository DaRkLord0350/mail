"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { errorMessage } from "@/lib/utils";

interface QueryState<T> {
  key: string | null;
  data: T | undefined;
  error: string | null;
  status: number | null;
}

export interface QueryResult<T> {
  data: T | undefined;
  error: string | null;
  /** HTTP status of the last error (e.g. 404), if any. */
  errorStatus: number | null;
  /** True while the first response for the current URL has not arrived yet. */
  loading: boolean;
  reload: () => void;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

/**
 * Minimal GET hook. Keeps the previous data while a new URL loads (so tables
 * don't flash), optionally polls, and pauses polling while the tab is hidden.
 */
export function useApiQuery<T>(url: string | null, options: { refreshMs?: number } = {}): QueryResult<T> {
  const { refreshMs } = options;
  const [state, setState] = useState<QueryState<T>>({ key: null, data: undefined, error: null, status: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const run = () => {
      api.get<T>(url).then(
        (data) => {
          if (!cancelled) setState({ key: url, data, error: null, status: null });
        },
        (err: unknown) => {
          if (cancelled) return;
          const status = err instanceof ApiClientError ? err.status : null;
          setState((prev) => ({
            key: url,
            data: prev.key === url ? prev.data : undefined,
            error: errorMessage(err),
            status,
          }));
        },
      );
    };
    run();
    let timer: ReturnType<typeof setInterval> | undefined;
    if (refreshMs && refreshMs > 0) {
      timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        run();
      }, refreshMs);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [url, nonce, refreshMs]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setState((prev) => ({
      ...prev,
      data: typeof updater === "function" ? (updater as (p: T | undefined) => T)(prev.data) : updater,
    }));
  }, []);

  const current = state.key === url;
  return {
    data: state.data,
    error: current ? state.error : null,
    errorStatus: current ? state.status : null,
    loading: url !== null && !current,
    reload,
    setData,
  };
}

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const USAGE_EVENT = "mail:usage-changed";

/** Ask the top-bar usage meter (and anything else listening) to refresh now. */
export function notifyUsageChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(USAGE_EVENT));
}

export function useUsageChanged(handler: () => void) {
  useEffect(() => {
    window.addEventListener(USAGE_EVENT, handler);
    return () => window.removeEventListener(USAGE_EVENT, handler);
  }, [handler]);
}

/** Warn before closing/reloading the tab with unsaved changes. */
export function useBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}

const FALLBACK_ZONES = [
  "Asia/Kolkata",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function listTimezones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    if (zones.length) return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    // older browsers
  }
  return FALLBACK_ZONES;
}
