/**
 * CodexApi — client for the Codex Responses API.
 *
 * Endpoint: POST /backend-api/codex/responses
 * This is the API the Codex CLI actually uses.
 * It requires: instructions, store: false, stream: true.
 *
 * All upstream requests go through the TLS transport layer
 * (native rustls transport when available).
 *
 * JavaScript port of codex-proxy-dev/src/proxy/codex-api.ts
 */

import { getTransport } from "./transport.js";
import { CodexApiError, PreviousResponseWebSocketError } from "./codex-types.js";
import { parseSSEBlock, parseSSEStream } from "./codex-sse.js";
import { fetchUsage } from "./codex-usage.js";
import { fetchModels, probeEndpoint as probeEndpointFn } from "./codex-models.js";
import { getInstallationId } from "../open-sse/utils/installationId.js";
import { normalizeOpenAISubagent, OPENAI_SUBAGENT_HEADER } from "./openai-subagent.js";
import { buildFingerprintHeaders } from "../open-sse/utils/fingerprintManager.js";
import { getCookieJar } from "../open-sse/services/cookieJar.js";
import { createWebSocketResponse } from "../open-sse/services/wsTransport.js";

const DEFAULT_BASE_URL = "https://api.openai.com/backend-api";

const X_CODEX_TURN_METADATA_HEADER = "x-codex-turn-metadata";
const X_CODEX_BETA_FEATURES_HEADER = "x-codex-beta-features";
const X_RESPONSESAPI_INCLUDE_TIMING_METRICS_HEADER = "x-responsesapi-include-timing-metrics";
const X_CODEX_PARENT_THREAD_ID_HEADER = "x-codex-parent-thread-id";
const X_CODEX_WINDOW_ID_HEADER = "x-codex-window-id";

function normalizeServiceTierForUpstream(serviceTier) {
  if (!serviceTier) return undefined;
  return serviceTier === "fast" ? "priority" : serviceTier;
}

export class CodexApi {
  constructor(token, accountId, cookieJar, entryId, proxyUrl, baseUrl, transport) {
    this.tag = "codex";
    this.token = token;
    this.accountId = accountId ?? null;
    this.cookieJar = cookieJar ?? null;
    this.entryId = entryId ?? null;
    this.proxyUrl = proxyUrl;
    this.baseUrl = baseUrl;
    this.transport = transport;
  }

  _resolveBaseUrl() {
    return this.baseUrl ?? DEFAULT_BASE_URL;
  }

  _resolveTransport() {
    return this.transport ?? getTransport();
  }

  _buildConversationIdentity(request) {
    const conversationId =
      typeof request.prompt_cache_key === "string" && request.prompt_cache_key.trim()
        ? request.prompt_cache_key.trim()
        : null;
    return {
      conversationId,
      windowId:
        (typeof request.codexWindowId === "string" && request.codexWindowId.trim()
          ? request.codexWindowId.trim()
          : null) ??
        (conversationId ? `${conversationId}:0` : null),
    };
  }

  _firstRequestString(request, key) {
    const direct =
      key === X_CODEX_TURN_METADATA_HEADER ? request.turnMetadata
        : key === X_CODEX_BETA_FEATURES_HEADER ? request.betaFeatures
        : key === X_RESPONSESAPI_INCLUDE_TIMING_METRICS_HEADER ? request.includeTimingMetrics
        : key === X_CODEX_PARENT_THREAD_ID_HEADER ? request.parentThreadId
        : key === X_CODEX_WINDOW_ID_HEADER ? request.codexWindowId
        : undefined;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const metadata = request.client_metadata?.[key];
    if (typeof metadata === "string" && metadata.trim()) return metadata.trim();
    return null;
  }

