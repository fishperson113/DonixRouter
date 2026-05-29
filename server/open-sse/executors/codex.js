import { createHash } from "crypto";
import { BaseExecutor } from "./base.js";
import { CODEX_DEFAULT_INSTRUCTIONS, ENCODING_SAFETY_RULES } from "../config/codexInstructions.js";
import { PROVIDERS } from "../config/providers.js";
import { normalizeResponsesInput } from "../translator/helpers/responsesApiHelper.js";
import { fetchImageAsBase64 } from "../translator/helpers/imageHelper.js";
import { getModelUpstreamId } from "../config/providerModels.js";
import { getConsistentMachineId } from "../../shared/utils/machineId.js";
import { getWsPool } from "../services/wsPool.js";
import { createWebSocketResponse } from "../services/wsTransport.js";
import { getSessionAffinityMap } from "../services/sessionAffinity.js";
import { getInstallationId } from "../utils/installationId.js";
import { buildFingerprintHeaders } from "../utils/fingerprintManager.js";
import { deriveStableConversationKey } from "../utils/stableConversationKey.js";
import { buildCodexPoolKey } from "../utils/codexPoolKey.js";
import { getCookieJar } from "../services/cookieJar.js";
import { getTransport } from "#tls";
import { staggerIfNeeded } from "#tls/request-stagger.js";
import { getProxyPool } from "#tls/proxy-pool-singleton.js";
import { hasTupleSchemas, convertTupleSchemas } from "../translator/helpers/tupleSchema.js";
import { refreshCodexToken } from "../services/tokenRefresh.js";
import { DEFAULT_RETRY_CONFIG, resolveRetryEntry } from "../config/runtimeConfig.js";

// Track which accounts have been warmed up (per-process)
const _warmedUpAccounts = new Set();

// In-memory map: hash(machineId + first assistant content) → { sessionId, lastUsed }
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const assistantSessionMap = new Map();

// Cache machine ID at module level (resolved once)
let cachedMachineId = null;
getConsistentMachineId().then(id => { cachedMachineId = id; });

function hashContent(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function generateSessionId() {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// Extract text content from an input item
function extractItemText(item) {
  if (!item) return "";
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    return item.content.map(c => c.text || c.output || "").filter(Boolean).join("");
  }
  return "";
}

// Resolve session_id from first assistant message + machineId to avoid cross-user collision
function resolveConversationSessionId(input, machineId) {
  const machineSessionId = machineId ? `sess_${hashContent(machineId)}` : generateSessionId();
  if (!Array.isArray(input) || input.length === 0) return machineSessionId;

  // Find first assistant message that has actual text content
  let text = "";
  for (const item of input) {
    if (item.role === "assistant") {
      text = extractItemText(item);
      if (text) break;
    }
  }
  if (!text) return machineSessionId;

  const hash = hashContent((machineId || "") + text);
  const entry = assistantSessionMap.get(hash);
  if (entry) {
    entry.lastUsed = Date.now();
    return entry.sessionId;
  }


  const sessionId = generateSessionId();
  assistantSessionMap.set(hash, { sessionId, lastUsed: Date.now() });
  return sessionId;
}

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of assistantSessionMap) {
    if (now - entry.lastUsed > SESSION_TTL_MS) assistantSessionMap.delete(key);
  }
}, 10 * 60 * 1000);

/**
 * Codex Executor - handles OpenAI Codex API (Responses API format)
 * Automatically injects default instructions if missing
 */
export class CodexExecutor extends BaseExecutor {
  constructor() {
    super("codex", PROVIDERS.codex);
    this._currentSessionId = null;
  }

