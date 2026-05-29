import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { v4 as uuidv4 } from "uuid";
import { refreshKiroToken } from "../services/tokenRefresh.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { HTTP_STATUS, DEFAULT_RETRY_CONFIG, resolveRetryEntry } from "../config/runtimeConfig.js";

function extractKiroErrorPayload(bodyText) {
  if (typeof bodyText !== "string") return null;

  const trimmed = bodyText.trim();
  if (!trimmed) return null;

  const candidates = [trimmed];
  if (trimmed.startsWith("data:")) {
    const payload = trimmed.slice(5).trim();
    if (payload && payload !== "[DONE]") candidates.push(payload);
  }
  if (trimmed.includes("\n")) {
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload && payload !== "[DONE]") candidates.push(payload);
    }
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

export function parseKiroErrorBody(bodyText) {
  const payload = extractKiroErrorPayload(bodyText);
  const message = typeof payload?.error?.message === "string"
    ? payload.error.message
    : typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error === "string"
        ? payload.error
        : (typeof bodyText === "string" ? bodyText.trim() : "");
  const statusText = typeof payload?.error?.status === "string"
    ? payload.error.status
    : typeof payload?.status === "string"
      ? payload.status
      : "";
  const lower = `${statusText} ${message}`.toLowerCase();
  const quotaExhausted = lower.includes("resource_exhausted")
    || lower.includes("resource has been exhausted")
    || lower.includes("check quota")
    || lower.includes("quota exhausted")
    || lower.includes("quota exceeded");
  const suspiciousActivity = lower.includes("suspicious activity")
    || lower.includes("temporary limits")
    || lower.includes("how frequently your account");

  return { payload, message, statusText, quotaExhausted, suspiciousActivity };
}

export function shouldRetryKiro429(bodyText) {
  const parsed = parseKiroErrorBody(bodyText);
  return !parsed.quotaExhausted && !parsed.suspiciousActivity;
}

/**
 * Detect Kiro upstream 400 "Input is too long" errors.
 * Kiro returns this when the conversation history exceeds the model's
 * effective context window, even if our local soft/hard byte budgets passed.
 */
export function isKiroInputTooLong(bodyText) {
  if (typeof bodyText !== "string") return false;
  const lower = bodyText.toLowerCase();
  return lower.includes("input is too long")
    || lower.includes("input too long")
    || lower.includes("context length exceeded")
    || lower.includes("too many tokens");
}

function isKiroAuthTokenInvalid(status, bodyText) {
  if (status !== HTTP_STATUS.UNAUTHORIZED && status !== HTTP_STATUS.FORBIDDEN) return false;
  const lower = String(bodyText || "").toLowerCase();
  if (!lower) return true;
  return lower.includes("bearer token") && lower.includes("invalid")
    || lower.includes("token") && lower.includes("expired")
    || lower.includes("unauthorized");
}

/**
 * Halve a Kiro payload's history in place by dropping the oldest user/assistant
 * pair(s). If the history starts with a virtual <system-instructions> turn
 * (injected by buildKiroPayload), that pair is preserved.
 * Returns the number of entries removed.
 */
function halveKiroHistory(transformedBody) {
  const history = transformedBody?.conversationState?.history;
  if (!Array.isArray(history) || history.length < 2) return 0;

  // Detect virtual system-instructions turn at head; preserve that pair.
  let preserveHead = 0;
  const firstContent = history[0]?.userInputMessage?.content || "";
  if (firstContent.startsWith("<system-instructions>") && history[1]?.assistantResponseMessage) {
    preserveHead = 2;
  }

  const trimmable = history.length - preserveHead;
  if (trimmable < 2) return 0;

  // Drop ~half the trimmable section, always an even count to keep pairs aligned.
  let toDrop = Math.floor(trimmable / 2);
  if (toDrop % 2 === 1) toDrop -= 1;
  if (toDrop < 2) toDrop = 2;

  history.splice(preserveHead, toDrop);
  return toDrop;
}

/**
 * KiroExecutor - Executor for Kiro AI (AWS CodeWhisperer)
 * Uses AWS CodeWhisperer streaming API with AWS EventStream binary format
 */
