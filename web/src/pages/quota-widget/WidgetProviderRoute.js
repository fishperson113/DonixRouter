"use client";

import { useMemo } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";

function filterByProvider(items, providerId) {
  const pid = (providerId || "").toLowerCase();
  return (items || []).filter((r) => (r.provider || "").toLowerCase() === pid);
}

function buildRouteState(activeRequests, recentRequests, providerId, errorProvider) {
  const pid = (providerId || "").toLowerCase();
  const isError = (errorProvider || "").toLowerCase() === pid;
  const active = filterByProvider(activeRequests, providerId);
  const recent = filterByProvider(recentRequests, providerId);
  const activeReq = active[0];
  const recentReq = recent[0];
  const isLive = active.length > 0;
  const isRecent = !isLive && recent.length > 0;

  const status = isError ? "error" : isLive ? "active" : isRecent ? "recent" : "idle";
  const model = activeReq?.model || recentReq?.model || "";
  const subtitle = [status, model].filter(Boolean).join(" | ");
  const account = activeReq?.account || recentReq?.account || "";

  return { isLive, subtitle, account };
}

export default function WidgetProviderRoute({ providerId, providerMeta, usageStats }) {
  const { isLive, subtitle, account } = useMemo(
    () =>
      buildRouteState(
        usageStats?.activeRequests,
        usageStats?.recentRequests,
        providerId,
        usageStats?.errorProvider
      ),
    [usageStats, providerId]
  );

  return (
    <div className="qw-topology">
      <div
        className={`qw-route qw-route--focus${isLive ? " is-live" : ""}`}
        style={{ "--filter-color": providerMeta.color }}
      >
        <div className={`qw-route-node qw-route-node--lg${isLive ? " is-active" : ""}`}>
          <ProviderIcon
            src={`/providers/${providerId}.png`}
            alt={providerMeta.name}
            size={48}
            className="size-12 rounded-lg object-contain shrink-0"
            fallbackText={providerMeta.textIcon}
            fallbackColor={providerMeta.color}
          />
          <div className="qw-route-node-text">
            <span className="qw-route-node-name">{providerMeta.name}</span>
            <span className="qw-route-node-meta">{subtitle}</span>
          </div>
        </div>

        <div className={`qw-route-connector qw-route-connector--lg${isLive ? " is-live" : ""}`}>
          <span className="qw-route-connector-dot" />
          <span className="qw-route-connector-line" />
          <span className="qw-route-connector-dot" />
        </div>

        <div className="qw-route-hub qw-route-hub--lg">
          <img src="/logo.png" alt="" width={40} height={40} className="qw-route-hub-logo" />
          <span>DonixRouter</span>
        </div>

        {account ? (
          <span className="qw-route-account" title={account}>
            {account}
          </span>
        ) : null}
      </div>
    </div>
  );
}
