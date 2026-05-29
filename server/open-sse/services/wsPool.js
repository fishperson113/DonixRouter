/**
 * WebSocket connection pool for upstream Codex Responses API.
 * Adapted from codex-proxy's ws-pool.ts.
 *
 * Pins same (connectionId, conversationId) to the same physical WS for all turns,
 * so the upstream LB pins to the same backend and prompt cache stays warm.
 *
 * Design:
 * - Pool key: `${connectionId}:${conversationId}` — both stable across turns.
 * - Per-WS strict serial: one in-flight at a time per WS.
 * - No idle TTL: kept open until natural death, max_age_ms (55 min), or account state change.
 * - Keepalive ping every 25s to detect silently broken connections.
 */

import { randomUUID } from "crypto";
import { classifyCodexWsErrorEvent } from "../utils/errorClassification.js";

// ── Error types ────────────────────────────────────────────────────

export class WsReusedConnectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "WsReusedConnectionError";
  }
}

// ── Constants ──────────────────────────────────────────────────────

const WS_OPEN = 1;

function isTerminalWsEvent(type) {
  return type === "response.completed" || type === "response.failed" || type === "error";
}

// ── PersistentWs ───────────────────────────────────────────────────

export const DEFAULT_PING_INTERVAL_MS = 25_000;
export const DEFAULT_LIVENESS_TIMEOUT_MULTIPLIER = 2.5;

export class PersistentWs {
  constructor(opts) {
    this.id = randomUUID().slice(0, 8);
    this.ws = opts.ws;
    this.entryId = opts.entryId;
    this.poolKey = opts.poolKey;
    this._hooks = opts.hooks;
    this._now = opts.now ?? Date.now;
    this._createdAt = this._now();
    this._lastActivityAt = this._createdAt;
    this._busy = false;
    this._currentSession = null;
    this._pendingClose = false;
    this._dead = false;
    this._upgradeHeaders = {};
    this._encoder = new TextEncoder();

    const pingMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this._livenessTimeoutMs = opts.livenessTimeoutMs ?? Math.round(pingMs * DEFAULT_LIVENESS_TIMEOUT_MULTIPLIER);

    this.ws.on("upgrade", (response) => {
      this._upgradeHeaders = response.headers || {};
    });

    this.ws.on("message", (data) => {
      this._lastActivityAt = this._now();
      this._handleMessage(data);
    });

    this.ws.on("pong", () => {
      this._lastActivityAt = this._now();
    });

    this.ws.on("error", (err) => this._handleTransportError(err));
    this.ws.on("close", (code, reason) => this._handleClose(code, reason));

    if (pingMs > 0) {
      this._pingTimer = setInterval(() => this._sendKeepalivePing(), pingMs);
      this._pingTimer.unref?.();
    }
  }

  tryAcquire() {
    if (this._busy || this._pendingClose || this._dead) return false;
    if (this.ws.readyState !== WS_OPEN) return false;
    this._busy = true;
    return true;
  }

  isAlive() {
    return !this._dead && !this._pendingClose && this.ws.readyState === WS_OPEN;
  }

  isBusy() {
    return this._busy;
  }

  isExpired(maxAgeMs) {
    return this._now() - this._createdAt > maxAgeMs;
  }

  /**
   * Send request over this WS. Caller MUST have called tryAcquire() first.
   * @param {object} opts
   * @param {object} opts.request - WS create request payload
   * @param {AbortSignal} [opts.signal]
   * @param {function} [opts.onRateLimits]
   * @param {boolean} opts.reused
   * @returns {Promise<Response>}
   */
  send(opts) {
    if (!this._busy) {
      throw new Error("PersistentWs.send called without prior tryAcquire");
    }

    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) {
        this._busy = false;
        this._markDead("aborted before send");
        reject(new Error("Aborted before WebSocket send"));
        return;
      }

      const wrappedReject = (err) => {
        if (opts.reused && !(err instanceof WsReusedConnectionError)) {
          reject(new WsReusedConnectionError(err.message));
        } else {
          reject(err);
        }
      };

      const stream = new ReadableStream({
        start: (controller) => {
          this._currentSession = {
            controller,
            onRateLimits: opts.onRateLimits,
            earlyDecisionMade: false,
            sawTerminalEvent: false,
            resolveResponse: () => resolve(this._buildResponse(stream)),
            reject: wrappedReject,
            abortListener: null,
            signal: opts.signal,
            streamClosed: false,
          };

          if (opts.signal) {
            const listener = () => this._handleAbort();
            opts.signal.addEventListener("abort", listener, { once: true });
            this._currentSession.abortListener = listener;
          }
        },
        cancel: () => {
          this._markDead("stream cancelled by caller");
        },
      });