export class KiroExecutor extends BaseExecutor {
  constructor() {
    super("kiro", PROVIDERS.kiro);
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      ...this.config.headers,
      "Amz-Sdk-Request": "attempt=1; max=3",
      "Amz-Sdk-Invocation-Id": uuidv4()
    };

    if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    }

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    return body;
  }

  /**
   * Custom execute for Kiro - handles AWS EventStream binary response with retry support
   */
  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null, onCredentialsRefreshed = null }) {
    const url = this.buildUrl(model, stream, 0);
    let transformedBody = this.transformRequest(model, body, stream, credentials);

    // Merge default retry config with provider-specific config
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    let retryAttempts = 0;
    let authRefreshAttempted = false;
    let inputTooLongAttempts = 0;
    const MAX_INPUT_TOO_LONG_RETRIES = 3;

    while (true) {
      const headers = this.buildHeaders(credentials, stream);

      const response = await proxyAwareFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(transformedBody),
        signal
      }, proxyOptions);

      // Kiro often returns 403 with a plain-text stale bearer-token message.
      // Refresh here so the generic chat handler does not have to infer it.
      if (!authRefreshAttempted && (response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN)) {
        let bodyText = "";
        try {
          bodyText = await response.clone().text();
        } catch {
          bodyText = "";
        }

        if (isKiroAuthTokenInvalid(response.status, bodyText)) {
          authRefreshAttempted = true;
          log?.warn?.("TOKEN", "KIRO | bearer token invalid, refreshing and retrying once");
          const refreshed = await this.refreshCredentials(credentials, log, proxyOptions);
          if (refreshed?.accessToken) {
            Object.assign(credentials, refreshed);
            if (onCredentialsRefreshed) {
              try {
                await onCredentialsRefreshed(refreshed);
              } catch (error) {
                log?.warn?.("TOKEN", `KIRO | persist refreshed credentials failed: ${error.message}`);
              }
            }
            continue;
          }
          log?.warn?.("TOKEN", "KIRO | refresh failed after bearer token invalid");
        }
      }

      // Handle 400 "Input is too long" by halving history and resending.
      if (response.status === 400 && inputTooLongAttempts < MAX_INPUT_TOO_LONG_RETRIES) {
        let bodyText = "";
        try {
          bodyText = await response.clone().text();
        } catch {
          bodyText = "";
        }
        if (isKiroInputTooLong(bodyText)) {
          const dropped = halveKiroHistory(transformedBody);
          if (dropped > 0) {
            inputTooLongAttempts++;
            const remaining = transformedBody?.conversationState?.history?.length ?? 0;
            log?.warn?.("KIRO", `Input too long; dropped ${dropped} oldest history entries (retry ${inputTooLongAttempts}/${MAX_INPUT_TOO_LONG_RETRIES}, ${remaining} remain)`);
            continue;
          }
          log?.warn?.("KIRO", "Input too long but history already minimal; giving up retry");
        }
      }

      // Check if should retry based on status code
      const { attempts: maxRetries, delayMs } = resolveRetryEntry(retryConfig[response.status]);
      let shouldRetry = !response.ok && maxRetries > 0 && retryAttempts < maxRetries;
      if (shouldRetry && response.status === HTTP_STATUS.RATE_LIMITED) {
        let bodyText = "";
        try {
          bodyText = await response.clone().text();
        } catch {
          bodyText = "";
        }
        if (!shouldRetryKiro429(bodyText)) {
          log?.warn?.("KIRO", "Detected hard quota exhaustion; skipping local 429 retry");
          shouldRetry = false;
        }
      }
      if (shouldRetry) {
        retryAttempts++;
        log?.debug?.("RETRY", `${response.status} retry ${retryAttempts}/${maxRetries} after ${delayMs / 1000}s`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      if (!response.ok) {
        return { response, url, headers, transformedBody };
      }

      // Success - transform and return
      // For Kiro, we need to transform the binary EventStream to SSE
      // Create a TransformStream to convert binary to SSE text
      const transformedResponse = this.transformEventStreamToSSE(response, model);
      return { response: transformedResponse, url, headers, transformedBody };
    }
  }

  parseError(response, bodyText) {
    const parsed = parseKiroErrorBody(bodyText);
    const message = parsed.message || bodyText || `HTTP ${response.status}`;

    if (response.status === HTTP_STATUS.RATE_LIMITED && parsed.quotaExhausted) {
      const normalized = message.toLowerCase().startsWith("kiro quota exhausted")
        ? message
        : `Kiro quota exhausted. ${message}`;
      return { status: response.status, message: normalized };
    }

    if (response.status === HTTP_STATUS.RATE_LIMITED && parsed.suspiciousActivity) {
      return { status: response.status, message };
    }

    return { status: response.status, message };
  }

  /**
   * Transform AWS EventStream binary response to SSE text stream.
   *
   * Uses a ReadableStream + manual reader so we can:
   *  - send `: keepalive\n\n` SSE comments every KEEPALIVE_MS while upstream is silent
   *    (prevents Claude CLI / OpenAI clients from tripping their stall timeout when
   *    Kiro is "thinking" for 30–90s before emitting the first frame),
   *  - run a stall watchdog that closes the stream gracefully if upstream
   *    goes quiet for STALL_MS (otherwise we'd hang forever on a half-open socket),
   *  - catch reader errors mid-stream and still emit a clean finish + [DONE]
   *    so the client never hangs.
   */
  transformEventStreamToSSE(response, model) {
    const MAX_FRAME_SIZE = 32 * 1024 * 1024;
    const MAX_BUFFER_SIZE = 64 * 1024 * 1024;
    const KEEPALIVE_MS = 15000;     // SSE comment every 15s
    const STALL_MS = 120000;        // close gracefully if no upstream data for 120s

    const sharedEncoder = new TextEncoder();
    let buffer = new Uint8Array(0);
    let chunkIndex = 0;
    const responseId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const state = {
      finishEmitted: false,
      hasToolCalls: false,
      toolCallIndex: 0,
      seenToolIds: new Map(),
      totalContentLength: 0,
      contextUsagePercentage: 0,
      hasContextUsage: false,
      hasMeteringEvent: false,
      stopEventReceived: false,
      streamAborted: false,
      doneSent: false,
    };

    const safeEnqueue = (controller, bytes) => {
      try { controller.enqueue(bytes); return true; }
      catch { return false; }
    };
    const writeChunk = (controller, payload) => {
      safeEnqueue(controller, sharedEncoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
    };
    const writePing = (controller) => {
      safeEnqueue(controller, sharedEncoder.encode(`: keepalive ${Date.now()}\n\n`));
    };

    const computeFinishUsage = () => {
      if (state.usage) return state.usage;
      const estimatedOutputTokens = state.totalContentLength > 0
        ? Math.max(1, Math.floor(state.totalContentLength / 4))
        : 0;
      const estimatedInputTokens = state.contextUsagePercentage > 0
        ? Math.floor(state.contextUsagePercentage * 200000 / 100)
        : 0;
      return {
        prompt_tokens: estimatedInputTokens,
        completion_tokens: estimatedOutputTokens,
        total_tokens: estimatedInputTokens + estimatedOutputTokens
      };
    };

    const emitFinish = (controller, { force = false } = {}) => {
      if (state.finishEmitted) return;
      const hasMeteringPair = state.hasMeteringEvent && state.hasContextUsage;
      const ready = state.stopEventReceived && hasMeteringPair;
      if (!force && !ready) return;

      state.finishEmitted = true;

      // finish_reason MUST match what we already streamed. By the time we get
      // here, any tool_call deltas have already been sent downstream and the
      // OpenAI→Claude translator has already opened tool_use content blocks —
      // we cannot retroactively turn those into a plain "stop" without producing
      // a self-contradictory message (tool_use blocks + end_turn), which breaks
      // Claude Code's agentic loop. So: if we saw tool calls, finish as tool_calls.
      const finishReason = state.hasToolCalls ? "tool_calls" : "stop";

      const finishChunk = {
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      };
      if (state.usage) {
        finishChunk.usage = state.usage;
      } else if (force) {
        finishChunk.usage = computeFinishUsage();
      }
      writeChunk(controller, finishChunk);
    };

    const emitErrorChunk = (controller, message) => {
      const errChunk = {
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{
          index: 0,
          delta: chunkIndex === 0
            ? { role: "assistant", content: `[Kiro Error] ${message}` }
            : { content: `\n\n[Kiro Error] ${message}` },
          finish_reason: null
        }]
      };
      chunkIndex++;
      writeChunk(controller, errChunk);
    };

    const emitDone = (controller) => {
      if (state.doneSent) return;
      state.doneSent = true;
      safeEnqueue(controller, sharedEncoder.encode("data: [DONE]\n\n"));
    };

    const drainFrames = (controller) => {
      while (buffer.length >= 12) {
        const view = new DataView(buffer.buffer, buffer.byteOffset);
        const totalLength = view.getUint32(0, false);

        if (totalLength < 16 || totalLength > MAX_FRAME_SIZE) {
          console.error(`[Kiro] Invalid EventStream frame totalLength=${totalLength}; aborting parse`);
          state.streamAborted = true;
          emitErrorChunk(controller, `corrupted frame (size=${totalLength})`);
          state.stopEventReceived = true;
          emitFinish(controller, { force: true });
          buffer = new Uint8Array(0);
          return;
        }

        if (buffer.length < totalLength) break;

        const eventData = buffer.slice(0, totalLength);
        buffer = buffer.slice(totalLength);

        const event = parseEventFrame(eventData);
        if (!event) continue;

        const messageType = event.headers[":message-type"] || "event";
        const eventType = event.headers[":event-type"] || "";

        if (messageType === "exception" || messageType === "error") {
          const errMsg = (event.payload && (event.payload.message || event.payload.Message))
            || event.headers[":exception-type"]
            || event.headers[":error-message"]
            || `${messageType}: ${eventType || "unknown"}`;
          console.warn(`[Kiro] EventStream ${messageType}: ${errMsg}`);
          emitErrorChunk(controller, String(errMsg).slice(0, 500));
          state.stopEventReceived = true;
          emitFinish(controller, { force: true });
          state.streamAborted = true;
          buffer = new Uint8Array(0);
          return;
        }

        if (eventType === "assistantResponseEvent" && event.payload?.content) {
          const content = event.payload.content;
          state.totalContentLength += content.length;
          writeChunk(controller, {
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{
              index: 0,
              delta: chunkIndex === 0
                ? { role: "assistant", content }
                : { content },
              finish_reason: null
            }]
          });
          chunkIndex++;
          continue;
        }

        if (eventType === "codeEvent" && event.payload?.content) {
          writeChunk(controller, {
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{
              index: 0,
              delta: { content: event.payload.content },
              finish_reason: null
            }]
          });
          chunkIndex++;
          continue;
        }

        if (eventType === "toolUseEvent" && event.payload) {
          state.hasToolCalls = true;
          const toolUse = event.payload;
          const toolUses = Array.isArray(toolUse) ? toolUse : [toolUse];

          for (const singleToolUse of toolUses) {
            const toolCallId = singleToolUse.toolUseId || `call_${Date.now()}`;
            const toolName = singleToolUse.name || "";
            const toolInput = singleToolUse.input;

            let toolIndex;
            const isNewTool = !state.seenToolIds.has(toolCallId);

            if (isNewTool) {
              toolIndex = state.toolCallIndex++;
              state.seenToolIds.set(toolCallId, toolIndex);

              writeChunk(controller, {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{
                  index: 0,
                  delta: {
                    ...(chunkIndex === 0 ? { role: "assistant" } : {}),
                    tool_calls: [{
                      index: toolIndex,
                      id: toolCallId,
                      type: "function",
                      function: { name: toolName, arguments: "" }
                    }]
                  },
                  finish_reason: null
                }]
              });
              chunkIndex++;
            } else {
              toolIndex = state.seenToolIds.get(toolCallId);
            }

            if (toolInput !== undefined) {
              let argumentsStr;
              if (typeof toolInput === "string") {
                argumentsStr = toolInput;
              } else if (toolInput && typeof toolInput === "object") {
                argumentsStr = JSON.stringify(toolInput);
              } else {
                continue;
              }

              writeChunk(controller, {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      index: toolIndex,
                      function: { arguments: argumentsStr }
                    }]
                  },
                  finish_reason: null
                }]
              });
              chunkIndex++;
            }
          }
          continue;
        }

        if (eventType === "messageStopEvent") {
          state.stopEventReceived = true;
          emitFinish(controller);
          continue;
        }

        if (eventType === "contextUsageEvent") {
          const pct = event.payload?.contextUsagePercentage;
          if (typeof pct === "number") state.contextUsagePercentage = pct;
          state.hasContextUsage = true;
          emitFinish(controller);
          continue;
        }

        if (eventType === "meteringEvent") {
          state.hasMeteringEvent = true;
          const metering = event.payload?.meteringEvent || event.payload;
          if (metering && typeof metering === "object") {
            const inputTokens = metering.inputTokens || metering.promptTokens || 0;
            const outputTokens = metering.outputTokens || metering.completionTokens || 0;
            if (inputTokens > 0 || outputTokens > 0) {
              state.usage = {
                prompt_tokens: inputTokens,
                completion_tokens: outputTokens,
                total_tokens: inputTokens + outputTokens
              };
            }
          }
          emitFinish(controller);
          continue;
        }

        if (eventType === "metricsEvent") {
          const metrics = event.payload?.metricsEvent || event.payload;
          if (metrics && typeof metrics === "object") {
            const inputTokens = metrics.inputTokens || 0;
            const outputTokens = metrics.outputTokens || 0;
            if (inputTokens > 0 || outputTokens > 0) {
              state.usage = {
                prompt_tokens: inputTokens,
                completion_tokens: outputTokens,
                total_tokens: inputTokens + outputTokens
              };
            }
          }
          continue;
        }
      }
    };

    if (!response.body) {
      return new Response("data: [DONE]\n\n", {
        status: response.status,
        headers: { "Content-Type": "text/event-stream" }
      });
    }

    const out = new ReadableStream({
      async start(controller) {
        // Initial role chunk so the client immediately sees a valid OpenAI delta.
        writeChunk(controller, {
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
        });
        chunkIndex++;

        const reader = response.body.getReader();
        let lastDataAt = Date.now();
        let closed = false;

        const pingTimer = setInterval(() => {
          if (closed) return;
          // Only ping if upstream has been silent for at least one keepalive
          // window — avoids interleaving pings between back-to-back frames.
          if (Date.now() - lastDataAt >= KEEPALIVE_MS) writePing(controller);
        }, KEEPALIVE_MS);

        const stallTimer = setInterval(() => {
          if (closed) return;
          if (Date.now() - lastDataAt < STALL_MS) return;
          console.warn(`[Kiro] upstream silent for ${STALL_MS}ms — closing gracefully`);
          state.streamAborted = true;
          emitErrorChunk(controller, "upstream stalled");
          state.stopEventReceived = true;
          emitFinish(controller, { force: true });
          emitDone(controller);
          try { reader.cancel("stall"); } catch { /* ignore */ }
        }, Math.max(5000, Math.floor(STALL_MS / 8)));

        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(pingTimer);
          clearInterval(stallTimer);
          if (!state.finishEmitted) emitFinish(controller, { force: true });
          emitDone(controller);
          try { controller.close(); } catch { /* already closed */ }
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (state.streamAborted) break;

            lastDataAt = Date.now();

            const merged = new Uint8Array(buffer.length + value.length);
            merged.set(buffer);
            merged.set(value, buffer.length);
            buffer = merged;

            if (buffer.length > MAX_BUFFER_SIZE) {
              console.error(`[Kiro] EventStream buffer exceeded ${MAX_BUFFER_SIZE} bytes — aborting`);
              state.streamAborted = true;
              emitErrorChunk(controller, "stream buffer overflow");
              state.stopEventReceived = true;
              emitFinish(controller, { force: true });
              buffer = new Uint8Array(0);
              break;
            }

            drainFrames(controller);
          }
        } catch (err) {
          // Upstream socket reset / fetch body error — most common cause of
          // "broken chunk" symptoms in long sessions. Recover gracefully.
          console.warn(`[Kiro] upstream body read error: ${err?.message || err}`);
          if (!state.finishEmitted) {
            emitErrorChunk(controller, `upstream interrupted: ${err?.message || "unknown"}`);
            state.stopEventReceived = true;
            emitFinish(controller, { force: true });
          }
        } finally {
          cleanup();
        }
      },

      cancel(reason) {
        // Client (Claude CLI) hung up — nothing more to do, GC will release the reader.
        console.warn(`[Kiro] downstream cancelled: ${reason || "unknown"}`);
      }
    });

    return new Response(out, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    try {
      // Use centralized refreshKiroToken function (handles both AWS SSO OIDC and Social Auth)
      const result = await refreshKiroToken(
        credentials.refreshToken,
        credentials.providerSpecificData,
        log,
        proxyOptions
      );

      return result;
    } catch (error) {
      log?.error?.("TOKEN", `Kiro refresh error: ${error.message}`);
      return null;
    }
  }
}

