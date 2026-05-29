import { buildVariantIdentity, resolvePromptCacheIdentity } from "./proxySessionHelpers.js";
import { computeVariantHash } from "./variantHash.js";

export function buildCodexPoolKey({ connectionId, conversationId, codexRequest, clientConversationId = null }) {
  if (!connectionId || !conversationId) {
    return { poolKey: null, variantHash: null };
  }

  const identity = resolvePromptCacheIdentity(codexRequest, clientConversationId);
  const variantIdentity = buildVariantIdentity(codexRequest, identity);
  const variantHash = computeVariantHash(codexRequest.instructions, codexRequest.tools, variantIdentity);

  return {
    poolKey: `${connectionId}:${conversationId}:${variantHash}`,
    variantHash,
  };
}
