/**
 * CodexAppServerClient — JSON-RPC WebSocket client for the Official Agent protocol.
 *
 * Connects to a Codex App Server instance, handles:
 * - Authentication (none / capability_token / signed_bearer_token)
 * - JSON-RPC 2.0 request/response lifecycle
 * - Notification streaming for turn events
 * - Sequenced turn execution (only one turn in-flight at a time)
 *
 * JavaScript port of codex-proxy-dev/src/codex-app-server/client.ts
 */

import { createHmac, randomUUID } from "crypto";
import { readFileSync } from "fs";
import WebSocket from "ws";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedFile(path) {
  return readFileSync(path, "utf-8").trim();
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signHs256(payload, secret) {
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const body = base64UrlJson(payload);
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function authHeader(options) {
  switch (options.auth.type) {
    case "none":
      return undefined;
    case "capability_token": {
      const token = options.auth.token ?? (options.auth.token_file ? readTrimmedFile(options.auth.token_file) : "");
      return `Bearer ${token}`;
    }
    case "signed_bearer_token": {
      const secret = options.auth.shared_secret ??
        (options.auth.shared_secret_file ? readTrimmedFile(options.auth.shared_secret_file) : "");
      const now = Math.floor(Date.now() / 1000);
      return `Bearer ${signHs256({
        iss: options.auth.issuer,
        aud: options.auth.audience,
        sub: options.auth.subject,
        iat: now,
        exp: now + options.auth.ttl_seconds,
        jti: randomUUID(),
      }, secret)}`;
    }
  }
}

function normalizeNotification(message) {
  if (typeof message.method !== "string") return null;
  return {
    method: message.method,
    ...(message.params !== undefined ? { params: message.params } : {}),
  };
}

function isTerminalTurnNotification(method) {
  return method === "turn/completed" ||
    method === "turn/failed" ||
    method === "turn/cancelled" ||
    method === "turn/interrupted";
}

class AsyncNotificationQueue {
  constructor() {
    this.queue = [];
    this.waiters = [];
    this.isClosed = false;
  }

  push(item) {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    this.queue.push(item);
  }

  close() {
    this.isClosed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter(null);
    }
  }

  async next() {
    const queued = this.queue.shift();
    if (queued) return queued;
    if (this.isClosed) return null;
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export class CodexAppServerClient {
  constructor(options) {
    this.options = options;
    this.ws = null;
    this.nextId = 1;
    this.initialized = false;
    this.pending = new Map();
    this.notifications = new AsyncNotificationQueue();
    this.connectPromise = null;
    this.initializePromise = null;
    this.turnTail = Promise.resolve();
  }

  async listApps(params) {
    return this.request("app/list", params ?? { limit: 100 });
  }

  async startThread(params) {
    return this.request("thread/start", params);
  }

  async startTurn(params) {
    return this.request("turn/start", this._buildTurnParams(params));
  }

  async *notificationsUntilTurnCompleted() {
    while (true) {
      const notification = await this.notifications.next();
      if (!notification) return;
      yield notification;
      if (isTerminalTurnNotification(notification.method)) return;
    }
  }

  async *runTurn(params) {
    const previousTurn = this.turnTail.catch(() => undefined);
    let releaseTurn = () => {};
    const currentTurn = new Promise((resolve) => {
      releaseTurn = resolve;
    });
    this.turnTail = previousTurn.then(() => currentTurn);
    await previousTurn;

    try {
      const notifications = this.notificationsUntilTurnCompleted();
      const result = await this.startTurn(params);
      yield { type: "result", result };
      for await (const notification of notifications) {
        yield { type: "notification", notification };
      }
    } finally {
      releaseTurn();
    }
  }

  async close() {
    this.notifications.close();
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Codex app-server client closed before request ${id} completed`));
    }
    this.pending.clear();
    const ws = this.ws;
    this.ws = null;
    this.initialized = false;
    if (!ws) return;
    await new Promise((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      ws.once("close", () => resolve());
      ws.close();
      setTimeout(resolve, 250).unref();
    });
  }

  _buildTurnParams(params) {
    const input = [];
    if (params.app) {
      input.push({ type: "text", text: `$${params.app.id} ${params.text}`, text_elements: [] });
      input.push({
        type: "mention",
        name: params.app.name ?? params.app.id,
        path: `app://${params.app.id}`,
      });
    } else {
      input.push({ type: "text", text: params.text, text_elements: [] });
    }

    return {
      threadId: params.threadId,
      input,
      ...(params.cwd ? { cwd: params.cwd } : {}),
      ...(params.approvalPolicy ? { approvalPolicy: params.approvalPolicy } : {}),
    };
  }

  async request(method, params) {
    await this._ensureReady();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Codex app-server WebSocket is not open");
    }

    const id = this.nextId++;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, this.options.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
    });
    ws.send(JSON.stringify(request));
    return promise;
  }

  async _ensureReady() {
    await this._ensureConnected();
    if (this.initialized) return;
    if (this.initializePromise) {
      await this.initializePromise;
      return;
    }
    const promise = (async () => {
      await this._requestRaw("initialize", {
        clientInfo: this.options.clientInfo,
        capabilities: { experimentalApi: true },
      });
      this._sendNotification("initialized");
      this.initialized = true;
    })();
    this.initializePromise = promise;
    try {
      await promise;
    } finally {
      if (this.initializePromise === promise) {
        this.initializePromise = null;
      }
    }
  }

  async _requestRaw(method, params) {
    await this._ensureConnected();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Codex app-server WebSocket is not open");
    }
    const id = this.nextId++;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, this.options.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
    });
    ws.send(JSON.stringify(request));
    return promise;
  }

  _sendNotification(method, params) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    }));
  }

  async _ensureConnected() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }
    const headers = {};
    const authorization = authHeader(this.options);
    if (authorization) headers.Authorization = authorization;

    const ws = new WebSocket(this.options.url, { headers });
    this.ws = ws;
    ws.on("message", (raw) => this._handleMessage(raw.toString()));
    ws.on("close", () => {
      if (this.ws !== ws) return;
      this.notifications.close();
      this.notifications = new AsyncNotificationQueue();
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Codex app-server WebSocket closed before request ${id} completed`));
      }
      this.pending.clear();
      this.ws = null;
      this.initialized = false;
      this.initializePromise = null;
      this.connectPromise = null;
    });
    ws.on("error", (err) => {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Codex app-server WebSocket error before request ${id} completed: ${err.message}`));
      }
      this.pending.clear();
    });

    const promise = new Promise((resolve, reject) => {
      const cleanup = () => {
        ws.off("open", onOpen);
        ws.off("error", onError);
        ws.off("close", onClose);
      };
      const onOpen = () => { cleanup(); resolve(); };
      const onError = (err) => { cleanup(); reject(err); };
      const onClose = () => { cleanup(); reject(new Error("Codex app-server WebSocket closed before open")); };
      ws.once("open", onOpen);
      ws.once("error", onError);
      ws.once("close", onClose);
    });
    this.connectPromise = promise;
    try {
      await promise;
    } finally {
      if (this.connectPromise === promise) {
        this.connectPromise = null;
      }
    }
  }

  _handleMessage(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;

    if ("id" in parsed && typeof parsed.id === "number") {
      this._handleResponse(parsed);
      return;
    }
    const notification = normalizeNotification(parsed);
    if (notification) this.notifications.push(notification);
  }

  _handleResponse(response) {
    if (!("id" in response) || typeof response.id !== "number") return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timeout);

    if ("error" in response) {
      pending.reject(new Error(response.error.message ?? "Codex app-server JSON-RPC error"));
      return;
    }
    if ("result" in response) {
      pending.resolve(response.result);
      return;
    }
    pending.reject(new Error("Codex app-server JSON-RPC response missing result"));
  }
}