  _applyCodexContextHeaders(headers, request) {
    if (request.turnState) headers["x-codex-turn-state"] = request.turnState;
    const turnMetadata = this._firstRequestString(request, X_CODEX_TURN_METADATA_HEADER);
    if (turnMetadata) headers[X_CODEX_TURN_METADATA_HEADER] = turnMetadata;
    const betaFeatures = this._firstRequestString(request, X_CODEX_BETA_FEATURES_HEADER);
    if (betaFeatures) headers[X_CODEX_BETA_FEATURES_HEADER] = betaFeatures;
    const timingMetrics = this._firstRequestString(request, X_RESPONSESAPI_INCLUDE_TIMING_METRICS_HEADER);
    if (timingMetrics) headers[X_RESPONSESAPI_INCLUDE_TIMING_METRICS_HEADER] = timingMetrics;
    if (request.version?.trim()) headers["Version"] = request.version.trim();
    const parentThreadId = this._firstRequestString(request, X_CODEX_PARENT_THREAD_ID_HEADER);
    if (parentThreadId) headers[X_CODEX_PARENT_THREAD_ID_HEADER] = parentThreadId;
  }

  _buildCodexClientMetadata(request, installationId, windowId) {
    const metadata = {
      ...(request.client_metadata ?? {}),
      "x-codex-installation-id": installationId,
      ...(windowId ? { [X_CODEX_WINDOW_ID_HEADER]: windowId } : {}),
    };
    const turnMetadata = this._firstRequestString(request, X_CODEX_TURN_METADATA_HEADER);
    if (turnMetadata) metadata[X_CODEX_TURN_METADATA_HEADER] = turnMetadata;
    const parentThreadId = this._firstRequestString(request, X_CODEX_PARENT_THREAD_ID_HEADER);
    if (parentThreadId) metadata[X_CODEX_PARENT_THREAD_ID_HEADER] = parentThreadId;
    return metadata;
  }

  setToken(token) {
    this.token = token;
  }

  /** Build headers with cookies injected. */
  _applyHeaders(headers) {
    if (this.cookieJar && this.entryId) {
      const cookie = this.cookieJar.getCookieHeader(this.entryId);
      if (cookie) headers["Cookie"] = cookie;
    }
    return headers;
  }

  /** Capture Set-Cookie headers from transport response into the jar. */
  _captureCookies(setCookieHeaders) {
    if (this.cookieJar && this.entryId && setCookieHeaders?.length > 0) {
      this.cookieJar.captureRaw(this.entryId, setCookieHeaders);
    }
  }

  /** Query official Codex usage/quota. */
  async getUsage() {
    const headers = this._applyHeaders(
      buildFingerprintHeaders(this.token, this.accountId),
    );
    return fetchUsage(headers, this.proxyUrl);
  }