/**
 * Parse AWS EventStream frame
 */
function parseEventFrame(data) {
  try {
    const view = new DataView(data.buffer, data.byteOffset);
    const headersLength = view.getUint32(4, false);

    // Parse headers
    const headers = {};
    let offset = 12; // After prelude
    const headerEnd = 12 + headersLength;

    while (offset < headerEnd && offset < data.length) {
      const nameLen = data[offset];
      offset++;
      if (offset + nameLen > data.length) break;

      const name = new TextDecoder().decode(data.slice(offset, offset + nameLen));
      offset += nameLen;

      const headerType = data[offset];
      offset++;

      // AWS EventStream header types — handle the common ones, skip the rest
      // by advancing `offset` instead of breaking. Breaking here drops every
      // header after an unknown one, including :message-type, which causes the
      // parser to misclassify exception frames as normal events.
      // 0 = bool true (no value), 1 = bool false (no value), 2 = byte (1B),
      // 3 = short (2B), 4 = int (4B), 5 = long (8B), 6 = byte array (2B len),
      // 7 = string (2B len), 8 = timestamp (8B), 9 = uuid (16B).
      if (headerType === 0 || headerType === 1) {
        // bool — no value bytes
      } else if (headerType === 2) {
        offset += 1;
      } else if (headerType === 3) {
        offset += 2;
      } else if (headerType === 4) {
        offset += 4;
      } else if (headerType === 5 || headerType === 8) {
        offset += 8;
      } else if (headerType === 6 || headerType === 7) {
        if (offset + 2 > data.length) break;
        const valueLen = (data[offset] << 8) | data[offset + 1];
        offset += 2;
        if (offset + valueLen > data.length) break;

        if (headerType === 7) {
          headers[name] = new TextDecoder().decode(data.slice(offset, offset + valueLen));
        }
        offset += valueLen;
      } else if (headerType === 9) {
        offset += 16;
      } else {
        // Truly unknown type — bail out of header parsing for this frame.
        break;
      }
    }

    // Parse payload
    const payloadStart = 12 + headersLength;
    const payloadEnd = data.length - 4; // Exclude message CRC

    let payload = null;
    if (payloadEnd > payloadStart) {
      const payloadStr = new TextDecoder().decode(data.slice(payloadStart, payloadEnd));

      // Skip empty or whitespace-only payloads
      if (!payloadStr || !payloadStr.trim()) {
        return { headers, payload: null };
      }

      try {
        payload = JSON.parse(payloadStr);
      } catch (parseError) {
        // Log parse error for debugging
        console.warn(`[Kiro] Failed to parse payload: ${parseError.message} | payload: ${payloadStr.substring(0, 100)}`);
        payload = { raw: payloadStr };
      }
    }

    return { headers, payload };
  } catch {
    return null;
  }
}

export default KiroExecutor;
