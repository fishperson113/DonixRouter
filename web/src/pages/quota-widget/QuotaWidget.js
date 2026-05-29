"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuotaStream, useUsageStream } from "@/shared/hooks";
import ProviderIcon from "@/shared/components/ProviderIcon";
import {
  AI_PROVIDERS,
  USAGE_SUPPORTED_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
} from "@/shared/constants/providers";
import { parseQuotaData } from "../usage/components/ProviderLimits/utils";
import OnWatchRow from "./OnWatchRow";
import WidgetOverviewCards from "./WidgetOverviewCards";
import WidgetLiveSection from "./WidgetLiveSection";
import { useTauriWindowFit } from "./useTauriWindowFit";
import "./quota-widget.css";

const PROVIDER_ORDER = ["codex", "github", "claude", "kiro", "antigravity", "gemini-cli", "qwen"];
const FILTER_STORAGE_KEY = "donixrouter:quota-widget-provider";

const isUsageEligible = (connection) =>
  USAGE_SUPPORTED_PROVIDERS.includes(connection.provider) &&
  (connection.authType === "oauth" ||
    USAGE_APIKEY_PROVIDERS.includes(connection.provider));

function getProviderMeta(providerId) {
  const info = AI_PROVIDERS[providerId] || {};
  return {
    id: providerId,
    name: info.name || providerId,
    color: info.color || "#6b7280",
    textIcon: info.textIcon || providerId.slice(0, 2).toUpperCase(),
  };
}

function sortQuotas(provider, quotas) {
  const order =
    provider === "codex"
      ? ["session", "weekly", "review_session", "review_weekly"]
      : provider === "github"
        ? ["chat", "completions"]
        : [];
  if (!order.length) return quotas;
  const rank = new Map(order.map((value, index) => [value, index]));
  return [...quotas].sort((a, b) => {
    const rankA = rank.get(a.name) ?? 999;
    const rankB = rank.get(b.name) ?? 999;
    if (rankA !== rankB) return rankA - rankB;
    return String(a.name).localeCompare(String(b.name));
  });
}

