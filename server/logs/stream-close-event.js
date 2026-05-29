/**
 * Structured logging for stream-close events.
 *
 * Premature stream close (upstream-side) and client abort (downstream-side) are
 * recurring failure modes. This helper persists every close event through
 * the local error log (Errors tab + JSONL file).
 *
 * JavaScript port of codex-proxy-dev/src/logs/stream-close-event.ts
 */

import { appendErrorLog } from "./error-log.js";

/**
 * @typedef {"client-abort" | "client-write-failed" | "upstream-error" | "upstream-premature"} StreamCloseKind
 */

const ERROR_NAMES = {
  "client-abort": "StreamClientAbort",
  "client-write-failed": "StreamClientWriteFailed",
  "upstream-error": "StreamUpstreamError",
  "upstream-premature": "StreamUpstreamPrematureClose",
};

const BASE_MESSAGES = {
  "client-abort": "Client aborted stream",
  "client-write-failed": "Client disconnected mid-stream (write failed)",
  "upstream-error": "Upstream stream errored",
  "upstream-premature": "Upstream stream closed before terminal event",
};

function prune(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Persist a stream-close event into the local error log.
 * Never throws — logging failures are silently swallowed.
 *
 * @param {{
 *   kind: StreamCloseKind,
 *   detail?: string|null,
 *   closeCode?: number|null,
 *   eventCount?: number|null,
 *   hadReasoning?: boolean|null,
 *   writtenChunks?: number|null,
 *   writtenBytes?: number|null,
 *   lastSentEvent?: string|null,
 *   sentTerminal?: boolean|null,
 *   upstreamStatus?: number|string|null,
 *   requestId?: string|null,
 *   tag?: string|null,
 *   provider?: string|null,
 *   path?: string|null,
 *   model?: string|null,
 *   accountEntryId?: string|null,
 *   variantHash?: string|null,
 *   responseId?: string|null,
 * }} evt
 */
export function recordStreamCloseEvent(evt) {
  const name = ERROR_NAMES[evt.kind] || "StreamCloseEvent";
  const base = BASE_MESSAGES[evt.kind] || "Stream closed unexpectedly";
  const message = evt.detail ? `${base}: ${evt.detail}` : base;

  appendErrorLog({
    source: "server",
    error: { name, message },
    context: prune({
      kind: evt.kind,
      requestId: evt.requestId,
      tag: evt.tag,
      provider: evt.provider,
      path: evt.path,
      model: evt.model,
      accountEntryId: evt.accountEntryId,
      variantHash: evt.variantHash,
      responseId: evt.responseId,
      eventCount: evt.eventCount,
      hadReasoning: evt.hadReasoning,
      closeCode: evt.closeCode,
      writtenChunks: evt.writtenChunks,
      writtenBytes: evt.writtenBytes,
      lastSentEvent: evt.lastSentEvent,
      sentTerminal: evt.sentTerminal,
      upstreamStatus: evt.upstreamStatus,
      detail: evt.detail,
    }),
  });
}
