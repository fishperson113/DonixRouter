"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Drawer from "@/shared/components/Drawer";
import Pagination from "@/shared/components/Pagination";
import Badge from "@/shared/components/Badge";
import { cn } from "@/shared/utils/cn";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";

let providerNameCache = null;
let providerNodesCache = null;

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "success", label: "Success" },
  { value: "error", label: "Error" },
];

async function fetchProviderNames() {
  if (providerNameCache && providerNodesCache) {
    return { providerNameCache, providerNodesCache };
  }

  const nodesRes = await fetch("/api/provider-nodes");
  const nodesData = await nodesRes.json();
  const nodes = nodesData.nodes || [];
  providerNodesCache = {};

  for (const node of nodes) {
    providerNodesCache[node.id] = node.name;
  }

  providerNameCache = {
    ...AI_PROVIDERS,
    ...providerNodesCache,
  };

  return { providerNameCache, providerNodesCache };
}

function getProviderName(providerId, cache) {
  if (!providerId) return providerId;
  if (!cache) return providerId;

  const cached = cache[providerId];
  if (typeof cached === "string") return cached;
  if (cached?.name) return cached.name;

  const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  return providerConfig?.name || providerId;
}

function getInputTokens(tokens) {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  const cache = tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
  return prompt < cache ? cache : prompt;
}

function getOutputTokens(tokens) {
  return tokens?.completion_tokens || tokens?.output_tokens || 0;
}

