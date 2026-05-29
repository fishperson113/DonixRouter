/**
 * Stable conversation key — derives a deterministic conversation identifier
 * from the request's model + instructions + first user message.
 * Adapted from codex-proxy's stable-conversation-key.ts.
 *
 * Used when the client doesn't provide an explicit prompt_cache_key,
 * allowing the proxy to correlate turns from the same conversation
 * even across different request payloads.
 */

import { createHash } from "crypto";

const LEADING_SYSTEM_REMINDER_RE = /^(?:<system-reminder>[\s\S]*?<\/system-reminder>\s*)+/i;

function normalizeConversationAnchorText(text) {
  return text.replace(LEADING_SYSTEM_REMINDER_RE, "").trimStart();
}

/**
 * Extract the stable seed components from a Codex request.
 * @param {object} req - Codex request body
 * @returns {{ instructions: string, firstUserText: string }}
 */
export function extractStableConversationSeed(req) {
  const instructions = (req.instructions ?? "").slice(0, 2000);
  const input = Array.isArray(req.input) ? req.input : [];

  let firstUserText = "";
  for (const item of input) {
    if (!item || !("role" in item) || item.role !== "user") continue;
    const content = item.content;
    if (typeof content === "string") {
      firstUserText = content;
    } else if (Array.isArray(content)) {
      firstUserText = content
        .filter(part => part && typeof part === "object" && part.type === "input_text" && typeof part.text === "string")
        .map(part => part.text)
        .join("");
    }
    break;
  }

  const normalizedFirstUserText = normalizeConversationAnchorText(firstUserText);
  return {
    instructions,
    firstUserText: normalizedFirstUserText || firstUserText,
  };
}

/**
 * Derive a stable conversation key (UUID-shaped hash) from a request.
 * Returns null if there's no meaningful seed data.
 * @param {object} req - Codex request body
 * @returns {string|null}
 */
export function deriveStableConversationKey(req) {
  const { instructions, firstUserText } = extractStableConversationSeed(req);
  const model = req.model ?? "";
  if (!instructions && !firstUserText) return null;

  const seed = `${model}\x00${instructions}\x00${firstUserText}`;
  const hash = createHash("sha256").update(seed).digest("hex");

  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
