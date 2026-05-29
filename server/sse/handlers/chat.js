import "#open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSessionAffinityMap } from "#open-sse/services/sessionAffinity.js";
import { computeVariantHash } from "#open-sse/utils/variantHash.js";
import { classifyUpstreamError } from "#open-sse/utils/errorClassification.js";
import { cacheClaudeHeaders } from "#open-sse/utils/claudeHeaderCache.js";
import { logRequestDiagnostics } from "#open-sse/utils/requestDiagnostics.js";
import { getSettings } from "#lib/localDb.js";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "#open-sse/handlers/chatCore.js";
import { errorResponse, unavailableResponse } from "#open-sse/utils/error.js";
import { handleComboChat } from "#open-sse/services/combo.js";
import { handleBypassRequest } from "#open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "#open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "#open-sse/translator/formats.js";
import {
  evaluateImplicitResume,
  getContinuationInputStartIndex,
  getFunctionCallOutputIds,
  resolvePromptCacheIdentity,
  buildVariantIdentity,
} from "#open-sse/utils/proxySessionHelpers.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "#open-sse/services/projectId.js";
import { staggerIfNeeded } from "#tls/request-stagger.js";

// In-memory per-account last request time for stagger
const _lastRequestMs = new Map();
const IMPLICIT_RESUME_PAYLOAD_GUARD_BYTES = 250_000;
const IMPLICIT_RESUME_PAYLOAD_GUARD_ITEMS = 80;

