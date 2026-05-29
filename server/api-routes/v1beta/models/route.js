import { getModelsByProviderId } from "#shared/constants/models.js";
import { getProviderConnections } from "#lib/localDb.js";
import { GEMINI_CONFIG } from "#lib/oauth/constants/oauth.js";
import { refreshGoogleToken, updateProviderCredentials } from "#sse/services/tokenRefresh.js";

const GEMINI_CLI_MODELS_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
const GEMINI_CLI_SAFE_MODEL_IDS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
]);
const GEMINI_MODEL_ORDER = new Map([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-3-pro-preview",
  "gemini-2.0-flash",
].map((modelId, index) => [modelId, index]));

function isGeminiCLIRequest(request) {
  const userAgent = (request.headers.get("user-agent") || "").toLowerCase();
  return userAgent.includes("gemini-cli")
    || userAgent.includes("geminicli")
    || userAgent.includes("proxy_client=geminicli");
}

function compareGeminiModels(a, b) {
  const rankA = GEMINI_MODEL_ORDER.get(a?.id) ?? Number.POSITIVE_INFINITY;
  const rankB = GEMINI_MODEL_ORDER.get(b?.id) ?? Number.POSITIVE_INFINITY;
  if (rankA !== rankB) return rankA - rankB;
  return (a?.name || a?.id || "").localeCompare(b?.name || b?.id || "");
}

function parseGeminiCliModels(data) {
  if (Array.isArray(data?.models)) {
    return data.models
      .map((item) => {
        const id = item?.id || item?.model || item?.name;
        if (!id) return null;
        return { id, name: item?.displayName || item?.name || id };
      })
      .filter(Boolean);
  }

  if (data?.models && typeof data.models === "object") {
    return Object.entries(data.models)
      .filter(([, info]) => !info?.isInternal)
      .map(([id, info]) => ({
        id,
        name: info?.displayName || info?.name || id,
      }));
  }

  return [];
}

function toGeminiModelEntry(model) {
  return {
    name: `models/${model.id}`,
    displayName: model.name || model.id,
    description: model.name || model.id,
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    inputTokenLimit: 128000,
    outputTokenLimit: 8192,
  };
}

function buildGeminiModels(candidateModels) {
  const models = [];
  const seen = new Set();

  for (const model of [...candidateModels].sort(compareGeminiModels)) {
    if ((model.type || "llm") !== "llm") continue;
    if (!model.id || seen.has(model.id)) continue;

    seen.add(model.id);
    models.push(toGeminiModelEntry(model));
  }

  return models;
}

function getStaticGeminiCliModels() {
  return getModelsByProviderId("gemini-cli")
    .filter((model) => (model.type || "llm") === "llm")
    .filter((model) => GEMINI_CLI_SAFE_MODEL_IDS.has(model.id));
}

async function fetchGeminiCliModelsFromConnection(connection) {
  const accessToken = connection?.accessToken;
  const refreshToken = connection?.refreshToken;
  if (!accessToken) return [];

  const projectId = connection.projectId || connection.providerSpecificData?.projectId;
  const body = projectId ? { project: projectId } : {};

  const fetchModels = async (token) => {
    const response = await fetch(GEMINI_CLI_MODELS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "google-api-nodejs-client/9.15.1",
        "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
      },
      body: JSON.stringify(body),
    });
    return response;
  };

  let response = await fetchModels(accessToken);

  if (!response.ok && (response.status === 401 || response.status === 403) && refreshToken) {
    const refreshed = await refreshGoogleToken(refreshToken, GEMINI_CONFIG.clientId, GEMINI_CONFIG.clientSecret);
    if (refreshed?.accessToken) {
      await updateProviderCredentials(connection.id, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || refreshToken,
        expiresIn: refreshed.expiresIn,
      });
      response = await fetchModels(refreshed.accessToken);
    }
  }

  if (!response.ok) return [];

  const data = await response.json();
  return parseGeminiCliModels(data);
}

async function getGeminiCliModelsForListing() {
  try {
    const connections = await getProviderConnections({ provider: "gemini-cli", isActive: true });
    for (const connection of connections) {
      const models = await fetchGeminiCliModelsFromConnection(connection);
      if (models.length > 0) {
        return models;
      }
    }
  } catch (error) {
    console.log("Error fetching Gemini CLI dynamic models:", error);
  }

  return getStaticGeminiCliModels();
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET(request) {
  try {
    const candidateModels = isGeminiCLIRequest(request)
      ? await getGeminiCliModelsForListing()
      : [
          ...getStaticGeminiCliModels(),
          ...getModelsByProviderId("gemini"),
        ];

    return Response.json({ models: buildGeminiModels(candidateModels) });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json({ error: { message: error.message } }, { status: 500 });
  }
}
