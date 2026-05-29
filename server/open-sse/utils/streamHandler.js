// Stream handler with disconnect detection - shared for all providers
import { STREAM_STALL_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { FORMATS } from "../translator/formats.js";
import { recordStreamCloseEvent } from "../../logs/stream-close-event.js";

const sharedEncoder = new TextEncoder();

function getStreamHeartbeatMs(provider) {
  if (provider !== "kiro") return 0;
  const raw = process.env.KIRO_STREAM_HEARTBEAT_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 15_000;
}

function getHeartbeatFrame(sourceFormat) {
  if (sourceFormat === FORMATS.CLAUDE) {
    return 'event: ping\ndata: {"type":"ping"}\n\n';
  }
  return ": keep-alive\n\n";
}

// Get HH:MM:SS timestamp
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Create stream controller with abort and disconnect detection
 * @param {object} options
 * @param {function} options.onDisconnect - Callback when client disconnects
 * @param {object} options.log - Logger instance
 * @param {string} options.provider - Provider name
 * @param {string} options.model - Model name
 */
export function createStreamController({ onDisconnect, onError, log, provider, model } = {}) {
  const abortController = new AbortController();
  const startTime = Date.now();
  let disconnected = false;
  let abortTimeout = null;

  const logStream = (status) => {
    const duration = Date.now() - startTime;
    const p = provider?.toUpperCase() || "UNKNOWN";
    console.log(`[${getTimeString()}] 🌊 [STREAM] ${p} | ${model || "unknown"} | ${duration}ms | ${status}`);
  };

  return {
    signal: abortController.signal,
    startTime,
    provider,
    heartbeatMs: getStreamHeartbeatMs(provider),
    heartbeatFrame: ": keep-alive\n\n",

    isConnected: () => !disconnected,

    // Call when client disconnects
    handleDisconnect: (reason = "client_closed") => {
      if (disconnected) return;
      disconnected = true;

      logStream(`disconnect: ${reason}`);

      // Delay abort to allow cleanup
      abortTimeout = setTimeout(() => {
        abortController.abort();
      }, 500);

      onDisconnect?.({ reason, duration: Date.now() - startTime });

      // Structured audit log
      recordStreamCloseEvent({
        kind: "client-abort",
        detail: reason,
        provider,
        model,
      });
    },

    // Call when stream completes normally
    handleComplete: () => {
      if (disconnected) return;
      disconnected = true;

      logStream("complete");

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }
    },

    // Call on error
    handleError: (error) => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }

      if (error.name === "AbortError") {
        logStream("aborted");
        return;
      }

      logStream(`error: ${error.message}`);
      onError?.(error);

      // Structured audit log
      recordStreamCloseEvent({
        kind: "upstream-error",
        detail: error.message,
        provider,
        model,
      });
    },

    abort: () => abortController.abort()
  };
}

/**
 * Create transform stream with disconnect detection
 * Wraps existing transform stream and adds abort capability
 */
export function createDisconnectAwareStream(transformStream, streamController) {
  const reader = transformStream.readable.getReader();
  const writer = transformStream.writable.getWriter();
  const heartbeatMs = streamController.heartbeatMs || 0;
  const heartbeatFrame = streamController.heartbeatFrame || ": keep-alive\n\n";
  let pendingRead = null;
  let hasForwardedChunk = false;

  return new ReadableStream({
    async pull(controller) {
      if (!streamController.isConnected()) {
        controller.close();
        return;
      }

      try {
        // Race between chunk arrival and stall timeout
        let stallTimer;
        let heartbeatTimer;
        const stallPromise = new Promise((_, reject) => {
          stallTimer = setTimeout(() => reject(new Error("stream stall timeout")), STREAM_STALL_TIMEOUT_MS);
        });
        const heartbeatPromise = heartbeatMs > 0 && hasForwardedChunk
          ? new Promise((resolve) => {
              heartbeatTimer = setTimeout(() => resolve({ heartbeat: true }), heartbeatMs);
            })
          : null;

        let done, value;
        let heartbeat = false;
        try {
          pendingRead ||= reader.read();
          const result = await Promise.race(heartbeatPromise ? [pendingRead, stallPromise, heartbeatPromise] : [pendingRead, stallPromise]);
          heartbeat = result?.heartbeat === true;
          if (!heartbeat) {
            ({ done, value } = result);
            pendingRead = null;
          }
        } finally {
          clearTimeout(stallTimer);
          if (heartbeatTimer) clearTimeout(heartbeatTimer);
        }

        if (heartbeat) {
          controller.enqueue(sharedEncoder.encode(heartbeatFrame));
          return;
        }

        if (done) {
          streamController.handleComplete();
          controller.close();
          return;
        }
        hasForwardedChunk = true;
        controller.enqueue(value);
      } catch (error) {
        streamController.handleError(error);
        reader.cancel().catch(() => {});
        writer.abort().catch(() => {});
        controller.error(error);
      }
    },

    cancel(reason) {
      streamController.handleDisconnect(reason || "cancelled");
      reader.cancel();
      writer.abort();
    }
  });
}

export function setStreamHeartbeatFormat(streamController, sourceFormat) {
  if (!streamController) return;
  streamController.heartbeatFrame = getHeartbeatFrame(sourceFormat);
}

/**
 * Pipe provider response through transform with disconnect detection
 * @param {Response} providerResponse - Response from provider
 * @param {TransformStream} transformStream - Transform stream for SSE
 * @param {object} streamController - Stream controller from createStreamController
 */
export function pipeWithDisconnect(providerResponse, transformStream, streamController) {
  const transformedBody = providerResponse.body.pipeThrough(transformStream);
  return createDisconnectAwareStream(
    { readable: transformedBody, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
    streamController
  );
}
