/**
 * Hooks for fetching usage stats data.
 */

import { useState, useEffect, useCallback } from "preact/hooks";
import { useDashboardLiveSelector } from "./dashboard-live-store";

export interface UsageSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cached_tokens: number;
  total_image_input_tokens: number;
  total_image_output_tokens: number;
  total_image_request_count: number;
  total_image_request_failed_count: number;
  total_request_count: number;
  total_accounts: number;
  active_accounts: number;
}

export interface UsageDataPoint {
  timestamp: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  image_input_tokens: number;
  image_output_tokens: number;
  image_request_count: number;
  image_request_failed_count: number;
  request_count: number;
}

export type Granularity = "raw" | "five_min" | "hourly" | "daily";
export type UsageHistoryRange = number | "all";

const FETCH_TIMEOUT_MS = 15_000;

export function useUsageSummary() {
  return useDashboardLiveSelector((state) => ({
    summary: state.usage?.summary ?? null,
    loading: state.initLoading && !state.usage,
  }));
}

export function useUsageHistory(granularity: Granularity, hours: UsageHistoryRange) {
  const [dataPoints, setDataPoints] = useState<UsageDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const historyVersion = useDashboardLiveSelector((state) => state.usage?.lastSnapshotAt ?? null);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const resp = await fetch(
        `/admin/usage-stats/history?granularity=${granularity}&hours=${hours}`,
        { signal },
      );
      if (resp.ok) {
        const body = await resp.json();
        if (signal.aborted) return;
        setDataPoints(body.data_points);
      }
    } catch {
      /* network error / timeout / abort */
    } finally {
      if (signal.aborted) return;
      setLoading(false);
    }
  }, [granularity, hours]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    setLoading(true);
    setDataPoints([]);
    void load(controller.signal);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [load, historyVersion]);

  return { dataPoints, loading };
}
