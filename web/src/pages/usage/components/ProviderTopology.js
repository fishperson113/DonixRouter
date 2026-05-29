"use client";

import Image from "next/image";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import {
  ReactFlow,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AI_PROVIDERS } from "@/shared/constants/providers";

const FE_ACTIVE_TIMEOUT_MS = 60000;
const PROVIDER_NODE_WIDTH = 188;
const PROVIDER_NODE_HEIGHT = 66;
const ROUTER_NODE_WIDTH = 228;
const ROUTER_NODE_HEIGHT = 66;
const FIT_OPTS = { padding: 0.1 };
const TOPOLOGY_COLUMN_X = 350;
const TOPOLOGY_ROW_GAP = 96;
const TOPOLOGY_COMPACT_ROW_GAP = 84;
const TOPOLOGY_SLOT_PATTERN = [
  { x: 0, y: -220, sourceHandle: "top", targetHandle: "bottom", lane: "top" },
  { x: -328, y: 122, sourceHandle: "left", targetHandle: "right", lane: "side-left" },
  { x: 328, y: 122, sourceHandle: "right", targetHandle: "left", lane: "side-right" },
  { x: -328, y: -26, sourceHandle: "left", targetHandle: "right", lane: "upper-left" },
  { x: 328, y: -26, sourceHandle: "right", targetHandle: "left", lane: "upper-right" },
  { x: -254, y: 266, sourceHandle: "bottom", targetHandle: "top", lane: "bottom-left" },
  { x: 254, y: 266, sourceHandle: "bottom", targetHandle: "top", lane: "bottom-right" },
  { x: 0, y: 338, sourceHandle: "bottom", targetHandle: "top", lane: "bottom" },
  { x: -474, y: 62, sourceHandle: "left", targetHandle: "right", lane: "far-left" },
  { x: 474, y: 62, sourceHandle: "right", targetHandle: "left", lane: "far-right" },
];
const PROVIDER_SLOT_PREFERENCES = {
  "gemini-cli": ["top", "upper-left", "upper-right"],
  gemini: ["upper-left", "top", "far-left"],
  kilocode: ["upper-right", "top", "far-right"],
  codex: ["side-left", "bottom-left", "upper-left"],
  github: ["side-right", "bottom-right", "upper-right"],
  claude: ["bottom-left", "side-left", "far-left"],
  cursor: ["bottom-right", "side-right", "far-right"],
  kiro: ["bottom", "bottom-left", "bottom-right"],
  antigravity: ["bottom-right", "upper-right", "far-right"],
  openrouter: ["far-left", "side-left", "bottom-left"],
  openai: ["far-right", "side-right", "bottom-right"],
  ollama: ["bottom", "bottom-right", "bottom-left"],
};
const PROVIDER_LAYOUT_PRIORITY = [
  "gemini-cli",
  "gemini",
  "kilocode",
  "codex",
  "github",
  "claude",
  "cursor",
  "kiro",
  "antigravity",
  "openrouter",
  "openai",
  "ollama",
];
const PROVIDER_LAYOUT_RANK = new Map(
  PROVIDER_LAYOUT_PRIORITY.map((providerId, index) => [providerId, index])
);

function getProviderConfig(providerId) {
  return AI_PROVIDERS[providerId] || { color: "#6b7280", name: providerId };
}

function getProviderImageUrl(providerId) {
  return `/providers/${providerId}.png`;
}

function buildSubtitle({ active, last, error, activeRequest, recentRequest }) {
  const status = error ? "error" : active ? "active" : last ? "recent" : "idle";
  const model = activeRequest?.model || recentRequest?.model || "";
  return [status, model].filter(Boolean).join(" | ");
}

function ProviderNode({ data }) {
  const { label, color, imageUrl, textIcon, active, tone, subtitle } = data;
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className={`provider-topology-node tone-${tone}${active ? " is-active" : ""}`}
      style={{
        width: `${PROVIDER_NODE_WIDTH}px`,
        minWidth: `${PROVIDER_NODE_WIDTH}px`,
        maxWidth: `${PROVIDER_NODE_WIDTH}px`,
        height: `${PROVIDER_NODE_HEIGHT}px`,
        "--provider-node-color": color,
      }}
    >
      <Handle type="target" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      <div className="provider-topology-node-icon-shell">
        {!imgError ? (
          <Image
            src={imageUrl}
            alt={label}
            width={32}
            height={32}
            className="provider-topology-node-icon"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="provider-topology-node-fallback" style={{ color }}>
            {textIcon}
          </span>
        )}
      </div>

      <div className="provider-topology-node-copy">
        <span className="provider-topology-node-title">{label}</span>
        <span className="provider-topology-node-subtitle">{subtitle || "idle"}</span>
      </div>
    </div>
  );
}

