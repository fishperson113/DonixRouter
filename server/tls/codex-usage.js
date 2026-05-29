/**
 * Codex usage/quota API query.
 * JavaScript port of codex-proxy-dev/src/proxy/codex-usage.ts
 */

import { getTransport } from "./transport.js";
import { CodexApiError } from "./codex-types.js";

const DEFAULT_BASE_URL = "https://api.openai.com/backend-api";

function usageUrls(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.includes("/backend-api")) {
    return [`${trimmed}/wham/usage`, `${trimmed}/codex/usage`];
  }
  return [`${trimmed}/api/codex/usage`, `${trimmed}/codex/usage`];
}

export async function fetchUsage(headers, proxyUrl, baseUrl, injectedTransport) {
  const resolvedBaseUrl = baseUrl ?? DEFAULT_BASE_URL;
  const transport = injectedTransport ?? getTransport();

  headers["Accept"] = "application/json";
  if (!transport.isImpersonate()) {
    headers["Accept-Encoding"] = "gzip, deflate";
  }

  let lastBody = "";
  let lastError = null;
  for (const url of usageUrls(resolvedBaseUrl)) {
    let body;
    try {
      const result = await transport.get(url, headers, 15, proxyUrl);
      body = result.body;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }
    lastBody = body;

    try {
      const parsed = JSON.parse(body);
      if (!parsed.rate_limit) {
        lastError = `Unexpected response from ${url}: ${body.slice(0, 200)}`;
        continue;
      }
      return parsed;
    } catch (e) {
      if (e instanceof CodexApiError) throw e;
      lastError = `Invalid JSON from ${url}: ${body.slice(0, 200)}`;
    }
  }

  if (lastBody) throw new CodexApiError(502, lastError ?? `Invalid usage response: ${lastBody.slice(0, 200)}`);
  throw new CodexApiError(0, `transport GET failed: ${lastError ?? "unknown error"}`);
}