      try {
        this.ws.send(JSON.stringify(opts.request));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._busy = false;
        this._markDead(`send failed: ${msg}`);
        wrappedReject(err instanceof Error ? err : new Error(msg));
      }
    });
  }

  closeGracefully() {
    this._pendingClose = true;
    if (!this._busy) {
      this._markDead("closeGracefully");
    }
  }

  // ── Private ──────────────────────────────────────────────────────

  _sendKeepalivePing() {
    if (this._dead || this._busy || this.ws.readyState !== WS_OPEN) return;
    if (this._livenessTimeoutMs > 0 && this._now() - this._lastActivityAt > this._livenessTimeoutMs) {
      this._markDead(`liveness timeout (no activity for ${this._now() - this._lastActivityAt}ms)`);
      return;
    }
    try { this.ws.ping(); } catch { /* skip */ }
  }

  _markDead(reason) {
    if (this._dead) return;
    this._dead = true;
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = undefined;
    }
    try { this.ws.close(1000, reason.slice(0, 120)); } catch { /* already closing */ }
    if (this._currentSession && !this._currentSession.streamClosed) {
      try { this._currentSession.controller.close(); } catch { /* already closed */ }
      this._currentSession.streamClosed = true;
    }
    this._detachAbortListener();
    this._busy = false;
    this._currentSession = null;
    try { this._hooks.onDead(); } catch { /* hook errors must not propagate */ }
  }

  _detachAbortListener() {
    const sess = this._currentSession;
    if (sess?.signal && sess.abortListener) {
      sess.signal.removeEventListener("abort", sess.abortListener);
      sess.abortListener = null;
    }
  }

  _buildResponse(stream) {
    const responseHeaders = new Headers({ "content-type": "text/event-stream" });
    for (const [key, value] of Object.entries(this._upgradeHeaders)) {
      const v = Array.isArray(value) ? value[0] : value;
      if (v != null) responseHeaders.set(key, v);
    }
    return new Response(stream, { status: 200, headers: responseHeaders });
  }

  _handleMessage(data) {
    const sess = this._currentSession;
    if (!sess || sess.streamClosed) return;

    const raw = typeof data === "string" ? data : data.toString("utf-8");
    let msg = null;
    let type = "unknown";
    try {
      msg = JSON.parse(raw);
      type = typeof msg.type === "string" ? msg.type : "unknown";
    } catch { /* raw passthrough */ }

    // Internal rate-limit frames
    if (msg && type === "codex.rate_limits" && sess.onRateLimits) {
      sess.onRateLimits(msg);
      return;
    }

    if (!sess.earlyDecisionMade) {
      sess.earlyDecisionMade = true;
      if (msg) {
        const classified = classifyCodexWsErrorEvent(msg);
        if (classified) {
          const err = new Error(JSON.stringify(msg));
          err.status = classified.status;
          err.body = JSON.stringify(msg);
          sess.reject(err);
          if (classified.code === "websocket_connection_limit_reached") {
            this._markDead("server connection limit");
          } else {
            this._releaseAfterEarlyError();
          }
          return;
        }
      }
      sess.resolveResponse();
    }

    if (msg) {
      const sse = `event: ${type}\ndata: ${raw}\n\n`;
      sess.controller.enqueue(this._encoder.encode(sse));

      if (isTerminalWsEvent(type)) {
        sess.sawTerminalEvent = true;
        queueMicrotask(() => this._releaseAfterTerminalFrame());
      }
    } else {
      sess.controller.enqueue(this._encoder.encode(`data: ${raw}\n\n`));
    }
  }

  _handleAbort() {
    const sess = this._currentSession;
    if (!sess) return;
    if (!sess.earlyDecisionMade) {
      sess.earlyDecisionMade = true;
      sess.reject(new Error("Aborted during WebSocket request"));
    } else if (!sess.streamClosed) {
      try { sess.controller.error(new Error("Aborted during WebSocket stream")); } catch { /* already closed */ }
      sess.streamClosed = true;
    }
    this._markDead("aborted");
  }

  _handleTransportError(err) {
    const sess = this._currentSession;
    if (!sess) {
      this._markDead(`transport error (idle): ${err.message}`);
      return;
    }
    if (!sess.earlyDecisionMade) {
      sess.earlyDecisionMade = true;
      sess.reject(err);
    } else if (!sess.streamClosed) {
      try { sess.controller.error(err); } catch { /* already closed */ }
      sess.streamClosed = true;
    }
    this._markDead(`transport error: ${err.message}`);
  }

  _handleClose(code, reason) {
    const reasonStr = reason && reason.length ? reason.toString("utf-8") : "";
    const sess = this._currentSession;
    if (sess && !sess.earlyDecisionMade) {
      sess.earlyDecisionMade = true;
      sess.reject(new Error(`WebSocket closed before any data: code=${code}${reasonStr ? ` reason=${reasonStr}` : ""}`));
    } else if (sess && !sess.streamClosed) {
      if (sess.sawTerminalEvent) {
        try { sess.controller.close(); } catch { /* already closed */ }
      } else {
        try {
          sess.controller.error(new Error(`WebSocket closed before terminal event: code=${code}${reasonStr ? ` reason=${reasonStr}` : ""}`));
        } catch { /* already closed */ }
      }
      sess.streamClosed = true;
    }
    this._markDead(`closed code=${code}${reasonStr ? ` reason=${reasonStr}` : ""}`);
  }

  _releaseAfterTerminalFrame() {
    const sess = this._currentSession;
    if (sess && !sess.streamClosed) {
      try { sess.controller.close(); } catch { /* already closed */ }
      sess.streamClosed = true;
    }
    this._detachAbortListener();
    this._currentSession = null;
    this._busy = false;
    if (this._pendingClose) this._markDead("pending close after terminal frame");
  }

  _releaseAfterEarlyError() {
    this._detachAbortListener();
    this._currentSession = null;
    this._busy = false;
    if (this._pendingClose) this._markDead("pending close after early error");
  }
}