  /**
   * Override headers to add session_id per conversation
   * transformRequest runs BEFORE buildHeaders, sets this._currentSessionId
   */
  buildHeaders(credentials, stream = true) {
    // Use fingerprint manager for properly ordered browser-like headers
    const token = credentials?.accessToken || credentials?.apiKey || "";
    const accountId = credentials?.chatgptAccountId || credentials?.providerSpecificData?.chatgptAccountId || null;
    const headers = buildFingerprintHeaders(token, accountId);

    // Codex-specific headers
    headers["Content-Type"] = "application/json";
    if (stream) headers["Accept"] = "text/event-stream";
    headers["session_id"] = this._currentSessionId || credentials?.connectionId || "default";
    const installId = getInstallationId();
    headers["x-codex-installation-id"] = installId;
    headers["x-openai-internal-codex-residency"] = "us";
    headers["x-client-request-id"] = this._conversationId || crypto.randomUUID();
    headers["OpenAI-Beta"] = "responses_websockets=2026-02-06";
    // Context headers (set by transformRequest)
    if (this._subagent) headers["x-openai-subagent"] = this._subagent;
    if (this._turnState) headers["x-codex-turn-state"] = this._turnState;
    if (this._turnMetadata) headers["x-codex-turn-metadata"] = this._turnMetadata;
    if (this._betaFeatures) headers["x-codex-beta-features"] = this._betaFeatures;
    if (this._timingMetrics) headers["x-responsesapi-include-timing-metrics"] = this._timingMetrics;
    if (this._parentThreadId) headers["x-codex-parent-thread-id"] = this._parentThreadId;
    if (this._version) headers["Version"] = this._version;
    // Window ID: explicit or auto-derived from conversationId
    const windowId = this._windowId || (this._conversationId ? `${this._conversationId}:0` : null);
    if (windowId) headers["x-codex-window-id"] = windowId;

    // Inject cookies for session continuity (cf_clearance, __cf_bm)
    const entryId = credentials?.connectionId;
    if (entryId) {
      const cookie = getCookieJar().getCookieHeader(entryId);
      if (cookie) headers["Cookie"] = cookie;
    }

    // Inject sessionToken as __Secure-next-auth.session-token cookie (session blob import)
    const sessionToken = credentials?.providerSpecificData?.sessionToken;
    if (sessionToken) {
      const existingCookie = headers["Cookie"] || "";
      const tokenCookie = `__Secure-next-auth.session-token=${sessionToken}`;
      headers["Cookie"] = existingCookie ? `${existingCookie}; ${tokenCookie}` : tokenCookie;
    }

    return headers;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const base = super.buildUrl(model, stream, urlIndex, credentials);
    return this._isCompact ? `${base}/compact` : base;
  }

  /**
   * Prefetch remote image URLs and inline them as base64 data URIs.
   * Runs before execute() because Codex backend cannot fetch remote images.
   * Mutates body.input in place.
   */
  async prefetchImages(body) {
    if (!Array.isArray(body?.input)) return;
    for (const item of body.input) {
      if (!Array.isArray(item.content)) continue;
      const pending = item.content.map(async (c) => {
        if (c.type !== "image_url") return c;
        const url = typeof c.image_url === "string" ? c.image_url : c.image_url?.url;
        const detail = c.image_url?.detail || "auto";
        if (!url) return c;
        if (url.startsWith("data:")) return { type: "input_image", image_url: url, detail };
        const fetched = await fetchImageAsBase64(url, { timeoutMs: 15000 });
        return { type: "input_image", image_url: fetched?.url || url, detail };
      });
      item.content = await Promise.all(pending);
    }
  }

  /**
   * Warmup: GET /codex/usage to establish session cookies (cf_clearance, __cf_bm).
   * Called once per account when it's first used, avoids cold-start detection.
   */
  async warmup(credentials) {
    const transport = getTransport();
    const entryId = credentials?.connectionId;
    const token = credentials?.accessToken || credentials?.apiKey || "";
    const accountId = credentials?.chatgptAccountId || credentials?.providerSpecificData?.chatgptAccountId || null;

    const headers = buildFingerprintHeaders(token, accountId);
    headers["Accept"] = "application/json";
    if (!transport.isImpersonate()) headers["Accept-Encoding"] = "gzip, deflate";

    // Inject existing cookies
    if (entryId) {
      const cookie = getCookieJar().getCookieHeader(entryId);
      if (cookie) headers["Cookie"] = cookie;
    }

    // Inject sessionToken as __Secure-next-auth.session-token cookie (session blob import)
    const sessionToken = credentials?.providerSpecificData?.sessionToken;
    if (sessionToken) {
      const existingCookie = headers["Cookie"] || "";
      const tokenCookie = `__Secure-next-auth.session-token=${sessionToken}`;
      headers["Cookie"] = existingCookie ? `${existingCookie}; ${tokenCookie}` : tokenCookie;
    }

    const baseUrls = this.getBaseUrls();
    // baseUrl is ".../codex/responses" — go up to backend-api level for usage endpoint
    const raw = (baseUrls[0] || "https://chatgpt.com/backend-api/codex/responses").replace(/\/+$/, "");
    const baseUrl = raw.replace(/\/codex\/responses$/, "");
    const url = `${baseUrl}/codex/usage`;

    try {
      if (transport.getWithCookies) {
        const result = await transport.getWithCookies(url, headers, 15);
        if (entryId && result.setCookieHeaders?.length > 0) {
          getCookieJar().captureRaw(entryId, result.setCookieHeaders);
        }
        const parsed = JSON.parse(result.body);
        return parsed.rate_limit ? parsed : null;
      } else {
        const result = await transport.get(url, headers, 15);
        const parsed = JSON.parse(result.body);
        return parsed.rate_limit ? parsed : null;
      }
    } catch {
      return null;
    }
  }

