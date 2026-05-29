"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import Toggle from "@/shared/components/Toggle";
import Card from "@/shared/components/Card";
import { EditConnectionModal } from "@/shared/components";
import { useQuotaStream } from "@/shared/hooks";
import {
  parseQuotaData,
  calculatePercentage,
  formatResetTime,
} from "./utils";
import AccountCard from "./AccountCard";
import {
  AI_PROVIDERS,
  USAGE_SUPPORTED_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
} from "@/shared/constants/providers";

const DEPLETED_QUOTA_THRESHOLD = 5;

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

function getConnectionLabel(connection) {
  return (
    connection.email ||
    connection.displayName ||
    connection.name ||
    "OAuth Account"
  );
}

function truncateMiddle(value, prefix = 10, suffix = 8) {
  if (!value || value.length <= prefix + suffix + 3) return value;
  return `${value.slice(0, prefix)}...${value.slice(-suffix)}`;
}

function formatPreciseCountdown(resetAt, nowMs = Date.now()) {
  if (!resetAt) return "-";
  try {
    const targetMs = new Date(resetAt).getTime();
    if (!Number.isFinite(targetMs)) return "-";

    const totalSeconds = Math.ceil((targetMs - nowMs) / 1000);
    if (totalSeconds <= 0) return "-";

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");

    return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
  } catch {
    return "-";
  }
}

function formatAbsoluteReset(resetAt) {
  if (!resetAt) return "No reset";
  try {
    return new Date(resetAt).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "No reset";
  }
}

