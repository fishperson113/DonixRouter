"use client";

import { useEffect, useMemo, useRef } from "react";
import { fmt } from "../usage/components/UsageTable";

const RECENT_GRID = "minmax(0,1.4fr) 52px 52px 84px 32px";
const MAX_RECENT_ROWS = 6;

function fmtCompact(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n || 0}`;
}

function fmtCost(n) {
  const v = Number(n || 0);
  if (v <= 0) return "—";
  if (v < 0.01) return "<$0.01";
  return `$${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(v)}`;
}

function recentWhenMeta(timestamp, nowMs) {
  const diff = Math.max(0, Math.floor((nowMs - new Date(timestamp).getTime()) / 1000));
  if (diff < 60) return { text: `${diff}s`, speed: "fast" };
  if (diff < 3600) {
    const min = Math.floor(diff / 60);
    return { text: `${min}m`, speed: min < 15 ? "mid" : "slow" };
  }
  if (diff < 86400) return { text: `${Math.floor(diff / 3600)}h`, speed: "slow" };
  return { text: `${Math.floor(diff / 86400)}d`, speed: "slow" };
}

function filterByProvider(items, providerId) {
  const pid = (providerId || "").toLowerCase();
  return (items || []).filter((r) => (r.provider || "").toLowerCase() === pid);
}

function PendingDots() {
  return (
    <span className="recent-pending-bars" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function PendingRow({ pending, startedAt, nowMs }) {
  const elapsedSec = Math.max(0, Math.floor((nowMs - startedAt) / 1000));
  const elapsedTxt = elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)}m`;

  return (
    <div
      className="qw-recent-row recent-row recent-row--pending is-pending"
      style={{ gridTemplateColumns: RECENT_GRID }}
    >
      <div className="qw-recent-model-cell">
        <span className="recent-status-dot is-pending" />
        <span className="qw-recent-model">{pending.model}</span>
      </div>
      <span className="qw-recent-muted">—</span>
      <span className="qw-recent-muted">—</span>
      <span className="qw-recent-pending-status">
        <PendingDots />
        <span>đang gọi</span>
      </span>
      <span className="qw-recent-when is-mid">{elapsedTxt}</span>
    </div>
  );
}

function RecentRow({ request, nowMs }) {
  const ok = !request.status || request.status === "ok" || request.status === "success";
  const when = recentWhenMeta(request.timestamp, nowMs);

  return (
    <div className="qw-recent-row recent-row" style={{ gridTemplateColumns: RECENT_GRID }}>
      <div className="qw-recent-model-cell">
        <span className={`recent-status-dot${ok ? "" : " err"}`} />
        <span className="qw-recent-model" title={request.model}>
          {request.model}
        </span>
      </div>
      <span className="qw-recent-in">{fmt(request.promptTokens || 0)}</span>
      <span className="qw-recent-out">{fmt(request.completionTokens || 0)}</span>
      <span className="qw-recent-cost">{fmtCost(request.cost)}</span>
      <span className={`qw-recent-when is-${when.speed}`}>{when.text}</span>
    </div>
  );
}

export default function WidgetLiveSection({
  providerId,
  providerMeta,
  usageStats,
  usageConnected,
  nowMs,
}) {
  const startedAtRef = useRef({});
  const activeRequests = useMemo(
    () => filterByProvider(usageStats?.activeRequests, providerId),
    [usageStats, providerId]
  );
  const recentRequests = useMemo(() => {
    const recent = filterByProvider(usageStats?.recentRequests, providerId);
    const slots = Math.max(0, MAX_RECENT_ROWS - activeRequests.length);
    return recent.slice(0, slots);
  }, [usageStats, providerId, activeRequests.length]);

  useEffect(() => {
    const seen = startedAtRef.current;
    const now = Date.now();
    const keys = new Set(
      activeRequests.map((p) => `${p.account || ""}|${p.provider}|${p.model}`)
    );
    for (const key of keys) {
      if (!seen[key]) seen[key] = now;
    }
    for (const key of Object.keys(seen)) {
      if (!keys.has(key)) delete seen[key];
    }
  }, [activeRequests]);

  const totalInput = recentRequests.reduce((sum, r) => sum + (r.promptTokens || 0), 0);
  const totalOutput = recentRequests.reduce((sum, r) => sum + (r.completionTokens || 0), 0);
  const totalCost = recentRequests.reduce((sum, r) => sum + (r.cost || 0), 0);
  const headerCount = activeRequests.length + recentRequests.length;
  const isEmpty = headerCount === 0;

  return (
    <section className="qw-live" style={{ "--filter-color": providerMeta.color }}>
      <div className="qw-live-row">
        <div className="qw-recent">
          <div className="qw-recent-head">
            <span className="qw-recent-title">Recent Requests</span>
            {headerCount > 0 ? <span className="qw-recent-pill">{headerCount}</span> : null}
            <span className={`qw-recent-live${usageConnected ? "" : " is-off"}`}>
              <span className="recent-live-dot" />
              Live
            </span>
          </div>

          {isEmpty ? (
            <p className="qw-recent-empty">Chưa có request cho {providerMeta.name}.</p>
          ) : (
            <>
              <div className="qw-recent-cols" style={{ gridTemplateColumns: RECENT_GRID }}>
                <span>Model</span>
                <span>In</span>
                <span>Out</span>
                <span>Cost</span>
                <span>When</span>
              </div>
              <div className="qw-recent-body">
                {activeRequests.map((pending) => {
                  const key = `${pending.account || ""}|${pending.provider}|${pending.model}`;
                  const startedAt = startedAtRef.current[key] || Date.now();
                  return (
                    <PendingRow
                      key={`pending-${key}`}
                      pending={pending}
                      startedAt={startedAt}
                      nowMs={nowMs}
                    />
                  );
                })}
                {recentRequests.map((r, i) => (
                  <RecentRow key={`${r.timestamp}-${r.model}-${i}`} request={r} nowMs={nowMs} />
                ))}
              </div>
              <div className="qw-recent-foot">
                <span className="qw-recent-foot-in">
                  In <strong>{fmtCompact(totalInput)}</strong>
                </span>
                <span className="qw-recent-foot-out">
                  Out <strong>{fmtCompact(totalOutput)}</strong>
                </span>
                <span className="qw-recent-foot-cost">
                  Cost <strong>{fmtCost(totalCost)}</strong>
                </span>
                <a href="/dashboard/usage" target="_blank" rel="noreferrer">
                  Usage
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
