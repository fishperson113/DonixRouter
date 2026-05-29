import { useDashboardLiveSelector } from "./dashboard-live-store";

export interface RtkAggregateStats {
  requests: number;
  hitRequests: number;
  bytesBefore: number;
  bytesAfter: number;
  hits: number;
  byFilter: Record<string, { hits: number; saved: number }>;
}

export interface PrefetchAggregateStats {
  requests: number;
  attempts: number;
  ok: number;
  failed: number;
  bytesAdded: number;
  msTotal: number;
}

export interface InRequestRefreshStats {
  attempts: number;
  succeeded: number;
  failed: number;
}

export interface FeatureStatsConfig {
  rtk: { enabled: boolean; log: boolean };
  codex: {
    prefetch_images: boolean;
    image_prefetch_timeout_ms: number;
    image_prefetch_concurrency: number;
    in_request_token_refresh: boolean;
    normalize_input: boolean;
  };
}

export interface FeatureStatsResponse {
  rtk: RtkAggregateStats;
  prefetch: PrefetchAggregateStats;
  inRequestRefresh: InRequestRefreshStats;
  config: FeatureStatsConfig;
}

export function useFeatureStats() {
  return useDashboardLiveSelector((state) => ({
    data: state.featureStats,
    loading: state.initLoading && !state.featureStats,
    refresh: async () => undefined,
  }));
}
