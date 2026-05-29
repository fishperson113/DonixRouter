import "#open-sse/index.js";

import { fetchAllQuotas } from "#open-sse/services/quotaSnapshot.js";
import { statsEmitter, getActiveConnectionIds } from "#lib/usageDb.js";

export const dynamic = "force-dynamic";

const FULL_REFRESH_INTERVAL_MS = 60_000;

function withActiveIds(snapshot) {
  return { ...snapshot, activeConnectionIds: getActiveConnectionIds() };
}

export async function GET() {
  const encoder = new TextEncoder();
  const state = {
    closed: false,
    keepalive: null,
    onUpdate: null,
    onPending: null,
    refreshTimer: null,
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          state.closed = true;
        }
      };

      try {
        send(withActiveIds(await fetchAllQuotas()));
      } catch {
        send({
          connections: [],
          quotas: {},
          activeConnectionIds: [],
          timestamp: new Date().toISOString(),
        });
      }

      state.onPending = () => {
        if (state.closed) return;
        send({
          type: "active_update",
          activeConnectionIds: getActiveConnectionIds(),
          timestamp: new Date().toISOString(),
        });
      };

      state.onUpdate = async () => {
        if (state.closed) return;
        try {
          send({ type: "usage_update", timestamp: new Date().toISOString() });
          send({
            type: "active_update",
            activeConnectionIds: getActiveConnectionIds(),
            timestamp: new Date().toISOString(),
          });
        } catch {
          state.closed = true;
        }
      };

      statsEmitter.on("pending", state.onPending);
      statsEmitter.on("update", state.onUpdate);

      state.refreshTimer = setInterval(async () => {
        if (state.closed) {
          clearInterval(state.refreshTimer);
          return;
        }
        try {
          send(withActiveIds(await fetchAllQuotas()));
        } catch {}
      }, FULL_REFRESH_INTERVAL_MS);

      state.keepalive = setInterval(() => {
        if (state.closed) {
          clearInterval(state.keepalive);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          clearInterval(state.keepalive);
        }
      }, 25_000);
    },

    cancel() {
      state.closed = true;
      if (state.onUpdate) statsEmitter.off("update", state.onUpdate);
      if (state.onPending) statsEmitter.off("pending", state.onPending);
      if (state.refreshTimer) clearInterval(state.refreshTimer);
      if (state.keepalive) clearInterval(state.keepalive);
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