  /**
   * Warmup request: GET /codex/usage with cookie capture.
   * Establishes session cookies (cf_clearance, __cf_bm, etc.) so subsequent
   * API requests look like a continuous session rather than a cold start.
   */
  async warmup() {
    const transport = this._resolveTransport();
    const baseUrl = this._resolveBaseUrl();
    const url = `${baseUrl}/codex/usage`;
    const headers = this._applyHeaders(
      buildFingerprintHeaders(this.token, this.accountId),
    );
    headers["Accept"] = "application/json";
    if (!transport.isImpersonate()) {
      headers["Accept-Encoding"] = "gzip, deflate";
    }

    try {
      let body;
      if (transport.getWithCookies) {
        const result = await transport.getWithCookies(url, headers, 15, this.proxyUrl);
        this._captureCookies(result.setCookieHeaders);
        body = result.body;
      } else {
        const result = await transport.get(url, headers, 15, this.proxyUrl);
        body = result.body;
      }
      const parsed = JSON.parse(body);
      return parsed.rate_limit ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Fetch available models from the Codex backend. */
  async getModels() {
    const headers = this._applyHeaders(
      buildFingerprintHeaders(this.token, this.accountId),
    );
    return fetchModels(headers, this.proxyUrl);
  }

  /** Probe a backend endpoint and return raw JSON (for debug). */
  async probeEndpoint(path) {
    const headers = this._applyHeaders(
      buildFingerprintHeaders(this.token, this.accountId),
    );
    return probeEndpointFn(path, headers, this.proxyUrl);
  }

  /**
   * Create a response (streaming).
   * Routes to WebSocket when previous_response_id is present.
   * WS failure with previous_response_id does NOT fall back to HTTP.
   */
  async createResponse(request, signal, onRateLimits, poolCtx) {
    if (request.useWebSocket) {
      try {
        return await this._createResponseViaWebSocket(request, signal, onRateLimits, poolCtx);
      } catch (err) {
        if (err instanceof CodexApiError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (request.previous_response_id) {
          console.warn(`[CodexApi] WebSocket failed (${msg}), previous_response_id cannot safely fall back to HTTP SSE`);
          throw new PreviousResponseWebSocketError(msg);
        }
        console.warn(`[CodexApi] WebSocket failed (${msg}), falling back to HTTP SSE`);
        const { previous_response_id: _, useWebSocket: _ws, ...httpRequest } = request;
        return this._createResponseViaHttp(httpRequest, signal);
      }
    }
    return this._createResponseViaHttp(request, signal);
  }

  /**
   * Create a response via WebSocket (for previous_response_id support).
   */
  async _createResponseViaWebSocket(request, signal, onRateLimits, poolCtx) {
    const baseUrl = this._resolveBaseUrl();
    const wsUrl = baseUrl.replace(/^https?:/, "wss:") + "/codex/responses";

    const headers = this._applyHeaders(
      buildFingerprintHeaders(this.token, this.accountId),
    );
    headers["OpenAI-Beta"] = "responses_websockets=2026-02-06";
    headers["x-openai-internal-codex-residency"] = "us";
    headers["x-client-request-id"] = crypto.randomUUID();
    const installationId = getInstallationId();
    headers["x-codex-installation-id"] = installationId;
    const identity = this._buildConversationIdentity(request);
    if (identity.conversationId) {
      headers["x-client-request-id"] = identity.conversationId;
      headers["session_id"] = identity.conversationId;
    }
    if (identity.windowId) headers["x-codex-window-id"] = identity.windowId;
    this._applyCodexContextHeaders(headers, request);
    const openAiSubagent = normalizeOpenAISubagent(request.client_metadata?.[OPENAI_SUBAGENT_HEADER]);
    if (openAiSubagent) headers[OPENAI_SUBAGENT_HEADER] = openAiSubagent;

    const wsRequest = {
      type: "response.create",
      model: request.model,
      instructions: request.instructions ?? "",
      input: request.input,
      store: false,
      stream: true,
    };
    if (request.previous_response_id) wsRequest.previous_response_id = request.previous_response_id;
    if (request.reasoning) wsRequest.reasoning = request.reasoning;
    if (request.tools?.length) wsRequest.tools = request.tools;
    wsRequest.tool_choice = request.tool_choice ?? "auto";
    wsRequest.parallel_tool_calls = request.parallel_tool_calls ?? true;
    if (request.text) wsRequest.text = request.text;
    const serviceTier = normalizeServiceTierForUpstream(request.service_tier);
    if (serviceTier) wsRequest.service_tier = serviceTier;
    if (request.prompt_cache_key) wsRequest.prompt_cache_key = request.prompt_cache_key;
    if (request.include?.length) wsRequest.include = request.include;
    wsRequest.client_metadata = this._buildCodexClientMetadata(request, installationId, identity.windowId);

    return createWebSocketResponse(wsUrl, headers, wsRequest, signal, this.proxyUrl, poolCtx);
  }

  /**
   * Create a response via HTTP SSE (default transport).
   */
  async _createResponseViaHttp(request, signal) {
    const transport = this._resolveTransport();
    const baseUrl = this._resolveBaseUrl();
    const url = `${baseUrl}/codex/responses`;

    const headers = this._applyHeaders(
      buildFingerprintHeaders(this.token, this.accountId),
    );
    headers["Content-Type"] = "application/json";
    headers["Accept"] = "text/event-stream";
    headers["OpenAI-Beta"] = "responses_websockets=2026-02-06";
    headers["x-openai-internal-codex-residency"] = "us";
    headers["x-client-request-id"] = crypto.randomUUID();
    const installationId = getInstallationId();
    headers["x-codex-installation-id"] = installationId;
    const identity = this._buildConversationIdentity(request);
    if (identity.conversationId) {
      headers["x-client-request-id"] = identity.conversationId;
      headers["session_id"] = identity.conversationId;
    }
    if (identity.windowId) headers["x-codex-window-id"] = identity.windowId;
    this._applyCodexContextHeaders(headers, request);
    const openAiSubagent = normalizeOpenAISubagent(request.client_metadata?.[OPENAI_SUBAGENT_HEADER]);
    if (openAiSubagent) headers[OPENAI_SUBAGENT_HEADER] = openAiSubagent;

    const {
      previous_response_id: _pid,
      useWebSocket: _ws,
      turnState: _ts,
      turnMetadata: _tm,
      betaFeatures: _bf,
      version: _ver,
      includeTimingMetrics: _timing,
      codexWindowId: _window,
      parentThreadId: _parent,
      service_tier,
      ...bodyFields
    } = request;
    const upstreamServiceTier = normalizeServiceTierForUpstream(service_tier);
    const bodyWithMetadata = {
      ...bodyFields,
      ...(upstreamServiceTier ? { service_tier: upstreamServiceTier } : {}),
      client_metadata: this._buildCodexClientMetadata(request, installationId, identity.windowId),
    };
    const body = JSON.stringify(bodyWithMetadata);

    let transportRes;
    try {
      transportRes = await transport.post(url, headers, body, signal, undefined, this.proxyUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CodexApiError(0, msg);
    }

    this._captureCookies(transportRes.setCookieHeaders);

    if (transportRes.status < 200 || transportRes.status >= 300) {
      const MAX_ERROR_BODY = 1024 * 1024;
      const reader = transportRes.body.getReader();
      const chunks = [];
      let totalSize = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalSize += value.byteLength;
        if (totalSize <= MAX_ERROR_BODY) {
          chunks.push(value);
        } else {
          reader.cancel?.();
          break;
        }
      }
      const errorBody = Buffer.concat(chunks).toString("utf-8");
      throw new CodexApiError(transportRes.status, errorBody);
    }

    return new Response(transportRes.body, {
      status: transportRes.status,
      headers: transportRes.headers,
    });
  }

  /**
   * Compact conversation history (non-streaming JSON).
   * POST /codex/responses/compact → { output: ResponseItem[] }
   */
  async createCompactResponse(request, signal) {
    const transport = this._resolveTransport();
    const baseUrl = this._resolveBaseUrl();
    const url = `${baseUrl}/codex/responses/compact`;

    const headers = this._applyHeaders(
      buildFingerprintHeaders(this.token, this.accountId),
    );
    headers["Content-Type"] = "application/json";
    headers["OpenAI-Beta"] = "responses_websockets=2026-02-06";
    headers["x-openai-internal-codex-residency"] = "us";
    headers["x-client-request-id"] = crypto.randomUUID();
    headers["x-codex-installation-id"] = getInstallationId();

    const body = JSON.stringify(request);

    let transportRes;
    try {
      transportRes = await transport.post(url, headers, body, signal, undefined, this.proxyUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CodexApiError(0, msg);
    }

    this._captureCookies(transportRes.setCookieHeaders);

    const reader = transportRes.body.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const responseBody = Buffer.concat(chunks).toString("utf-8");

    if (transportRes.status < 200 || transportRes.status >= 300) {
      throw new CodexApiError(transportRes.status, responseBody);
    }

    try {
      return JSON.parse(responseBody);
    } catch {
      throw new CodexApiError(502, `Compact response is not valid JSON: ${responseBody.slice(0, 200)}`);
    }
  }

  /** Parse SSE stream from a Codex Responses API response. */
  async *parseStream(response) {
    yield* parseSSEStream(response);
  }
}

// Re-export for convenience
export { CodexApiError, PreviousResponseWebSocketError } from "./codex-types.js";
export { parseSSEBlock, parseSSEStream } from "./codex-sse.js";
