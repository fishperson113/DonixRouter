import { detectFormat, getTargetFormat } from "../services/provider.js";
import { translateRequest } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { COLORS } from "../utils/stream.js";
import { createStreamController, setStreamHeartbeatFormat } from "../utils/streamHandler.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import { getModelTargetFormat, getModelStrip, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import { trackPendingRequest, appendRequestLog, saveRequestDetail } from "#lib/usageDb.js";
import { getExecutor } from "../executors/index.js";
import { buildRequestDetail, extractRequestConfig } from "./chatCore/requestDetail.js";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import { handleStreamingResponse, buildOnStreamComplete } from "./chatCore/streamingHandler.js";
import { detectClientTool, isNativePassthrough } from "../utils/clientDetector.js";
import { dedupeTools } from "../utils/toolDeduper.js";
import { injectCaveman } from "../rtk/caveman.js";
import { compressMessages, formatRtkLog } from "../rtk/index.js";
import { parseRateLimitHeaders } from "../utils/rateLimitHeaders.js";
import { getCookieJar } from "../services/cookieJar.js";
import { debugDump, debugDumpEnabled } from "../utils/debugDump.js";

/**
 * Core chat handler - shared between SSE and Worker
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {string} options.sourceFormatOverride - Override detected source format (e.g. "openai-responses")
 */
