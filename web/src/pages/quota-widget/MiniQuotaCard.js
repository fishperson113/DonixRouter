"use client";

import ProviderIcon from "@/shared/components/ProviderIcon";
import { formatResetTime, calculatePercentage } from "../usage/components/ProviderLimits/utils";

function getQuotaRemaining(quota) {
  if (quota.remainingPercentage !== undefined) {
    return Math.max(0, Math.min(100, Math.round(quota.remainingPercentage)));
  }
  return calculatePercentage(quota.used, quota.total);
}

function shortLabel(name) {
  const map = {
    session: "Session",
    weekly: "Weekly",
    review_session: "Review 5h",
    review_weekly: "Review 7d",
    chat: "Chat",
    completions: "Code",
  };
  return map[name] || String(name).replace(/_/g, " ");
}

function formatCountdown(resetAt, nowMs) {
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

function MiniBar({ label, quota, nowMs, limitHit }) {
  const remaining = getQuotaRemaining(quota);
  const usedPct = Math.max(0, 100 - remaining);
  const tone = usedPct >= 80 ? "high" : usedPct >= 40 ? "mid" : "low";
  const countdown = formatCountdown(quota.resetAt, nowMs);
  const fallback = formatResetTime(quota.resetAt);

  return (
    <div className={`acct-pct${limitHit ? " is-reached" : ""}`}>
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
      {(countdown || (fallback !== "-" && fallback)) && (
        <span className={`acct-pct-reset${usedPct >= 80 ? " is-alert" : ""}`}>
          {countdown || fallback}
        </span>
      )}
    </div>
  );
}

export default function MiniQuotaCard({ connection, providerMeta, quotaEntry, error, nowMs }) {
  const label =
    connection.email ||
    connection.displayName ||
    connection.name ||
    "Account";

  const limitHit = Boolean(
    quotaEntry?.raw?.limitReached ||
    quotaEntry?.raw?.reviewLimitReached ||
    (quotaEntry?.quotas || []).some((q) => q.total > 0 && getQuotaRemaining(q) <= 5)
  );

  let statusLabel = "Hoạt động";
  let statusTone = "green";
  if (connection.isActive === false) {
    statusLabel = "Tạm dừng";
    statusTone = "slate";
  } else if (error) {
    statusLabel = "Lỗi";
    statusTone = "red";
  } else if (limitHit) {
    statusLabel = "Đã đạt giới hạn";
    statusTone = "red";
  }

  const quotas = (quotaEntry?.quotas || []).filter((q) => q.total > 0);

  return (
    <div className={`quota-widget-card${limitHit ? " is-hit" : ""}`}>
      <div className="quota-widget-card-head">
        <div className="quota-widget-card-id">
          <ProviderIcon
            src={`/providers/${connection.provider}.png`}
            alt={providerMeta.name}
            size={22}
            className="size-[22px] rounded object-contain"
            fallbackText={providerMeta.textIcon}
            fallbackColor={providerMeta.color}
          />
          <span className="quota-widget-card-email" title={label}>
            {label}
          </span>
        </div>
        <span className={`quota-widget-status tone-${statusTone}`}>{statusLabel}</span>
      </div>

      {error ? (
        <div className="quota-widget-empty">{error}</div>
      ) : quotaEntry?.message && !quotas.length ? (
        <div className="quota-widget-empty">{quotaEntry.message}</div>
      ) : quotas.length ? (
        quotas.map((q) => (
          <MiniBar
            key={q.name}
            label={shortLabel(q.name)}
            quota={q}
            nowMs={nowMs}
            limitHit={limitHit}
          />
        ))
      ) : (
        <div className="quota-widget-empty">Đang tải quota…</div>
      )}
    </div>
  );
}