ProviderNode.propTypes = {
  data: PropTypes.object.isRequired,
};

function RouterNode({ data }) {
  return (
    <div className="router-topology-node">
      <Handle type="source" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      <div className="router-topology-main">
        <div className="router-topology-icon-shell">
          <Image src="/logo.png" alt="DonixRouter" width={32} height={32} className="router-topology-icon" />
          <span className={`router-topology-live-dot${data.activeCount > 0 ? " is-live" : ""}`} />
        </div>
        <span className="router-topology-title">DonixRouter</span>
      </div>
      {data.activeCount > 0 && (
        <span className="router-topology-badge">
          x{data.activeCount}
        </span>
      )}
    </div>
  );
}

RouterNode.propTypes = {
  data: PropTypes.object.isRequired,
};

function FlowPacket({
  pathId,
  begin,
  radius,
  opacity = 1,
  duration = "1.05s",
  variant = "active",
  reverse = false,
}) {
  const motionProps = reverse
    ? { keyPoints: "1;0", keyTimes: "0;1" }
    : {};

  return (
    <circle className={`provider-topology-packet is-${variant}`} r={radius} opacity={opacity}>
      <animateMotion
        dur={duration}
        begin={begin}
        repeatCount="indefinite"
        calcMode="linear"
        {...motionProps}
      >
        <mpath href={`#${pathId}`} xlinkHref={`#${pathId}`} />
      </animateMotion>
    </circle>
  );
}

FlowPacket.propTypes = {
  pathId: PropTypes.string.isRequired,
  begin: PropTypes.string.isRequired,
  radius: PropTypes.number.isRequired,
  opacity: PropTypes.number,
  duration: PropTypes.string,
  variant: PropTypes.oneOf(["active", "last", "error"]),
  reverse: PropTypes.bool,
};

function buildEdgePath(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (sourcePosition === Position.Top && targetPosition === Position.Bottom) {
    const bend = Math.max(74, Math.min(136, absDy * 0.34));
    const sway = absDx < 8
      ? Math.max(28, Math.min(52, absDy * 0.16))
      : dx * 0.14;
    return `M ${sourceX} ${sourceY} C ${sourceX + sway} ${sourceY - bend}, ${targetX - sway} ${targetY + bend}, ${targetX} ${targetY}`;
  }

  if (sourcePosition === Position.Bottom && targetPosition === Position.Top) {
    const bend = Math.max(84, Math.min(142, absDy * 0.36));
    const sway = absDx < 8
      ? Math.max(30, Math.min(56, absDy * 0.16))
      : dx * 0.14;
    return `M ${sourceX} ${sourceY} C ${sourceX - sway} ${sourceY + bend}, ${targetX + sway} ${targetY - bend}, ${targetX} ${targetY}`;
  }

  if (sourcePosition === Position.Left && targetPosition === Position.Right) {
    const bend = Math.max(86, Math.min(144, absDx * 0.28));
    return `M ${sourceX} ${sourceY} C ${sourceX - bend} ${sourceY}, ${targetX + bend} ${targetY}, ${targetX} ${targetY}`;
  }

  if (sourcePosition === Position.Right && targetPosition === Position.Left) {
    const bend = Math.max(86, Math.min(144, absDx * 0.28));
    return `M ${sourceX} ${sourceY} C ${sourceX + bend} ${sourceY}, ${targetX - bend} ${targetY}, ${targetX} ${targetY}`;
  }

  const cx1 = sourceX + dx * 0.35;
  const cy1 = sourceY + dy * 0.12;
  const cx2 = sourceX + dx * 0.68;
  const cy2 = sourceY + dy * 0.88;
  return `M ${sourceX} ${sourceY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${targetX} ${targetY}`;
}

function ProviderLinkEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
}) {
  const edgePath = buildEdgePath(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition);
  const tone = data?.tone || "idle";
  const active = data?.active === true;
  const pathId = `provider-topology-path-${id}`;

  return (
    <g>
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={18} />
      <path d={edgePath} fill="none" className={`provider-topology-wire-glow is-${tone}`} />
      <path
        id={pathId}
        d={edgePath}
        fill="none"
        className={`provider-topology-wire is-${tone}`}
      />
      {active && (
        <>
          <circle
            cx={targetX}
            cy={targetY}
            r={3.5}
            className="provider-topology-target-pulse"
          >
            <animate
              attributeName="r"
              values="2.6;4.2;2.6"
              dur="1.15s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.3;0.72;0.3"
              dur="1.15s"
              repeatCount="indefinite"
            />
          </circle>
          <FlowPacket pathId={pathId} begin="0s" radius={3.8} duration="1.15s" variant="active" />
          <FlowPacket pathId={pathId} begin="0.4s" radius={3.2} opacity={0.82} duration="1.15s" variant="active" />
          <FlowPacket pathId={pathId} begin="0.8s" radius={2.7} opacity={0.68} duration="1.15s" variant="active" />
          <FlowPacket pathId={pathId} begin="0.2s" radius={3.1} opacity={0.82} duration="1.15s" variant="active" reverse />
          <FlowPacket pathId={pathId} begin="0.7s" radius={2.6} opacity={0.58} duration="1.15s" variant="active" reverse />
        </>
      )}
    </g>
  );
}

ProviderLinkEdge.propTypes = {
  id: PropTypes.string.isRequired,
  sourceX: PropTypes.number.isRequired,
  sourceY: PropTypes.number.isRequired,
  sourcePosition: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  targetX: PropTypes.number.isRequired,
  targetY: PropTypes.number.isRequired,
  targetPosition: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  data: PropTypes.shape({
    active: PropTypes.bool,
    tone: PropTypes.string,
  }),
};

const nodeTypes = { provider: ProviderNode, router: RouterNode };
const edgeTypes = { providerLink: ProviderLinkEdge };

function buildSlots(count) {
  if (count === 1) {
    return [{ x: 0, y: -170, sourceHandle: "top", targetHandle: "bottom", lane: "top" }];
  }

  const leftCount = Math.ceil(count / 2);
  const rightCount = Math.floor(count / 2);
  const rowGap = count > 10 ? TOPOLOGY_COMPACT_ROW_GAP : TOPOLOGY_ROW_GAP;
  const buildColumn = (side, rowCount) => {
    const startY = -((rowCount - 1) * rowGap) / 2;
    return Array.from({ length: rowCount }, (_, index) => ({
      x: side === "left" ? -TOPOLOGY_COLUMN_X : TOPOLOGY_COLUMN_X,
      y: startY + index * rowGap,
      sourceHandle: side,
      targetHandle: side === "left" ? "right" : "left",
      lane: side,
    }));
  };

  const leftSlots = buildColumn("left", leftCount);
  const rightSlots = buildColumn("right", rightCount);
  const slots = [];
  for (let index = 0; index < leftCount; index += 1) {
    slots.push(leftSlots[index]);
    if (rightSlots[index]) slots.push(rightSlots[index]);
  }
  return slots.slice(0, count);
}

function getProviderId(provider) {
  return provider.provider?.toLowerCase() || "";
}

function getProviderLabel(provider) {
  const config = getProviderConfig(provider.provider);
  return (config.name !== provider.provider ? config.name : null) || provider.name || provider.provider || "";
}

function compareProvidersForLayout(a, b) {
  const idA = getProviderId(a);
  const idB = getProviderId(b);
  const rankA = PROVIDER_LAYOUT_RANK.get(idA) ?? Number.POSITIVE_INFINITY;
  const rankB = PROVIDER_LAYOUT_RANK.get(idB) ?? Number.POSITIVE_INFINITY;

  if (rankA !== rankB) return rankA - rankB;
  return getProviderLabel(a).localeCompare(getProviderLabel(b));
}

