import { useCallback } from "preact/hooks";
import type { ProxyEntry } from "../types";
import {
  updateDashboardProxies,
  useDashboardLiveSelector,
  type AssignmentAccount,
  type ProxiesPayload,
} from "./dashboard-live-store";

export type { AssignmentAccount } from "./dashboard-live-store";

export interface ImportDiff {
  changes: Array<{ email: string; accountId: string; from: string; to: string }>;
  unchanged: number;
}

export interface ProxyAssignmentsState {
  accounts: AssignmentAccount[];
  proxies: ProxyEntry[];
  loading: boolean;
  refresh: () => Promise<void>;
  assignBulk: (assignments: Array<{ accountId: string; proxyId: string }>) => Promise<void>;
  assignRule: (accountIds: string[], rule: string, targetProxyIds: string[]) => Promise<void>;
  exportAssignments: () => Promise<Array<{ email: string; proxyId: string }>>;
  importPreview: (data: Array<{ email: string; proxyId: string }>) => Promise<ImportDiff | null>;
  applyImport: (assignments: Array<{ accountId: string; proxyId: string }>) => Promise<void>;
}

export function useProxyAssignments(): ProxyAssignmentsState {
  const proxiesState = useDashboardLiveSelector((state) => state.proxies);
  const initLoading = useDashboardLiveSelector((state) => state.initLoading);

  const refresh = useCallback(async () => {
    const resp = await fetch("/api/proxies/snapshot");
    if (resp.ok) {
      updateDashboardProxies(await resp.json() as ProxiesPayload);
    }
  }, []);

  const assignBulk = useCallback(
    async (assignments: Array<{ accountId: string; proxyId: string }>) => {
      const resp = await fetch("/api/proxies/assign-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        throw new Error((err as { error?: string }).error ?? "Request failed");
      }
      await refresh();
    },
    [refresh],
  );

  const assignRule = useCallback(
    async (accountIds: string[], rule: string, targetProxyIds: string[]) => {
      const resp = await fetch("/api/proxies/assign-rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds, rule, targetProxyIds }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        throw new Error((err as { error?: string }).error ?? "Request failed");
      }
      await refresh();
    },
    [refresh],
  );

  const exportAssignments = useCallback(async (): Promise<Array<{ email: string; proxyId: string }>> => {
    const resp = await fetch("/api/proxies/assignments/export");
    if (!resp.ok) return [];
    const data: { assignments?: Array<{ email: string; proxyId: string }> } = await resp.json();
    return data.assignments || [];
  }, []);

  const importPreview = useCallback(
    async (data: Array<{ email: string; proxyId: string }>): Promise<ImportDiff | null> => {
      const resp = await fetch("/api/proxies/assignments/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments: data }),
      });
      if (!resp.ok) return null;
      const result: ImportDiff = await resp.json();
      return result;
    },
    [],
  );

  const applyImport = useCallback(
    async (assignments: Array<{ accountId: string; proxyId: string }>) => {
      const resp = await fetch("/api/proxies/assignments/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        throw new Error((err as { error?: string }).error ?? "Request failed");
      }
      await refresh();
    },
    [refresh],
  );

  return {
    accounts: proxiesState?.accounts ?? [],
    proxies: proxiesState?.proxies ?? [],
    loading: initLoading && !proxiesState,
    refresh,
    assignBulk,
    assignRule,
    exportAssignments,
    importPreview,
    applyImport,
  };
}
