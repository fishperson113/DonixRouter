"use client";

import ProviderIcon from "@/shared/components/ProviderIcon";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { formatResetTime, calculatePercentage } from "./utils";

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

function isPlusAccount(planLabel) {
  const v = String(planLabel || "").toLowerCase();
  return v.includes("plus") || v.includes("pro") || v.includes("enterprise") || v.includes("team");
}

function getPlanTone(planLabel) {
  return isPlusAccount(planLabel) ? "plus" : "free";
}

function getQuotaRemaining(quota) {
  if (quota.remainingPercentage !== undefined) {
    return Math.max(0, Math.min(100, Math.round(quota.remainingPercentage)));
  }
  return calculatePercentage(quota.used, quota.total);
}

function pctTone(usedPct) {
  if (usedPct >= 80) return "high";
  if (usedPct >= 40) return "mid";
  return "low";
}

function shortWindowLabel(name) {
  const map = {
    session: "5h",
    weekly: "7d",
    review_session: "Rev 5h",
    review_weekly: "Rev 7d",
    chat: "Chat",
    completions: "Code",
    premium_interactions: "Premium",
    agentic_request: "Agent",
  };
  if (map[name]) return map[name];
  return String(name)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatPreciseCountdown(resetAt, nowMs = Date.now()) {
  if (!resetAt) return null;
  try {
    const targetMs = new Date(resetAt).getTime();
    if (!Number.isFinite(targetMs)) return null;
    const totalSeconds = Math.ceil((targetMs - nowMs) / 1000);
    if (totalSeconds <= 0) return null;
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
  } catch {
    return null;
  }
}

function PctBar({ label, usedPct, resetAt, nowMs, limitReached }) {
  const remaining = Math.max(0, 100 - usedPct);
  const tone = pctTone(usedPct);
  const countdown = formatPreciseCountdown(resetAt, nowMs);
  const fallback = formatResetTime(resetAt);
  const resetStr = countdown || (fallback !== "-" ? fallback : null);

  return (
    <div className={`acct-pct${limitReached ? " is-reached" : ""}`}>
      <span className={`acct-pct-dot acct-pct-tone-${tone}`} />
      <span className="acct-pct-label">{label}</span>
      <div className="acct-pct-track">
        <div
          className={`acct-pct-fill acct-pct-tone-${tone}`}
          style={{ width: `${remaining}%` }}
          data-pct={remaining}
        />
      </div>
      <span className={`acct-pct-value acct-pct-tone-${tone}`}>{usedPct}%</span>
      {resetStr && (
        <span className={`acct-pct-reset${usedPct >= 80 ? " is-alert" : ""}`}>
          {countdown ? countdown : `in ${resetStr}`}
        </span>
      )}
    </div>
  );
}

export default function AccountCard({
  connection,
  quotaEntry,
  error,
  isLoading,
  nowMs,
  onRefresh,
  onDelete,
  onToggle,
  onToggleKiroLimit,
  onEdit,
  refreshing = false,
  deleting = false,
  toggling = false,
  kiroLimitToggling = false,
  proxyPools = [],
}) {
  const meta = getProviderMeta(connection.provider);
  const label = getConnectionLabel(connection);
  const planLabel =
    quotaEntry?.raw?.plan ||
    connection.providerSpecificData?.chatgptPlanType ||
    quotaEntry?.plan ||
    "";
  const hasPlan = planLabel && planLabel !== "unknown";
  const planTone = getPlanTone(planLabel);
  const isActive = connection.isActive !== false;
  const busy = refreshing || deleting || toggling;
  const isKiro = connection.provider === "kiro";
  const isKiroPro = isKiro && String(planLabel || "").toLowerCase().includes("pro");
  const kiroLimitKnown = typeof connection.providerSpecificData?.kiroLimitEnabled === "boolean";
  const kiroLimitEnabled = connection.providerSpecificData?.kiroLimitEnabled === true;
  const overageConfig = quotaEntry?.raw?.overageConfiguration || {};
  const kiroOverageEnabled =
    typeof overageConfig.overageEnabled === "boolean"
      ? overageConfig.overageEnabled
      : connection.providerSpecificData?.kiroOverageEnabled === true;
  const overageCharges =
    overageConfig.currentChargesFormatted || overageConfig.chargesFormatted || "$0.00";
  const overageRate = overageConfig.rateFormatted || "$0.04/req";
  const overageUsed = Number(overageConfig.currentOverages) || 0;
  const overageCap = Number(overageConfig.overageCap) || 0;
  const overageText =
    overageConfig.overagesFormatted ||
    (overageCap > 0
      ? `${Math.round(overageUsed).toLocaleString("en-US")} / ${Math.round(overageCap).toLocaleString("en-US")}`
      : "0 / 10,000");
  const overagePct =
    overageCap > 0 ? Math.max(0, Math.min(100, (overageUsed / overageCap) * 100)) : 0;
  const overageTone = overagePct >= 80 ? "red" : overagePct >= 40 ? "amber" : "green";
  const overagePctLabel = `${overagePct.toFixed(overagePct >= 10 ? 0 : 1)}%`;
  const kiroBillingBusy = busy || kiroLimitToggling;

  const limitHit = Boolean(
    quotaEntry?.raw?.limitReached || quotaEntry?.raw?.reviewLimitReached
  );
  const isExhausted = limitHit;

  const quotas = quotaEntry?.quotas || [];

  // Build PctBar rows
  const barRows = quotas
    .filter((q) => q.total > 0)
    .map((q) => {
      const remaining = getQuotaRemaining(q);
      const usedPct = Math.max(0, 100 - remaining);
      return {
        key: q.name,
        label: shortWindowLabel(q.name),
        usedPct,
        resetAt: q.resetAt,
      };
    });

  // Status text
  let statusClass = "is-on";
  let statusLabel = "Hoạt động";
  if (!isActive) {
    statusClass = "is-off";
    statusLabel = "Tạm dừng";
  } else if (isExhausted) {
    statusClass = "is-danger";
    statusLabel = "Đã đạt giới hạn";
  } else if (error) {
    statusClass = "is-warn";
    statusLabel = "Lỗi";
  }

  const cardClass = [
    "acct-glass-card",
    !isActive && "is-inactive",
    isExhausted && "is-exhausted",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cardClass}>
      {/* Row 1: Header */}
      <div className="acct-row-header">
        <div
          className="acct-avatar"
          style={{
            background: `${meta.color}25`,
            border: `1px solid ${meta.color}55`,
            color: meta.color,
          }}
        >
          <ProviderIcon
            src={`/providers/${connection.provider}.png`}
            alt={meta.name}
            size={18}
            className="size-[18px] rounded object-contain"
            fallbackText={meta.textIcon}
            fallbackColor={meta.color}
          />
        </div>

        <div className="acct-id">
          <span className="acct-email" title={label}>
            {label}
          </span>
          {hasPlan && (
            <span className={`acct-plan-tag tone-${planTone}`}>
              {String(planLabel).replace(/_/g, " ")}
            </span>
          )}
        </div>

        <div className="acct-status-actions">
          <span className={`acct-status-text ${statusClass}`}>
            <span className="dot" />
            {statusLabel}
          </span>

          {isExhausted && (
            <span className="acct-danger-badge acct-danger-badge-inline">
              LIMIT HIT
            </span>
          )}

          <button
            type="button"
            className={`acct-icon-btn${isLoading ? " is-spinning" : ""}`}
            title="Refresh quota"
            disabled={busy}
            onClick={() => onRefresh?.(connection.id, connection.provider)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              refresh
            </span>
          </button>

          {onEdit && (
            <button
              type="button"
              className="acct-icon-btn"
              title="Sửa kết nối"
              disabled={busy}
              onClick={() => onEdit?.(connection)}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                edit
              </span>
            </button>
          )}

          <button
            type="button"
            className="acct-icon-btn is-danger"
            title="Xóa kết nối"
            disabled={busy}
            onClick={() => onDelete?.(connection.id)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              delete
            </span>
          </button>

          <button
            type="button"
            className={`acct-toggle${isActive ? " is-on" : ""}`}
            disabled={busy}
            onClick={() => onToggle?.(connection.id, !isActive)}
            title={isActive ? "Tắt" : "Bật"}
          >
            <span className="knob" />
          </button>
        </div>
      </div>

      {/* Row 2: Stats */}
      <div className="acct-row-stats">
        <span className="acct-stat-cell">
          <span className="material-symbols-outlined icon" style={{ fontSize: 14 }}>
            bolt
          </span>
          <span className="label">{meta.name}</span>
        </span>

        <span className="acct-stat-sep">|</span>

        {quotas.length > 0 && (
          <>
            <span className="acct-stat-cell">
              <span className="label">Quota</span>
              <span className="num">{quotas.length}</span>
            </span>
            <span className="acct-stat-sep">|</span>
          </>
        )}

        {connection.providerSpecificData?.chatgptAccountId && (
          <span className="acct-stat-total">
            ID: {connection.providerSpecificData.chatgptAccountId.slice(0, 8)}...
          </span>
        )}

        {proxyPools.length > 0 && (
          <select
            className="acct-proxy-select"
            title="Proxy pool"
            defaultValue=""
          >
            <option value="">Direct</option>
            {proxyPools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name || pool.id}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Row 3: Progress bars */}
      {isLoading ? (
        <div className="acct-row-bars" style={{ padding: "8px 0 4px 33px" }}>
          <div
            style={{
              height: 4,
              borderRadius: 2,
              background: "rgba(255,255,255,0.06)",
              animation: "pulse 1.5s infinite",
            }}
          />
        </div>
      ) : error ? (
        <div className="acct-row-bars" style={{ paddingTop: 4 }}>
          <span style={{ fontSize: 11, color: "#fb7185" }}>{error}</span>
        </div>
      ) : quotaEntry?.message ? (
        <div className="acct-row-bars" style={{ paddingTop: 4 }}>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>{quotaEntry.message}</span>
        </div>
      ) : barRows.length > 0 ? (
        <div className="acct-row-bars">
          {barRows.map((bar) => (
            <PctBar
              key={bar.key}
              label={bar.label}
              usedPct={bar.usedPct}
              resetAt={bar.resetAt}
              nowMs={nowMs}
              limitReached={limitHit}
            />
          ))}
        </div>
      ) : null}

      {isKiroPro && (
        <div className="acct-overage-panel">
          <div className="acct-overage-head">
            <div className="acct-overage-title">
              <span className="material-symbols-outlined acct-overage-icon">bolt</span>
              <span>Overage</span>
              <span className={`acct-overage-state ${kiroOverageEnabled ? "is-enabled" : "is-disabled"}`}>
                {kiroLimitKnown ? (kiroOverageEnabled ? "ENABLED" : "DISABLED") : "UNKNOWN"}
              </span>
            </div>
            <button
              type="button"
              className={`acct-toggle acct-overage-toggle${kiroOverageEnabled ? " is-on" : ""}`}
              disabled={kiroBillingBusy || !onToggleKiroLimit}
              onClick={() => onToggleKiroLimit?.(connection.id, !kiroLimitEnabled)}
              title={kiroLimitEnabled ? "Disable Kiro Pro spending limit" : "Enable Kiro Pro spending limit"}
            >
              <span className="knob" />
            </button>
          </div>
          <div className="acct-overage-grid">
            <div>
              <span className="acct-overage-label">Charges</span>
              <strong className="acct-overage-value">{overageCharges}</strong>
            </div>
            <div>
              <span className="acct-overage-label">Rate</span>
              <strong className="acct-overage-value">{overageRate}</strong>
            </div>
            <div>
              <span className="acct-overage-label">Overages</span>
              <strong className="acct-overage-value">{overageText}</strong>
            </div>
          </div>
          {overageCap > 0 && (
            <div className="acct-overage-bar-row">
              <div className="acct-overage-bar-track">
                <div
                  className={`acct-overage-bar-fill tone-${overageTone}`}
                  style={{ width: `${overagePct}%` }}
                />
              </div>
              <span className={`acct-overage-bar-pct tone-${overageTone}`}>{overagePctLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