function extractClientConversationId(body) {
  if (!body || typeof body !== "object") return null;
  const metadata = body.client_metadata && typeof body.client_metadata === "object" ? body.client_metadata : null;
  return (
    body._sessionId ||
    body.sessionId ||
    metadata?.session_id ||
    metadata?.conversation_id ||
    metadata?.thread_id ||
    null
  );
}

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  cacheClaudeHeaders(clientRawRequest.headers);

  // Log request endpoint and model
  const url = new URL(request.url);
  const modelStr = body.model;

  // Count messages (support messages[], input[], and antigravity request.contents[] formats)
  const msgCount = body.messages?.length || body.input?.length || body.request?.contents?.length || 0;
  const toolCount = body.tools?.length || 0;
  const effort = body.reasoning_effort || body.reasoning?.effort || null;
  log.request("POST", `${url.pathname} | ${modelStr} | ${msgCount} msgs${toolCount ? ` | ${toolCount} tools` : ""}${effort ? ` | effort=${effort}` : ""}`);

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null) {
  const modelInfo = await getModelInfo(modelStr);
  const requestDiagId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      
      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Log model routing (alias → actual model)
  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Session affinity: route to the same account that created the previous response
  const affinityMap = getSessionAffinityMap();
  let prevResponseId = body.previous_response_id || null;
  let preferredConnectionId = null;
  let conversationId = null;
  let implicitResumeActive = false;
  let implicitResumeInjectedId = null;
  let implicitResumeReason = null;
  let implicitPrevCandidateId = null;

  // Compute variant hash for sub-agent isolation. Identity combines
  // x-codex-window-id (when client sets it) and the first-user-anchor when
  // an explicit prompt_cache_key or session id is present, so concurrent
  // subagents under the same session don't collide on the same prev_response
  // chain. Falls back to instructions+tools-only hash when no identity hints.
  const clientConversationId = extractClientConversationId(body);
  const promptCacheIdentity = resolvePromptCacheIdentity(body, clientConversationId);
  const promptCacheKey = promptCacheIdentity.promptCacheKey;
  const variantIdentity = buildVariantIdentity(body, promptCacheIdentity);
  const vHash = computeVariantHash(body.instructions, body.tools, variantIdentity);
  if (provider === "codex" && promptCacheKey && !body.prompt_cache_key) {
    body.prompt_cache_key = promptCacheKey;
  }

  if (prevResponseId) {
    // Explicit previous_response_id — look up affinity
    preferredConnectionId = affinityMap.lookup(prevResponseId);
    conversationId = affinityMap.lookupConversationId(prevResponseId);
    if (preferredConnectionId) {
      log.info("AFFINITY", `previous_response_id=${prevResponseId.slice(-8)} → conn=${preferredConnectionId.slice(0, 8)}`);
    }
  } else if (provider === "codex" && promptCacheKey) {
    // Implicit resume: client didn't send previous_response_id but we have
    // one from the affinity map for this conversation+variant. Inject it to
    // get prompt cache hits on the upstream backend.
    const IMPLICIT_RESUME_MAX_AGE_MS = 55 * 60 * 1000;
    const implicitId = affinityMap.lookupLatestResponseIdByConversationId(
      promptCacheKey, IMPLICIT_RESUME_MAX_AGE_MS, vHash
    );
    implicitPrevCandidateId = implicitId;
    if (implicitId) {
      const implicitConn = affinityMap.lookup(implicitId);
      if (implicitConn) {
        const inputItems = Array.isArray(body.input) ? body.input : [];
        const continuationInputStart = getContinuationInputStartIndex(inputItems);
        const requiredFunctionCallOutputIds = getFunctionCallOutputIds(inputItems.slice(continuationInputStart));
        const resumeEvaluation = evaluateImplicitResume({
          implicitPrevRespId: implicitId,
          continuationInputStart,
          inputLength: inputItems.length,
          preferredEntryId: implicitConn,
          acquiredEntryId: implicitConn,
          currentInstructions: body.instructions,
          storedInstructions: affinityMap.lookupInstructions(implicitId),
          storedFunctionCallIds: affinityMap.lookupFunctionCallIds(implicitId),
          requiredFunctionCallOutputIds,
        });
        implicitResumeReason = resumeEvaluation.reason;

        if (
          (resumeEvaluation.reason === "missing_tool_calls" || resumeEvaluation.reason === "unanswered_tool_calls") &&
          (JSON.stringify(body.input || []).length > IMPLICIT_RESUME_PAYLOAD_GUARD_BYTES ||
            inputItems.length > IMPLICIT_RESUME_PAYLOAD_GUARD_ITEMS)
        ) {
          log.warn(
            "AFFINITY",
            `payload guard: blocked ${(JSON.stringify(body.input || []).length / 1024).toFixed(0)}KB / ${inputItems.length} items full-history replay (${resumeEvaluation.reason})`
          );
          return errorResponse(
            HTTP_STATUS.REQUEST_ENTITY_TOO_LARGE,
            `Context too large for full-history replay (${(JSON.stringify(body.input || []).length / 1024).toFixed(0)}KB, ${inputItems.length} items). Implicit resume failed: ${resumeEvaluation.reason}. Please compact or restart the conversation.`
          );
        }

        if (resumeEvaluation.active) {
          prevResponseId = implicitId;
          preferredConnectionId = implicitConn;
          conversationId = promptCacheKey;
          implicitResumeActive = true;
          implicitResumeInjectedId = implicitId;
          body.previous_response_id = implicitId;
          log.info("AFFINITY", `implicit resume: injected prev=${implicitId.slice(-8)} → conn=${implicitConn.slice(0, 8)}`);
        } else {
          const missingIds = resumeEvaluation.missingCallIds?.length ? ` missing=${resumeEvaluation.missingCallIds.join(",")}` : "";
          const unansweredIds = resumeEvaluation.unansweredCallIds?.length ? ` unanswered=${resumeEvaluation.unansweredCallIds.join(",")}` : "";
          log.debug("AFFINITY", `implicit resume skipped: ${resumeEvaluation.reason}`);
          if (missingIds || unansweredIds) {
            log.debug("AFFINITY", `implicit resume details:${missingIds}${unansweredIds}`);
          }
        }
      }
    }
  }

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let prevResponseRetried = false; // guard: only retry previous_response_not_found once
  let capacityRetried = false; // guard: one same-account retry for transient overload (503/529)

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, { preferredConnectionId });

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    // Log account selection
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    if (implicitResumeInjectedId && preferredConnectionId && credentials.connectionId !== preferredConnectionId) {
      log.warn("AFFINITY", `implicit resume account mismatch, stripping prev=${implicitResumeInjectedId.slice(-8)}`);
      delete body.previous_response_id;
      prevResponseId = null;
      implicitResumeActive = false;
      implicitResumeInjectedId = null;
      implicitResumeReason = "acct_mismatch_after_selection";
    }

    if (provider === "codex") {
      logRequestDiagnostics({
        tag: "Responses",
        entryId: credentials.connectionId,
        requestId: requestDiagId,
        model: `${provider}/${model}`,
        requestBody: body,
        conversationId: conversationId || promptCacheKey || null,
        promptCacheKey,
        variantHash: vHash,
        explicitPrevRespId: body.previous_response_id && body.previous_response_id !== implicitResumeInjectedId
          ? body.previous_response_id
          : null,
        implicitPrevRespId: implicitPrevCandidateId,
        prevRespId: prevResponseId,
        resumeActive: implicitResumeActive,
        resumeReason: implicitResumeReason,
        preferredConnectionId,
        log: (message) => log.debug("REQUEST", message),
        warn: (message) => log.warn("REQUEST", message),
      });
    }

    // Request stagger: add small delay if account was used recently (avoid burst patterns)
    if (provider === "codex") {
      const lastMs = _lastRequestMs.get(credentials.connectionId);
      if (lastMs) {
        await staggerIfNeeded(lastMs, { intervalMs: 1000 });
      }
      _lastRequestMs.set(credentials.connectionId, Date.now());
    }

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      providerThinking,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async (responseMetadata) => {
        await clearAccountError(credentials.connectionId, credentials, model);
        // Record session affinity for future requests
        if (responseMetadata?.responseId) {
          const convId = conversationId || responseMetadata.conversationId || credentials.connectionId;
          affinityMap.record(responseMetadata.responseId, credentials.connectionId, convId, {
            turnState: responseMetadata.turnState,
            instructions: body.instructions,
            inputTokens: responseMetadata.inputTokens,
            functionCallIds: responseMetadata.functionCallIds,
            variantHash: vHash,
          });
          log.debug("AFFINITY", `recorded ${responseMetadata.responseId.slice(-8)} → conn=${credentials.connectionId.slice(0, 8)}`);
        }
      }
    });

    if (result.success) return result.response;

    // Classify the error for smarter routing decisions
    const errorClass = classifyUpstreamError(result.status, result.error);

    // Handle previous_response_not_found: strip prev ID and retry on same account (once)
    if (!prevResponseRetried && errorClass.type === "previous_response_not_found" && prevResponseId) {
      log.warn("AFFINITY", `previous_response_not_found for ${prevResponseId.slice(-8)}${implicitResumeActive ? " (implicit resume)" : ""}, stripping and retrying`);
      affinityMap.forget(prevResponseId);
      delete body.previous_response_id;
      preferredConnectionId = null;
      prevResponseRetried = true;
      continue;
    }

    // Handle unanswered_function_call: strip prev ID and retry on same account (once)
    if (!prevResponseRetried && errorClass.type === "unanswered_function_call" && prevResponseId) {
      log.warn("AFFINITY", `unanswered_function_call, stripping prev ID and retrying full input`);
      affinityMap.forget(prevResponseId);
      delete body.previous_response_id;
      preferredConnectionId = null;
      prevResponseRetried = true;
      continue;
    }

    // Transient upstream overload: retry same account once before rotating
    if (!capacityRetried && errorClass.type === "model_capacity") {
      capacityRetried = true;
      log.warn("CHAT", `Codex overloaded (${result.status}), retrying same account after 2s`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }

    // Mark account unavailable (auto-calculates cooldown with exponential backoff, or precise resetsAtMs)
    const resetsAtMs = errorClass.resetsAtMs || result.resetsAtMs;
    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs);

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status} ${errorClass.type}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      preferredConnectionId = null; // clear affinity on fallback
      continue;
    }

    return result.response;
  }
}
