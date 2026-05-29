/**
 * Proxy session helpers — implicit resume evaluation, continuation detection,
 * and prompt cache identity resolution.
 * Adapted from codex-proxy's proxy-session-helpers.ts.
 */

import { randomUUID } from "crypto";
import { deriveStableConversationKey } from "./stableConversationKey.js";

/** Upper bound on how stale an implicit-resume previous_response_id may be.
 *  Must stay in sync with DEFAULT_POOL_CONFIG.maxAgeMs (3_300_000 ms) in wsPool.js */
export const IMPLICIT_RESUME_MAX_AGE_MS = 55 * 60 * 1000;

export function normalizeInstructions(instructions) {
  return instructions ?? "";
}

function nonEmptyString(value) {
  const trimmed = value?.trim?.();
  return trimmed ? trimmed : null;
}

/**
 * Resolve prompt cache identity from request + client hints.
 * Priority: explicit prompt_cache_key > client session > content hash > random.
 * @param {object} codexRequest
 * @param {string} [clientConversationId]
 * @returns {{ promptCacheKey: string, conversationId: string, explicitPromptCacheKey: string|null, clientConversationId: string|null, derivedConversationId: string|null }}
 */
export function resolvePromptCacheIdentity(codexRequest, clientConversationId) {
  const explicitPromptCacheKey = nonEmptyString(codexRequest.prompt_cache_key);
  const normalizedClientConversationId = nonEmptyString(clientConversationId);
  const derivedConversationId = deriveStableConversationKey(codexRequest);
  const promptCacheKey =
    explicitPromptCacheKey ??
    normalizedClientConversationId ??
    derivedConversationId ??
    randomUUID();

  return {
    promptCacheKey,
    conversationId: promptCacheKey,
    explicitPromptCacheKey,
    clientConversationId: normalizedClientConversationId,
    derivedConversationId,
  };
}

/**
 * Build a variant-isolation identity string for computeVariantHash().
 *
 * Combines (a) Codex window id (when client supplies x-codex-window-id) and
 * (b) the derived conversation anchor when the client also gave us an
 * explicit prompt_cache_key or session id. Anchoring on the first user
 * message under those scopes lets sub-agents and parallel tool calls run
 * under the same session-id without sharing prev_response_id chains.
 *
 * Returns null when no identity components are present (caller falls back
 * to instructions+tools-only hashing).
 *
 * @param {object} codexRequest - request body (may carry codexWindowId)
 * @param {{explicitPromptCacheKey: string|null, clientConversationId: string|null, derivedConversationId: string|null}} identity
 * @returns {string|null}
 */
export function buildVariantIdentity(codexRequest, identity) {
  const parts = [];
  const windowId = nonEmptyString(codexRequest?.codexWindowId);
  if (windowId) parts.push(`window:${windowId}`);
  if ((identity?.explicitPromptCacheKey || identity?.clientConversationId) && identity?.derivedConversationId) {
    parts.push(`anchor:${identity.derivedConversationId}`);
  }
  return parts.length > 0 ? parts.join("\x00") : null;
}

/**
 * Evaluate whether implicit resume should activate.
 * @param {object} opts
 * @param {string|null} opts.implicitPrevRespId
 * @param {number} opts.continuationInputStart
 * @param {number} opts.inputLength
 * @param {string|null} opts.preferredEntryId
 * @param {string} opts.acquiredEntryId
 * @param {string|null} opts.currentInstructions
 * @param {string|null} opts.storedInstructions
 * @param {string[]} [opts.requiredFunctionCallOutputIds]
 * @param {string[]} [opts.storedFunctionCallIds]
 * @returns {{ active: boolean, reason: string|null, missingCallIds?: string[], unansweredCallIds?: string[] }}
 */
export function evaluateImplicitResume(opts) {
  if (!opts.implicitPrevRespId) return { active: false, reason: "no_implicit_prev" };
  if (opts.continuationInputStart >= opts.inputLength) {
    return { active: false, reason: "cont_start_eq_len" };
  }
  if (!opts.preferredEntryId) return { active: false, reason: "no_pref_entry" };
  if (opts.acquiredEntryId !== opts.preferredEntryId) {
    return { active: false, reason: "acct_mismatch" };
  }
  if (normalizeInstructions(opts.currentInstructions) !== normalizeInstructions(opts.storedInstructions)) {
    return { active: false, reason: "instr_diff" };
  }
  const storedFunctionCallIds = new Set(opts.storedFunctionCallIds ?? []);
  const requiredFunctionCallOutputIds = opts.requiredFunctionCallOutputIds ?? [];
  const missingCallIds = requiredFunctionCallOutputIds.filter(id => !storedFunctionCallIds.has(id));
  if (missingCallIds.length > 0) {
    return { active: false, reason: "missing_tool_calls", missingCallIds };
  }
  const requiredSet = new Set(requiredFunctionCallOutputIds);
  const unansweredCallIds = [...storedFunctionCallIds].filter(id => !requiredSet.has(id));
  if (unansweredCallIds.length > 0) {
    return { active: false, reason: "unanswered_tool_calls", unansweredCallIds };
  }
  return { active: true, reason: null };
}

/**
 * Find the index of the first "new" input item (after the last model output).
 * Used to detect continuation vs fresh turn.
 * @param {Array} input
 * @returns {number}
 */
export function getContinuationInputStartIndex(input) {
  if (!Array.isArray(input)) return 0;
  let lastModelOutputIndex = -1;
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (item && "role" in item) {
      if (item.role === "assistant") lastModelOutputIndex = i;
      continue;
    }
    if (item?.type === "function_call") {
      lastModelOutputIndex = i;
    }
  }
  return lastModelOutputIndex >= 0 ? lastModelOutputIndex + 1 : 0;
}

/**
 * Extract function_call_output call_ids from input.
 * @param {Array} input
 * @returns {string[]}
 */
export function getFunctionCallOutputIds(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter(item => item && !("role" in item) && item.type === "function_call_output" && item.call_id)
    .map(item => item.call_id);
}
