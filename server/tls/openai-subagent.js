/**
 * OpenAI subagent header normalization.
 * JavaScript port of codex-proxy-dev/src/proxy/openai-subagent.ts
 */

export const OPENAI_SUBAGENT_HEADER = "x-openai-subagent";

const ALLOWED_OPENAI_SUBAGENTS = new Set([
  "review",
  "compact",
  "memory_consolidation",
  "collab_spawn",
]);

export function normalizeOpenAISubagent(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return ALLOWED_OPENAI_SUBAGENTS.has(trimmed) ? trimmed : null;
}

export function sanitizeClientMetadata(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") result[key] = raw;
  }
  return result;
}

export function extractOpenAISubagentFromMetadata(value) {
  return normalizeOpenAISubagent(sanitizeClientMetadata(value)[OPENAI_SUBAGENT_HEADER]);
}
