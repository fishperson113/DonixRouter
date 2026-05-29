// Re-export from open-sse with localDb integration
import {
  getModelAliases,
  getComboByName,
  getProviderNodes,
  getProviderConnections,
} from "#lib/localDb.js";
import { parseModel, resolveModelAliasFromMap, getModelInfoCore } from "#open-sse/services/model.js";
import { getModelsByProviderId } from "#shared/constants/models.js";

export { parseModel };

function isActiveConnection(connection) {
  return connection?.isActive !== false;
}

function codexSupportsModel(modelId) {
  if (typeof modelId !== "string" || !modelId.trim()) return false;
  return getModelsByProviderId("codex").some((entry) => {
    const upstreamModelId = entry?.upstreamModelId;
    return entry?.id === modelId || upstreamModelId === modelId;
  });
}

async function preferCodexWhenOpenAIUnavailable(modelInfo) {
  if (!modelInfo?.provider || modelInfo.provider !== "openai" || !modelInfo.model) {
    return modelInfo;
  }

  const connections = await getProviderConnections();
  const hasOpenAI = connections.some(
    (connection) => connection.provider === "openai" && isActiveConnection(connection),
  );
  if (hasOpenAI) return modelInfo;

  const hasCodex = connections.some(
    (connection) => connection.provider === "codex" && isActiveConnection(connection),
  );
  if (!hasCodex) return modelInfo;

  if (!codexSupportsModel(modelInfo.model)) return modelInfo;

  return {
    ...modelInfo,
    provider: "codex",
  };
}

async function preferGeminiCLIWhenGeminiUnavailable(modelInfo) {
  if (!modelInfo?.provider || modelInfo.provider !== "gemini" || !modelInfo.model) {
    return modelInfo;
  }

  const connections = await getProviderConnections();
  const hasGemini = connections.some(
    (connection) => connection.provider === "gemini" && isActiveConnection(connection),
  );
  if (hasGemini) return modelInfo;

  const hasGeminiCLI = connections.some(
    (connection) => connection.provider === "gemini-cli" && isActiveConnection(connection),
  );
  if (!hasGeminiCLI) return modelInfo;

  return {
    ...modelInfo,
    provider: "gemini-cli",
  };
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Always check provider-node prefix matching using original input first
    const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
    const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
    if (matchedOpenAI) {
      return { provider: matchedOpenAI.id, model: parsed.model };
    }

    const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
    const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
    if (matchedAnthropic) {
      return { provider: matchedAnthropic.id, model: parsed.model };
    }

    const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
    const matchedEmbedding = embeddingNodes.find((node) => node.prefix === parsed.providerAlias);
    if (matchedEmbedding) {
      return { provider: matchedEmbedding.id, model: parsed.model };
    }
    return await preferCodexWhenOpenAIUnavailable({
      provider: parsed.provider,
      model: parsed.model
    });
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  const resolved = await getModelInfoCore(modelStr, getModelAliases);
  const withGeminiFallback = await preferGeminiCLIWhenGeminiUnavailable(resolved);
  return preferCodexWhenOpenAIUnavailable(withGeminiFallback);
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
