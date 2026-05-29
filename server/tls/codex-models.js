/**
 * Codex model discovery — probes backend endpoints for available models.
 * JavaScript port of codex-proxy-dev/src/proxy/codex-models.ts
 */

import { getTransport } from "./transport.js";

const DEFAULT_BASE_URL = "https://api.openai.com/backend-api";
let _firstModelFetchLogged = false;

export async function fetchModels(headers, proxyUrl, apiConfig, injectedTransport) {
  const transport = injectedTransport ?? getTransport();
  const baseUrl = apiConfig?.base_url ?? DEFAULT_BASE_URL;
  const clientVersion = apiConfig?.app_version ?? "1.0.0";

  const endpoints = [
    `${baseUrl}/codex/models?client_version=${clientVersion}`,
    `${baseUrl}/models`,
    `${baseUrl}/sentinel/chat-requirements`,
  ];

  headers["Accept"] = "application/json";
  if (!transport.isImpersonate()) {
    headers["Accept-Encoding"] = "gzip, deflate";
  }

  for (const url of endpoints) {
    try {
      const result = await transport.get(url, headers, 15, proxyUrl);
      const parsed = JSON.parse(result.body);

      const sentinel = parsed.chat_models;
      const models = sentinel?.models ?? parsed.models ?? parsed.data ?? parsed.categories;
      if (Array.isArray(models) && models.length > 0) {
        console.log(`[CodexApi] getModels() found ${models.length} entries from ${url}`);
        if (!_firstModelFetchLogged) {
          console.log(`[CodexApi] Raw response keys: ${Object.keys(parsed).join(", ")}`);
          console.log(`[CodexApi] Raw model sample: ${JSON.stringify(models[0]).slice(0, 500)}`);
          if (models.length > 1) {
            console.log(`[CodexApi] Raw model sample[1]: ${JSON.stringify(models[1]).slice(0, 500)}`);
          }
          _firstModelFetchLogged = true;
        }
        // Flatten nested categories into a single list
        const flattened = [];
        for (const item of models) {
          if (item && typeof item === "object") {
            if (Array.isArray(item.models)) {
              for (const sub of item.models) {
                flattened.push(sub);
              }
            } else {
              flattened.push(item);
            }
          }
        }
        if (flattened.length > 0) {
          console.log(`[CodexApi] getModels() total after flatten: ${flattened.length} models`);
          return flattened;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[CodexApi] Probe ${url} failed: ${msg}`);
      continue;
    }
  }

  return null;
}

export async function probeEndpoint(path, headers, proxyUrl, baseUrl, injectedTransport) {
  const transport = injectedTransport ?? getTransport();
  const url = `${baseUrl ?? DEFAULT_BASE_URL}${path}`;

  headers["Accept"] = "application/json";
  if (!transport.isImpersonate()) {
    headers["Accept-Encoding"] = "gzip, deflate";
  }

  try {
    const result = await transport.get(url, headers, 15, proxyUrl);
    return JSON.parse(result.body);
  } catch {
    return null;
  }
}
