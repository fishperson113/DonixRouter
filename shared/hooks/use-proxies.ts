import { useCallback } from "preact/hooks";
import type { ProxyEntry, ProxyAssignment } from "../types";
import {
  updateDashboardProxies,
  useDashboardLiveSelector,
  type ProxiesPayload,
} from "./dashboard-live-store";

export interface AddProxyFields {
  name: string;
  protocol: string;
  host: string;
  port: string;
  username: string;
  password: string;
}

export interface ProxiesState {
  proxies: ProxyEntry[];
  assignments: ProxyAssignment[];
  healthCheckIntervalMinutes: number;
  loading: boolean;
  refresh: () => Promise<void>;
  addProxy: (fields: AddProxyFields) => Promise<string | null>;
  removeProxy: (id: string) => Promise<string | null>;
  checkProxy: (id: string) => Promise<void>;
  checkAll: () => Promise<void>;
  enableProxy: (id: string) => Promise<void>;
  disableProxy: (id: string) => Promise<void>;
  assignProxy: (accountId: string, proxyId: string) => Promise<void>;
  unassignProxy: (accountId: string) => Promise<void>;
  setInterval: (minutes: number) => Promise<void>;
}

export function useProxies(): ProxiesState {
  const proxiesState = useDashboardLiveSelector((state) => state.proxies);
  const initLoading = useDashboardLiveSelector((state) => state.initLoading);

  const refresh = useCallback(async () => {
    const resp = await fetch("/api/proxies/snapshot");
    if (resp.ok) {
      updateDashboardProxies(await resp.json() as ProxiesPayload);
    }
  }, []);

  const addProxy = useCallback(
    async (fields: AddProxyFields): Promise<string | null> => {
      try {
        const resp = await fetch("/api/proxies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: fields.name,
            protocol: fields.protocol,
            host: fields.host,
            port: fields.port,
            username: fields.username,
            password: fields.password,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) return data.error || "Failed to add proxy";
        await refresh();
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : "Network error";
      }
    },
    [refresh],
  );

  const removeProxy = useCallback(
    async (id: string): Promise<string | null> => {
      try {
        const resp = await fetch(`/api/proxies/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!resp.ok) {
          const data = await resp.json();
          return data.error || "Failed to remove proxy";
        }
        await refresh();
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : "Network error";
      }
    },
    [refresh],
  );

  const checkProxy = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/proxies/${encodeURIComponent(id)}/check`, {
          method: "POST",
        });
      } catch {
        /* ignore */
      }
      await refresh();
    },
    [refresh],
  );

  const checkAll = useCallback(async () => {
    try {
      await fetch("/api/proxies/check-all", { method: "POST" });
    } catch {
      /* ignore */
    }
    await refresh();
  }, [refresh]);

  const enableProxy = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/proxies/${encodeURIComponent(id)}/enable`, {
          method: "POST",
        });
      } catch {
        /* ignore */
      }
      await refresh();
    },
    [refresh],
  );

  const disableProxy = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/proxies/${encodeURIComponent(id)}/disable`, {
          method: "POST",
        });
      } catch {
        /* ignore */
      }
      await refresh();
    },
    [refresh],
  );

  const assignProxy = useCallback(
    async (accountId: string, proxyId: string) => {
      try {
        await fetch("/api/proxies/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, proxyId }),
        });
      } catch {
        /* ignore */
      }
      await refresh();
    },
    [refresh],
  );

  const unassignProxy = useCallback(
    async (accountId: string) => {
      try {
        await fetch(`/api/proxies/assign/${encodeURIComponent(accountId)}`, {
          method: "DELETE",
        });
      } catch {
        /* ignore */
      }
      await refresh();
    },
    [refresh],
  );

  const setIntervalMinutes = useCallback(
    async (minutes: number) => {
      try {
        await fetch("/api/proxies/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ healthCheckIntervalMinutes: minutes }),
        });
      } catch {
        /* ignore */
      }
      await refresh();
    },
    [refresh],
  );

  return {
    proxies: proxiesState?.proxies ?? [],
    assignments: proxiesState?.assignments ?? [],
    healthCheckIntervalMinutes: proxiesState?.healthCheckIntervalMinutes ?? 5,
    loading: initLoading && !proxiesState,
    refresh,
    addProxy,
    removeProxy,
    checkProxy,
    checkAll,
    enableProxy,
    disableProxy,
    assignProxy,
    unassignProxy,
    setInterval: setIntervalMinutes,
  };
}
