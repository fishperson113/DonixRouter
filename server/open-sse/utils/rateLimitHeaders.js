/**
 * Parse Codex rate-limit info from upstream response headers.
 * Adapted from codex-proxy's rate-limit-headers.ts.
 *
 * The Codex backend attaches quota data to every response via x-codex-* headers.
 * This module extracts that data for passive quota tracking without polling.
 *
 * Header families (prefix = "x-codex"):
 *   {prefix}-primary-used-percent
 *   {prefix}-primary-window-minutes
 *   {prefix}-primary-reset-at
 *   {prefix}-secondary-used-percent
 *   {prefix}-secondary-window-minutes
 *   {prefix}-secondary-reset-at
 */

/**
 * Extract rate-limit data from response headers.
 * @param {Headers|object} headers
 * @returns {{ primary: object|null, secondary: object|null, code_review: object|null }|null}
 */
export function parseRateLimitHeaders(headers) {
  const get = (name) => {
    if (headers instanceof Headers) return headers.get(name);
    return headers[name] ?? null;
  };

  const primary = parseWindow(get, "x-codex-primary");
  const secondary = parseWindow(get, "x-codex-secondary");
  const codeReview =
    parseDetailsFromHeaders(get, "x-codex-code-review") ??
    parseDetailsFromHeaders(get, "x-codex-review") ??
    parseDetailsFromHeaders(get, "x-code-review");

  if (!primary && !secondary && !codeReview) return null;
  return { primary, secondary, code_review: codeReview };
}

/**
 * Parse rate-limit data from a `codex.rate_limits` WebSocket event.
 * @param {object} data - Parsed JSON from WS message
 * @returns {{ primary: object|null, secondary: object|null, code_review: object|null }|null}
 */
export function parseRateLimitsEvent(data) {
  if (!data || typeof data !== "object") return null;
  const rl = parseDetailsFromObject(data.rate_limits);
  const explicitCodeReview =
    parseDetailsFromObject(data.code_review_rate_limits) ??
    parseDetailsFromObject(data.code_review_rate_limit);

  let primary = rl?.primary ?? null;
  let secondary = rl?.secondary ?? null;
  let codeReview = explicitCodeReview;

  const limitName =
    typeof data.metered_limit_name === "string"
      ? data.metered_limit_name
      : typeof data.limit_name === "string"
        ? data.limit_name
        : null;
  if (rl && isReviewLimitName(limitName)) {
    codeReview = codeReview ?? rl;
    primary = null;
    secondary = null;
  }

  if (!primary && !secondary && !codeReview) return null;
  return { primary, secondary, code_review: codeReview };
}

/**
 * Convert parsed rate-limit data to quota format for storage.
 * @param {object} rl - ParsedRateLimit
 * @param {string|null} planType
 * @returns {object} CodexQuota-compatible object
 */
export function rateLimitToQuota(rl, planType) {
  const primary = rl.primary;
  const secondary = rl.secondary;

  return {
    plan_type: planType ?? "unknown",
    rate_limit: {
      used_percent: primary?.used_percent ?? null,
      reset_at: primary?.reset_at ?? null,
      limit_window_seconds: primary?.window_minutes != null ? primary.window_minutes * 60 : null,
      allowed: true,
      limit_reached: (primary?.used_percent ?? 0) >= 100,
    },
    secondary_rate_limit: secondary
      ? {
          used_percent: secondary.used_percent,
          reset_at: secondary.reset_at,
          limit_window_seconds: secondary.window_minutes != null ? secondary.window_minutes * 60 : null,
          limit_reached: secondary.used_percent >= 100,
        }
      : null,
    code_review_rate_limit: rl.code_review
      ? {
          allowed: rl.code_review.allowed ?? true,
          limit_reached:
            rl.code_review.limit_reached ??
            (rl.code_review.primary?.used_percent ?? 0) >= 100,
          used_percent: rl.code_review.primary?.used_percent ?? null,
          reset_at: rl.code_review.primary?.reset_at ?? null,
          limit_window_seconds:
            rl.code_review.primary?.window_minutes != null
              ? rl.code_review.primary.window_minutes * 60
              : null,
        }
      : null,
  };
}

// ── Internal helpers ──────────────────────────────────────────────

function parseWindow(get, prefix) {
  const pctStr = get(`${prefix}-used-percent`);
  if (pctStr == null) return null;

  const pct = parseFloat(pctStr);
  if (!isFinite(pct)) return null;

  const winStr = get(`${prefix}-window-minutes`);
  const resetStr = get(`${prefix}-reset-at`);

  return {
    used_percent: pct,
    window_minutes: winStr ? parseInt(winStr, 10) || null : null,
    reset_at: resetStr ? parseInt(resetStr, 10) || null : null,
  };
}

function parseDetailsFromHeaders(get, prefix) {
  const primary = parseWindow(get, `${prefix}-primary`);
  const secondary = parseWindow(get, `${prefix}-secondary`);
  if (!primary && !secondary) return null;
  return { primary, secondary };
}

function parseDetailsFromObject(value) {
  if (!value || typeof value !== "object") return null;
  const primary = parseWindowFromObject(value.primary);
  const secondary = parseWindowFromObject(value.secondary);
  if (!primary && !secondary) return null;
  return {
    allowed: typeof value.allowed === "boolean" ? value.allowed : undefined,
    limit_reached: typeof value.limit_reached === "boolean" ? value.limit_reached : undefined,
    primary,
    secondary,
  };
}

function parseWindowFromObject(win) {
  if (!win || typeof win !== "object") return null;
  const pct = typeof win.used_percent === "number" ? win.used_percent : NaN;
  if (!isFinite(pct)) return null;

  return {
    used_percent: pct,
    window_minutes: typeof win.window_minutes === "number" ? win.window_minutes : null,
    reset_at: typeof win.reset_at === "number" ? win.reset_at : null,
  };
}

function isReviewLimitName(value) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  return normalized === "review" ||
    normalized === "code_review" ||
    normalized === "codex_review" ||
    normalized === "codex_code_review";
}
