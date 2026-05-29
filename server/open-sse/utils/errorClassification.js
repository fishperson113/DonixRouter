/**
 * Shared error classification utilities for upstream API errors.
 * Adapted from codex-proxy's error-classification.ts.
 *
 * Uses duck-typing ({ status, body/message }) to classify upstream errors
 * for retry decisions, account status changes, and fallback routing.
 */

/**
 * Check if an error object looks like an upstream API error with status + body.
 * @param {unknown} err
 * @returns {boolean}
 */
function isUpstreamError(err) {
  if (!(err instanceof Error)) return false;
  return typeof err.status === "number" && (typeof err.body === "string" || typeof err.message === "string");
}

function getBody(err) {
  return err.body || err.message || "";
}

/** Codex WS allowlist — exact error codes that should rotate accounts / fail fast. */
const CODEX_WS_ROTATABLE_ERROR_CODES = {
  usage_limit_reached: 429,
  rate_limit_exceeded: 429,
  rate_limit_reached: 429,
  quota_exhausted: 402,
  payment_required: 402,
  unauthorized: 401,
  token_invalid: 401,
  token_expired: 401,
  account_deactivated: 401,
  forbidden: 403,
  account_banned: 403,
  banned: 403,
  previous_response_not_found: 400,
  websocket_connection_limit_reached: 503,
  overloaded_error: 503,
  server_overloaded: 503,
  model_capacity_exceeded: 503,
};

function looksModelCapacity(text) {
  const lower = String(text || "").toLowerCase();
  if (!lower) return false;
  return lower.includes("overloaded")
    || lower.includes("servers are currently")
    || lower.includes("model_capacity")
    || (lower.includes("capacity") && lower.includes("server"));
}

function bodyLooksQuotaExhausted(body) {
  const lower = String(body || "").toLowerCase();
  return lower.includes("resource_exhausted")
    || lower.includes("resource has been exhausted")
    || lower.includes("check quota")
    || lower.includes("quota exhausted")
    || lower.includes("quota exceeded")
    || lower.includes("insufficient_quota")
    || lower.includes("insufficient quota");
}

/**
 * Extract the rate-limit reset duration from a 429 error body, if available.
 * Looks for `error.resets_in_seconds` or `error.resets_at` in the JSON body.
 * @param {string} body - Raw response body text
 * @returns {number|undefined} Seconds until reset, or undefined
 */
export function extractRetryAfterSec(body) {
  try {
    const parsed = JSON.parse(body);
    const error = parsed?.error;
    if (!error) return undefined;
    if (typeof error.resets_in_seconds === "number" && error.resets_in_seconds > 0) {
      return error.resets_in_seconds;
    }
    if (typeof error.resets_at === "number" && error.resets_at > 0) {
      const diff = error.resets_at - Date.now() / 1000;
      return diff > 0 ? diff : undefined;
    }
  } catch { /* use default backoff */ }
  return undefined;
}

/**
 * Extract precise resets_at timestamp in milliseconds from a 429 error body.
 * @param {string} body - Raw response body text
 * @returns {number|null} Unix timestamp in ms, or null
 */
export function extractResetsAtMs(body) {
  try {
    const parsed = JSON.parse(body);
    const err = parsed?.error;
    if (!err) return null;
    const now = Date.now();
    if (typeof err.resets_at === "number" && err.resets_at > 0) {
      const ms = err.resets_at * 1000;
      if (ms > now) return ms;
    }
    if (typeof err.resets_in_seconds === "number" && err.resets_in_seconds > 0) {
      return now + err.resets_in_seconds * 1000;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Check if a 402 Payment Required indicates the account's quota/subscription is exhausted.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isQuotaExhaustedError(err) {
  if (!isUpstreamError(err)) {
    // Also check plain status number
    if (typeof err === "object" && err !== null && err.status === 402) return true;
    return false;
  }
  if (err.status === 402) return true;
  if (err.status === 429) return bodyLooksQuotaExhausted(getBody(err));
  return false;
}

/**
 * Check if an error indicates the account is banned/suspended (non-Cloudflare 403).
 * Excludes Cloudflare challenge pages (cf_chl, HTML pages).
 * @param {unknown} err
 * @returns {boolean}
 */
export function isBanError(err) {
  if (!isUpstreamError(err)) return false;
  if (err.status !== 403) return false;
  const body = getBody(err).toLowerCase();
  if (body.includes("cf_chl") || body.includes("<!doctype") || body.includes("<html")) return false;
  return true;
}

/**
 * Check if an error is a 401 token invalidation (revoked/expired upstream).
 * @param {unknown} err
 * @returns {boolean}
 */
export function isTokenInvalidError(err) {
  if (!isUpstreamError(err)) {
    if (typeof err === "object" && err !== null && err.status === 401) return true;
    return false;
  }
  if (err.status === 401) return true;
  if (err.status !== 403) return false;
  const body = getBody(err).toLowerCase();
  return body.includes("bearer token") && body.includes("invalid");
}

/**
 * Check if an error indicates the upstream does not recognize the
 * `previous_response_id` referenced in the request.
 * Detects either:
 *  - structured `code: "previous_response_not_found"` in the error body, or
 *  - the human-readable "Previous response with id ... not found" message.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isPreviousResponseNotFoundError(err) {
  if (!isUpstreamError(err)) return false;
  const body = getBody(err);
  try {
    const parsed = JSON.parse(body);
    const error = parsed?.error;
    if (error && typeof error.code === "string" && error.code === "previous_response_not_found") {
      return true;
    }
  } catch { /* fall through to message check */ }
  const lower = (body + " " + (err.message || "")).toLowerCase();
  return lower.includes("previous_response_not_found")
    || (lower.includes("previous response with id") && lower.includes("not found"));
}

