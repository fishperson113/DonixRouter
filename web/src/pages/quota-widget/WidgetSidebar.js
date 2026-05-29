"use client";

import { useMemo } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
function statsForProvider(usageStats, providerId) {
  const pid = (providerId || "").toLowerCase();
  const byProvider = usageStats?.byProvider || {};
  const entry =
    byProvider[providerId] ||
    byProvider[pid] ||
    Object.entries(byProvider).find(([key]) => key.toLowerCase() === pid)?.[1];
  return entry || { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
}

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

function fmtCost(n) {
  const v = Number(n || 0);
  if (v <= 0) return "$0.00";
  if (v < 0.01) return "<$0.01";
  return `$${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v)}`;
}

function fmtCompact(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n || 0}`;
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function costTodayForProvider(usageStats, providerId) {
  const recent = filterByProvider(usageStats?.recentRequests, providerId);
  const active = filterByProvider(usageStats?.activeRequests, providerId);
  return [...active, ...recent]
    .filter((r) => isToday(r.timestamp))
    .reduce((sum, r) => sum + (r.cost || 0), 0);
}

export default function WidgetSidebar({
  providerId,
  providerMeta,
  usageStats,
  usageConnected,
  nowMs,
}) {
  const router = useMemo(() => {
    const pid = (providerId || "").toLowerCase();
    const isError = (usageStats?.errorProvider || "").toLowerCase() === pid;
    const active = filterByProvider(usageStats?.activeRequests, providerId);
    const recent = filterByProvider(usageStats?.recentRequests, providerId);
    const isLive = active.length > 0;
    const lastTs = recent[0]?.timestamp;
    const model = active[0]?.model || recent[0]?.model || "";

    let status = "Idle";
    if (isError) status = "Error";
    else if (isLive) status = "Live";
    else if (recent.length > 0) status = "Recent";

    const detail = isLive
      ? "đang gọi"
      : `Last: ${formatLastAgo(lastTs, nowMs)}`;

    return { isLive, status, detail, model };
  }, [usageStats, providerId, nowMs]);

  const usage = useMemo(
    () => statsForProvider(usageStats, providerId),
    [usageStats, providerId]
  );

  const costToday = useMemo(
    () => costTodayForProvider(usageStats, providerId),
    [usageStats, providerId]
  );

  return (
    <aside className="qw-sidebar" style={{ "--side-color": providerMeta.color }}>
      <div className={`qw-side-card qw-router${router.isLive ? " is-live" : ""}`}>
        <div className="qw-side-card-head">
          <span className="qw-side-card-title">Router Status</span>
          <span className={`qw-side-live${usageConnected ? "" : " is-off"}`}>
            <span className="qw-side-live-dot" />
          </span>
        </div>
        <div className="qw-router-route">
          <ProviderIcon
            src={`/providers/${providerId}.png`}
            alt={providerMeta.name}
            size={16}
            className="size-4 rounded object-contain shrink-0"
            fallbackText={providerMeta.textIcon}
            fallbackColor={providerMeta.color}
          />
          <span>{providerMeta.name}</span>
          <span className="qw-router-arrow">→</span>
          <img src="/logo.png" alt="" width={16} height={16} className="qw-router-logo" />
          <span>DonixRouter</span>
        </div>
        <p className="qw-router-meta">
          <span className={`qw-router-status${router.isLive ? " is-live" : ""}`}>
            {router.status}
          </span>
          {" · "}
          {router.detail}
          {router.model ? ` · ${router.model}` : ""}
        </p>
      </div>

      <div className="qw-side-card">
        <div className="qw-side-card-head">
          <span className="qw-side-card-title">Provider Usage</span>
          <span className="qw-side-card-sub">24h</span>
        </div>
        <dl className="qw-side-stats">
          <div>
            <dt>Requests</dt>
            <dd>{usage.requests || 0}</dd>
          </div>
          <div>
            <dt>Input</dt>
            <dd>{fmtCompact(usage.promptTokens || 0)}</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>{fmtCompact(usage.completionTokens || 0)}</dd>
          </div>
        </dl>
      </div>

      <div className="qw-side-card">
        <span className="qw-side-card-title">Cost Today</span>
        <p className="qw-side-cost">{fmtCost(costToday)}</p>
        <p className="qw-side-hint">Từ request hôm nay</p>
      </div>
    </aside>
  );
}
