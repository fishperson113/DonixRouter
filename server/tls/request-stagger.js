/**
 * Request staggering — adds random delay between upstream requests
 * to avoid burst patterns that trigger rate limiting.
 * JavaScript port of codex-proxy-dev/src/routes/shared/proxy-stagger.ts
 */

/**
 * Generate a jittered integer from a base value.
 * @param {number} baseMs - Base delay in ms
 * @param {number} ratio - Jitter ratio (0.0 to 1.0)
 * @returns {number} Jittered value
 */
function jitterInt(baseMs, ratio) {
  const jitter = Math.floor(baseMs * ratio * (Math.random() * 2 - 1));
  return Math.max(0, baseMs + jitter);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sleep if this account had a recent request, to stagger upstream traffic.
 * @param {number|null} prevSlotMs - Timestamp (ms) of previous request on this account
 * @param {object} [opts] - Optional overrides
 * @param {number|null} [opts.intervalMs] - Target interval between requests (null = disabled)
 */
export async function staggerIfNeeded(prevSlotMs, opts = {}) {
  const intervalMs = opts.intervalMs ?? null;
  if (!intervalMs || prevSlotMs == null) return;
  const elapsed = Date.now() - prevSlotMs;
  const target = jitterInt(intervalMs, 0.3);
  const wait = target - elapsed;
  if (wait > 0) await sleep(wait);
}