function prettyQuotaName(name) {
  const map = {
    session: "Session",
    weekly: "Weekly",
    review_session: "Review Session",
    review_weekly: "Review Weekly",
    agentic_request: "Agentic Request",
  };
  if (map[name]) return map[name];
  return String(name)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getPlanLabel(connection, quotaEntry) {
  const rawPlan =
    quotaEntry?.raw?.plan ||
    connection.providerSpecificData?.chatgptPlanType ||
    quotaEntry?.plan ||
    "";
  if (!rawPlan || rawPlan === "unknown") return null;
  if (connection.provider === "kiro") {
    const value = String(rawPlan).toLowerCase();
    if (value.includes("pro")) return "KIRO PRO";
    if (value.includes("free")) return "KIRO FREE";
    return String(rawPlan).toUpperCase();
  }
  return String(rawPlan).replace(/_/g, " ");
}

function getPlanTone(plan) {
  const value = String(plan || "").toLowerCase();
  if (value.includes("enterprise") || value.includes("team")) return "blue";
  if (value.includes("pro") || value.includes("plus")) return "violet";
  if (value.includes("free")) return "green";
  return "slate";
}

function getQuotaRemaining(quota) {
  if (quota.remainingPercentage !== undefined) {
    return Math.max(0, Math.min(100, Math.round(quota.remainingPercentage)));
  }
  return calculatePercentage(quota.used, quota.total);
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

function isConnectionLowQuota(quotaEntry) {
  const quotas = quotaEntry?.quotas || [];
  return quotas.some((quota) => {
    if (!quota.total || quota.total <= 0) return false;
    return getQuotaRemaining(quota) <= DEPLETED_QUOTA_THRESHOLD;
  });
}

function getConnectionStatus(connection, quotaEntry, error) {
  if (connection.isActive === false) {
    return { label: "Inactive", tone: "slate" };
  }
  if (error) {
    return { label: "Error", tone: "red" };
  }
  if (quotaEntry?.raw?.limitReached || quotaEntry?.raw?.reviewLimitReached || isConnectionLowQuota(quotaEntry)) {
    return { label: "Limit Hit", tone: "red" };
  }
  return { label: "Active", tone: "green" };
}

function getSoonestReset(quotaEntry) {
  const quotas = quotaEntry?.quotas || [];
  const timestamps = quotas
    .map((quota) => (quota.resetAt ? new Date(quota.resetAt).getTime() : Number.POSITIVE_INFINITY))
    .filter((value) => Number.isFinite(value));
  if (!timestamps.length) return null;
  return new Date(Math.min(...timestamps)).toISOString();
}

function getStatusDisplay(status) {
  if (!status) return "";
  if (status.tone === "red" && status.label === "Limit Hit") return "Đã đạt giới hạn";
  if (status.label === "Active") return "Hoạt động";
  if (status.label === "Inactive") return "Tạm dừng";
  if (status.label === "Error") return "Lỗi";
  return status.label;
}

function QuotaRow({ quota, nowMs }) {
  const remaining = getQuotaRemaining(quota);
  const totalValue = quota.total > 0 ? quota.total.toLocaleString() : "∞";
  const resetCountdown = formatResetTime(quota.resetAt);
  const tone =
    remaining > 70 ? "green" : remaining >= 30 ? "amber" : "red";

  return (
    <div className="quota-row">
      <div className="quota-row-main">
        <div className={`quota-row-dot tone-${tone}`} />
        <div className="quota-row-copy">
          <div className="quota-row-label">{prettyQuotaName(quota.name)}</div>
          <div className="quota-row-meta">
            {quota.used.toLocaleString()} / {totalValue}
          </div>
        </div>
      </div>
      <div className="quota-row-track-shell">
        <div className="quota-row-track">
          <div
            className={`quota-row-fill tone-${tone}`}
            style={{ width: `${Math.max(0, Math.min(100, remaining))}%` }}
          />
        </div>
      </div>
      <div className="quota-row-side">
        <div className={`quota-row-percent tone-${tone}`}>{remaining}%</div>
        <div
          className="quota-row-reset"
          title={quota.resetAt ? formatAbsoluteReset(quota.resetAt) : ""}
        >
          {resetCountdown !== "-" ? `in ${resetCountdown}` : "No reset"}
        </div>
      </div>
    </div>
  );
}

function getConnectionStatusText(status) {
  if (!status) return "";
  if (status.tone === "red" && status.label === "Limit Hit") return "\u0110\u00e3 \u0111\u1ea1t gi\u1edbi h\u1ea1n";
  if (status.label === "Active") return "Ho\u1ea1t \u0111\u1ed9ng";
  if (status.label === "Inactive") return "T\u1ea1m d\u1eebng";
  if (status.label === "Error") return "L\u1ed7i";
  return status.label;
}

function LiveQuotaRow({ quota, nowMs, isLimitHit = false }) {
  const remaining = getQuotaRemaining(quota);
  const totalValue = quota.total > 0 ? quota.total.toLocaleString() : "\u221e";
  const resetCountdown = formatPreciseCountdown(quota.resetAt, nowMs);
  const tone =
    remaining > 70 ? "green" : remaining >= 30 ? "amber" : "red";

  return (
    <div className={`quota-row${isLimitHit ? " is-card-limit-hit" : ""}`}>
      <div className="quota-row-main">
        <div className={`quota-row-dot tone-${tone}`} />
        <div className="quota-row-copy">
          <div className="quota-row-label">{prettyQuotaName(quota.name)}</div>
          <div className="quota-row-meta">
            {quota.used.toLocaleString()} / {totalValue}
          </div>
        </div>
      </div>
      <div className="quota-row-track-shell">
        <div className="quota-row-track">
          <div
            className={`quota-row-fill tone-${tone}`}
            style={{ width: `${Math.max(0, Math.min(100, remaining))}%` }}
          />
        </div>
      </div>
      <div className="quota-row-side">
        <div className={`quota-row-percent tone-${tone}`}>{remaining}%</div>
        <div
          className="quota-row-reset"
          title={quota.resetAt ? formatAbsoluteReset(quota.resetAt) : ""}
        >
          {resetCountdown !== "-" ? resetCountdown : "No reset"}
        </div>
      </div>
    </div>
  );
}

function getKiroOverageInfo(connection, quotaEntry) {
  const raw = quotaEntry?.raw || {};
  const config = raw.overageConfiguration || {};
  const saved = connection.providerSpecificData || {};
  const overageEnabled =
    typeof config.overageEnabled === "boolean"
      ? config.overageEnabled
      : saved.kiroOverageEnabled === true;

  const used = Number(config.currentOverages) || 0;
  const cap = Number(config.overageCap) || 0;
  const usedPct =
    cap > 0 ? Math.max(0, Math.min(100, (used / cap) * 100)) : 0;

  return {
    overageEnabled,
    charges: config.currentChargesFormatted || config.chargesFormatted || "$0.00",
    rate: config.rateFormatted || "$0.04/req",
    overages: config.overagesFormatted || "0 / 10,000",
    overagesUsed: used,
    overagesCap: cap,
    overagesPercent: usedPct,
  };
}

function overagesTone(pct) {
  if (pct >= 80) return "red";
  if (pct >= 40) return "amber";
  return "green";
}

function isKiroProAccount(connection, quotaEntry) {
  return connection.provider === "kiro" && String(getPlanLabel(connection, quotaEntry) || "").toLowerCase().includes("pro");
}

function KiroOveragePanel({ connection, quotaEntry, busy, onToggle }) {
  const info = getKiroOverageInfo(connection, quotaEntry);
  const tone = overagesTone(info.overagesPercent);
  const pctLabel = `${info.overagesPercent.toFixed(info.overagesPercent >= 10 ? 0 : 1)}%`;

  return (
    <div className="quota-kiro-overage-panel">
      <div className="quota-kiro-overage-head">
        <div className="quota-kiro-overage-title">
          <span className="material-symbols-outlined">bolt</span>
          <span>Overage</span>
          <span className={`quota-kiro-overage-badge${info.overageEnabled ? " is-enabled" : ""}`}>
            {info.overageEnabled ? "ENABLED" : "DISABLED"}
          </span>
        </div>
        <button
          type="button"
          className={`acct-toggle quota-kiro-overage-toggle${info.overageEnabled ? " is-on" : ""}`}
          disabled={busy}
          onClick={() => onToggle?.(connection.id, info.overageEnabled)}
          title={info.overageEnabled ? "Disable Kiro overage" : "Enable Kiro overage"}
        >
          <span className="knob" />
        </button>
      </div>
      <div className="quota-kiro-overage-grid">
        <span>Charges</span>
        <strong>{info.charges}</strong>
        <span>Rate</span>
        <strong>{info.rate}</strong>
        <span>Overages</span>
        <strong>{info.overages}</strong>
      </div>
      {info.overagesCap > 0 && (
        <div className="quota-kiro-overage-bar-row">
          <div className="quota-kiro-overage-bar-track">
            <div
              className={`quota-kiro-overage-bar-fill tone-${tone}`}
              style={{ width: `${info.overagesPercent}%` }}
            />
          </div>
          <span className={`quota-kiro-overage-bar-pct tone-${tone}`}>{pctLabel}</span>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, note, tone = "slate" }) {
  return (
    <Card className={`quota-summary-card tone-${tone}`} padding="none">
      <div className="quota-summary-card-inner">
        <div className="quota-summary-label">{label}</div>
        <div className="quota-summary-value">{value}</div>
        <div className="quota-summary-note">{note}</div>
      </div>
    </Card>
  );
}

export default function ProviderLimits() {
  const { snapshot, connected, forceRefresh } = useQuotaStream();

  const [localQuotaOverrides, setLocalQuotaOverrides] = useState({});
  const [localConnectionOverrides, setLocalConnectionOverrides] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [kiroBillingTogglingId, setKiroBillingTogglingId] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [proxyPools, setProxyPools] = useState([]);
  const [providerFilter, setProviderFilter] = useState("all");
  const [viewMode, setViewMode] = useState("grouped");

  const connectionsLoading = !snapshot;
  const lastUpdated = snapshot ? new Date(snapshot.timestamp) : null;

  // Merge SSE connections with local overrides (for toggle/delete)
  const connections = useMemo(() => {
    const sseConnections = snapshot?.connections || [];
    const deletedIds = new Set(
      Object.entries(localConnectionOverrides)
        .filter(([, v]) => v._deleted)
        .map(([k]) => k)
    );
    return sseConnections
      .filter((c) => !deletedIds.has(c.id))
      .map((c) => ({ ...c, ...localConnectionOverrides[c.id] }));
  }, [snapshot, localConnectionOverrides]);

  // Merge SSE quota data with local overrides (for manual single refresh)
  const quotaData = useMemo(() => {
    const sseQuotas = snapshot?.quotas || {};
    const merged = {};
    for (const [id, entry] of Object.entries(sseQuotas)) {
      if (localQuotaOverrides[id]) {
        merged[id] = localQuotaOverrides[id];
      } else if (entry?.data) {
        const conn = connections.find((c) => c.id === id);
        const provider = conn?.provider || "";
        const parsedQuotas = sortQuotas(provider, parseQuotaData(provider, entry.data));
        merged[id] = {
          quotas: parsedQuotas,
          plan: entry.data.plan || null,
          message: entry.data.message || null,
          raw: entry.data,
        };
      } else if (entry?.error) {
        merged[id] = { quotas: [], message: entry.error, raw: {} };
      }
    }
    // Also include any local-only overrides not in SSE
    for (const [id, override] of Object.entries(localQuotaOverrides)) {
      if (!merged[id]) merged[id] = override;
    }
    return merged;
  }, [snapshot, localQuotaOverrides, connections]);

  // Clear local overrides when SSE pushes a new full snapshot
  useEffect(() => {
    if (snapshot?.timestamp) {
      setLocalQuotaOverrides({});
    }
  }, [snapshot?.timestamp]);

  const fetchQuota = useCallback(async (connectionId, provider) => {
    setLoading((prev) => ({ ...prev, [connectionId]: true }));
    setErrors((prev) => ({ ...prev, [connectionId]: null }));

    try {
      const response = await fetch(`/api/usage/${connectionId}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || response.statusText;

        if (response.status === 404) return;

        if (response.status === 401) {
          setLocalQuotaOverrides((prev) => ({
            ...prev,
            [connectionId]: {
              quotas: [],
              message: errorMsg,
              raw: {},
            },
          }));
          return;
        }

        throw new Error(`HTTP ${response.status}: ${errorMsg}`);
      }

      const data = await response.json();
      const parsedQuotas = sortQuotas(provider, parseQuotaData(provider, data));

      setLocalQuotaOverrides((prev) => ({
        ...prev,
        [connectionId]: {
          quotas: parsedQuotas,
          plan: data.plan || null,
          message: data.message || null,
          raw: data,
        },
      }));
    } catch (error) {
      console.error(`Error fetching quota for ${provider} (${connectionId}):`, error);
      setErrors((prev) => ({
        ...prev,
        [connectionId]: error.message || "Failed to fetch quota",
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [connectionId]: false }));
    }
  }, []);

  const refreshProvider = useCallback(
    async (connectionId, provider) => {
      await fetchQuota(connectionId, provider);
    },
    [fetchQuota]
  );

  const handleDeleteConnection = useCallback(async (id) => {
    if (!confirm("Delete this connection?")) return;
    setDeletingId(id);
    try {
      const response = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (response.ok) {
        setLocalConnectionOverrides((prev) => ({ ...prev, [id]: { _deleted: true } }));
        setTimeout(() => forceRefresh(), 500);
      }
    } catch (error) {
      console.error("Error deleting connection:", error);
    } finally {
      setDeletingId(null);
    }
  }, [forceRefresh]);

  const handleToggleConnectionActive = useCallback(async (id, isActive) => {
    setTogglingId(id);
    try {
      const response = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (response.ok) {
        setLocalConnectionOverrides((prev) => ({ ...prev, [id]: { ...prev[id], isActive } }));
      }
    } catch (error) {
      console.error("Error updating connection status:", error);
    } finally {
      setTogglingId(null);
    }
  }, []);

  const handleToggleKiroLimit = useCallback(async (id, limitEnabled) => {
    setKiroBillingTogglingId(id);
    try {
      const response = await fetch(`/api/providers/${id}/kiro-billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limitEnabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || "Failed to update Kiro billing limit");
        return;
      }
      if (data.connection) {
        setLocalConnectionOverrides((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            providerSpecificData: data.connection.providerSpecificData,
          },
        }));
      } else {
        setLocalConnectionOverrides((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            providerSpecificData: {
              ...(prev[id]?.providerSpecificData || {}),
              kiroLimitEnabled: data.limitEnabled,
              kiroOverageEnabled: data.overageEnabled,
            },
          },
        }));
      }
      setTimeout(() => forceRefresh(), 500);
    } catch (error) {
      console.error("Error updating Kiro billing limit:", error);
      alert("Failed to update Kiro billing limit");
    } finally {
      setKiroBillingTogglingId(null);
    }
  }, [forceRefresh]);

  const handleUpdateConnection = useCallback(
    async (formData) => {
      if (!selectedConnection?.id) return;
      const connectionId = selectedConnection.id;
      const provider = selectedConnection.provider;
      try {
        const response = await fetch(`/api/providers/${connectionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (response.ok) {
          setShowEditModal(false);
          setSelectedConnection(null);
          forceRefresh();
          if (USAGE_SUPPORTED_PROVIDERS.includes(provider)) {
            await fetchQuota(connectionId, provider);
          }
        }
      } catch (error) {
        console.error("Error saving connection:", error);
      }
    },
    [selectedConnection, fetchQuota, forceRefresh]
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/proxy-pools?isActive=true", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data?.proxyPools) {
          setProxyPools(data.proxyPools);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const eligibleConnections = useMemo(
    () => connections.filter(isUsageEligible),
    [connections]
  );

  const providerIds = useMemo(
    () =>
      [...new Set(eligibleConnections.map((connection) => connection.provider))].sort(
        (a, b) =>
          USAGE_SUPPORTED_PROVIDERS.indexOf(a) - USAGE_SUPPORTED_PROVIDERS.indexOf(b)
      ),
    [eligibleConnections]
  );

  const visibleConnections = useMemo(
    () =>
      eligibleConnections.filter(
        (connection) =>
          providerFilter === "all" || connection.provider === providerFilter
      ),
    [eligibleConnections, providerFilter]
  );

  const groupedConnections = useMemo(() => {
    const map = new Map();
    visibleConnections.forEach((connection) => {
      if (!map.has(connection.provider)) {
        map.set(connection.provider, []);
      }
      map.get(connection.provider).push(connection);
    });

    return [...map.entries()]
      .sort(
        ([providerA], [providerB]) =>
          USAGE_SUPPORTED_PROVIDERS.indexOf(providerA) -
          USAGE_SUPPORTED_PROVIDERS.indexOf(providerB)
      )
      .map(([provider, items]) => ({
        provider,
        items: [...items].sort((a, b) =>
          getConnectionLabel(a).localeCompare(getConnectionLabel(b))
        ),
      }));
  }, [visibleConnections]);

  const summary = useMemo(() => {
    const lowQuotaAccounts = eligibleConnections.filter((connection) =>
      isConnectionLowQuota(quotaData[connection.id])
    ).length;
    return {
      providers: providerIds.length,
      accounts: eligibleConnections.length,
      activeAccounts: eligibleConnections.filter(
        (connection) => connection.isActive !== false
      ).length,
      lowQuotaAccounts,
      codexAccounts: eligibleConnections.filter(
        (connection) => connection.provider === "codex"
      ).length,
    };
  }, [eligibleConnections, providerIds, quotaData]);

  if (!connectionsLoading && eligibleConnections.length === 0) {
    return (
      <Card padding="lg">
        <div className="py-12 text-center">
          <span className="material-symbols-outlined text-[64px] text-text-muted opacity-20">
            cloud_off
          </span>
          <h3 className="mt-4 text-lg font-semibold text-text-primary">
            No Providers Connected
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">
            Connect supported providers to track quota windows, session limits,
            weekly limits, and Codex account usage in one dashboard.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="quota-dashboard">
      <div className="quota-hero">
        <div className="quota-hero-copy">
          <div className="quota-hero-title-row">
            <span className="material-symbols-outlined quota-hero-icon">
              donut_large
            </span>
            <h1 className="quota-hero-title">Quota Monitor</h1>
          </div>
          <p className="quota-hero-subtitle">
            Grouped by provider, with per-account quota windows and richer Codex
            session details.
          </p>
        </div>

        <div className="quota-hero-actions">
          <span
            className={`quota-toolbar-button is-active`}
            title={connected ? "Realtime SSE connected" : "SSE disconnected — reconnecting..."}
          >
            <span
              className="quota-sse-dot"
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: connected ? "#22c55e" : "#ef4444",
                boxShadow: connected ? "0 0 6px #22c55e" : "none",
              }}
            />
            <span>{connected ? "Live" : "Reconnecting..."}</span>
          </span>

          <div className="view-mode-toggle">
            <button
              type="button"
              className={`view-mode-btn${viewMode === "compact" ? " is-active" : ""}`}
              onClick={() => setViewMode("compact")}
            >
              Compact
            </button>
            <button
              type="button"
              className={`view-mode-btn${viewMode === "grouped" ? " is-active" : ""}`}
              onClick={() => setViewMode("grouped")}
            >
              Grouped
            </button>
          </div>

          <button
            type="button"
            onClick={forceRefresh}
            disabled={!connected}
            className="quota-toolbar-button"
            title="Force refresh all quotas"
          >
            <span className="material-symbols-outlined">
              refresh
            </span>
            <span>Refresh All</span>
          </button>
        </div>
      </div>

      <div className="quota-summary-grid">
        <SummaryCard
          label="NHÀ CUNG CẤP"
          value={summary.providers}
          note={`${providerFilter === "all" ? "All supported providers" : "Filtered provider view"}`}
          tone="orange"
        />
        <SummaryCard
          label="Accounts"
          value={`${summary.activeAccounts}/${summary.accounts}`}
          note="Active accounts / total tracked accounts"
          tone="green"
        />
        <SummaryCard
          label="Quota Alerts"
          value={summary.lowQuotaAccounts}
          note="Accounts with one or more windows near depletion"
          tone="red"
        />
        <SummaryCard
          label="Codex Accounts"
          value={summary.codexAccounts}
          note={lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Waiting for first sync"}
          tone="violet"
        />
      </div>

      <div className="quota-provider-tabs">
        <button
          type="button"
          className={`quota-provider-tab${providerFilter === "all" ? " is-active" : ""}`}
          onClick={() => setProviderFilter("all")}
        >
          <span>All</span>
          <span className="quota-provider-tab-count">{eligibleConnections.length}</span>
        </button>
        {providerIds.map((providerId) => {
          const meta = getProviderMeta(providerId);
          const count = eligibleConnections.filter(
            (connection) => connection.provider === providerId
          ).length;
          return (
            <button
              key={providerId}
              type="button"
              className={`quota-provider-tab${providerFilter === providerId ? " is-active" : ""}`}
              onClick={() => setProviderFilter(providerId)}
            >
              <ProviderIcon
                src={`/providers/${providerId}.png`}
                alt={meta.name}
                size={18}
                className="size-[18px] rounded object-contain"
                fallbackText={meta.textIcon}
              />
              <span>{meta.name}</span>
              <span className="quota-provider-tab-count">{count}</span>
            </button>
          );
        })}
      </div>

      {connectionsLoading ? (
        <div className="quota-loading-shell">
          <span className="material-symbols-outlined animate-spin text-[32px]">
            progress_activity
          </span>
        </div>
      ) : viewMode === "compact" ? (
        <div className="acct-compact-grid">
          {visibleConnections.map((connection) => {
            const quotaEntry = quotaData[connection.id];
            const connectionError = errors[connection.id];
            const isLoading = loading[connection.id];
            const rowBusy =
              deletingId === connection.id || togglingId === connection.id;

            return (
              <AccountCard
                key={connection.id}
                connection={connection}
                quotaEntry={quotaEntry}
                error={connectionError}
                isLoading={isLoading}
                nowMs={nowMs}
                onRefresh={refreshProvider}
                onDelete={handleDeleteConnection}
                onToggle={handleToggleConnectionActive}
                onToggleKiroLimit={handleToggleKiroLimit}
                onEdit={(conn) => {
                  setSelectedConnection(conn);
                  setShowEditModal(true);
                }}
                refreshing={isLoading}
                deleting={deletingId === connection.id}
                toggling={togglingId === connection.id}
                kiroLimitToggling={kiroBillingTogglingId === connection.id}
                proxyPools={proxyPools}
              />
            );
          })}
        </div>
      ) : (
        groupedConnections.map(({ provider, items }) => {
          const meta = getProviderMeta(provider);
          const activeCount = items.filter((connection) => connection.isActive !== false).length;
          const warningCount = items.filter((connection) =>
            isConnectionLowQuota(quotaData[connection.id])
          ).length;

          return (
            <section
              key={provider}
              className="quota-provider-section"
              style={{ "--quota-provider-color": meta.color }}
            >
              <div className="quota-provider-section-head">
                <div className="quota-provider-section-copy">
                  <div className="quota-provider-section-title-row">
                    <div className="quota-provider-section-icon-shell">
                      <ProviderIcon
                        src={`/providers/${provider}.png`}
                        alt={meta.name}
                        size={30}
                        className="size-[30px] rounded object-contain"
                        fallbackText={meta.textIcon}
                        fallbackColor={meta.color}
                      />
                    </div>
                    <div>
                      <h2 className="quota-provider-section-title">{meta.name}</h2>
                      <p className="quota-provider-section-note">
                        {activeCount}/{items.length} active
                        {warningCount > 0 ? ` • ${warningCount} alert` : " • healthy"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="quota-provider-grid">
                {items.map((connection) => {
                  const quotaEntry = quotaData[connection.id];
                  const connectionError = errors[connection.id];
                  const isLoading = loading[connection.id];
                  const rowBusy =
                    deletingId === connection.id || togglingId === connection.id;
                  const status = getConnectionStatus(
                    connection,
                    quotaEntry,
                    connectionError
                  );
                  const planLabel = getPlanLabel(connection, quotaEntry);
                  const planTone = getPlanTone(planLabel);
                  const soonestReset = getSoonestReset(quotaEntry);
                  const soonestResetCountdown = formatPreciseCountdown(soonestReset, nowMs);
                  const accountId =
                    connection.providerSpecificData?.chatgptAccountId || "";
                  const limitHit = Boolean(
                    quotaEntry?.raw?.limitReached || quotaEntry?.raw?.reviewLimitReached
                  );
                  const showKiroOverage = isKiroProAccount(connection, quotaEntry);
                  const kiroBillingBusy = kiroBillingTogglingId === connection.id;

                  return (
                    <Card
                      key={connection.id}
                      padding="none"
                      className={`quota-connection-card tone-${status.tone}${connection.isActive === false ? " is-inactive" : ""}${limitHit ? " is-limit-hit" : ""}`}
                    >
                      <div className="quota-connection-head">
                        <div className="quota-connection-identity">
                          <div className="quota-connection-avatar-shell">
                            <ProviderIcon
                              src={`/providers/${connection.provider}.png`}
                              alt={meta.name}
                              size={28}
                              className="size-7 rounded object-contain"
                              fallbackText={meta.textIcon}
                              fallbackColor={meta.color}
                            />
                          </div>
                          <div className="quota-connection-copy">
                            <div className="quota-connection-title-row">
                              <h3 className="quota-connection-provider">{meta.name}</h3>
                              {planLabel && (
                                <span className={`quota-chip tone-${planTone}`}>
                                  {planLabel}
                                </span>
                              )}
                            </div>
                            <div className="quota-connection-account">
                              {getConnectionLabel(connection)}
                            </div>
                          </div>
                        </div>

                        <div className="quota-connection-actions">
                          <div className={`quota-connection-status tone-${status.tone}`}>
                            <span className="quota-connection-status-dot" />
                            <span>{getConnectionStatusText(status)}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => refreshProvider(connection.id, connection.provider)}
                            disabled={isLoading || rowBusy}
                            className="quota-icon-button"
                            title="Refresh quota"
                          >
                            <span
                              className={`material-symbols-outlined${isLoading ? " animate-spin" : ""}`}
                            >
                              refresh
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedConnection(connection);
                              setShowEditModal(true);
                            }}
                            disabled={rowBusy}
                            className="quota-icon-button"
                            title="Edit connection"
                          >
                            <span className="material-symbols-outlined">edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteConnection(connection.id)}
                            disabled={rowBusy}
                            className="quota-icon-button tone-red"
                            title="Delete connection"
                          >
                            <span className="material-symbols-outlined">delete</span>
                          </button>
                          <Toggle
                            size="sm"
                            checked={connection.isActive ?? true}
                            disabled={rowBusy || kiroBillingBusy}
                            onChange={(nextActive) =>
                              handleToggleConnectionActive(connection.id, nextActive)
                            }
                          />
                        </div>
                      </div>

                      <div className="quota-connection-meta">
                        <span className="quota-meta-pill">
                          <span className="material-symbols-outlined text-[13px]">schedule</span>
                          {soonestReset ? (
                            <>
                              <span>Next reset</span>
                              <span className="quota-reset-pill-time">
                                {soonestResetCountdown !== "-" ? soonestResetCountdown : formatResetTime(soonestReset)}
                              </span>
                            </>
                          ) : "No reset window"}
                        </span>
                        {accountId && (
                          <span className="quota-meta-pill">
                            <span className="material-symbols-outlined text-[13px]">badge</span>
                            {truncateMiddle(accountId)}
                          </span>
                        )}
                      </div>

                      <div className={`quota-connection-body${limitHit ? " has-limit-hit" : ""}`}>
                        {isLoading ? (
                          <div className="quota-card-state">
                            <span className="material-symbols-outlined animate-spin text-[28px]">
                              progress_activity
                            </span>
                          </div>
                        ) : connectionError ? (
                          <div className="quota-card-state tone-red">
                            <span className="material-symbols-outlined text-[26px]">error</span>
                            <p>{connectionError}</p>
                          </div>
                        ) : quotaEntry?.message ? (
                          <div className="quota-card-state">
                            <span className="material-symbols-outlined text-[24px]">info</span>
                            <p>{quotaEntry.message}</p>
                          </div>
                        ) : quotaEntry?.quotas?.length ? (
                          <div className="quota-rows">
                            {limitHit && (
                              <div className="quota-limit-hit-banner">LIMIT HIT</div>
                            )}
                            {quotaEntry.quotas.map((quota) => (
                              <LiveQuotaRow
                                key={`${connection.id}-${quota.name}`}
                                quota={quota}
                                nowMs={nowMs}
                                isLimitHit={limitHit}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="quota-card-state">
                            <span className="material-symbols-outlined text-[24px]">data_usage</span>
                            <p>No quota data available.</p>
                          </div>
                        )}
                        {showKiroOverage && !connectionError && (
                          <KiroOveragePanel
                            connection={connection}
                            quotaEntry={quotaEntry}
                            busy={rowBusy || kiroBillingBusy}
                            onToggle={handleToggleKiroLimit}
                          />
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => {
          setShowEditModal(false);
          setSelectedConnection(null);
        }}
      />
    </div>
  );
}
