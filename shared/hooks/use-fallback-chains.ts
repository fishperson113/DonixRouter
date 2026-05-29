import { useCallback, useEffect, useState } from "preact/hooks";

export type FallbackMatchMode = "exact" | "prefix";

export interface FallbackChainRule {
  id: string;
  enabled: boolean;
  matchMode: FallbackMatchMode;
  source: string;
  targets: string[];
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useFallbackChains() {
  const [rules, setRules] = useState<FallbackChainRule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/auth/fallback-chains");
      const data = await resp.json();
      setRules(Array.isArray(data.rules) ? data.rules : []);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addRule = useCallback(
    async (input: {
      enabled?: boolean;
      matchMode: FallbackMatchMode;
      source: string;
      targets: string[];
      note?: string | null;
    }) => {
      const resp = await fetch("/auth/fallback-chains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${resp.status}`);
      }
      await load();
    },
    [load],
  );

  const updateRule = useCallback(
    async (
      id: string,
      patch: Partial<{
        enabled: boolean;
        matchMode: FallbackMatchMode;
        source: string;
        targets: string[];
        note: string | null;
      }>,
    ) => {
      const resp = await fetch(`/auth/fallback-chains/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${resp.status}`);
      }
      await load();
    },
    [load],
  );

  const deleteRule = useCallback(
    async (id: string) => {
      const resp = await fetch(`/auth/fallback-chains/${id}`, {
        method: "DELETE",
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${resp.status}`);
      }
      await load();
    },
    [load],
  );

  return {
    rules,
    loading,
    addRule,
    updateRule,
    deleteRule,
    refresh: load,
  };
}
