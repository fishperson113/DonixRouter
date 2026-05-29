import { getUsageStats, statsEmitter, getActiveRequests } from "#lib/usageDb.js";

export const dynamic = "force-dynamic";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d", "all"]);

function mergeRecentRequest(recentRequests = [], entry) {
  const next = [
    {
      timestamp: entry.timestamp,
      model: entry.model,
      provider: entry.provider || "",
      promptTokens: entry.promptTokens || 0,
      completionTokens: entry.completionTokens || 0,
      cost: entry.cost || 0,
      status: entry.status || "ok",
    },
    ...recentRequests,
  ];

  const seen = new Set();
  return next.filter((item) => {
    if ((item.promptTokens || 0) === 0 && (item.completionTokens || 0) === 0) return false;
    const minute = item.timestamp ? item.timestamp.slice(0, 16) : "";
    const key = `${item.model}|${item.provider}|${item.promptTokens}|${item.completionTokens}|${minute}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function applyOptimisticUsagePatch(stats, payload) {
  const entry = payload?.entry;
  if (!stats || payload?.type !== "usage" || !entry?.timestamp) return stats;

  const timestampMs = new Date(entry.timestamp).getTime();
  if (!Number.isFinite(timestampMs) || timestampMs > Date.now() + 5000) return stats;

  return {
    ...stats,
    totalRequests: (stats.totalRequests || 0) + 1,
    totalPromptTokens: (stats.totalPromptTokens || 0) + (entry.promptTokens || 0),
    totalCompletionTokens: (stats.totalCompletionTokens || 0) + (entry.completionTokens || 0),
    totalCost: (stats.totalCost || 0) + (entry.cost || 0),
    recentRequests: mergeRecentRequest(stats.recentRequests, entry),
  };
}

export async function GET(request) {
  const encoder = new TextEncoder();
  const { searchParams } = new URL(request.url);
  const period = VALID_PERIODS.has(searchParams.get("period")) ? searchParams.get("period") : "7d";
  const state = { closed: false, keepalive: null, send: null, sendPending: null, cachedStats: null };

  const stream = new ReadableStream({
    async start(controller) {
      // Full stats refresh (heavy) + immediate lightweight push
      state.send = async (payload) => {
        if (state.closed) return;
        try {
          // Push lightweight update immediately so UI reflects changes fast
          if (state.cachedStats) {
            const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
            const optimisticStats = applyOptimisticUsagePatch(state.cachedStats, payload);
            state.cachedStats = optimisticStats;
            const quickStats = { ...optimisticStats, activeRequests, recentRequests, errorProvider };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
          }
          // Then do full recalc and update cache
          const stats = await getUsageStats(period);
          state.cachedStats = stats;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("update", state.send);
          statsEmitter.off("pending", state.sendPending);
          clearInterval(state.keepalive);
        }
      };

      // Lightweight push: only refresh activeRequests + recentRequests on pending changes
      state.sendPending = async () => {
        if (state.closed || !state.cachedStats) return;
        try {
          const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
          const stats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("update", state.send);
          statsEmitter.off("pending", state.sendPending);
          clearInterval(state.keepalive);
        }
      };

      await state.send();

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.sendPending);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          clearInterval(state.keepalive);
        }
      }, 25000);
    },

    cancel() {
      state.closed = true;
      statsEmitter.off("update", state.send);
      statsEmitter.off("pending", state.sendPending);
      clearInterval(state.keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
