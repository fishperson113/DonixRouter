"use client";

import { useMemo } from "react";
import OverviewCards from "@/pages/usage/components/OverviewCards";

function statsForProvider(usageStats, providerId) {
  const pid = (providerId || "").toLowerCase();
  const byProvider = usageStats?.byProvider || {};
  const entry =
    byProvider[providerId] ||
    byProvider[pid] ||
    Object.entries(byProvider).find(([key]) => key.toLowerCase() === pid)?.[1];

  return {
    totalRequests: entry?.requests || 0,
    totalPromptTokens: entry?.promptTokens || 0,
    totalCompletionTokens: entry?.completionTokens || 0,
    totalCost: entry?.cost || 0,
  };
}

export default function WidgetOverviewCards({ usageStats, providerId, connected = false }) {
  const stats = useMemo(
    () => statsForProvider(usageStats, providerId),
    [usageStats, providerId]
  );

  return (
    <div className="qw-overview">
      <OverviewCards stats={stats} connected={connected} />
    </div>
  );
}
