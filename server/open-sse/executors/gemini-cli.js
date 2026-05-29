import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, GEMINI_CLI_API_CLIENT, geminiCLIUserAgent } from "../config/appConstants.js";
import { getModelUpstreamId } from "../config/providerModels.js";

const GEMINI_CLI_MODEL_FALLBACKS = {
  "gemini-2.5-flash-lite": "gemini-2.5-flash",
  "gemini-3-flash-preview": "gemini-2.5-flash",
  "gemini-3.1-flash-lite-preview": "gemini-2.5-flash",
  "gemini-3-pro-preview": "gemini-2.5-pro",
  "gemini-3.1-pro-preview": "gemini-2.5-pro",
};

function normalizeGeminiCLIModel(model) {
  let normalized = getModelUpstreamId("gc", model);

  // Gemini CLI OAuth does not expose the API-key-only "-customtools" variants.
  if (typeof normalized === "string" && normalized.endsWith("-customtools")) {
    normalized = normalized.slice(0, -"-customtools".length);
  }

  return normalized;
}

function getGeminiCLIFallbackModel(model) {
  const normalized = normalizeGeminiCLIModel(model);
  return GEMINI_CLI_MODEL_FALLBACKS[normalized] || null;
}

function shouldRetryGeminiCLIModel(status, errorText) {
  if (status === 404) return true;
  if (status === 429) {
    const lower429 = (errorText || "").toLowerCase();
    return lower429.includes("resource_exhausted")
      || lower429.includes("model_capacity_exhausted")
      || lower429.includes("no capacity available")
      || lower429.includes("quota exceeded");
  }
  if (status !== 400 && status !== 403) return false;
  if (!errorText && status === 403) return true;
  const lower = (errorText || "").toLowerCase();
  return lower.includes("not found")
    || lower.includes("preview release")
    || lower.includes("don't have access")
    || lower.includes("disabled the access")
    || lower.includes("not available")
    || lower.includes("unsupported");
}

export class GeminiCLIExecutor extends BaseExecutor {
  constructor() {
    super("gemini-cli", PROVIDERS["gemini-cli"]);
  }

  async execute(options) {
    let currentModel = options.model;
    const attemptedModels = new Set();

    while (true) {
      const result = await super.execute({ ...options, model: currentModel });
      if (result.response.ok) {
        return result;
      }

      const fallbackModel = getGeminiCLIFallbackModel(currentModel);
      if (!fallbackModel || fallbackModel === currentModel || attemptedModels.has(fallbackModel)) {
        return result;
      }

      let errorText = "";
      if (typeof result.response?.clone === "function") {
        errorText = await result.response.clone().text().catch(() => "");
      }
      if (!shouldRetryGeminiCLIModel(result.response.status, errorText)) {
        return result;
      }

      options.log?.warn?.(
        "GEMINI",
        `Gemini CLI model ${normalizeGeminiCLIModel(currentModel)} unavailable (${result.response.status}), retrying with ${fallbackModel}`
      );

      attemptedModels.add(currentModel);
      currentModel = fallbackModel;
    }
  }

  buildUrl(model, stream, urlIndex = 0) {
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${this.config.baseUrl}:${action}`;
  }

  buildHeaders(credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.accessToken}`,
      "User-Agent": geminiCLIUserAgent(this._currentModel),
      "X-Goog-Api-Client": GEMINI_CLI_API_CLIENT,
      "Accept": stream ? "text/event-stream" : "application/json"
    };
  }

  transformRequest(model, body, stream, credentials) {
    const upstreamModel = normalizeGeminiCLIModel(model);
    // Store model for use in buildHeaders (called by base.execute after transformRequest)
    this._currentModel = upstreamModel;
    body.model = upstreamModel;
    if (!body.project && credentials?.projectId) {
      body.project = credentials.projectId;
    }
    return body;
  }

  async refreshCredentials(credentials, log) {
    if (!credentials.refreshToken) return null;

    try {
      const response = await fetch(OAUTH_ENDPOINTS.google.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        })
      });

      if (!response.ok) return null;

      const tokens = await response.json();
      log?.info?.("TOKEN", "Gemini CLI refreshed");

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId
      };
    } catch (error) {
      log?.error?.("TOKEN", `Gemini CLI refresh error: ${error.message}`);
      return null;
    }
  }
}

export default GeminiCLIExecutor;
