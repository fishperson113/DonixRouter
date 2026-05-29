import { createHash } from "crypto";

/**
 * Short fingerprint of a request's "shape" — instructions + tools — used to
 * isolate concurrent variants within the same client conversation.
 * Adapted from codex-proxy's variant-hash.ts.
 *
 * Why: Claude Code (and other Anthropic clients) issue sub-agent / parallel
 * tool calls under the same session. They share a conversation id but use
 * different system prompts and tool sets, so they belong on independent
 * prev_response_id chains — otherwise sub-agents get cold starts every turn.
 *
 * The hash is deterministic over byte-stable inputs (same instructions + same
 * tools array + same optional identity → same hash). 12 hex chars = 48 bits,
 * ample to avoid collisions within a single conversation.
 *
 * @param {string|null|undefined} instructions
 * @param {Array|null|undefined} tools
 * @param {string|null|undefined} [identity]
 * @returns {string} 12-char hex hash
 */
export function computeVariantHash(instructions, tools, identity = null) {
  const instr = instructions ?? "";
  // NOTE: tool order matters by design — same set in different order yields
  // different hashes. Upstream prompt cache hits on byte-stable prefixes, so
  // tool reordering is a real cache miss.
  const toolsJson = JSON.stringify(tools ?? []);
  const hash = createHash("sha256")
    .update(instr)
    .update("\x00")
    .update(toolsJson);
  if (identity?.trim()) {
    hash
      .update("\x00")
      .update(identity.trim());
  }
  return hash
    .digest("hex")
    .slice(0, 12);
}