function getReasoningTokens(tokens) {
  return tokens?.reasoning_tokens || tokens?.completion_tokens_details?.reasoning_tokens || 0;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatTimestamp(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatDateShort(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMs(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0 ms";
  if (num >= 1000) return `${(num / 1000).toFixed(2)}s`;
  return `${num} ms`;
}

function formatJsonValue(value) {
  if (value == null) return "[empty]";
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getStatusVariant(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "success" || normalized === "ok" || normalized === "200 ok") return "success";
  if (normalized.includes("pending")) return "warning";
  return "error";
}

function normalizeStatusLabel(status) {
  if (!status) return "unknown";
  return String(status).replaceAll("_", " ");
}

function shortenId(value, size = 10) {
  if (!value || value.length <= size * 2) return value || "n/a";
  return `${value.slice(0, size)}...${value.slice(-size)}`;
}

function CopyButton({ value, label = "Copy" }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatJsonValue(value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      console.error("Failed to copy detail block:", error);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="detail-copy-btn"
    >
      <span className="material-symbols-outlined text-[15px]">{copied ? "done" : "content_copy"}</span>
      {copied ? "Copied" : label}
    </button>
  );
}

function DetailMetric({ label, value, subvalue, accent = "default" }) {
  return (
    <div className={cn("detail-metric-card", accent !== "default" && `is-${accent}`)}>
      <div className="detail-metric-label">{label}</div>
      <div className="detail-metric-value">{value}</div>
      {subvalue ? <div className="detail-metric-sub">{subvalue}</div> : null}
    </div>
  );
}

function FilterField({ label, children }) {
  return (
    <label className="detail-filter-field">
      <span className="detail-filter-label">{label}</span>
      {children}
    </label>
  );
}

function CollapsibleSection({ title, subtitle, children, defaultOpen = false, icon = null, value }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="detail-section">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="detail-section-toggle"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {icon ? <span className="material-symbols-outlined text-[18px] text-[#f2b64f]">{icon}</span> : null}
            <span className="detail-section-title">{title}</span>
          </div>
          {subtitle ? <p className="detail-section-subtitle">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <CopyButton value={value} />
          <span className={cn("material-symbols-outlined detail-chevron", isOpen && "rotate-90")}>
            chevron_right
          </span>
        </div>
      </button>

      {isOpen ? <div className="detail-section-body">{children}</div> : null}
    </section>
  );
}

function EmptyState({ title, message, icon = "list_alt" }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="detail-empty-icon">
        <span className="material-symbols-outlined text-[26px]">{icon}</span>
      </div>
      <div>
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="mt-1 text-sm text-slate-400">{message}</div>
      </div>
    </div>
  );
}

export default function RequestDetailsTab() {
  const [details, setDetails] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providerNameState, setProviderNameState] = useState(null);
  const [filters, setFilters] = useState({
    provider: "",
    model: "",
    status: "",
    startDate: "",
    endDate: "",
  });

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/providers");
      const data = await res.json();
      setProviders(data.providers || []);

      const cache = await fetchProviderNames();
      setProviderNameState(cache.providerNameCache);
    } catch (error) {
      console.error("Failed to fetch providers:", error);
    }
  }, []);

  const fetchDetails = useCallback(async () => {
    setLoading(true);

    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString(),
      });

      if (filters.provider) params.append("provider", filters.provider);
      if (filters.model.trim()) params.append("model", filters.model.trim());
      if (filters.status) params.append("status", filters.status);
      if (filters.startDate) params.append("startDate", filters.startDate);
      if (filters.endDate) params.append("endDate", filters.endDate);

      const res = await fetch(`/api/usage/request-details?${params}`);
      const data = await res.json();

      setDetails(data.details || []);
      if (data.pagination) {
        setPagination((prev) => {
          if (prev.totalItems === data.pagination.totalItems && prev.totalPages === data.pagination.totalPages && prev.page === data.pagination.page) return prev;
          return { ...prev, totalItems: data.pagination.totalItems, totalPages: data.pagination.totalPages };
        });
      }
    } catch (error) {
      console.error("Failed to fetch request details:", error);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.pageSize, filters.provider, filters.model, filters.status, filters.startDate, filters.endDate]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const handleViewDetail = (detail) => {
    setSelectedDetail(detail);
    setIsDrawerOpen(true);
  };

  const handlePageChange = (newPage) => {
    setPagination((prev) => ({ ...prev, page: newPage }));
  };

  const handlePageSizeChange = (newPageSize) => {
    setPagination((prev) => ({ ...prev, pageSize: newPageSize, page: 1 }));
  };

  const handleClearFilters = () => {
    setFilters({
      provider: "",
      model: "",
      status: "",
      startDate: "",
      endDate: "",
    });
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const summary = useMemo(() => {
    const visible = details.length;
    const inputTokens = details.reduce((sum, detail) => sum + getInputTokens(detail.tokens), 0);
    const outputTokens = details.reduce((sum, detail) => sum + getOutputTokens(detail.tokens), 0);
    const avgLatency = visible
      ? Math.round(details.reduce((sum, detail) => sum + Number(detail.latency?.total || 0), 0) / visible)
      : 0;
    const successCount = details.filter((detail) => getStatusVariant(detail.status) === "success").length;
    const successRate = visible ? Math.round((successCount / visible) * 100) : 0;

    return {
      visible,
      inputTokens,
      outputTokens,
      avgLatency,
      successRate,
    };
  }, [details]);

  const hasFilters = Boolean(
    filters.provider ||
    filters.model.trim() ||
    filters.status ||
    filters.startDate ||
    filters.endDate
  );

  const selectedMetrics = useMemo(() => {
    if (!selectedDetail) return null;

    return {
      input: getInputTokens(selectedDetail.tokens),
      output: getOutputTokens(selectedDetail.tokens),
      reasoning: getReasoningTokens(selectedDetail.tokens),
      ttft: selectedDetail.latency?.ttft || 0,
      total: selectedDetail.latency?.total || 0,
    };
  }, [selectedDetail]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card padding="md" className="request-details-shell request-details-grid">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="request-details-kicker">Request Analytics</div>
              <h2 className="request-details-title">Detailed request traces for Codex, OpenAI and routed providers</h2>
              <p className="request-details-subtitle">
                Màn này bê theo hướng monitor của codex-proxy: lọc theo provider, model, thời gian; xem raw request, translated payload và final response trong một trace.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="request-details-chip">
                <span className="material-symbols-outlined text-[14px]">database</span>
                {formatNumber(pagination.totalItems)} traces
              </span>
              <span className="request-details-chip">
                <span className="material-symbols-outlined text-[14px]">insights</span>
                {formatNumber(summary.inputTokens + summary.outputTokens)} tokens on page
              </span>
              <span className="request-details-chip">
                <span className="material-symbols-outlined text-[14px]">bolt</span>
                avg {formatMs(summary.avgLatency)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <DetailMetric label="Visible Rows" value={formatNumber(summary.visible)} subvalue="Current page" />
            <DetailMetric label="Input Tokens" value={formatNumber(summary.inputTokens)} subvalue="Prompt + cache read" />
            <DetailMetric label="Output Tokens" value={formatNumber(summary.outputTokens)} subvalue="Completion output" />
            <DetailMetric label="Success Rate" value={`${summary.successRate}%`} subvalue="Per page" accent="success" />
            <DetailMetric label="Avg Total Latency" value={formatMs(summary.avgLatency)} subvalue="Current page" accent="warning" />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <FilterField label="Provider">
              <select
                value={filters.provider}
                onChange={(e) => updateFilter("provider", e.target.value)}
                className="detail-filter-input"
                style={{ colorScheme: "dark" }}
              >
                <option value="">All Providers</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Model Contains">
              <input
                type="text"
                value={filters.model}
                onChange={(e) => updateFilter("model", e.target.value)}
                placeholder="gpt-5, claude, gemini..."
                className="detail-filter-input"
              />
            </FilterField>

            <FilterField label="Status">
              <select
                value={filters.status}
                onChange={(e) => updateFilter("status", e.target.value)}
                className="detail-filter-input"
                style={{ colorScheme: "dark" }}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Start Date">
              <input
                type="datetime-local"
                value={filters.startDate}
                onChange={(e) => updateFilter("startDate", e.target.value)}
                className="detail-filter-input"
              />
            </FilterField>

            <FilterField label="End Date">
              <input
                type="datetime-local"
                value={filters.endDate}
                onChange={(e) => updateFilter("endDate", e.target.value)}
                className="detail-filter-input"
              />
            </FilterField>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={fetchDetails} className="detail-action-btn">
              <span className="material-symbols-outlined text-[18px]">refresh</span>
              Refresh
            </Button>
            <Button
              variant="ghost"
              onClick={handleClearFilters}
              disabled={!hasFilters}
              className="detail-action-btn"
            >
              <span className="material-symbols-outlined text-[18px]">filter_alt_off</span>
              Clear Filters
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="none" className="request-details-shell request-details-table-card">
        {loading ? (
          <EmptyState
            title="Loading request traces"
            message="Đang lấy dữ liệu request-details từ observability store."
            icon="progress_activity"
          />
        ) : details.length === 0 ? (
          <EmptyState
            title="No request traces found"
            message="Chưa có log phù hợp với bộ lọc hiện tại, hoặc observability chưa ghi nhận request nào."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="request-details-table min-w-[1080px] w-full">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Trace</th>
                    <th>Provider</th>
                    <th>Tokens</th>
                    <th>Latency</th>
                    <th>Status</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((detail, index) => {
                    const inputTokens = getInputTokens(detail.tokens);
                    const outputTokens = getOutputTokens(detail.tokens);
                    const providerLabel = getProviderName(detail.provider, providerNameState);
                    const statusVariant = getStatusVariant(detail.status);
                    const endpoint = detail.endpoint || detail.request?.endpoint;

                    return (
                      <tr key={`${detail.id}-${index}`}>
                        <td>
                          <div className="detail-cell-primary">{formatTimestamp(detail.timestamp)}</div>
                          <div className="detail-cell-secondary">{formatDateShort(detail.timestamp)}</div>
                        </td>
                        <td>
                          <div className="detail-cell-primary font-mono">{detail.model}</div>
                          <div className="detail-cell-secondary font-mono">
                            {endpoint || shortenId(detail.id, 8)}
                          </div>
                        </td>
                        <td>
                          <div className="detail-cell-primary">{providerLabel}</div>
                          <div className="detail-cell-secondary font-mono">
                            {detail.connectionId ? shortenId(detail.connectionId, 6) : "No connection"}
                          </div>
                        </td>
                        <td className="font-mono">
                          <div className="detail-token-pair">
                            <span className="detail-token-label">IN</span>
                            <span className="detail-token-value">{formatNumber(inputTokens)}</span>
                          </div>
                          <div className="detail-token-pair">
                            <span className="detail-token-label is-output">OUT</span>
                            <span className="detail-token-value">{formatNumber(outputTokens)}</span>
                          </div>
                        </td>
                        <td className="font-mono">
                          <div className="detail-token-pair">
                            <span className="detail-token-label is-warning">TTFT</span>
                            <span className="detail-token-value">{formatMs(detail.latency?.ttft)}</span>
                          </div>
                          <div className="detail-token-pair">
                            <span className="detail-token-label is-total">TOTAL</span>
                            <span className="detail-token-value">{formatMs(detail.latency?.total)}</span>
                          </div>
                        </td>
                        <td>
                          <Badge variant={statusVariant} size="md" dot className="capitalize">
                            {normalizeStatusLabel(detail.status)}
                          </Badge>
                        </td>
                        <td className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewDetail(detail)}
                            className="detail-trace-btn"
                          >
                            <span className="material-symbols-outlined text-[17px]">frame_inspect</span>
                            Inspect
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-t border-white/8 px-5 py-4">
              <Pagination
                currentPage={pagination.page}
                pageSize={pagination.pageSize}
                totalItems={pagination.totalItems}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                className="detail-pagination"
              />
            </div>
          </>
        )}
      </Card>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Request Trace"
        width="xl"
        className="request-detail-drawer-shell"
      >
        {selectedDetail && selectedMetrics ? (
          <div className="flex flex-col gap-6">
            <div className="detail-drawer-panel detail-grid-bg">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="request-details-kicker">Trace Summary</div>
                  <h3 className="truncate text-xl font-semibold text-white">{selectedDetail.model}</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant={getStatusVariant(selectedDetail.status)} size="md" dot className="capitalize">
                      {normalizeStatusLabel(selectedDetail.status)}
                    </Badge>
                    <span className="request-details-chip">
                      <span className="material-symbols-outlined text-[14px]">hub</span>
                      {getProviderName(selectedDetail.provider, providerNameState)}
                    </span>
                    {selectedDetail.endpoint || selectedDetail.request?.endpoint ? (
                      <span className="request-details-chip font-mono">
                        {selectedDetail.endpoint || selectedDetail.request?.endpoint}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-col items-start gap-2 text-sm text-slate-300 lg:items-end">
                  <div className="font-mono text-xs text-slate-400">{selectedDetail.id}</div>
                  <div>{formatTimestamp(selectedDetail.timestamp)}</div>
                  <div className="font-mono text-xs text-slate-400">
                    {selectedDetail.connectionId ? shortenId(selectedDetail.connectionId, 10) : "No connection id"}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
                <DetailMetric label="Input" value={formatNumber(selectedMetrics.input)} subvalue="Prompt / cache read" />
                <DetailMetric label="Output" value={formatNumber(selectedMetrics.output)} subvalue="Completion tokens" />
                <DetailMetric label="Reasoning" value={formatNumber(selectedMetrics.reasoning)} subvalue="If provider exposed it" />
                <DetailMetric label="TTFT" value={formatMs(selectedMetrics.ttft)} subvalue="Time to first token" accent="warning" />
                <DetailMetric label="Total" value={formatMs(selectedMetrics.total)} subvalue="End-to-end latency" accent="success" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="detail-inline-meta">
                <span className="detail-inline-label">Provider</span>
                <span className="detail-inline-value">{getProviderName(selectedDetail.provider, providerNameState)}</span>
              </div>
              <div className="detail-inline-meta">
                <span className="detail-inline-label">Model</span>
                <span className="detail-inline-value font-mono">{selectedDetail.model}</span>
              </div>
              <div className="detail-inline-meta">
                <span className="detail-inline-label">Trace ID</span>
                <span className="detail-inline-value font-mono break-all">{selectedDetail.id}</span>
              </div>
              <div className="detail-inline-meta">
                <span className="detail-inline-label">Captured At</span>
                <span className="detail-inline-value">{formatTimestamp(selectedDetail.timestamp)}</span>
              </div>
            </div>

            <CollapsibleSection
              title="Client Request"
              subtitle="Payload gốc nhận từ client hoặc CLI."
              defaultOpen
              icon="input"
              value={selectedDetail.request}
            >
              <pre className="detail-code-block">{formatJsonValue(selectedDetail.request)}</pre>
            </CollapsibleSection>

            {selectedDetail.providerRequest ? (
              <CollapsibleSection
                title="Provider Request"
                subtitle="Payload sau khi translate sang định dạng upstream provider."
                defaultOpen
                icon="sync_alt"
                value={selectedDetail.providerRequest}
              >
                <pre className="detail-code-block">{formatJsonValue(selectedDetail.providerRequest)}</pre>
              </CollapsibleSection>
            ) : null}

            {selectedDetail.providerResponse ? (
              <CollapsibleSection
                title="Provider Response"
                subtitle="Raw upstream body hoặc snapshot khi stream."
                icon="dns"
                value={selectedDetail.providerResponse}
              >
                <pre className="detail-code-block">{formatJsonValue(selectedDetail.providerResponse)}</pre>
              </CollapsibleSection>
            ) : null}

            <CollapsibleSection
              title="Client Response"
              subtitle="Phần response cuối cùng trả ra cho client."
              defaultOpen
              icon="output"
              value={selectedDetail.response}
            >
              <div className="flex flex-col gap-4">
                {selectedDetail.response?.thinking ? (
                  <div className="detail-response-box is-thinking">
                    <div className="detail-response-heading">
                      <span className="material-symbols-outlined text-[16px]">psychology</span>
                      Thinking
                    </div>
                    <pre className="detail-code-block is-compact">{formatJsonValue(selectedDetail.response.thinking)}</pre>
                  </div>
                ) : null}

                <div className="detail-response-box">
                  <div className="detail-response-heading">
                    <span className="material-symbols-outlined text-[16px]">article</span>
                    Content
                  </div>
                  <pre className="detail-code-block is-compact">
                    {formatJsonValue(selectedDetail.response?.content || "[No content]")}
                  </pre>
                </div>
              </div>
            </CollapsibleSection>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
