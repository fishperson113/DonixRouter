import { useEffect, useState } from "preact/hooks";
import type {
  Account,
  ProxyAssignment,
  ProxyEntry,
  QuotaWarning,
} from "../types";
import type { FeatureStatsResponse } from "./use-feature-stats";
import type { UsageSummary } from "./use-usage-stats";

const USAGE_POLL_INTERVAL_MS = 1_000;
const ACTIVE_GRACE_MS = 4_000;
const STREAM_REOPEN_BACKOFF_MS = 2_000;

export interface PendingItem {
  entryId: string;
  email?: string;
  model: string;
  count: number;
}

export interface RecentRequest {
  id: string;
  entryId: string;
  email?: string;
  model: string;
  rawModel: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  status: "ok" | "error";
  durationMs: number;
  timestamp: string;
  count?: number;
  firstTimestamp?: string;
}

export interface CatalogModel {
  id: string;
  displayName: string;
  isDefault: boolean;
  supportedReasoningEfforts: {
    reasoningEffort: string;
    description: string;
  }[];
  defaultReasoningEffort: string;
}

export interface AssignmentAccount {
  id: string;
  email: string;
  label?: string;
  status: string;
  proxyId: string;
  proxyName: string;
}

export interface UsageLiveSnapshot {
  summary: UsageSummary;
  pending: PendingItem[];
  pendingTotal: number;
  recentRequests: RecentRequest[];
  activeRequests: PendingItem[];
  errorProvider: string;
  lastSnapshotAt?: string | null;
}

export interface AccountsPayload {
  accounts: Account[];
  warnings: QuotaWarning[];
  warningsUpdatedAt?: string | null;
  authenticated: boolean;
  user: { email?: string; accountId?: string; planType?: string } | null;
  proxy_api_key: string | null;
  pool: { total: number; active: number };
}

export interface ProxiesPayload {
  proxies: ProxyEntry[];
  assignments: ProxyAssignment[];
  healthCheckIntervalMinutes: number;
  accounts: AssignmentAccount[];
}

export interface ModelsPayload {
  models: string[];
  modelCatalog: CatalogModel[];
}

export interface ProviderNodeSnapshot {
  id: string;
  provider: string;
  model: string;
  label: string | null;
  status: string;
  proxyId: string | null;
  cooldownUntil: string | null;
  lastError: string | null;
  errorCount: number;
  lastStatusCode: number | null;
  lastUsedAt: string | null;
  lastRecoveredAt: string | null;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
}

export interface ProviderSummarySnapshot {
  provider: string;
  label: string;
  total: number;
  active: number;
  disabled: number;
  cooldown: number;
  degraded: number;
  healthy: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  models: string[];
  lastUsedAt: string | null;
}

export interface ProviderPoolPayload {
  providers: ProviderSummarySnapshot[];
  nodes: ProviderNodeSnapshot[];
}

export interface DashboardInitPayload {
  accounts: AccountsPayload;
  proxies: ProxiesPayload;
  usage: UsageLiveSnapshot;
  featureStats: FeatureStatsResponse;
  models: ModelsPayload;
  providerPool: ProviderPoolPayload;
}

interface DashboardLiveState {
  initLoading: boolean;
  connected: boolean;
  accounts: AccountsPayload | null;
  proxies: ProxiesPayload | null;
  usage: UsageLiveSnapshot | null;
  featureStats: FeatureStatsResponse | null;
  models: ModelsPayload | null;
  providerPool: ProviderPoolPayload | null;
}

type StreamMessage =
  | { type: "init"; payload: DashboardInitPayload }
  | { type: "accounts"; payload: AccountsPayload }
  | { type: "proxies"; payload: ProxiesPayload }
  | { type: "usage"; payload: UsageLiveSnapshot }
  | { type: "featureStats"; payload: FeatureStatsResponse }
  | { type: "models"; payload: ModelsPayload }
  | { type: "providerPool"; payload: ProviderPoolPayload };

interface HeldPending {
  item: PendingItem;
  lastSeenAt: number;
}

const initialState: DashboardLiveState = {
  initLoading: true,
  connected: false,
  accounts: null,
  proxies: null,
  usage: null,
  featureStats: null,
  models: null,
  providerPool: null,
};

