import { useState, useEffect, useCallback } from "preact/hooks";
import type { Account } from "../types";
import {
  updateDashboardAccounts,
  useDashboardLiveSelector,
  type AccountsPayload,
} from "./dashboard-live-store";

export function useAccounts() {
  const accountsState = useDashboardLiveSelector((state) => state.accounts);
  const initLoading = useDashboardLiveSelector((state) => state.initLoading);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [addInfo, setAddInfo] = useState("");
  const [addError, setAddError] = useState("");

  useEffect(() => {
    if (accountsState) setLastUpdated(new Date());
  }, [accountsState]);

  const loadAccounts = useCallback(async () => {
    setRefreshing(true);
    try {
      const resp = await fetch("/auth/accounts/snapshot");
      if (resp.ok) {
        updateDashboardAccounts(await resp.json() as AccountsPayload);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Listen for OAuth callback success
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      if (event.data?.type === "oauth-callback-success") {
        setAddVisible(false);
        setAddInfo("accountAdded");
        await loadAccounts();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [loadAccounts]);

  const startAdd = useCallback(async () => {
    setAddInfo("");
    setAddError("");
    try {
      const resp = await fetch("/auth/login-start", { method: "POST" });
      const data = await resp.json();
      if (!resp.ok || !data.authUrl) {
        throw new Error(data.error || "failedStartLogin");
      }
      window.open(data.authUrl, "oauth_add", "width=600,height=700,scrollbars=yes");
      setAddVisible(true);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "failedStartLogin");
    }
  }, []);

  const cancelAdd = useCallback(() => {
    setAddVisible(false);
    setAddInfo("");
    setAddError("");
  }, []);

  const submitRelay = useCallback(
    async (callbackUrl: string) => {
      setAddInfo("");
      setAddError("");
      if (!callbackUrl.trim()) {
        setAddError("pleasePassCallback");
        return;
      }
      try {
        const resp = await fetch("/auth/code-relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callbackUrl }),
        });
        const data = await resp.json();
        if (resp.ok && data.success) {
          setAddVisible(false);
          setAddInfo("accountAdded");
          await loadAccounts();
        } else {
          setAddError(data.error || "failedExchangeCode");
        }
      } catch (err) {
        setAddError(
          "networkError" + (err instanceof Error ? err.message : String(err))
        );
      }
    },
    [loadAccounts]
  );

  const addByRefreshToken = useCallback(async (refreshToken: string): Promise<string | null> => {
    setAddInfo("");
    setAddError("");
    try {
      const resp = await fetch("/auth/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const msg = data.error || "Failed to add account";
        setAddError(msg);
        return msg;
      }
      setAddInfo("accountAdded");
      await loadAccounts();
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAddError(msg);
      return msg;
    }
  }, [loadAccounts]);

  const deleteAccount = useCallback(
    async (id: string) => {
      try {
        const resp = await fetch("/auth/accounts/" + encodeURIComponent(id), {
          method: "DELETE",
        });
        if (!resp.ok) {
          const data = await resp.json();
          return data.error || "failedDeleteAccount";
        }
        await loadAccounts();
        return null;
      } catch (err) {
        return "networkError" + (err instanceof Error ? err.message : "");
      }
    },
    [loadAccounts]
  );

  const patchLocal = useCallback((accountId: string, patch: Partial<Account>) => {
    if (!accountsState) return;
    updateDashboardAccounts({
      ...accountsState,
      accounts: accountsState.accounts.map((a) => a.id === accountId ? { ...a, ...patch } : a),
    });
  }, [accountsState]);

  const exportAccounts = useCallback(async (selectedIds?: string[], format?: "full" | "minimal") => {
    const params = new URLSearchParams();
    if (selectedIds && selectedIds.length > 0) params.set("ids", selectedIds.join(","));
    if (format === "minimal") params.set("format", "minimal");
    const qs = params.toString() ? `?${params.toString()}` : "";
    const resp = await fetch(`/auth/accounts/export${qs}`);
    const data = await resp.json() as { accounts: Array<{ id: string }> };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    const suffix = format === "minimal" ? "-minimal" : "";
    a.download = `accounts-export${suffix}-${date}.json`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const importAccounts = useCallback(async (file: File): Promise<{
    success: boolean;
    added: number;
    updated: number;
    failed: number;
    errors: string[];
  }> => {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { success: false, added: 0, updated: 0, failed: 0, errors: ["Invalid JSON file"] };
    }
    const accounts = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { accounts?: unknown[] }).accounts)
        ? (parsed as { accounts: unknown[] }).accounts
        : null;
    if (!accounts) {
      return { success: false, added: 0, updated: 0, failed: 0, errors: ["Invalid format: expected { accounts: [...] }"] };
    }

    const resp = await fetch("/auth/accounts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts }),
    });
    const result = await resp.json();
    if (resp.ok) {
      await loadAccounts();
    }
    return { added: 0, updated: 0, failed: 0, errors: [], ...result };
  }, [loadAccounts]);

  const batchDelete = useCallback(async (ids: string[]): Promise<string | null> => {
    try {
      const resp = await fetch("/auth/accounts/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        return data.error || "Batch delete failed";
      }
      await loadAccounts();
      return null;
    } catch (err) {
      return "networkError" + (err instanceof Error ? err.message : "");
    }
  }, [loadAccounts]);

  const batchSetStatus = useCallback(async (ids: string[], status: "active" | "disabled"): Promise<string | null> => {
    try {
      const resp = await fetch("/auth/accounts/batch-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        return data.error || "Batch status change failed";
      }
      await loadAccounts();
      return null;
    } catch (err) {
      return "networkError" + (err instanceof Error ? err.message : "");
    }
  }, [loadAccounts]);

  const toggleStatus = useCallback(async (id: string, currentStatus: string): Promise<string | null> => {
    const newStatus = currentStatus === "disabled" ? "active" : "disabled";
    return batchSetStatus([id], newStatus);
  }, [batchSetStatus]);

  const updateLabel = useCallback(async (id: string, label: string | null): Promise<string | null> => {
    try {
      const resp = await fetch(`/auth/accounts/${encodeURIComponent(id)}/label`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        return data.error || "Failed to update label";
      }
      patchLocal(id, { label: label ?? undefined });
      return null;
    } catch (err) {
      return "networkError" + (err instanceof Error ? err.message : "");
    }
  }, [patchLocal]);

  return {
    list: accountsState?.accounts ?? [],
    warnings: accountsState?.warnings ?? [],
    loading: initLoading && !accountsState,
    refreshing,
    lastUpdated,
    addVisible,
    addInfo,
    addError,
    refresh: loadAccounts,
    patchLocal,
    startAdd,
    cancelAdd,
    submitRelay,
    addByRefreshToken,
    deleteAccount,
    exportAccounts,
    importAccounts,
    batchDelete,
    batchSetStatus,
    toggleStatus,
    updateLabel,
  };
}