/**
 * Check if an error indicates a stored function_call from the previous response
 * was not answered with a function_call_output in the current request.
 * Upstream surfaces this as 400 with message "No tool output found for function call call_X".
 * @param {unknown} err
 * @returns {boolean}
 */
export function isUnansweredFunctionCallError(err) {
  if (!isUpstreamError(err)) return false;
  if (err.status !== 400) return false;
  const haystack = (getBody(err) + " " + (err.message || "")).toLowerCase();
  return haystack.includes("no tool output found for function call");
}

/**
 * Check if a CodexApiError indicates the model is not supported on the account's plan.
 * @param {unknown} err
 * @returns {boolean}
 */
/**
 * Check if an error indicates upstream model/server capacity exhaustion (503/529/overloaded).
 * @param {unknown} err
 * @returns {boolean}
 */
export function isModelCapacityError(err) {
  const status = err?.status;
  if (status === 503 || status === 529) return true;
  if (!isUpstreamError(err)) return false;
  if (err.status === 503 || err.status === 529) return true;
  const haystack = (getBody(err) + " " + (err.message || "")).toLowerCase();
  return looksModelCapacity(haystack);
}

/**
 * Classify a Codex WebSocket JSON error frame for early reject / account rotation.
 * @param {object} msg - Parsed WS message
 * @returns {{ status: number, code?: string }|null}
 */
export function classifyCodexWsErrorEvent(msg) {
  const type = typeof msg?.type === "string" ? msg.type : "";
  if (type !== "error" && type !== "response.failed") return null;
  const errorObj = typeof msg.error === "object" && msg.error !== null ? msg.error : null;
  if (!errorObj) return null;
  const codeRaw = (typeof errorObj.code === "string" ? errorObj.code : null)
    ?? (typeof errorObj.type === "string" ? errorObj.type : null)
    ?? "";
  const lower = codeRaw.toLowerCase();
  const fromCode = CODEX_WS_ROTATABLE_ERROR_CODES[lower];
  if (fromCode) return { status: fromCode, code: lower };

  const message = typeof errorObj.message === "string" ? errorObj.message : "";
  if (looksModelCapacity(message) || looksModelCapacity(lower)) {
    return { status: 503, code: lower || "overloaded" };
  }
  return null;
}

export function isModelNotSupportedError(err) {
  const status = err?.status;
  if (!status || status < 400 || status >= 500 || status === 429) return false;
  const lower = (err.message || getBody(err) || "").toLowerCase();
  if (!lower.includes("model")) return false;
  return lower.includes("not supported") || lower.includes("not_supported")
    || lower.includes("not available") || lower.includes("not_available");
}

/**
 * Classify an upstream error for routing decisions.
 * @param {number} status - HTTP status code
 * @param {string} body - Response body text
 * @returns {{ type: string, shouldRetry: boolean, shouldFallback: boolean, resetsAtMs: number|null }}
 */
export function classifyUpstreamError(status, body) {
  const bodyStr = typeof body === "string" ? body : "";
  const err = Object.assign(new Error(bodyStr.slice(0, 200)), { status, body: bodyStr });

  if (isQuotaExhaustedError(err)) {
    return { type: "quota_exhausted", shouldRetry: false, shouldFallback: true, resetsAtMs: null };
  }
  if (isTokenInvalidError(err)) {
    return { type: "token_invalid", shouldRetry: false, shouldFallback: true, resetsAtMs: null };
  }
  if (isBanError(err)) {
    return { type: "banned", shouldRetry: false, shouldFallback: true, resetsAtMs: null };
  }
  if (isPreviousResponseNotFoundError(err)) {
    return { type: "previous_response_not_found", shouldRetry: true, shouldFallback: false, resetsAtMs: null };
  }
  if (isUnansweredFunctionCallError(err)) {
    return { type: "unanswered_function_call", shouldRetry: true, shouldFallback: false, resetsAtMs: null };
  }
  if (isModelNotSupportedError(err)) {
    return { type: "model_not_supported", shouldRetry: false, shouldFallback: true, resetsAtMs: null };
  }
  if (isModelCapacityError(err)) {
    return { type: "model_capacity", shouldRetry: true, shouldFallback: true, resetsAtMs: null };
  }
  if (status === 429) {
    const resetsAtMs = extractResetsAtMs(bodyStr);
    return { type: "rate_limited", shouldRetry: false, shouldFallback: true, resetsAtMs };
  }

  return { type: "unknown", shouldRetry: false, shouldFallback: status >= 500, resetsAtMs: null };
}