function formatAgo(iso, nowMs) {
  if (!iso) return "—";
  const diff = nowMs - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "—";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "vừa xong";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function readStoredProvider() {
  try {
    return localStorage.getItem(FILTER_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export default function QuotaWidget() {
  const rootRef = useRef(null);
  const { snapshot, connected, activeConnectionIds, forceRefresh } = useQuotaStream();
  const { snapshot: usageStats, connected: usageConnected } = useUsageStream("24h");
  const [providerId, setProviderId] = useState(readStoredProvider);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    document.documentElement.classList.add("quota-widget-page");
    return () => document.documentElement.classList.remove("quota-widget-page");
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeConnections = useMemo(() => {
    const list = (snapshot?.connections || []).filter(
      (c) => isUsageEligible(c) && c.isActive !== false
    );
    return list.sort((a, b) => {
      const ia = PROVIDER_ORDER.indexOf(a.provider);
      const ib = PROVIDER_ORDER.indexOf(b.provider);
      const ra = ia === -1 ? 999 : ia;
      const rb = ib === -1 ? 999 : ib;
      if (ra !== rb) return ra - rb;
      const la = (a.email || a.displayName || a.name || "").toLowerCase();
      const lb = (b.email || b.displayName || b.name || "").toLowerCase();
      return la.localeCompare(lb);
    });
  }, [snapshot]);

  const providerIds = useMemo(() => {
    const ids = [...new Set(activeConnections.map((c) => c.provider))];
    return ids.sort((a, b) => {
      const ia = PROVIDER_ORDER.indexOf(a);
      const ib = PROVIDER_ORDER.indexOf(b);
      const ra = ia === -1 ? 999 : ia;
      const rb = ib === -1 ? 999 : ib;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });
  }, [activeConnections]);

  useEffect(() => {
    if (!providerIds.length) return;
    if (!providerIds.includes(providerId)) {
      const next = providerIds.includes("codex") ? "codex" : providerIds[0];
      setProviderId(next);
      try {
        localStorage.setItem(FILTER_STORAGE_KEY, next);
      } catch {}
    }
  }, [providerIds, providerId]);

  const selectProvider = (id) => {
    setProviderId(id);
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, id);
    } catch {}
  };

  const filteredConnections = useMemo(
    () => activeConnections.filter((c) => c.provider === providerId),
    [activeConnections, providerId]
  );

  const callingIdSet = useMemo(
    () => new Set(activeConnectionIds || []),
    [activeConnectionIds]
  );

  const quotaData = useMemo(() => {
    const sseQuotas = snapshot?.quotas || {};
    const merged = {};
    for (const [id, entry] of Object.entries(sseQuotas)) {
      const conn = filteredConnections.find((c) => c.id === id);
      if (!conn) continue;
      const provider = conn.provider;
      if (entry?.data) {
        merged[id] = {
          quotas: sortQuotas(provider, parseQuotaData(provider, entry.data)),
          message: entry.data.message || null,
          raw: entry.data,
        };
      } else if (entry?.error) {
        merged[id] = { quotas: [], message: entry.error, raw: {} };
      }
    }
    return merged;
  }, [snapshot, filteredConnections]);

  const providerMeta = getProviderMeta(providerId);
  const updatedAgo = formatAgo(snapshot?.timestamp, nowMs);
  const callingCount = filteredConnections.filter((c) => callingIdSet.has(c.id)).length;
  const accountCount = filteredConnections.length;
  const useGrid = accountCount >= 2;
  // Layout no longer uses the old wide right sidebar, keep compact width.
  const hasDashboard = false;

  useTauriWindowFit(rootRef, accountCount, hasDashboard, [
    providerId,
    hasDashboard,
    accountCount,
    useGrid,
    snapshot?.timestamp,
    callingCount,
    usageStats?.recentRequests?.length,
    usageStats?.activeRequests?.length,
    usageStats?.errorProvider,
    usageStats?.byProvider?.[providerId]?.requests,
    usageStats?.byProvider?.[providerId]?.cost,
  ]);

  return (
    <div className="quota-widget-root" ref={rootRef}>
      <header className="quota-widget-header">
        <div className="quota-widget-title-block">
          <div className="quota-widget-title">
            <span className="material-symbols-outlined">monitoring</span>
            <span>DonixWatch</span>
          </div>
          <p className="quota-widget-subtitle">
            {filteredConnections.length > 0
              ? `${providerMeta.name} · ${filteredConnections.length} tài khoản · ${updatedAgo}${
                  callingCount > 0 ? ` · ${callingCount} đang gọi` : ""
                }`
              : snapshot
                ? "Không có tài khoản đang bật"
                : "Đang kết nối…"}
          </p>
        </div>
        <div
          className={`quota-widget-live${connected ? "" : " is-off"}`}
          title={connected ? "SSE" : "Polling"}
        >
          <span className="quota-widget-live-dot" />
        </div>
        <div className="quota-widget-actions">
          <button
            type="button"
            className="quota-widget-icon-btn"
            title="Làm mới"
            onClick={() => forceRefresh()}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              refresh
            </span>
          </button>
          <a
            href="/dashboard/providers"
            className="quota-widget-icon-btn"
            title="Quản lý tài khoản"
            target="_blank"
            rel="noreferrer"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              settings
            </span>
          </a>
        </div>
      </header>

      {providerIds.length > 1 ? (
        <div className="quota-widget-filter" role="tablist" aria-label="Lọc nhà cung cấp">
          {providerIds.map((id) => {
            const pm = getProviderMeta(id);
            const count = activeConnections.filter((c) => c.provider === id).length;
            const calling = activeConnections.some(
              (c) => c.provider === id && callingIdSet.has(c.id)
            );
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={providerId === id}
                className={`quota-widget-filter-btn${providerId === id ? " is-active" : ""}${
                  calling ? " is-calling" : ""
                }`}
                style={{ "--filter-color": pm.color }}
                onClick={() => selectProvider(id)}
              >
                <ProviderIcon
                  src={`/providers/${id}.png`}
                  alt={pm.name}
                  size={14}
                  className="size-[14px] rounded object-contain shrink-0"
                  fallbackText={pm.textIcon}
                  fallbackColor={pm.color}
                />
                <span>{pm.name}</span>
                <span className="quota-widget-filter-count">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {snapshot && providerId ? (
        <>
          <WidgetOverviewCards
            usageStats={usageStats}
            providerId={providerId}
            connected={usageConnected}
          />
          <WidgetLiveSection
            providerId={providerId}
            providerMeta={providerMeta}
            usageStats={usageStats}
            usageConnected={usageConnected}
            nowMs={nowMs}
          />
        </>
      ) : null}

      <div
        className={`quota-widget-list is-dense${useGrid ? " is-grid" : ""}`}
      >
        {!snapshot ? (
          <div className="quota-widget-empty">
            <span className="quota-widget-spinner" />
            Đang kết nối stream quota…
          </div>
        ) : filteredConnections.length === 0 ? (
          <div className="quota-widget-empty">
            {providerIds.length === 0 ? (
              <>
                Bật tài khoản tại{" "}
                <a href="/dashboard/providers" target="_blank" rel="noreferrer">
                  Quản lý Providers
                </a>{" "}
                để hiển thị ở đây.
              </>
            ) : (
              <>Không có tài khoản {providerMeta.name} đang bật.</>
            )}
          </div>
        ) : (
          <div className={useGrid ? "accounts-grid" : "accounts-single"}>
          {filteredConnections.map((connection) => {
            const meta = getProviderMeta(connection.provider);
            const entry = quotaData[connection.id];
            const error =
              entry?.message && !entry?.quotas?.length ? entry.message : null;
            return (
              <OnWatchRow
                key={connection.id}
                connection={connection}
                providerMeta={meta}
                quotaEntry={entry}
                error={error}
                nowMs={nowMs}
                snapshotAt={snapshot?.timestamp}
                isCalling={callingIdSet.has(connection.id)}
                compact
              />
            );
          })}
          </div>
        )}
      </div>
    </div>
  );
}
