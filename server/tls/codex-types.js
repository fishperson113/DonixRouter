/**
 * Codex API error types and constants.
 * JavaScript port of codex-proxy-dev/src/proxy/codex-types.ts
 */

export class CodexApiError extends Error {
  constructor(status, body) {
    let detail;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object") {
        const raw = parsed.detail ?? parsed.error?.message ?? body;
        detail = typeof raw === "string" ? raw : JSON.stringify(raw);
      } else {
        detail = body;
      }
    } catch {
      detail = body;
    }
    super(`Codex API error (${status}): ${detail}`);
    this.status = status;
    this.body = body;
  }
}

/** previous_response_id can only chain safely via WebSocket, HTTP fallback would drop server-side history. */
export class PreviousResponseWebSocketError extends CodexApiError {
  constructor(causeMessage) {
    super(
      0,
      JSON.stringify({
        error: {
          message:
            "WebSocket failed while using previous_response_id; HTTP SSE fallback would drop server-side history: " +
            causeMessage,
        },
      }),
    );
    this.name = "PreviousResponseWebSocketError";
    this.causeMessage = causeMessage;
  }
}