  async execute(args) {
    // Fetch remote images before the synchronous transform/execute pipeline
    await this.prefetchImages(args.body);

    const { model, body, stream, credentials, signal, log, proxyOptions } = args;
    const prevResponseId = body.previous_response_id;

    // Warmup: establish session cookies + quota pre-check on first use per account
    const entryId = credentials?.connectionId;
    if (entryId && !_warmedUpAccounts.has(entryId)) {
      _warmedUpAccounts.add(entryId);
      try {
        const usageResult = await this.warmup(credentials);
        log?.debug?.("WARMUP", `session cookies established for ${entryId.slice(0, 8)}`);

        // Quota pre-check: if usage shows limit reached, throw 429 to trigger account fallback
        if (usageResult?.rate_limit) {
          const rl = usageResult.rate_limit;
          const remaining = rl.remaining ?? rl.remaining_tokens ?? null;
          const resetsAt = rl.resets_at || rl.reset_at || null;
          if (remaining !== null && remaining <= 0) {
            const resetsAtMs = resetsAt ? new Date(resetsAt).getTime() : null;
            log?.warn?.("QUOTA", `account ${entryId.slice(0, 8)} exhausted (remaining=${remaining}), skipping`);
            const err = new Error(`Codex quota exhausted for account ${entryId.slice(0, 8)}`);
            err.status = 429;
            err.body = JSON.stringify({ error: { type: "usage_limit_reached", message: err.message } });
            err.resetsAtMs = resetsAtMs;
            throw err;
          }
        }
      } catch (err) {
        // Re-throw 429 quota errors (for account fallback); swallow all others
        if (err.status === 429) throw err;
      }
    }

    // Resolve per-account proxy from pool (falls back to global auto-detect or proxyOptions)
    const pool = getProxyPool();
    const poolProxyUrl = pool.getAll().length > 0 ? pool.resolveProxyUrl(entryId) : undefined;

    // Use WebSocket transport when previous_response_id is present
    // This keeps the connection pinned to the same backend for prompt cache reuse
    if (prevResponseId && credentials?.connectionId) {
      try {
        const transformedBody = this.transformRequest(model, body, stream, credentials);
        const headers = this.buildHeaders(credentials, stream);
        const httpUrl = this.buildUrl(model, stream, 0, credentials);
        const wsUrl = httpUrl.replace(/^https?:/, "wss:");

        // Determine proxy URL: pool assignment > connection-level > global
        let proxyUrl = poolProxyUrl !== undefined ? poolProxyUrl : null;
        if (!proxyUrl && proxyOptions?.connectionProxyEnabled && proxyOptions?.connectionProxyUrl) {
          proxyUrl = proxyOptions.connectionProxyUrl;
        }

        // Build WS request payload (Codex WebSocket format)
        const wsRequest = {
          type: "response.create",
          model: transformedBody.model,
          instructions: transformedBody.instructions || "",
          input: transformedBody.input || [],
          store: false,
          stream: true,
        };
        if (prevResponseId) wsRequest.previous_response_id = prevResponseId;
        if (transformedBody.reasoning) wsRequest.reasoning = transformedBody.reasoning;
        if (transformedBody.tools?.length) wsRequest.tools = transformedBody.tools;
        wsRequest.tool_choice = transformedBody.tool_choice ?? "auto";
        wsRequest.parallel_tool_calls = transformedBody.parallel_tool_calls ?? true;
        if (transformedBody.text) wsRequest.text = transformedBody.text;
        if (transformedBody.service_tier) wsRequest.service_tier = transformedBody.service_tier;
        if (transformedBody.include?.length) wsRequest.include = transformedBody.include;
        if (transformedBody.prompt_cache_key) wsRequest.prompt_cache_key = transformedBody.prompt_cache_key;
        if (transformedBody.client_metadata) wsRequest.client_metadata = transformedBody.client_metadata;

        // Pool context: use connectionId + conversationId + variantHash as pool key
        const affinityMap = getSessionAffinityMap();
        const conversationId =
          affinityMap.lookupConversationId(prevResponseId) ||
          transformedBody.prompt_cache_key ||
          this._conversationId ||
          this._currentSessionId ||
          "default";
        const { poolKey } = buildCodexPoolKey({
          connectionId: credentials.connectionId,
          conversationId,
          codexRequest: transformedBody,
        });
        const pool = getWsPool();

        const poolCtx = {
          pool,
          poolKey,
          entryId: credentials.connectionId,
          onDecision: (decision) => {
            if (decision.kind === "reuse") {
              log?.info?.("WS-POOL", `reuse ws=${decision.wsId} key=${poolKey.slice(0, 16)}`);
            } else if (decision.kind === "new") {
              log?.info?.("WS-POOL", `new ws=${decision.wsId} key=${poolKey.slice(0, 16)}`);
            } else if (decision.kind === "bypass") {
              log?.debug?.("WS-POOL", `bypass: ${decision.reason}`);
            } else if (decision.kind === "retry-after-stale-reuse") {
              log?.warn?.("WS-POOL", `stale reuse ws=${decision.wsId}, retrying one-shot`);
            }
          },
        };

        const response = await createWebSocketResponse(wsUrl, headers, wsRequest, signal, proxyUrl, poolCtx);
        transformedBody._tupleSchema = this._tupleSchema;
        return { response, url: wsUrl, headers, transformedBody };
      } catch (err) {
        // WS failed — fall back to HTTP. The error may be a CodexApiError with
        // status/body that the caller can classify for rotation.
        if (err.status) {
          // Structured error from WS (e.g. 429, 401) — let caller handle
          const errorResponse = new Response(err.body || err.message, {
            status: err.status,
            headers: { "content-type": "application/json" }
          });
          const httpUrl = this.buildUrl(model, stream, 0, credentials);
          return { response: errorResponse, url: httpUrl, headers: {}, transformedBody: body };
        }
        log?.warn?.("WS-POOL", `WS failed (${err.message}), falling back to HTTP`);
        // Fall through to HTTP
      }
    }

    // Use TLS transport for HTTP SSE when native is available (better TLS fingerprint)
    const transport = getTransport();
    if (transport && transport.isImpersonate !== undefined) {
      const transformedBody = this.transformRequest(model, body, stream, credentials);
      const headers = this.buildHeaders(credentials, stream);
      const url = this.buildUrl(model, stream, 0, credentials);

      // Resolve proxy: pool assignment > connection-level > global auto-detect (undefined = use global)
      const httpProxyUrl = poolProxyUrl !== undefined ? poolProxyUrl
        : (proxyOptions?.connectionProxyEnabled && proxyOptions?.connectionProxyUrl)
          ? proxyOptions.connectionProxyUrl : undefined;

      try {
        const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
        const retryAttempts = {};
        let transportRes = null;

        while (true) {
          transportRes = await transport.post(
            url,
            headers,
            JSON.stringify(transformedBody),
            signal,
            undefined,
            httpProxyUrl,
          );

          const { attempts, delayMs } = resolveRetryEntry(retryConfig[transportRes.status]);
          if (attempts > 0 && (retryAttempts[transportRes.status] || 0) < attempts) {
            retryAttempts[transportRes.status] = (retryAttempts[transportRes.status] || 0) + 1;
            log?.debug?.("RETRY", `Codex TLS ${transportRes.status} retry ${retryAttempts[transportRes.status]}/${attempts} after ${delayMs / 1000}s`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }
          break;
        }

        // Capture cookies from transport response
        const entryId = credentials?.connectionId;
        if (entryId && transportRes.setCookieHeaders?.length > 0) {
          getCookieJar().captureRaw(entryId, transportRes.setCookieHeaders);
        }

        // Build a Response from the transport result
        const response = new Response(transportRes.body, {
          status: transportRes.status,
          headers: transportRes.headers,
        });
        transformedBody._tupleSchema = this._tupleSchema;
        return { response, url, headers, transformedBody };
      } catch (err) {
        // Fall through to proxyAwareFetch on transport error
        log?.warn?.("TLS", `Native transport failed (${err.message}), falling back to fetch`);
      }
    }

    const result = await super.execute(args);
    if (result.transformedBody) result.transformedBody._tupleSchema = this._tupleSchema;
    return result;
  }

  // Parse Codex usage_limit_reached to extract precise resetsAtMs; fallback to default otherwise
  parseError(response, bodyText) {
    if (response.status === 429 && bodyText) {
      try {
        const json = JSON.parse(bodyText);
        const err = json?.error;
        if (err?.type === "usage_limit_reached") {
          const now = Date.now();
          let resetsAtMs = null;
          if (typeof err.resets_at === "number" && err.resets_at > 0) {
            const ms = err.resets_at * 1000;
            if (ms > now) resetsAtMs = ms;
          }
          if (!resetsAtMs && typeof err.resets_in_seconds === "number" && err.resets_in_seconds > 0) {
            resetsAtMs = now + err.resets_in_seconds * 1000;
          }
          if (resetsAtMs) {
            return { status: 429, message: err.message || bodyText, resetsAtMs };
          }
        }
      } catch { /* fall through to default */ }
    }
    return super.parseError(response, bodyText);
  }

  async refreshCredentials(credentials, log) {
    if (!credentials?.refreshToken) return null;
    return refreshCodexToken(credentials.refreshToken, log);
  }

  /**
   * Transform request before sending - inject default instructions if missing.
   * Image fetching is handled separately in prefetchImages() so this stays sync.
   */
  transformRequest(model, body, stream, credentials) {
    this._isCompact = !!body._compact;
    delete body._compact;
    // Resolve conversation-stable session_id from input history + machineId
    this._currentSessionId = resolveConversationSessionId(body.input, cachedMachineId);
    // Resolve conversation identity: explicit prompt_cache_key > stable derived key
    const explicitKey = typeof body.prompt_cache_key === "string" && body.prompt_cache_key.trim()
      ? body.prompt_cache_key.trim() : null;
    const derivedKey = !explicitKey ? deriveStableConversationKey(body) : null;
    this._conversationId = explicitKey || derivedKey || null;
    // Inject prompt_cache_key if client didn't provide one (for upstream cache routing)
    if (!body.prompt_cache_key && derivedKey) {
      body.prompt_cache_key = derivedKey;
    }
    // Convert string input to array format (Codex API requires input as array)
    const normalized = normalizeResponsesInput(body.input);
    if (normalized) body.input = normalized;

    // Ensure input is present and non-empty (Codex API rejects empty input)
    if (!body.input || (Array.isArray(body.input) && body.input.length === 0)) {
      body.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
    }

    // Ensure streaming is enabled (Codex API requires it)
    body.stream = true;

    // If no instructions provided, inject default Codex instructions
    if (!body.instructions || body.instructions.trim() === "") {
      body.instructions = CODEX_DEFAULT_INSTRUCTIONS;
    }

    // Always append encoding safety rules to prevent UTF-8 destruction
    // See: https://github.com/openai/codex/issues/4013
    if (!body.instructions.includes("ENCODING SAFETY")) {
      body.instructions += ENCODING_SAFETY_RULES;
    }

    // Ensure store is false (Codex requirement)
    body.store = false;

    // Map virtual Codex review models to the upstream Codex model before suffix parsing.
    body.model = getModelUpstreamId("cx", body.model || model);

    // Extract thinking level from model name suffix
    // e.g., gpt-5.3-codex-high → high, gpt-5.3-codex → medium (default)
    const effortLevels = ['none', 'low', 'medium', 'high', 'xhigh'];
    let modelEffort = null;
    for (const level of effortLevels) {
      if (body.model.endsWith(`-${level}`)) {
        modelEffort = level;
        // Strip suffix from model name for actual API call
        body.model = body.model.replace(`-${level}`, '');
        break;
      }
    }

    // Priority: explicit reasoning.effort > reasoning_effort param > model suffix > default (medium)
    if (!body.reasoning) {
      const effort = body.reasoning_effort || modelEffort || 'low';
      body.reasoning = { effort, summary: "auto" };
    } else if (!body.reasoning.summary) {
      body.reasoning.summary = "auto";
    }
    delete body.reasoning_effort;

    // Include reasoning encrypted content (required by Codex backend for reasoning models)
    if (body.reasoning && body.reasoning.effort && body.reasoning.effort !== 'none') {
      body.include = ["reasoning.encrypted_content"];
    }

    // Normalize service_tier: "fast" → "priority" (upstream expects "priority")
    if (body.service_tier === "fast") body.service_tier = "priority";

    // Remove unsupported parameters for Codex API
    delete body.temperature;
    delete body.top_p;
    delete body.frequency_penalty;
    delete body.presence_penalty;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.n;
    delete body.seed;
    delete body.max_tokens;
    delete body.max_completion_tokens;
    delete body.max_output_tokens; // Responses API clients send this but Codex rejects it
    delete body.user; // Cursor sends this but Codex doesn't support it
    delete body.prompt_cache_retention; // Cursor sends this but Codex doesn't support it
    delete body.metadata; // Cursor sends this but Codex doesn't support it
    delete body.stream_options; // Cursor sends this but Codex doesn't support it
    delete body.safety_identifier; // Droid CLI sends this but Codex doesn't support it

    // Inject client_metadata with installation ID for upstream cache routing
    const installId = getInstallationId();
    const metadata = typeof body.client_metadata === "object" && body.client_metadata && !Array.isArray(body.client_metadata)
      ? { ...body.client_metadata } : {};
    metadata["x-codex-installation-id"] = installId;

    // Normalize x-openai-subagent from client_metadata
    const ALLOWED_SUBAGENTS = new Set(["review", "compact", "memory_consolidation", "collab_spawn"]);
    const subagentRaw = metadata["x-openai-subagent"];
    this._subagent = typeof subagentRaw === "string" && ALLOWED_SUBAGENTS.has(subagentRaw.trim()) ? subagentRaw.trim() : null;

    // Preserve context headers for buildHeaders (extract from body or metadata)
    this._turnState = body.turnState || null;
    this._turnMetadata = body.turnMetadata || metadata["x-codex-turn-metadata"] || null;
    this._betaFeatures = body.betaFeatures || metadata["x-codex-beta-features"] || null;
    this._timingMetrics = body.includeTimingMetrics || metadata["x-responsesapi-include-timing-metrics"] || null;
    this._parentThreadId = body.parentThreadId || metadata["x-codex-parent-thread-id"] || null;
    this._version = body.version || null;
    this._windowId = metadata["x-codex-window-id"] || body.codexWindowId || null;

    // Inject windowId into metadata (upstream uses it for session routing)
    const effectiveWindowId = this._windowId || (this._conversationId ? `${this._conversationId}:0` : null);
    if (effectiveWindowId) metadata["x-codex-window-id"] = effectiveWindowId;
    if (this._turnMetadata) metadata["x-codex-turn-metadata"] = this._turnMetadata;
    if (this._parentThreadId) metadata["x-codex-parent-thread-id"] = this._parentThreadId;

    body.client_metadata = metadata;

    // Strip body-level fields that become headers (not part of API body)
    delete body.turnState;
    delete body.turnMetadata;
    delete body.betaFeatures;
    delete body.includeTimingMetrics;
    delete body.codexWindowId;
    delete body.parentThreadId;
    delete body.version;
    delete body.useWebSocket;

    // Tuple schema conversion: prefixItems → object properties (Codex upstream doesn't support prefixItems)
    // Store original schema on this._tupleSchema (NOT body) so it's excluded from the upstream request
    if (body.text?.format?.type === "json_schema" && body.text.format.schema) {
      const schema = body.text.format.schema;
      if (hasTupleSchemas(schema)) {
        this._tupleSchema = structuredClone(schema);
        convertTupleSchemas(schema);
      } else {
        this._tupleSchema = null;
      }
    } else {
      this._tupleSchema = null;
    }

    return body;
  }
}
