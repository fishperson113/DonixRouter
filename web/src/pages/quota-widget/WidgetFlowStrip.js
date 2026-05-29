"use client";

import { useMemo } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";

function filterByProvider(items, providerId) {
  const pid = (providerId || "").toLowerCase();
  return (items || []).filter((r) => (r.provider || "").toLowerCase() === pid);
}

function formatLastAgo(timestamp, nowMs) {
  if (!timestamp) return "—";
  const diff = Math.max(0, Math.floor((nowMs - new Date(timestamp).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function WidgetFlowStrip({ providerId, providerMeta, usageStats, nowMs }) {
  const state = useMemo(() => {
    const pid = (providerId || "").toLowerCase();
    const isError = (usageStats?.errorProvider || "").toLowerCase() === pid;
    const active = filterByProvider(usageStats?.activeRequests, providerId);
    const recent = filterByProvider(usageStats?.recentRequests, providerId);
    const isLive = active.length > 0;
    const lastTs = recent[0]?.timestamp;
    const model = active[0]?.model || recent[0]?.model || "";

    let statusLabel = "Idle";
    if (isError) statusLabel = "Error";
    else if (isLive) statusLabel = "Live";
    else if (recent.length > 0) statusLabel = "Recent";

    const statusBits = [`Status: ${statusLabel}`];
    if (isLive) statusBits.push("đang gọi");
    else statusBits.push(`Last request: ${formatLastAgo(lastTs, nowMs)}`);
    if (model) statusBits.push(model);

    return {
      isLive,
      statusLabel,
      metaLine: statusBits.join(" · "),
    };
  }, [usageStats, providerId, nowMs]);

  return (
    <div
      className={`qw-flow-strip${state.isLive ? " is-live" : ""}`}
      style={{ "--flow-color": providerMeta.color }}
    >
      <div className="qw-flow-strip-main">
        <span className="qw-flow-provider">
          <ProviderIcon
            src={`/providers/${providerId}.png`}
            alt={providerMeta.name}
            size={18}
            className="size-[18px] rounded object-contain shrink-0"
            fallbackText={providerMeta.textIcon}
            fallbackColor={providerMeta.color}
          />
          <span>{providerMeta.name}</span>
        </span>
        <span className="qw-flow-arrow" aria-hidden>
          →
        </span>
        <span className="qw-flow-router">
          <img src="/logo.png" alt="" width={18} height={18} className="qw-flow-router-logo" />
          <span>DonixRouter</span>
        </span>
      </div>
      <p className="qw-flow-meta">{state.metaLine}</p>
    </div>
  );
}