export async function handleChatCore({ body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, clientRawRequest, connectionId, userAgent, apiKey, ccFilterNaming, rtkEnabled, cavemanEnabled, cavemanLevel, sourceFormatOverride, providerThinking }) {
  const { provider, model } = modelInfo;
  const requestStartTime = Date.now();

  const sourceFormat = sourceFormatOverride || detectFormat(body);

  // Check for bypass patterns (warmup, skip, cc naming)
  const bypassResponse = handleBypassRequest(body, model, userAgent, ccFilterNaming);
  if (bypassResponse) return bypassResponse;

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  const targetFormat = modelTargetFormat || getTargetFormat(provider);
  const stripList = getModelStrip(alias, model);

  // Inject provider-level thinking config override (only if client hasn't set)
  // on/off → extended type (body.thinking), none/low/medium/high → effort type (body.reasoning_effort)
  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const mode = providerThinking.mode;
    if (mode === "on" && !body.thinking) {
      console.log("Injecting provider-level thinking config override: on");
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }

  const clientRequestedStreaming = body.stream === true || sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI;
  const providerRequiresStreaming = provider === "openai" || provider === "codex" || provider === "commandcode";
  let stream = providerRequiresStreaming ? true : (body.stream !== false);

  // Check client Accept header preference for non-streaming requests
  // This fixes AI SDK compatibility where clients send Accept: application/json
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (clientPrefersJson && !clientPrefersSSE && body.stream !== true) {
    stream = false;
  }

  const reqLogger = await createRequestLogger(sourceFormat, targetFormat, model);
  if (clientRawRequest) reqLogger.logClientRawRequest(clientRawRequest.endpoint, clientRawRequest.body, clientRawRequest.headers);
  reqLogger.logRawRequest(body);
  log?.debug?.("FORMAT", `${sourceFormat} → ${targetFormat} | stream=${stream}`);

  // Native passthrough: CLI tool and provider are the same ecosystem
  // Skip all translation/normalization — only model and Bearer are swapped
  const clientTool = detectClientTool(clientRawRequest?.headers || {}, body);
  const passthrough = isNativePassthrough(clientTool, provider);

  let translatedBody;
  let toolNameMap;
  if (passthrough) {
    log?.debug?.("PASSTHROUGH", `${clientTool} → ${provider} | native lossless`);
    translatedBody = { ...body, model };
  } else {
    translatedBody = translateRequest(sourceFormat, targetFormat, model, body, stream, credentials, provider, reqLogger, stripList, connectionId, clientTool);
    if (!translatedBody) {
      trackPendingRequest(model, provider, connectionId, false, true);
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Failed to translate request for ${sourceFormat} → ${targetFormat}`);
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    translatedBody.model = model;
  }

  // Dedupe duplicate built-in tools when equivalent MCP tools are present (Claude clients only).
  if (clientTool === "claude" && Array.isArray(translatedBody.tools)) {
    const { tools: deduped, stripped } = dedupeTools(translatedBody.tools);
    if (stripped.length > 0) {
      translatedBody.tools = deduped;
      log?.debug?.("TOOLDEDUP", `stripped ${stripped.length}: ${stripped.slice(0, 3).join(", ")}${stripped.length > 3 ? "..." : ""}`);
    }
  }

  // Token savers: applied at the final body just before dispatch
  // Covers both passthrough (source shape) and translated (target shape) flows
  const finalFormat = passthrough ? sourceFormat : targetFormat;

  // RTK: compress tool_result content
  const rtkStats = compressMessages(translatedBody, rtkEnabled);
  const rtkLine = formatRtkLog(rtkStats);
  if (rtkLine) console.log(rtkLine);

  // Caveman: inject terse-style system prompt
  if (cavemanEnabled && cavemanLevel) {
    injectCaveman(translatedBody, finalFormat, cavemanLevel);
    log?.debug?.("CAVEMAN", `${cavemanLevel} | ${finalFormat}`);
  }

  const executor = getExecutor(provider);
  trackPendingRequest(model, provider, connectionId, true);
  appendRequestLog({ model, provider, connectionId, status: "PENDING" }).catch(() => {});

  const msgCount = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || translatedBody.request?.contents?.length || 0;
  log?.debug?.("REQUEST", `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`);

  const streamController = createStreamController({
    onDisconnect: (reason) => {
      trackPendingRequest(model, provider, connectionId, false);
      if (onDisconnect) onDisconnect(reason);
    },
    onError: () => trackPendingRequest(model, provider, connectionId, false),
    log, provider, model
  });
  setStreamHeartbeatFormat(streamController, sourceFormat);

  const proxyOptions = {
    connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
  };

  if (proxyOptions.vercelRelayUrl) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | vercel-relay=${proxyOptions.vercelRelayUrl}`);
  } else if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionProxyUrl) {
    let maskedProxyUrl = proxyOptions.connectionProxyUrl;
    try {
      const parsed = new URL(proxyOptions.connectionProxyUrl);
      const host = parsed.hostname || "";
      const port = parsed.port ? `:${parsed.port}` : "";
      const protocol = parsed.protocol || "http:";
      maskedProxyUrl = `${protocol}//${host}${port}`;
    } catch {
      // Keep raw if URL parsing fails
    }

    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | url=${maskedProxyUrl}`);
  }

  if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.debug?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`);
  }

  // Opt-in dump of pre-flight request payload (CODEX_PROXY_DEBUG_DUMP=1)
  if (debugDumpEnabled()) {
    debugDump("request", {
      provider, model, connectionId,
      sourceFormat, targetFormat, stream,
      msgCount,
      hasTools: Array.isArray(translatedBody.tools) && translatedBody.tools.length > 0,
      passthrough,
      body: translatedBody,
    });
  }

  // Execute request
  let providerResponse, providerUrl, providerHeaders, finalBody;
  try {
    const result = await executor.execute({
      model,
      body: translatedBody,
      stream,
      credentials,
      signal: streamController.signal,
      log,
      proxyOptions,
      onCredentialsRefreshed,
    });
    providerResponse = result.response;
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;
    if (result.refreshedCredentials && onCredentialsRefreshed) {
      try {
        await onCredentialsRefreshed(result.refreshedCredentials);
      } catch (error) {
        log?.warn?.("TOKEN", `persist refreshed credentials failed: ${error.message}`);
      }
    }
    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
    if (debugDumpEnabled()) {
      debugDump("target-request", {
        provider,
        model,
        connectionId,
        url: providerUrl,
        headers: providerHeaders,
        body: finalBody || translatedBody,
        status: providerResponse?.status ?? null,
      });
    }

    // Codex-specific: capture cookies + passive quota extraction
    if (provider === "codex") {
      try {
        // Capture Set-Cookie for session continuity (cf_clearance, __cf_bm)
        const setCookies = providerResponse.headers?.getSetCookie?.() || [];
        if (setCookies.length > 0 && connectionId) {
          getCookieJar().captureRaw(connectionId, setCookies);
        }
        // Parse rate-limit headers for passive quota tracking
        if (providerResponse.ok) {
          const rl = parseRateLimitHeaders(providerResponse.headers);
          if (rl) {
            log?.debug?.("QUOTA", `passive: primary=${rl.primary?.used_percent ?? "?"}% secondary=${rl.secondary?.used_percent ?? "?"}%`);
            // Proactive enforcement: if primary limit reached, warn
            if (rl.primary && rl.primary.used_percent >= 100) {
              log?.warn?.("QUOTA", `primary limit reached (${rl.primary.used_percent}%) for conn=${connectionId?.slice(0, 8)}, reset_at=${rl.primary.reset_at}`);
            }
          }
        }
      } catch { /* quota/cookie parsing must not break the request */ }
    }
  } catch (error) {
    if (debugDumpEnabled()) {
      debugDump("executor-error", {
        provider, model, connectionId,
        name: error?.name, msg: (error?.message || String(error)).slice(0, 4000),
      });
    }
    trackPendingRequest(model, provider, connectionId, false, true);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${error.name === "AbortError" ? 499 : HTTP_STATUS.BAD_GATEWAY}` }).catch(() => {});
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: translatedBody || null,
      response: { error: error.message || String(error), status: error.name === "AbortError" ? 499 : 502, thinking: null },
      status: "error"
    })).catch(() => {});

    if (error.name === "AbortError") {
      streamController.handleError(error);
      return createErrorResult(499, "Request aborted");
    }
    // Preserve upstream error status and resetsAtMs (e.g. Codex warmup 429 → account fallback)
    const upstreamStatus = error.status && error.status >= 400 ? error.status : HTTP_STATUS.BAD_GATEWAY;
    const errMsg = formatProviderError(error, provider, model, upstreamStatus);
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);
    return createErrorResult(upstreamStatus, errMsg, error.resetsAtMs || null);
  }

  // Handle 401/403 - try token refresh (skip for noAuth providers)
  // CRITICAL: Only retry if upstream hasn't processed the request yet (to avoid duplicate token usage)
  if (!executor.noAuth && (providerResponse.status === HTTP_STATUS.UNAUTHORIZED || providerResponse.status === HTTP_STATUS.FORBIDDEN)) {
    // Check if upstream already processed the request by examining response body
    let shouldRetry = false;
    try {
      const clonedResponse = providerResponse.clone();
      const bodyText = await clonedResponse.text();
      // If response has structured error from upstream API (not just auth gateway), don't retry
      // Connection-level auth failures have empty/minimal body, upstream errors have detailed JSON
      if (!bodyText || bodyText.length < 50) {
        shouldRetry = true; // Empty response = connection-level auth failure, safe to retry
      } else {
        try {
          const json = JSON.parse(bodyText);
          // If error has upstream-specific fields (like response_id, conversation_id), upstream processed it
          if (json.error?.response_id || json.error?.conversation_id || json.response_id) {
            log?.warn?.("TOKEN", `${provider.toUpperCase()} | 401/403 after upstream processing, NOT retrying to avoid duplicate`);
            shouldRetry = false;
          } else {
            shouldRetry = true; // Generic auth error, safe to retry
          }
        } catch {
          shouldRetry = true; // Non-JSON response, likely connection-level error
        }
      }
    } catch {
      shouldRetry = false; // If we can't read body, don't risk duplicate
    }

    if (shouldRetry) {
      try {
        const newCredentials = await refreshWithRetry(() => executor.refreshCredentials(credentials, log, proxyOptions), 3, log);
        if (newCredentials?.accessToken || newCredentials?.copilotToken) {
          log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed, retrying request`);
          Object.assign(credentials, newCredentials);
          if (onCredentialsRefreshed) {
            try { await onCredentialsRefreshed(newCredentials); } catch (e) { log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${e.message}`); }
          }
          try {
            const retryResult = await executor.execute({ model, body: translatedBody, stream, credentials, signal: streamController.signal, log, proxyOptions });
            if (retryResult.response.ok) { providerResponse = retryResult.response; providerUrl = retryResult.url; }
          } catch { log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`); }
        } else {
          log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
        }
      } catch (e) {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh threw: ${e.message}`);
      }
    }
  }

  // Provider returned error
  if (!providerResponse.ok) {
    trackPendingRequest(model, provider, connectionId, false, true);
    const { statusCode, message, resetsAtMs } = await parseUpstreamError(providerResponse, executor);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${statusCode}` }).catch(() => {});
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      response: { error: message, status: statusCode, thinking: null },
      status: "error"
    })).catch(() => {});

    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);
    reqLogger.logError(new Error(message), finalBody || translatedBody);
    return createErrorResult(statusCode, errMsg, resetsAtMs);
  }

  const sharedCtx = { provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess };
  const appendLog = (extra) => appendRequestLog({ model, provider, connectionId, ...extra }).catch(() => {});
  const trackDone = () => trackPendingRequest(model, provider, connectionId, false);

  // Provider forced streaming but client wants JSON
  if (!clientRequestedStreaming && providerRequiresStreaming) {
    const result = await handleForcedSSEToJson({ ...sharedCtx, providerResponse, sourceFormat, trackDone, appendLog });
    if (result) { streamController.handleComplete(); return result; }
  }

  // True non-streaming response
  if (!stream) {
    const result = await handleNonStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat, reqLogger, toolNameMap, trackDone, appendLog });
    streamController.handleComplete();
    return result;
  }

  // Streaming response
  const { onStreamComplete } = buildOnStreamComplete({ ...sharedCtx });
  return handleStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, streamController, onStreamComplete });
}

export function isTokenExpiringSoon(expiresAt, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}