function getSlotPreferenceIndex(providerId, lane) {
  const preferences = PROVIDER_SLOT_PREFERENCES[providerId];
  if (!preferences) return Number.POSITIVE_INFINITY;

  if (lane === "left" || lane === "right") {
    const sideToken = `-${lane}`;
    const sideIndex = preferences.findIndex((preference) => preference === lane || preference.endsWith(sideToken));
    return sideIndex === -1 ? Number.POSITIVE_INFINITY : sideIndex;
  }

  const index = preferences.indexOf(lane);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function assignProvidersToSlots(providers, slots) {
  const remainingProviders = [...providers].sort(compareProvidersForLayout);
  const assignments = slots.map((slot) => ({ slot, provider: null }));

  assignments.forEach((assignment) => {
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    remainingProviders.forEach((provider, index) => {
      const score = getSlotPreferenceIndex(getProviderId(provider), assignment.slot.lane);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex !== -1 && bestScore !== Number.POSITIVE_INFINITY) {
      assignment.provider = remainingProviders.splice(bestIndex, 1)[0];
    }
  });

  assignments.forEach((assignment) => {
    if (!assignment.provider && remainingProviders.length > 0) {
      assignment.provider = remainingProviders.shift();
    }
  });

  return assignments.filter((assignment) => assignment.provider);
}

function buildLayout(providers, activeSet, lastSet, errorSet, activeMetaMap, recentMetaMap) {
  if (providers.length === 0) {
    return {
      nodes: [{ id: "router", type: "router", position: { x: 0, y: 0 }, data: { activeCount: 0 }, draggable: false }],
      edges: [],
    };
  }

  const nodes = [];
  const edges = [];
  const slots = buildSlots(providers.length);
  const providerAssignments = assignProvidersToSlots(providers, slots);

  nodes.push({
    id: "router",
    type: "router",
    position: { x: -ROUTER_NODE_WIDTH / 2, y: -ROUTER_NODE_HEIGHT / 2 },
    data: { activeCount: activeSet.size },
    draggable: false,
  });

  providerAssignments.forEach(({ provider, slot }) => {
    const config = getProviderConfig(provider.provider);
    const id = getProviderId(provider);
    const active = activeSet.has(id);
    const last = !active && lastSet.has(id);
    const error = !active && errorSet.has(id);
    const tone = error ? "error" : active ? "active" : last ? "last" : "idle";
    const nodeId = `provider-${provider.provider}`;
    const activeRequest = activeMetaMap.get(id);
    const recentRequest = recentMetaMap.get(id);

    nodes.push({
      id: nodeId,
      type: "provider",
      position: { x: slot.x - PROVIDER_NODE_WIDTH / 2, y: slot.y - PROVIDER_NODE_HEIGHT / 2 },
      data: {
        label: (config.name !== provider.provider ? config.name : null) || provider.name || provider.provider,
        color: config.color || "#6b7280",
        imageUrl: getProviderImageUrl(provider.provider),
        textIcon: config.textIcon || (provider.provider || "?").slice(0, 2).toUpperCase(),
        active,
        tone,
        subtitle: buildSubtitle({ active, last, error, activeRequest, recentRequest }),
      },
      draggable: false,
    });

    edges.push({
      id: `e-${nodeId}`,
      type: "providerLink",
      source: "router",
      sourceHandle: slot.sourceHandle,
      target: nodeId,
      targetHandle: slot.targetHandle,
      data: {
        active,
        tone,
      },
    });
  });

  return { nodes, edges };
}

function getTopologyHeight(providerCount) {
  if (providerCount <= 10) return 500;
  const rows = Math.ceil(providerCount / 2);
  return Math.min(860, Math.max(500, rows * TOPOLOGY_COMPACT_ROW_GAP + 128));
}

export default function ProviderTopology({
  providers = [],
  activeRequests = [],
  recentRequests = [],
  lastProvider = "",
  errorProvider = "",
  height: heightProp,
  fitPadding,
  className = "",
}) {
  const fitOpts = useMemo(
    () => ({ padding: typeof fitPadding === "number" ? fitPadding : 0.1 }),
    [fitPadding]
  );
  const activeKey = useMemo(
    () => activeRequests.map((request) => request.provider?.toLowerCase()).filter(Boolean).sort().join(","),
    [activeRequests]
  );
  const lastKey = lastProvider?.toLowerCase() || "";
  const errorKey = errorProvider?.toLowerCase() || "";

  const rawActiveSet = useMemo(() => new Set(activeKey ? activeKey.split(",") : []), [activeKey]);
  const lastSet = useMemo(() => new Set(lastKey ? [lastKey] : []), [lastKey]);
  const errorSet = useMemo(() => new Set(errorKey ? [errorKey] : []), [errorKey]);
  const activeMetaMap = useMemo(() => {
    const map = new Map();
    activeRequests.forEach((request) => {
      const id = request.provider?.toLowerCase();
      if (id && !map.has(id)) {
        map.set(id, request);
      }
    });
    return map;
  }, [activeRequests]);
  const recentMetaMap = useMemo(() => {
    const map = new Map();
    recentRequests.forEach((request) => {
      const id = request.provider?.toLowerCase();
      if (id && !map.has(id)) {
        map.set(id, request);
      }
    });
    return map;
  }, [recentRequests]);

  const firstSeenRef = useRef({});
  const expiryTimersRef = useRef({});
  const [expiryVersion, setExpiryVersion] = useState(0);

  useEffect(() => {
    const seen = firstSeenRef.current;
    const timers = expiryTimersRef.current;
    const now = Date.now();

    for (const provider of rawActiveSet) {
      if (!seen[provider]) {
        seen[provider] = now;
        clearTimeout(timers[provider]);
        timers[provider] = setTimeout(() => {
          setExpiryVersion((value) => value + 1);
        }, FE_ACTIVE_TIMEOUT_MS);
      }
    }

    for (const provider of Object.keys(seen)) {
      if (!rawActiveSet.has(provider)) {
        delete seen[provider];
        clearTimeout(timers[provider]);
        delete timers[provider];
      }
    }

    return () => {
      for (const provider of Object.keys(timers)) {
        if (!rawActiveSet.has(provider)) {
          clearTimeout(timers[provider]);
          delete timers[provider];
        }
      }
    };
  }, [rawActiveSet]);

  const activeSet = useMemo(() => {
    const now = Date.now();
    const filtered = new Set();
    for (const provider of rawActiveSet) {
      const ts = firstSeenRef.current[provider];
      if (!ts || now - ts < FE_ACTIVE_TIMEOUT_MS) filtered.add(provider);
    }
    return filtered;
  }, [rawActiveSet, expiryVersion]);

  const { nodes, edges } = useMemo(
    () => buildLayout(providers, activeSet, lastSet, errorSet, activeMetaMap, recentMetaMap),
    [providers, activeSet, lastSet, errorSet, activeMetaMap, recentMetaMap]
  );
  const topologyHeight = useMemo(() => {
    if (typeof heightProp === "number" && heightProp > 0) return heightProp;
    return getTopologyHeight(providers.length);
  }, [heightProp, providers.length]);

  const providersKey = useMemo(
    () => providers.map((provider) => provider.provider).sort().join(","),
    [providers]
  );

  const rfInstance = useRef(null);
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);

  const safeFitView = useCallback(() => {
    if (!rfInstance.current) return;
    rfInstance.current.fitView(fitOpts);
  }, [fitOpts]);

  const onInit = useCallback((instance) => {
    rfInstance.current = instance;
    // Instant fitView, then reveal
    instance.fitView(fitOpts);
    requestAnimationFrame(() => {
      instance.fitView(fitOpts);
      setReady(true);
    });
  }, [fitOpts]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => safeFitView());
    observer.observe(element);
    return () => observer.disconnect();
  }, [safeFitView, fitOpts]);

  useEffect(() => {
    if (!rfInstance.current) return undefined;
    setReady(false);
    const t1 = setTimeout(() => { safeFitView(); setReady(true); }, 80);
    return () => clearTimeout(t1);
  }, [nodes.length, safeFitView, fitOpts]);

  return (
    <div
      ref={containerRef}
      className={`provider-topology-grid w-full min-w-0 overflow-hidden rounded-[22px] border border-white/8${className ? ` ${className}` : ""}`}
      style={{
        height: `${typeof heightProp === "number" ? topologyHeight : Math.max(520, topologyHeight)}px`,
      }}
    >
      {providers.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-text-muted">
          No providers connected
        </div>
      ) : (
        <ReactFlow
          key={providersKey}
          style={{ opacity: ready ? 1 : 0, transition: 'opacity 0.2s ease' }}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={fitOpts}
          minZoom={0.28}
          maxZoom={1}
          onInit={onInit}
          proOptions={{ hideAttribution: true }}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          panOnScroll={false}
          panOnScrollMode={undefined}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
        >
        </ReactFlow>
      )}
    </div>
  );
}

ProviderTopology.propTypes = {
  providers: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    provider: PropTypes.string,
    name: PropTypes.string,
  })),
  activeRequests: PropTypes.arrayOf(PropTypes.shape({
    provider: PropTypes.string,
    model: PropTypes.string,
    account: PropTypes.string,
  })),
  recentRequests: PropTypes.arrayOf(PropTypes.shape({
    provider: PropTypes.string,
    model: PropTypes.string,
  })),
  lastProvider: PropTypes.string,
  errorProvider: PropTypes.string,
  height: PropTypes.number,
  fitPadding: PropTypes.number,
  className: PropTypes.string,
};
