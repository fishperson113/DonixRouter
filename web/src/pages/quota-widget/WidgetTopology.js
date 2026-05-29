"use client";

import { useEffect, useMemo, useState } from "react";
import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";
import ProviderTopology from "../usage/components/ProviderTopology";

function isLLMProvider(id) {
  const p = AI_PROVIDERS[id];
  if (!p?.serviceKinds) return true;
  return p.serviceKinds.includes("llm");
}

function filterByProvider(items, providerId) {
  const pid = (providerId || "").toLowerCase();
  return (items || []).filter((r) => (r.provider || "").toLowerCase() === pid);
}

export default function WidgetTopology({ providerId, providerMeta, usageStats }) {
  const [providers, setProviders] = useState([]);

  useEffect(() => {
    if (!providerId) {
      setProviders([]);
      return;
    }

    const fallback = {
      provider: providerId,
      name: providerMeta?.name || providerId,
    };

    fetch("/api/providers")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const match = (d?.connections || []).find(
          (c) =>
            c.isActive !== false &&
            isLLMProvider(c.provider) &&
            (c.provider || "").toLowerCase() === providerId.toLowerCase()
        );
        if (match) {
          setProviders([{ provider: match.provider, name: match.name || fallback.name }]);
          return;
        }
        const free = FREE_PROVIDERS[providerId];
        if (free?.noAuth && isLLMProvider(providerId)) {
          setProviders([{ provider: providerId, name: free.name || fallback.name }]);
          return;
        }
        setProviders([fallback]);
      })
      .catch(() => setProviders([fallback]));
  }, [providerId, providerMeta?.name]);

  const activeRequests = useMemo(
    () => filterByProvider(usageStats?.activeRequests, providerId),
    [usageStats, providerId]
  );
  const recentRequests = useMemo(
    () => filterByProvider(usageStats?.recentRequests, providerId),
    [usageStats, providerId]
  );
  const lastProvider = recentRequests[0]?.provider || "";
  const errorProvider =
    (usageStats?.errorProvider || "").toLowerCase() === (providerId || "").toLowerCase()
      ? usageStats.errorProvider
      : "";

  return (
    <div className="qw-topology">
      <ProviderTopology
        className="provider-topology-grid--widget provider-topology-grid--single"
        height={236}
        fitPadding={0.42}
        providers={providers}
        activeRequests={activeRequests}
        recentRequests={recentRequests}
        lastProvider={lastProvider}
        errorProvider={errorProvider}
      />
    </div>
  );
}
