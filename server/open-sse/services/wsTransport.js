/**
 * WebSocket transport for the Codex Responses API.
 * Adapted from codex-proxy's ws-transport.ts.
 *
 * Opens a WebSocket to the backend, sends a `response.create` message,
 * and wraps incoming JSON messages into an SSE-formatted ReadableStream.
 * This lets existing SSE parsing work identically whether HTTP or WS was used.
 *
 * When poolCtx is provided, tries to reuse a pooled WS for (entryId, poolKey);
 * on WsReusedConnectionError, falls back to a fresh one-shot connection.
 */

import { PersistentWs, WsReusedConnectionError } from "./wsPool.js";
import { classifyCodexWsErrorEvent } from "../utils/errorClassification.js";

function isTerminalWsEvent(type) {
  return type === "response.completed" || type === "response.failed" || type === "error";
}

// ── Lazy ws module loading ─────────────────────────────────────────

let _WS = null;

async function getWS() {
  if (!_WS) {
    const mod = await import("ws");
    _WS = mod.default || mod.WebSocket || mod;
  }
  return _WS;
}

// ── Proxy agent cache ──────────────────────────────────────────────

const _agentCache = new Map();

async function buildWsOpts(WS, headers, proxyUrl) {
  const wsOpts = { headers };
  if (proxyUrl) {
    let agent = _agentCache.get(proxyUrl);
    if (!agent) {
      const { HttpsProxyAgent } = await import("https-proxy-agent");
      agent = new HttpsProxyAgent(proxyUrl);
      _agentCache.set(proxyUrl, agent);
    }
    wsOpts.agent = agent;
  }
  return wsOpts;
}

// ── Factory for pool-managed connections ───────────────────────────

async function createPersistentWsConnection(opts) {
  const WS = await getWS();
  const wsOpts = await buildWsOpts(WS, opts.headers, opts.proxyUrl);
  const ws = new WS(opts.wsUrl, wsOpts);

  const persistent = new PersistentWs({
    ws,
    entryId: opts.entryId,
    poolKey: opts.poolKey,
    hooks: opts.hooks,
  });

  await new Promise((resolve, reject) => {
    if (ws.readyState === WS.OPEN || ws.readyState === 1) {
      resolve();
      return;
    }
    const cleanup = () => {
      ws.removeListener("open", onOpen);
      ws.removeListener("error", onErr);
      ws.removeListener("close", onClose);
    };
    const onOpen = () => { cleanup(); resolve(); };
    const onErr = (err) => { cleanup(); reject(err); };
    const onClose = () => { cleanup(); reject(new Error("WebSocket closed before open")); };
    ws.once("open", onOpen);
    ws.once("error", onErr);
    ws.once("close", onClose);
  });

  return persistent;
}

// ── One-shot WS (no pooling) ───────────────────────────────────────