class DashboardLiveStore {
  private state: DashboardLiveState = initialState;
  private listeners = new Set<() => void>();
  private started = false;
  private es: EventSource | null = null;
  private featureStatsTimer: number | null = null;
  private pendingFeatureStats: FeatureStatsResponse | null = null;
  private usagePollTimer: number | null = null;
  private inflightUsageRefresh: Promise<void> | null = null;
  private heldPending = new Map<string, HeldPending>();
  private reopenTimer: number | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DashboardLiveState => this.state;

  start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    void this.loadInit();
    this.openStream();
    this.ensureUsagePolling();
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  setAccountsPayload(payload: AccountsPayload): void {
    this.patch({ accounts: payload });
  }

  setProxiesPayload(payload: ProxiesPayload): void {
    this.patch({ proxies: payload });
  }

  setUsagePayload(payload: UsageLiveSnapshot): void {
    this.patch({ usage: this.reconcileUsagePayload(payload) });
  }

  setModelsPayload(payload: ModelsPayload): void {
    this.patch({ models: payload });
  }

  setProviderPoolPayload(payload: ProviderPoolPayload): void {
    this.patch({ providerPool: payload });
  }

  private patch(patch: Partial<DashboardLiveState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private applyInit(payload: DashboardInitPayload): void {
    this.patch({
      initLoading: false,
      accounts: payload.accounts,
      proxies: payload.proxies,
      usage: this.reconcileUsagePayload(payload.usage),
      featureStats: payload.featureStats,
      models: payload.models,
      providerPool: payload.providerPool,
    });
  }

  private applyMessage(message: StreamMessage): void {
    switch (message.type) {
      case "init":
        this.applyInit(message.payload);
        return;
      case "accounts":
        this.patch({ initLoading: false, accounts: message.payload });
        return;
      case "proxies":
        this.patch({ initLoading: false, proxies: message.payload });
        return;
      case "usage":
        this.patch({
          initLoading: false,
          usage: this.reconcileUsagePayload(message.payload),
        });
        return;
      case "featureStats":
        this.scheduleFeatureStats(message.payload);
        return;
      case "models":
        this.patch({ initLoading: false, models: message.payload });
        return;
      case "providerPool":
        this.patch({ initLoading: false, providerPool: message.payload });
        return;
    }
  }

  private scheduleFeatureStats(payload: FeatureStatsResponse): void {
    this.pendingFeatureStats = payload;
    if (this.featureStatsTimer !== null) return;

    this.featureStatsTimer = window.setTimeout(() => {
      this.featureStatsTimer = null;
      if (!this.pendingFeatureStats) return;
      this.patch({
        initLoading: false,
        featureStats: this.pendingFeatureStats,
      });
      this.pendingFeatureStats = null;
    }, 300);
  }

  private async loadInit(): Promise<void> {
    try {
      const resp = await fetch("/admin/init", { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.applyInit((await resp.json()) as DashboardInitPayload);
    } catch {
      this.patch({ initLoading: false });
    }
  }

  private openStream(): void {
    try {
      this.es?.close();
      this.es = new EventSource("/admin/stream/global");
    } catch {
      return;
    }

    this.es.onopen = () => {
      this.clearReconnectTimer();
      this.patch({ connected: true });
      void this.refreshUsageSnapshot();
    };
    this.es.onmessage = (event) => {
      try {
        this.applyMessage(JSON.parse(event.data) as StreamMessage);
      } catch {
        /* ignore malformed payload */
      }
    };
    this.es.onerror = () => {
      this.patch({ connected: false });
      this.scheduleStreamReopen();
    };
  }

  private handleVisibilityChange = (): void => {
    if (document.hidden) return;
    void this.refreshUsageSnapshot({ preferInit: !this.state.usage });
    if (!this.state.connected) this.scheduleStreamReopen(true);
  };

  private ensureUsagePolling(): void {
    if (this.usagePollTimer !== null) return;
    this.usagePollTimer = window.setInterval(() => {
      void this.pollUsageHealth();
    }, USAGE_POLL_INTERVAL_MS);
  }

  private async pollUsageHealth(): Promise<void> {
    if (typeof document !== "undefined" && document.hidden) return;

    const hasActive =
      this.heldPending.size > 0 ||
      (this.state.usage?.activeRequests.length ?? 0) > 0;

    if (!this.state.connected || hasActive || !this.state.usage) {
      await this.refreshUsageSnapshot({ preferInit: !this.state.usage });
    }

    if (!this.state.connected && (!this.es || this.es.readyState === EventSource.CLOSED)) {
      this.scheduleStreamReopen();
    }
  }

  private async refreshUsageSnapshot(
    options: { preferInit?: boolean } = {},
  ): Promise<void> {
    if (this.inflightUsageRefresh) return this.inflightUsageRefresh;

    this.inflightUsageRefresh = (async () => {
      try {
        const preferInit = options.preferInit && !this.state.accounts;
        const url = preferInit ? "/admin/init" : "/admin/usage-stats/snapshot";
        const resp = await fetch(url, { cache: "no-store" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        if (preferInit) {
          this.applyInit((await resp.json()) as DashboardInitPayload);
        } else {
          this.patch({
            initLoading: false,
            usage: this.reconcileUsagePayload(
              (await resp.json()) as UsageLiveSnapshot,
            ),
          });
        }
      } catch {
        /* best-effort self-heal only */
      } finally {
        this.inflightUsageRefresh = null;
      }
    })();

    return this.inflightUsageRefresh;
  }

  private scheduleStreamReopen(force = false): void {
    if (force) {
      this.clearReconnectTimer();
      this.openStream();
      return;
    }
    if (this.reopenTimer !== null) return;
    this.reopenTimer = window.setTimeout(() => {
      this.reopenTimer = null;
      this.openStream();
    }, STREAM_REOPEN_BACKOFF_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reopenTimer === null) return;
    window.clearTimeout(this.reopenTimer);
    this.reopenTimer = null;
  }

  private reconcileUsagePayload(payload: UsageLiveSnapshot): UsageLiveSnapshot {
    const now = Date.now();
    const incoming = payload.activeRequests?.length
      ? payload.activeRequests
      : payload.pending ?? [];
    const activeByKey = new Map<string, PendingItem>();

    for (const item of incoming) {
      const key = `${item.entryId}|${item.model}`;
      activeByKey.set(key, item);
      this.heldPending.set(key, { item, lastSeenAt: now });
    }

    for (const [key, held] of this.heldPending) {
      if (activeByKey.has(key)) continue;
      if (now - held.lastSeenAt > ACTIVE_GRACE_MS) {
        this.heldPending.delete(key);
      }
    }

    const mergedActive = [...this.heldPending.values()]
      .map((held) => held.item)
      .sort((a, b) => {
        const emailA = a.email ?? "";
        const emailB = b.email ?? "";
        return emailA.localeCompare(emailB) || a.model.localeCompare(b.model);
      });

    return {
      ...payload,
      pending: mergedActive,
      pendingTotal: mergedActive.reduce((sum, item) => sum + item.count, 0),
      activeRequests: mergedActive,
    };
  }
}

const dashboardLiveStore = new DashboardLiveStore();

export function useDashboardLiveSelector<T>(
  selector: (state: DashboardLiveState) => T,
): T {
  const [snapshot, setSnapshot] = useState(() =>
    dashboardLiveStore.getSnapshot(),
  );

  useEffect(() => {
    dashboardLiveStore.start();
    const unsubscribe = dashboardLiveStore.subscribe(() => {
      setSnapshot(dashboardLiveStore.getSnapshot());
    });
    return unsubscribe;
  }, []);

  return selector(snapshot);
}

export function updateDashboardAccounts(payload: AccountsPayload): void {
  dashboardLiveStore.setAccountsPayload(payload);
}

export function updateDashboardProxies(payload: ProxiesPayload): void {
  dashboardLiveStore.setProxiesPayload(payload);
}

export function updateDashboardUsage(payload: UsageLiveSnapshot): void {
  dashboardLiveStore.setUsagePayload(payload);
}

export function updateDashboardModels(payload: ModelsPayload): void {
  dashboardLiveStore.setModelsPayload(payload);
}

export function updateDashboardProviderPool(payload: ProviderPoolPayload): void {
  dashboardLiveStore.setProviderPoolPayload(payload);
}
