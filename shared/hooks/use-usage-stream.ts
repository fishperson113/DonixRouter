/**
 * use-usage-stream - realtime usage snapshot sourced from the global
 * dashboard SSE connection.
 */

import { useDashboardLiveSelector } from "./dashboard-live-store";

export type {
  PendingItem,
  RecentRequest,
  UsageLiveSnapshot,
} from "./dashboard-live-store";

export function useUsageStream() {
  return useDashboardLiveSelector((state) => ({
    snapshot: state.usage,
    connected: state.connected,
    loading: state.initLoading && !state.usage,
  }));
}
