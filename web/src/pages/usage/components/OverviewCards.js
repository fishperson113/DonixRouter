"use client";

import PropTypes from "prop-types";
import OdometerValue from "@/shared/components/OdometerValue";

const fmtInt = (n) => new Intl.NumberFormat().format(Math.max(0, Math.round(n || 0)));
const fmtCost = (n) => `~$${new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Math.max(0, Number(n || 0)))}`;

function MetricCard({ label, value, format = "int", tone = "white", note, connected = false }) {
  const shown = format === "cost" ? fmtCost(value) : fmtInt(value);

  return (
    <div className={`usage-overview-card accent-${tone}`}>
      <div className="usage-overview-card-head">
        <span className="usage-overview-card-label">{label}</span>
        <span className={`usage-overview-live-pill ${connected ? "is-live" : ""}`}>
          <span className="usage-overview-live-dot" />
          {connected ? "LIVE" : "SYNC"}
        </span>
      </div>
      <div className={`usage-overview-card-value tone-${tone}`}>
        <OdometerValue value={shown} height={36} />
      </div>
      {note ? <div className="usage-overview-card-note">{note}</div> : <div className="usage-overview-card-note">&nbsp;</div>}
    </div>
  );
}

MetricCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.number,
  format: PropTypes.oneOf(["int", "cost"]),
  tone: PropTypes.oneOf(["white", "orange", "green", "yellow"]),
  note: PropTypes.string,
  connected: PropTypes.bool,
};

export default function OverviewCards({ stats, connected = false }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 sm:gap-4">
      <MetricCard
        label="Total Requests"
        value={stats.totalRequests}
        tone="white"
        note={connected ? "Realtime from usage stream" : "Waiting for usage stream"}
        connected={connected}
      />
      <MetricCard
        label="Total Input Tokens"
        value={stats.totalPromptTokens}
        tone="orange"
        note="Prompt tokens routed in selected range"
        connected={connected}
      />
      <MetricCard
        label="Output Tokens"
        value={stats.totalCompletionTokens}
        tone="green"
        note="Completion tokens returned"
        connected={connected}
      />
      <MetricCard
        label="Est. Cost"
        value={stats.totalCost}
        format="cost"
        tone="yellow"
        note="Estimated, not actual billing"
        connected={connected}
      />
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
  connected: PropTypes.bool,
};
