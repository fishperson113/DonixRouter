"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Card from "@/shared/components/Card";
import OdometerValue from "@/shared/components/OdometerValue";
import { useUsageStream } from "@/shared/hooks";

const COLOR_INPUT = "#5ea1ff";
const COLOR_OUTPUT = "#4dd388";
const COLOR_CACHED = "#9c82ff";
const COLOR_REQUESTS = "#f0a12a";
const COLOR_COST_IN = "#f5a623";
const COLOR_COST_OUT = "#54d487";
const GRID_COLOR = "rgba(255,255,255,0.06)";
const TICK_COLOR = "#94a3b8";
const INPUT_PRICE_PER_1M = 2.5;
const OUTPUT_PRICE_PER_1M = 10;

const RANGE_OPTIONS = [
  { value: "6h", label: "6 giờ qua" },
  { value: "24h", label: "24 giờ qua" },
  { value: "3d", label: "3 ngày qua" },
  { value: "7d", label: "7 ngày qua" },
  { value: "30d", label: "30 ngày qua" },
  { value: "60d", label: "60 ngày qua" },
  { value: "90d", label: "90 ngày qua" },
  { value: "all", label: "Tất cả" },
];

const GRANULARITY_OPTIONS = {
  five_min: { label: "5 phút" },
  hourly: { label: "Theo giờ" },
  daily: { label: "Theo ngày" },
};

const TOOLTIP_STYLE = {
  backgroundColor: "rgba(11, 16, 25, 0.96)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "12px",
  color: "#e2e8f0",
  fontSize: "11px",
  padding: "8px 10px",
  boxShadow: "0 14px 32px rgba(0, 0, 0, 0.34)",
  backdropFilter: "blur(12px)",
};

const TOOLTIP_LABEL_STYLE = {
  color: "#94a3b8",
  fontSize: "10px",
  marginBottom: "2px",
};

const AXIS_FONT = {
  fontSize: 10.5,
  fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
};

function normalizePeriod(period) {
  return ["24h", "7d", "30d", "60d"].includes(period) ? period : "7d";
}

function getDefaultGranularity(range) {
  if (range === "6h" || range === "24h") return "five_min";
  if (range === "60d" || range === "90d" || range === "all") return "daily";
  return "hourly";
}

function getAvailableGranularities(range) {
  if (range === "60d" || range === "90d" || range === "all") return ["daily"];
  if (range === "3d" || range === "7d" || range === "30d") return ["hourly", "daily"];
  return ["five_min", "hourly", "daily"];
}

function fmtCompact(value, digits = 1) {
  const number = Number(value) || 0;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(digits)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 100_000 ? 0 : digits)}K`;
  return String(Math.round(number));
}

function fmtTokens(value) {
  return fmtCompact(value, 1);
}

function fmtCost(value) {
  const number = Number(value) || 0;
  if (number >= 100) return `$${number.toFixed(0)}`;
  if (number >= 10) return `$${number.toFixed(1)}`;
  return `$${number.toFixed(2)}`;
}

function fmtPct(value) {
  return `${Math.round(Number(value) || 0)}%`;
}

function getLabel(point, granularity) {
  if (point.label) return point.label;

  const date = new Date(point.timestamp);
  if (Number.isNaN(date.getTime())) return "";
  if (granularity === "daily") {
    return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function ChartPanel({ title, legend, height, wide = false, loading, hasData, children }) {
  return (
    <div className={`usage-chart-box ${wide ? "is-wide" : ""}`}>
      <div className="usage-chart-head">
        <span className="usage-chart-title">{title}</span>
        <span className="usage-chart-legend">{legend}</span>
      </div>
      <div className={`usage-chart-body ${wide ? "is-tall" : ""}`} style={{ height }}>
        {!hasData || loading ? (
          <div className="usage-chart-empty">{loading ? "Đang tải..." : "Chưa có dữ liệu trong khoảng này"}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

ChartPanel.propTypes = {
  title: PropTypes.string.isRequired,
  legend: PropTypes.node,
  height: PropTypes.number.isRequired,
  wide: PropTypes.bool,
  loading: PropTypes.bool.isRequired,
  hasData: PropTypes.bool.isRequired,
  children: PropTypes.node,
};

function FilterStrip({ options, value, onChange }) {
  return (
    <div className="usage-detail-filter-strip">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`usage-detail-filter-pill${active ? " is-active" : ""}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

FilterStrip.propTypes = {
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    })
  ).isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
};

function SummaryMetric({ label, value, sub, tone = "default" }) {
  return (
    <div className={`usage-detail-metric tone-${tone}`}>
      <div className="usage-detail-metric-label">{label}</div>
      <div className="usage-detail-metric-value">
        <OdometerValue value={value} height={38} />
      </div>
      <div className="usage-detail-metric-sub">{sub}</div>
    </div>
  );
}

SummaryMetric.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  sub: PropTypes.string.isRequired,
  tone: PropTypes.oneOf(["default", "input", "output", "cached", "cost"]),
};