async function openOneShotWs(wsUrl, headers, request, signal, proxyUrl) {
  const WS = await getWS();
  const wsOpts = await buildWsOpts(WS, headers, proxyUrl);

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted before WebSocket connect"));
      return;
    }

    const ws = new WS(wsUrl, wsOpts);
    const encoder = new TextEncoder();
    let controller = null;
    let streamClosed = false;
    let earlyDecisionMade = false;
    let sawTerminalEvent = false;

    function closeStream() {
      if (!streamClosed && controller) {
        streamClosed = true;
        try { controller.close(); } catch { /* already closed */ }
      }
    }

    function errorStream(err) {
      if (!streamClosed && controller) {
        streamClosed = true;
        try { controller.error(err); } catch { /* already closed */ }
      }
    }

    const onAbort = () => {
      try { ws.close(1000, "aborted"); } catch { /* already closing */ }
      if (!earlyDecisionMade) {
        earlyDecisionMade = true;
        reject(new Error("Aborted during WebSocket connect"));
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const stream = new ReadableStream({
      start(c) { controller = c; },
      cancel() { ws.close(1000, "stream cancelled"); },
    });

    let upgradeHeaders = {};
    ws.on("upgrade", (response) => {
      upgradeHeaders = response.headers || {};
    });

    function buildResponse() {
      const responseHeaders = new Headers({ "content-type": "text/event-stream" });
      for (const [key, value] of Object.entries(upgradeHeaders)) {
        const v = Array.isArray(value) ? value[0] : value;
        if (v != null) responseHeaders.set(key, v);
      }
      return new Response(stream, { status: 200, headers: responseHeaders });
    }

    ws.on("open", () => {
      ws.send(JSON.stringify(request));
    });

    ws.on("message", (data) => {
      if (streamClosed) return;
      const raw = typeof data === "string" ? data : data.toString("utf-8");

      let msg = null;
      let type = "unknown";
      try {
        msg = JSON.parse(raw);
        type = typeof msg.type === "string" ? msg.type : "unknown";
      } catch { /* raw passthrough */ }

      if (!earlyDecisionMade) {
        earlyDecisionMade = true;
        if (msg) {
          const classified = classifyCodexWsErrorEvent(msg);
          if (classified) {
            const err = new Error(JSON.stringify(msg));
            err.status = classified.status;
            err.body = JSON.stringify(msg);
            reject(err);
            try { ws.close(1000, "early upstream error"); } catch { /* already closing */ }
            return;
          }
        }
        resolve(buildResponse());
      }

      // Internal rate-limit frames: observe but don't forward as SSE
      if (msg && type === "codex.rate_limits") {
        // Rate limit data is passively logged by chatCore via response headers;
        // WS events are silently consumed here.
        return;
      }

      if (msg) {
        const sse = `event: ${type}\ndata: ${raw}\n\n`;
        controller.enqueue(encoder.encode(sse));

        if (isTerminalWsEvent(type)) {
          sawTerminalEvent = true;
          queueMicrotask(() => {
            closeStream();
            ws.close(1000);
          });
        }
      } else {
        controller.enqueue(encoder.encode(`data: ${raw}\n\n`));
      }
    });

    ws.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      if (!earlyDecisionMade) {
        earlyDecisionMade = true;
        reject(err);
      } else {
        errorStream(err);
      }
    });

    ws.on("close", (code, reason) => {
      signal?.removeEventListener("abort", onAbort);
      const reasonStr = reason && reason.length ? reason.toString("utf-8") : "";
      if (!earlyDecisionMade) {
        earlyDecisionMade = true;
        reject(new Error(`WebSocket closed before any data: code=${code}${reasonStr ? ` reason=${reasonStr}` : ""}`));
        return;
      }
      if (!sawTerminalEvent) {
        errorStream(new Error(`WebSocket closed before terminal event: code=${code}${reasonStr ? ` reason=${reasonStr}` : ""}`));
        return;
      }
      closeStream();
    });
  });
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Open a WebSocket to the Codex backend, send response.create,
 * and return a Response whose body is an SSE-formatted ReadableStream.
 *
 * @param {string} wsUrl - WebSocket URL (wss://...)
 * @param {object} headers - Headers for WS upgrade request
 * @param {object} request - WsCreateRequest payload
 * @param {AbortSignal} [signal]
 * @param {string|null} [proxyUrl]
 * @param {object} [poolCtx] - { pool, poolKey, entryId, onDecision }
 * @returns {Promise<Response>}
 */
export async function createWebSocketResponse(wsUrl, headers, request, signal, proxyUrl, poolCtx) {
  if (poolCtx) {
    try {
      const acquired = await poolCtx.pool.acquire(
        poolCtx.entryId,
        poolCtx.poolKey,
        (deps) => createPersistentWsConnection({
          wsUrl,
          headers,
          proxyUrl,
          entryId: deps.entryId,
          poolKey: deps.poolKey,
          hooks: deps.hooks,
        }),
      );

      if ("ws" in acquired) {
        poolCtx.onDecision?.({
          kind: acquired.reused ? "reuse" : "new",
          wsId: acquired.ws.id,
        });
        try {
          return await acquired.ws.send({ request, signal, reused: acquired.reused });
        } catch (err) {
          if (err instanceof WsReusedConnectionError) {
            poolCtx.onDecision?.({ kind: "retry-after-stale-reuse", wsId: acquired.ws.id });
            return openOneShotWs(wsUrl, headers, request, signal, proxyUrl);
          }
          throw err;
        }
      }
      // Bypass
      poolCtx.onDecision?.({ kind: "bypass", reason: acquired.bypass });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ws-pool] acquire failed, using one-shot fallback: ${msg}`);
      poolCtx.onDecision?.({ kind: "bypass", reason: "factory_error" });
    }
  }

  return openOneShotWs(wsUrl, headers, request, signal, proxyUrl);
}
