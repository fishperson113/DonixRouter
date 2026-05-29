"use client";

import { useState, useMemo, Fragment } from "react";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(n || 0))}`;
const fmtCompact = (n) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n || 0}`;
};

function fmtTime(iso) {
  if (!iso) return "Never";
  const diffMins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  if (diffMins < 43200) return `${Math.floor(diffMins / 1440)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtFirstUsed(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { label, sub: `${diffDays} days ago` };
}

function getProviderIcon(provider) {
  const p = getProviderByAlias(provider) || AI_PROVIDERS[provider];
  const id = p?.id || provider || "";
  return { src: `/providers/${id}.png`, fallbackText: p?.textIcon || id?.slice(0, 2)?.toUpperCase() || "AI" };
}

function getProviderName(alias) {
  const p = getProviderByAlias(alias) || AI_PROVIDERS[alias];
  return p?.name || alias || "—";
}

function SortArrow({ active, order }) {
  return (
    <span className="inline-flex flex-col gap-[1px] ml-1.5 align-middle" style={{ opacity: active ? 1 : 0.3 }}>
      {order === "asc" ? (
        <svg width="6" height="4" viewBox="0 0 6 4" fill="currentColor"><path d="M3 0l3 4H0z" /></svg>
      ) : (
        <svg width="6" height="4" viewBox="0 0 6 4" fill="currentColor"><path d="M3 4l3-4H0z" /></svg>
      )}
    </span>
  );
}

export default function ModelUsageTable({ stats, connected }) {
  const [sortBy, setSortBy] = useState("cost");
  const [sortOrder, setSortOrder] = useState("desc");
  const [expandedId, setExpandedId] = useState(null);
  const [filter, setFilter] = useState("");

  const models = useMemo(() => {
    if (!stats?.byModel) return [];
    return Object.entries(stats.byModel).map(([key, data]) => {
      const inputCost = data.inputCost || (data.cost ? data.cost * 0.85 : 0);
      const outputCost = data.outputCost || (data.cost ? data.cost * 0.15 : 0);
      return {
        id: key,
        model: data.rawModel || key,
        provider: data.provider || "—",
        requests: data.requests || 0,
        lastUsed: data.lastUsed,
        firstUsed: data.firstUsed,
        promptTokens: data.promptTokens || 0,
        completionTokens: data.completionTokens || 0,
        totalTokens: (data.promptTokens || 0) + (data.completionTokens || 0),
        cachedTokens: data.cachedTokens || 0,
        inputCost,
        outputCost,
        cost: data.cost || 0,
      };
    });
  }, [stats?.byModel]);

  const filtered = useMemo(() => {
    let list = models;
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter((m) => m.model.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let va, vb;
      switch (sortBy) {
        case "model": va = a.model; vb = b.model; return sortOrder === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
        case "requests": va = a.requests; vb = b.requests; break;
        case "lastUsed": va = new Date(a.lastUsed || 0).getTime(); vb = new Date(b.lastUsed || 0).getTime(); break;
        case "inputCost": va = a.inputCost; vb = b.inputCost; break;
        case "outputCost": va = a.outputCost; vb = b.outputCost; break;
        default: va = a.cost; vb = b.cost;
      }
      return sortOrder === "asc" ? va - vb : vb - va;
    });
    return list;
  }, [models, filter, sortBy, sortOrder]);

  const totals = useMemo(() => {
    return models.reduce(
      (acc, m) => ({
        requests: acc.requests + m.requests,
        cost: acc.cost + m.cost,
      }),
      { requests: 0, cost: 0 }
    );
  }, [models]);

  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  return (
    <div className="mu-container">
      {/* Header */}
      <div className="mu-header">
        <div>
          <h2 className="mu-title">Model Usage</h2>
          <p className="mu-subtitle">API cost breakdown by model</p>
        </div>
        <div className="mu-chips">
          <div className="mu-chip">
            <span className="mu-chip-label">Total requests</span>
            <span className="mu-chip-value">{fmt(totals.requests)}</span>
          </div>
          <div className="mu-chip accent">
            <span className="mu-chip-label">Total spend</span>
            <span className="mu-chip-value">{fmtCost(totals.cost)}</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="mu-table-wrap">
        {/* Toolbar */}
        <div className="mu-toolbar">
          <div className="mu-search">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="7" cy="7" r="5" /><path d="M12 12l2.5 2.5" />
            </svg>
            <input
              type="text"
              placeholder="Filter models..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="mu-search-input"
            />
          </div>
          <div className="mu-toolbar-right">
            <span className={`mu-live-indicator ${connected ? "is-live" : ""}`}>
              <span className="mu-live-dot" />
              {connected ? "Live" : "Offline"}
            </span>
          </div>
        </div>

        {/* Table */}
        <table className="mu-table">
          <thead>
            <tr>
              <th style={{ width: 260 }} onClick={() => toggleSort("model")}>
                Model <SortArrow active={sortBy === "model"} order={sortOrder} />
              </th>
              <th>Provider</th>
              <th onClick={() => toggleSort("requests")}>
                Requests <SortArrow active={sortBy === "requests"} order={sortOrder} />
              </th>
              <th onClick={() => toggleSort("lastUsed")}>
                Last used <SortArrow active={sortBy === "lastUsed"} order={sortOrder} />
              </th>
              <th onClick={() => toggleSort("inputCost")}>
                Input cost <SortArrow active={sortBy === "inputCost"} order={sortOrder} />
              </th>
              <th onClick={() => toggleSort("outputCost")}>
                Output cost <SortArrow active={sortBy === "outputCost"} order={sortOrder} />
              </th>
              <th onClick={() => toggleSort("cost")}>
                Total cost <SortArrow active={sortBy === "cost"} order={sortOrder} />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="mu-empty">No models found.</td></tr>
            ) : filtered.map((m) => {
              const provIcon = getProviderIcon(m.provider);
              const isExpanded = expandedId === m.id;
              const isRecent = m.lastUsed && (Date.now() - new Date(m.lastUsed)) < 3600000;
              const first = fmtFirstUsed(m.firstUsed);
              const costPct = m.cost > 0 ? Math.round((m.inputCost / m.cost) * 100) : 0;

              return (
                <Fragment key={m.id}>
                  <tr className={isExpanded ? "expanded" : ""} onClick={() => setExpandedId(isExpanded ? null : m.id)}>
                    <td>
                      <div className="mu-model-cell">
                        <div className={`mu-expand-arrow ${isExpanded ? "open" : ""}`}>
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M2 1l4 3-4 3" />
                          </svg>
                        </div>
                        <div className="mu-model-icon">
                          <img
                            src={provIcon.src}
                            alt={provIcon.fallbackText}
                            width={20}
                            height={20}
                            style={{ borderRadius: 4, objectFit: "contain" }}
                            onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
                          />
                          <span className="mu-model-icon-fallback" style={{ display: "none" }}>{provIcon.fallbackText}</span>
                        </div>
                        <div>
                          <div className="mu-model-name">{m.model}</div>
                          <div className="mu-model-sub">{getProviderName(m.provider)}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className="mu-provider-badge">{getProviderName(m.provider)}</span></td>
                    <td><span className="mu-mono">{fmt(m.requests)}</span></td>
                    <td>
                      <span className="mu-last-used">
                        {isRecent && <span className="mu-live-dot" />}
                        {fmtTime(m.lastUsed)}
                      </span>
                    </td>
                    <td><span className="mu-cost mu-cost-input">{fmtCost(m.inputCost)}</span></td>
                    <td><span className="mu-cost mu-cost-output">{fmtCost(m.outputCost)}</span></td>
                    <td><span className="mu-cost mu-cost-total">{fmtCost(m.cost)}</span></td>
                  </tr>
                  {isExpanded && (
                    <tr className="mu-expanded-row">
                      <td colSpan={7}>
                        <div className="mu-expanded-content">
                          <div className="mu-stat-card">
                            <div className="mu-stat-label">Avg. cost / req</div>
                            <div className="mu-stat-value">{m.requests > 0 ? fmtCost(m.cost / m.requests) : "—"}</div>
                            <div className="mu-stat-sub">per request</div>
                          </div>
                          <div className="mu-stat-card">
                            <div className="mu-stat-label">Input tokens</div>
                            <div className="mu-stat-value">{fmtCompact(m.promptTokens)}</div>
                            <div className="mu-stat-sub">{fmtCost(m.inputCost)} total</div>
                            <div className="mu-cost-bar-wrap"><div className="mu-cost-bar" style={{ width: `${costPct}%` }} /></div>
                          </div>
                          <div className="mu-stat-card">
                            <div className="mu-stat-label">Output tokens</div>
                            <div className="mu-stat-value">{fmtCompact(m.completionTokens)}</div>
                            <div className="mu-stat-sub">{fmtCost(m.outputCost)} total</div>
                            <div className="mu-cost-bar-wrap"><div className="mu-cost-bar" style={{ width: `${100 - costPct}%` }} /></div>
                          </div>
                          <div className="mu-stat-card">
                            <div className="mu-stat-label">Total tokens</div>
                            <div className="mu-stat-value">{fmtCompact(m.totalTokens)}</div>
                            <div className="mu-stat-sub">{m.cachedTokens > 0 ? `${fmtCompact(m.cachedTokens)} cached` : `${fmt(m.requests)} requests`}</div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {/* Footer */}
        <div className="mu-footer">
          <span className="mu-footer-left">Showing {filtered.length} of {models.length} models</span>
        </div>
      </div>
    </div>
  );
}
