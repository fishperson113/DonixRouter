/**
 * Session affinity — maps response IDs to connection IDs.
 * Adapted from codex-proxy's session-affinity.ts.
 *
 * When a request includes `previous_response_id`, the proxy looks up which
 * connection created that response and routes to the same connection. This enables:
 *   - Server-side conversation history reuse (previous_response_id chain)
 *   - Prompt cache hits (cache is per-account on the backend)
 */

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

class SessionAffinityMap {
  constructor(ttlMs = DEFAULT_TTL_MS) {
    /** @type {Map<string, AffinityEntry>} */
    this._map = new Map();
    this._ttlMs = ttlMs;
    this._cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
  }

  /**
   * Record that a response was created by a specific connection in a conversation.
   * @param {string} responseId
   * @param {string} connectionId
   * @param {string} conversationId
   * @param {object} [meta] - Optional metadata
   * @param {string} [meta.turnState]
   * @param {string} [meta.instructions]
   * @param {number} [meta.inputTokens]
   * @param {string[]} [meta.functionCallIds]
   * @param {string} [meta.variantHash]
   */
  record(responseId, connectionId, conversationId, meta = {}) {
    this._map.set(responseId, {
      connectionId,
      conversationId,
      turnState: meta.turnState || null,
      instructions: meta.instructions || null,
      inputTokens: meta.inputTokens || null,
      functionCallIds: meta.functionCallIds ? [...meta.functionCallIds] : null,
      variantHash: meta.variantHash || null,
      createdAt: Date.now(),
    });
  }

  /**
   * Look up which connection created a given response.
   * @param {string} responseId
   * @returns {string|null}
   */
  lookup(responseId) {
    const entry = this._getEntry(responseId);
    return entry?.connectionId ?? null;
  }

  /**
   * Look up the conversation ID for a given response.
   * @param {string} responseId
   * @returns {string|null}
   */
  lookupConversationId(responseId) {
    const entry = this._getEntry(responseId);
    return entry?.conversationId ?? null;
  }

  /**
   * Look up the latest response ID recorded for a conversation.
   * @param {string} conversationId
   * @param {number} [maxAgeMs] - Skip entries older than this
   * @param {string} [variantHash] - Only match entries with this variant hash
   * @returns {string|null}
   */
  lookupLatestResponseIdByConversationId(conversationId, maxAgeMs, variantHash) {
    const now = Date.now();
    let latestResponseId = null;
    let latestCreatedAt = -1;
    for (const [responseId, entry] of this._map) {
      if (entry.conversationId !== conversationId) continue;
      if (variantHash !== undefined && entry.variantHash !== variantHash) continue;
      const liveEntry = this._getEntry(responseId);
      if (!liveEntry) continue;
      if (maxAgeMs !== undefined && now - liveEntry.createdAt > maxAgeMs) continue;
      if (liveEntry.createdAt >= latestCreatedAt) {
        latestCreatedAt = liveEntry.createdAt;
        latestResponseId = responseId;
      }
    }
    return latestResponseId;
  }

  /**
   * Look up the upstream turn-state token for a given response.
   * @param {string} responseId
   * @returns {string|null}
   */
  lookupTurnState(responseId) {
    const entry = this._getEntry(responseId);
    return entry?.turnState ?? null;
  }

  /**
   * Look up instructions for a given response.
   * @param {string} responseId
   * @returns {string|null}
   */
  lookupInstructions(responseId) {
    const entry = this._getEntry(responseId);
    return entry?.instructions ?? null;
  }

  /**
   * Look up the latest instructions by conversation.
   * @param {string} conversationId
   * @returns {string|null}
   */
  lookupLatestInstructionsByConversationId(conversationId) {
    const responseId = this.lookupLatestResponseIdByConversationId(conversationId);
    if (!responseId) return null;
    return this.lookupInstructions(responseId);
  }

  /**
   * Look up input tokens for a given response.
   * @param {string} responseId
   * @returns {number|null}
   */
  lookupInputTokens(responseId) {
    const entry = this._getEntry(responseId);
    return entry?.inputTokens ?? null;
  }

  /**
   * Look up function call IDs for a given response.
   * @param {string} responseId
   * @returns {string[]}
   */
  lookupFunctionCallIds(responseId) {
    const entry = this._getEntry(responseId);
    return entry?.functionCallIds ? [...entry.functionCallIds] : [];
  }

  /**
   * Drop a response ID — called after upstream rejects it as not-found.
   * @param {string} responseId
   */
  forget(responseId) {
    this._map.delete(responseId);
  }

  /** @returns {number} */
  get size() {
    return this._map.size;
  }

  dispose() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this._map.clear();
  }

  // --- Private ---

  _getEntry(responseId) {
    const entry = this._map.get(responseId);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this._ttlMs) {
      this._map.delete(responseId);
      return null;
    }
    return entry;
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, entry] of this._map) {
      if (now - entry.createdAt > this._ttlMs) {
        this._map.delete(key);
      }
    }
  }
}

/** Singleton instance. */
let instance = null;

export function getSessionAffinityMap() {
  if (!instance) {
    instance = new SessionAffinityMap();
  }
  return instance;
}

export { SessionAffinityMap };
