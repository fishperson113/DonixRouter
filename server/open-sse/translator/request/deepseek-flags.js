/**
 * Resolve search_enabled and thinking_enabled flags for DeepSeek Web API.
 *
 * Heuristics:
 * 1. Explicit body params (search_enabled, thinking_enabled) take priority.
 * 2. Model name containing "search" or "coi" → search enabled.
 * 3. Model name "deepseek_reasoner" or containing "think" → thinking enabled.
 * 4. If client sends tools containing web_search → search enabled.
 */
export function resolveDeepSeekFlags(model, body) {
  const modelLower = (model || "").toLowerCase();

  // Explicit overrides from body
  let searchEnabled = body?.search_enabled;
  let thinkingEnabled = body?.thinking_enabled;

  // Derive from model name if not explicitly set
  if (searchEnabled === undefined) {
    searchEnabled =
      modelLower.includes("search") ||
      modelLower.includes("coi") ||
      hasWebSearchTool(body);
  }

  if (thinkingEnabled === undefined) {
    thinkingEnabled =
      modelLower.includes("reasoner") ||
      modelLower.includes("think") ||
      modelLower.includes("reason");
  }

  return {
    searchEnabled: Boolean(searchEnabled),
    thinkingEnabled: Boolean(thinkingEnabled),
  };
}

/**
 * Strip virtual suffixes (_search, _coi) from model name to get the real
 * model_class that DeepSeek API recognizes (deepseek_chat or deepseek_reasoner).
 */
export function resolveDeepSeekModelClass(model) {
  if (!model) return "deepseek_chat";
  // Strip known virtual suffixes
  const cleaned = model
    .replace(/_search$/i, "")
    .replace(/_coi$/i, "");
  // Validate known model classes
  if (cleaned === "deepseek_reasoner") return "deepseek_reasoner";
  return "deepseek_chat";
}

/**
 * Check if the request body contains a web_search tool definition,
 * which signals the client wants search enabled.
 */
function hasWebSearchTool(body) {
  const tools = body?.tools;
  if (!Array.isArray(tools)) {
    return false;
  }
  return tools.some(
    (t) =>
      t?.type === "web_search" ||
      t?.function?.name === "web_search" ||
      t?.function?.name === "$web_search"
  );
}
