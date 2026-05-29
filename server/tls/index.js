/**
 * TLS module — aggregates all transport, proxy, and Codex API components.
 *
 * Usage:
 *   import { initTransport, getTransport, CodexApi, ProxyPool } from "#tls";
 */

export { initTransport, getTransport, getTransportInfo, resetTransport } from "./transport.js";
export { initProxy, getProxyUrl, resetProxyCache } from "./proxy.js";
export { isNativeAvailable, createNativeTransport } from "./native-transport.js";
export { CodexApi } from "./codex-api.js";
export { CodexApiError, PreviousResponseWebSocketError } from "./codex-types.js";
export { parseSSEBlock, parseSSEStream } from "./codex-sse.js";
export { fetchUsage } from "./codex-usage.js";
export { fetchModels, probeEndpoint } from "./codex-models.js";
export { ProxyPool } from "./proxy-pool.js";
export { staggerIfNeeded } from "./request-stagger.js";
export { normalizeOpenAISubagent, sanitizeClientMetadata, extractOpenAISubagentFromMetadata, OPENAI_SUBAGENT_HEADER } from "./openai-subagent.js";
