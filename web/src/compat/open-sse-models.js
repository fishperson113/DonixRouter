// Browser-safe shim: fetches model data from API and builds PROVIDER_MODELS map
// The API returns { models: [{ provider, model, name, fullModel, alias, ... }] }

export const PROVIDER_MODELS = {};
export const PROVIDER_ID_TO_ALIAS = {};

let _loaded = false;
let _loadPromise = null;

export function ensureModelsLoaded() {
  if (_loaded) return Promise.resolve();
  if (_loadPromise) return _loadPromise;
  _loadPromise = fetch("/api/models")
    .then(r => r.json())
    .then(data => {
      if (Array.isArray(data.models)) {
        // Group flat array into { alias: [{ id, name, ... }] }
        for (const m of data.models) {
          const alias = m.provider || m.alias;
          if (!alias) continue;
          if (!PROVIDER_MODELS[alias]) PROVIDER_MODELS[alias] = [];
          PROVIDER_MODELS[alias].push({
            id: m.model || m.id,
            name: m.name,
            upstreamModelId: m.upstreamModelId,
            targetFormat: m.targetFormat,
            quotaFamily: m.quotaFamily,
            type: m.type,
            strip: m.strip,
          });
        }
      } else if (data.models && typeof data.models === "object") {
        // Already grouped: { alias: [...] }
        Object.assign(PROVIDER_MODELS, data.models);
      }

      // Build PROVIDER_ID_TO_ALIAS from known OAuth aliases
      const OAUTH_ALIASES = {
        claude: "cc", codex: "cx", "gemini-cli": "gc", qwen: "qw",
        iflow: "if", antigravity: "ag", github: "gh", kiro: "kr",
        cursor: "cu", "kimi-coding": "kmc", kilocode: "kc", cline: "cl",
        opencode: "oc", vertex: "vertex", "vertex-partner": "vertex-partner",
      };
      // For each alias group, map providerId → alias
      for (const [providerId, alias] of Object.entries(OAUTH_ALIASES)) {
        PROVIDER_ID_TO_ALIAS[providerId] = alias;
      }
      // Also add API key providers (alias = id)
      for (const alias of Object.keys(PROVIDER_MODELS)) {
        if (!Object.values(PROVIDER_ID_TO_ALIAS).includes(alias)) {
          PROVIDER_ID_TO_ALIAS[alias] = alias;
        }
      }
      _loaded = true;
    })
    .catch(err => {
      console.error("Failed to load models:", err);
      _loaded = true; // Don't retry forever
    });
  return _loadPromise;
}

export function getProviderModels(aliasOrId) {
  return PROVIDER_MODELS[aliasOrId] || [];
}

export function getDefaultModel(aliasOrId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return models?.[0]?.id || null;
}

export function isValidModel(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return false;
  return models.some(m => m.id === modelId);
}

export function findModelName(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return modelId;
  const found = models.find(m => m.id === modelId);
  return found?.name || modelId;
}

export function getModelTargetFormat(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = models.find(m => m.id === modelId);
  return found?.targetFormat || null;
}

export function getModelStrip(alias, modelId) {
  const entry = PROVIDER_MODELS[alias]?.find(m => m.id === modelId);
  return entry?.strip || [];
}

export function getModelsByProviderId(providerId) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return PROVIDER_MODELS[alias] || [];
}

export function getModelUpstreamId(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  const found = models?.find(m => m.id === modelId);
  return found?.upstreamModelId || modelId;
}

export function getModelQuotaFamily(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  const found = models?.find(m => m.id === modelId);
  return found?.quotaFamily || "normal";
}

export function buildTtsProviderModels() { return {}; }

// Auto-load on import
ensureModelsLoaded();
