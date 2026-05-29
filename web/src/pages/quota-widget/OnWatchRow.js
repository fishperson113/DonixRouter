"use client";

import { useMemo } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { calculatePercentage } from "../usage/components/ProviderLimits/utils";

function getUsedPct(quota) {
  if (quota.remainingPercentage !== undefined) {
    const remaining = Math.max(0, Math.min(100, Math.round(quota.remainingPercentage)));
    return Math.max(0, 100 - remaining);
  }
  return Math.max(0, 100 - calculatePercentage(quota.used, quota.total));
}

function ringTone(usedPct) {
  if (usedPct >= 80) return "high";
  if (usedPct >= 40) return "mid";
  return "low";
}

function windowLabel(provider, name) {
  const codex = {
    session: "5hr",
    weekly: "Weekly",
    review_session: "Review",
    review_weekly: "Review",
  };
  const github = { chat: "Chat", completions: "Code" };
  const claude = { session: "5hr", weekly: "Weekly" };
  const map = provider === "codex" ? codex : provider === "github" ? github : claude;
  return map[name] || String(name).replace(/_/g, " ");
}

function pickQuotas(provider, quotas) {
  const withTotal = (quotas || []).filter((q) => q.total > 0);
  const order =
    provider === "codex"
      ? ["session", "weekly", "review_weekly", "review_session"]
      : provider === "github"
        ? ["chat", "completions"]
        : provider === "claude"
          ? ["session", "weekly"]
          : [];
  if (!order.length) return withTotal.slice(0, 2);
  const rank = new Map(order.map((n, i) => [n, i]));
  const sorted = [...withTotal].sort((a, b) => (rank.get(a.name) ?? 99) - (rank.get(b.name) ?? 99));
  const seen = new Set();
  const out = [];
  for (const q of sorted) {
    const label = windowLabel(provider, q.name);
    if (label === "Review" && seen.has("Review")) continue;
    seen.add(label);
    out.push(q);
    if (out.length >= 2) break;
  }
  return out;
}

function QuotaRingItem({ label, quota }) {
  const usedPct = getUsedPct(quota);
  const tone = ringTone(usedPct);

  return (
    <div className="quota-ring-item">
      <div className={`quota-ring tone-${tone}`} style={{ "--p": usedPct }}>
        <span>{usedPct}%</span>
      </div>
      <div className="quota-ring-label">{label}</div>
    </div>
  );
}

function shortenAccountName(name) {
  const at = name.indexOf("@");
  if (at > 0) {
    const local = name.slice(0, at);
    return local.length > 14 ? `${local.slice(0, 14)}…` : local;
  }
  return name.length > 16 ? `${name.slice(0, 16)}…` : name;
}

function formatAgo(iso, nowMs) {
  if (!iso) return "—";
  const diff = nowMs - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "—";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${Math.max(1, sec)}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export default function OnWatchRow({
  connection,
  providerMeta,
  quotaEntry,
  error,
  nowMs,
  snapshotAt,
  isCalling = false,
  compact = false,
}) {
  const accountLabel =
    connection.email || connection.displayName || connection.name || "Account";
  const title = compact ? accountLabel : `${providerMeta.name} · ${accountLabel}`;
  const ago = formatAgo(connection.updatedAt || snapshotAt, nowMs);
  const quotas = pickQuotas(connection.provider, quotaEntry?.quotas || []);
  const displayName = shortenAccountName(accountLabel);
  const iconSize = compact ? 18 : 18;

  const quotaSlots = useMemo(
    () =>
      quotas.map((q) => ({
        label: windowLabel(connection.provider, q.name),
        quota: q,
      })),
    [connection.provider, quotas]
  );

  if (compact) {
    return (
      <article
        className={`ow-row account-card${isCalling ? " is-calling" : ""}`}
        style={{ "--ow-accent": providerMeta.color }}
      >
        <div className="account-left">
          <ProviderIcon
            src={`/providers/${connection.provider}.png`}
            alt={providerMeta.name}
            size={iconSize}
            className="account-icon rounded object-contain shrink-0"
            fallbackText={providerMeta.textIcon}
            fallbackColor={providerMeta.color}
          />
          <div className="account-meta">
            <div className="account-name-row">
              <div className="account-name" title={accountLabel}>
                {displayName}
              </div>
              {isCalling ? <span className="ow-row-live">Live</span> : null}
            </div>
            <div className="account-sub">
              {providerMeta.name} · {ago}
            </div>
          </div>
        </div>

        {error ? (
          <p className="account-card-error">{error}</p>
        ) : quotas.length ? (
          <div className="account-right">
            {quotaSlots.map((slot, i) => (
              <QuotaRingItem key={`${slot.label}-${i}`} label={slot.label} quota={slot.quota} />
            ))}
          </div>
        ) : (
          <p className="account-card-muted">Không có quota</p>
        )}
      </article>
    );
  }

  return (
    <article
      className={`ow-row${isCalling ? " is-calling" : ""}`}
      style={{ "--ow-accent": providerMeta.color }}
    >
      <header className="ow-row-head">
        <div className="ow-row-id">
          <ProviderIcon
            src={`/providers/${connection.provider}.png`}
            alt={providerMeta.name}
            size={iconSize}
            className="size-[18px] rounded object-contain shrink-0"
            fallbackText={providerMeta.textIcon}
            fallbackColor={providerMeta.color}
          />
          <span className="ow-row-title" title={title}>
            {title}
          </span>
          {isCalling ? <span className="ow-row-live">Live</span> : null}
        </div>
        <span className="ow-row-ago">{ago}</span>
      </header>
      <div className="ow-bars">
        {error ? (
          <p className="ow-row-error">{error}</p>
        ) : quotas.length ? (
          quotas.map((q) => {
            const usedPct = getUsedPct(q);
            const tone = ringTone(usedPct);
            return (
              <div key={q.name} className="ow-bar">
                <div className="ow-bar-head">
                  <span className="ow-bar-label">{windowLabel(connection.provider, q.name)}</span>
                  <span className={`ow-bar-pct tone-${tone}`}>{usedPct}%</span>
                </div>
                <div className="ow-bar-track">
                  <div className={`ow-bar-fill tone-${tone}`} style={{ width: `${usedPct}%` }} />
                </div>
              </div>
            );
          })
        ) : (
          <p className="ow-row-muted">Không có quota</p>
        )}
      </div>
    </article>
  );
}