// ── WsConnectionPool ───────────────────────────────────────────────

export const DEFAULT_WS_POOL_CONFIG = {
  enabled: true,
  maxAgeMs: 3_300_000, // 55 minutes (under server's 60-min hard cap)
  maxPerAccount: 8,
};

export class WsConnectionPool {
  constructor(config = {}, opts = {}) {
    this._map = new Map();
    this._byEntry = new Map();
    this._config = { ...DEFAULT_WS_POOL_CONFIG, ...config };
    this._shuttingDown = false;

    if (opts.startGc !== false && this._config.enabled) {
      this._gcInterval = setInterval(() => this.gcSweep(), opts.gcIntervalMs ?? 60_000);
      this._gcInterval.unref?.();
    }
  }

  /**
   * Try to get a usable PersistentWs for (entryId, poolKey).
   * @param {string} entryId - Connection ID
   * @param {string} poolKey - `${connectionId}:${conversationId}`
   * @param {function} factory - async ({ entryId, poolKey, hooks }) => PersistentWs
   * @returns {Promise<{ ws: PersistentWs, reused: boolean } | { bypass: string }>}
   */
  async acquire(entryId, poolKey, factory) {
    if (!this._config.enabled || this._shuttingDown) {
      return { bypass: "disabled" };
    }
    if (!entryId || !poolKey) {
      return { bypass: "no_key" };
    }

    let existing = this._map.get(poolKey);
    if (existing && !existing.isAlive()) {
      this._removeEntry(existing);
      existing = undefined;
    }
    if (existing) {
      if (existing.tryAcquire()) {
        return { ws: existing, reused: true };
      }
      return { bypass: "busy" };
    }

    // Miss: enforce per-account cap before creating
    const keys = this._byEntry.get(entryId);
    if (keys && keys.size >= this._config.maxPerAccount) {
      return { bypass: "cap" };
    }

    const fresh = await factory({
      entryId,
      poolKey,
      hooks: {
        onDead: () => this._removeEntryByKey(poolKey),
      },
    });

    // Race: another acquire for same key may have completed during factory() await
    const racer = this._map.get(poolKey);
    if (racer) {
      fresh.closeGracefully();
      if (racer.isAlive() && racer.tryAcquire()) {
        return { ws: racer, reused: true };
      }
      return { bypass: "busy" };
    }

    if (!fresh.tryAcquire()) {
      fresh.closeGracefully();
      return { bypass: "dead" };
    }

    this._map.set(poolKey, fresh);
    let entryKeys = this._byEntry.get(entryId);
    if (!entryKeys) {
      entryKeys = new Set();
      this._byEntry.set(entryId, entryKeys);
    }
    entryKeys.add(poolKey);
    return { ws: fresh, reused: false };
  }

  /** Evict every WS for the given entryId (rate-limited/banned/disabled/refreshed). */
  evictByEntryId(entryId) {
    const keys = this._byEntry.get(entryId);
    if (!keys) return;
    for (const key of [...keys]) {
      const ws = this._map.get(key);
      if (ws) ws.closeGracefully();
    }
    this._byEntry.delete(entryId);
  }

  countByEntryId(entryId) {
    return this._byEntry.get(entryId)?.size ?? 0;
  }

  size() {
    return this._map.size;
  }

  async shutdown() {
    this._shuttingDown = true;
    if (this._gcInterval) {
      clearInterval(this._gcInterval);
      this._gcInterval = undefined;
    }
    for (const ws of [...this._map.values()]) {
      ws.closeGracefully();
    }
    this._map.clear();
    this._byEntry.clear();
  }

  gcSweep() {
    for (const [, ws] of this._map) {
      if (ws.isBusy()) continue;
      if (!ws.isAlive() || ws.isExpired(this._config.maxAgeMs)) {
        ws.closeGracefully();
      }
    }
  }

  _removeEntry(ws) {
    this._removeEntryByKey(ws.poolKey);
  }

  _removeEntryByKey(poolKey) {
    const ws = this._map.get(poolKey);
    if (!ws) return;
    this._map.delete(poolKey);
    const entryKeys = this._byEntry.get(ws.entryId);
    if (entryKeys) {
      entryKeys.delete(poolKey);
      if (entryKeys.size === 0) this._byEntry.delete(ws.entryId);
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let _singleton = null;

export function getWsPool() {
  if (!_singleton) _singleton = new WsConnectionPool();
  return _singleton;
}

export function setWsPoolConfig(config) {
  if (_singleton) _singleton.shutdown();
  _singleton = new WsConnectionPool(config);
  return _singleton;
}