export default function UsageChart({ period = "7d" }) {
  const normalizedPeriod = normalizePeriod(period);
  const [range, setRange] = useState(normalizedPeriod);
  const [granularity, setGranularity] = useState(getDefaultGranularity(normalizedPeriod));
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { snapshot } = useUsageStream(normalizedPeriod);
  const refreshMarker = snapshot?.totalRequests || 0;
  const lastRequestId = useRef(0);

  useEffect(() => {
    const nextRange = normalizePeriod(period);
    setRange(nextRange);
    setGranularity(getDefaultGranularity(nextRange));
  }, [period]);

  const availableGranularities = useMemo(() => getAvailableGranularities(range), [range]);

  useEffect(() => {
    if (!availableGranularities.includes(granularity)) {
      setGranularity(availableGranularities[0]);
    }
  }, [availableGranularities, granularity]);

  const fetchData = useCallback(
    async ({ soft = false } = {}) => {
      const requestId = lastRequestId.current + 1;
      lastRequestId.current = requestId;

      if (!soft) setLoading(true);

      try {
        const params = new URLSearchParams({
          range,
          granularity,
          period: normalizedPeriod,
        });
        const response = await fetch(`/api/usage/chart?${params.toString()}`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`Unexpected status ${response.status}`);
        }

        const json = await response.json();
        if (lastRequestId.current !== requestId) return;
        setData(Array.isArray(json) ? json : []);
        setError("");
      } catch (fetchError) {
        if (lastRequestId.current !== requestId) return;
        setData([]);
        setError(fetchError?.message || "Failed to load chart data");
      } finally {
        if (lastRequestId.current === requestId) {
          setLoading(false);
        }
      }
    },
    [granularity, normalizedPeriod, range]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!snapshot) return;
    fetchData({ soft: true });
  }, [fetchData, refreshMarker, snapshot]);

  const rows = useMemo(
    () =>
      data.map((point) => {
        const input = Number(point.input_tokens) || 0;
        const output = Number(point.output_tokens) || 0;
        const cached = Number(point.cached_tokens) || 0;
        const request = Number(point.request_count) || 0;
        const hit = input > 0 ? Math.min(100, (cached / input) * 100) : null;

        return {
          label: getLabel(point, granularity),
          input,
          output,
          cached,
          request,
          hit,
          costIn: (input / 1_000_000) * INPUT_PRICE_PER_1M,
          costOut: (output / 1_000_000) * OUTPUT_PRICE_PER_1M,
        };
      }),
    [data, granularity]
  );

  const totals = useMemo(() => {
    const input = rows.reduce((sum, row) => sum + row.input, 0);
    const output = rows.reduce((sum, row) => sum + row.output, 0);
    const cached = rows.reduce((sum, row) => sum + row.cached, 0);
    const requests = rows.reduce((sum, row) => sum + row.request, 0);
    const costIn = rows.reduce((sum, row) => sum + row.costIn, 0);
    const costOut = rows.reduce((sum, row) => sum + row.costOut, 0);
    const hitRate = input > 0 ? (cached / input) * 100 : 0;

    return {
      input,
      output,
      cached,
      requests,
      hitRate,
      spend: costIn + costOut,
    };
  }, [rows]);

  const hasData = rows.some((row) => row.input > 0 || row.output > 0 || row.cached > 0 || row.request > 0);
  const selectedRange = RANGE_OPTIONS.find((option) => option.value === range)?.label || range;
  const selectedGranularity = GRANULARITY_OPTIONS[granularity]?.label || granularity;
  const legendItemClass = "inline-flex items-center gap-1.5";

  return (
    <Card className="usage-detail-section" padding="none" elev>
      <div className="usage-detail-header">
        <div className="usage-detail-heading">
          <div className="usage-detail-kicker">Chi tiết</div>
          <h3 className="usage-detail-title">Thống kê sử dụng</h3>
          <p className="usage-detail-subtitle">
            Token flow, cache hit, request volume và xu hướng chi phí cho khoảng đang chọn.
          </p>
        </div>

        <div className="usage-detail-toolbar">
          <FilterStrip options={RANGE_OPTIONS} value={range} onChange={setRange} />
          <FilterStrip
            options={availableGranularities.map((value) => ({
              value,
              label: GRANULARITY_OPTIONS[value].label,
            }))}
            value={granularity}
            onChange={setGranularity}
          />
        </div>
      </div>

      <div className="usage-detail-metrics">
        <SummaryMetric
          label="Token đầu vào"
          value={fmtCompact(totals.input)}
          sub={`${selectedRange} • ${selectedGranularity}`}
          tone="input"
        />
        <SummaryMetric
          label="Token đầu ra"
          value={fmtCompact(totals.output)}
          sub={`${fmtCompact(totals.cached)} cache`}
          tone="output"
        />
        <SummaryMetric
          label="Tỷ lệ cache hit"
          value={fmtPct(totals.hitRate)}
          sub={`${fmtCompact(totals.cached)} / ${fmtCompact(totals.input)}`}
          tone="cached"
        />
        <SummaryMetric
          label="Yêu cầu"
          value={fmtCompact(totals.requests, 0)}
          sub={snapshot ? "Realtime từ usage stream" : "Đồng bộ theo chart"}
          tone="default"
        />
        <SummaryMetric
          label="Ước tính chi phí"
          value={fmtCost(totals.spend)}
          sub="Ước tính theo pricing snapshot"
          tone="cost"
        />
      </div>

      {error && !loading ? (
        <div className="usage-detail-error">
          {error}
        </div>
      ) : null}

      <div className="usage-chart-grid">
        <ChartPanel
          title="Token theo thời gian"
          legend={
            <>
              <span className={legendItemClass}>
                <span className="usage-legend-line" style={{ background: COLOR_INPUT }} />
                Token đầu vào
              </span>
              <span className={legendItemClass}>
                <span className="usage-legend-line" style={{ background: COLOR_OUTPUT }} />
                Token đầu ra
              </span>
              <span className={legendItemClass} style={{ color: COLOR_CACHED }}>
                <span className="usage-legend-line is-dashed" />
                Cached
              </span>
            </>
          }
          height={320}
          wide
          loading={loading}
          hasData={hasData}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_COLOR} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ ...AXIS_FONT, fill: TICK_COLOR }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                tick={{ ...AXIS_FONT, fill: TICK_COLOR }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmtTokens}
                width={44}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                formatter={(value, name) => {
                  const number = Number(value) || 0;
                  if (name === "input") return [fmtTokens(number), "Token đầu vào"];
                  if (name === "output") return [fmtTokens(number), "Token đầu ra"];
                  if (name === "cached") return [fmtTokens(number), "Cached"];
                  return [fmtTokens(number), String(name)];
                }}
              />
              <Line type="monotone" dataKey="input" stroke={COLOR_INPUT} strokeWidth={2.4} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />
              <Line type="monotone" dataKey="output" stroke={COLOR_OUTPUT} strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />
              <Line type="monotone" dataKey="cached" stroke={COLOR_CACHED} strokeWidth={1.8} strokeDasharray="5 4" dot={false} activeDot={{ r: 3.5 }} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel
          title="Yêu cầu"
          legend={
            <span className={legendItemClass}>
              <span className="usage-legend-line" style={{ background: COLOR_REQUESTS }} />
              Yêu cầu
            </span>
          }
          height={228}
          loading={loading}
          hasData={hasData}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 6, left: 0, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid stroke={GRID_COLOR} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ ...AXIS_FONT, fill: TICK_COLOR }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis tick={{ ...AXIS_FONT, fill: TICK_COLOR }} tickLine={false} axisLine={false} width={28} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                formatter={(value) => [String(Number(value) || 0), "Yêu cầu"]}
              />
              <Bar dataKey="request" fill="rgba(240, 161, 42, 0.56)" stroke={COLOR_REQUESTS} strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel
          title="Tỷ lệ cache hit"
          legend={
            <span className={legendItemClass}>
              <span className="usage-legend-line" style={{ background: COLOR_CACHED }} />
              Hit %
            </span>
          }
          height={228}
          loading={loading}
          hasData={hasData}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_COLOR} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ ...AXIS_FONT, fill: TICK_COLOR }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                tick={{ ...AXIS_FONT, fill: TICK_COLOR }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmtPct}
                width={36}
                domain={[0, 110]}
                ticks={[0, 25, 50, 75, 100]}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                formatter={(value) => {
                  if (value == null) return ["--", "Hit %"];
                  const number = Number(value) || 0;
                  return [`${number.toFixed(1)}%`, "Hit %"];
                }}
              />
              <Line
                type="monotone"
                dataKey="hit"
                stroke={COLOR_CACHED}
                strokeWidth={1.9}
                dot={{ r: 2.6, fill: COLOR_CACHED, strokeWidth: 0 }}
                activeDot={{ r: 3 }}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel
          title="Xu hướng chi phí"
          legend={
            <>
              <span className={legendItemClass}>
                <span className="usage-legend-line" style={{ background: COLOR_COST_IN }} />
                Token đầu vào
              </span>
              <span className={legendItemClass}>
                <span className="usage-legend-line" style={{ background: COLOR_COST_OUT }} />
                Token đầu ra
              </span>
            </>
          }
          height={228}
          loading={loading}
          hasData={hasData}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_COLOR} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ ...AXIS_FONT, fill: TICK_COLOR }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                tick={{ ...AXIS_FONT, fill: TICK_COLOR }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmtCost}
                width={40}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                formatter={(value, name) => {
                  const number = Number(value) || 0;
                  if (name === "costIn") return [fmtCost(number), "Token đầu vào"];
                  if (name === "costOut") return [fmtCost(number), "Token đầu ra"];
                  return [fmtCost(number), String(name)];
                }}
              />
              <Line type="monotone" dataKey="costIn" stroke={COLOR_COST_IN} strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} connectNulls />
              <Line type="monotone" dataKey="costOut" stroke={COLOR_COST_OUT} strokeWidth={1.8} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
    </Card>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
};
