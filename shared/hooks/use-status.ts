import { useEffect, useMemo, useState } from "preact/hooks";
import {
  useDashboardLiveSelector,
  type CatalogModel as DashboardCatalogModel,
} from "./dashboard-live-store";

export type CatalogModel = DashboardCatalogModel;

export interface ModelFamily {
  id: string;
  displayName: string;
  efforts: { reasoningEffort: string; description: string }[];
  defaultEffort: string;
}

/**
 * Extract model family ID from a model ID.
 * gpt-5.3-codex-high -> gpt-5.3-codex
 * gpt-5.3-codex-spark -> gpt-5.3-codex-spark
 * gpt-5.4 -> gpt-5.4
 */
function getFamilyId(id: string): string {
  if (/^gpt-\d+(?:\.\d+)?$/.test(id)) return id;
  if (/^gpt-\d+(?:\.\d+)?-codex-spark$/.test(id)) return id;
  if (/^gpt-\d+(?:\.\d+)?-codex-mini$/.test(id)) return id;

  const tierVariant = id.match(/^(gpt-\d+(?:\.\d+)?-codex)(?:-(?:high|mid|low|max))?$/);
  if (tierVariant) return tierVariant[1];

  const legacy = id.match(/^(gpt-\d+-codex)(?:-(?:high|mid|low|max|mini))?$/);
  if (legacy) return legacy[1];

  return id;
}

function isTierVariant(id: string): boolean {
  return /^gpt-\d+(?:\.\d+)?-codex-(?:high|mid|low|max)$/.test(id);
}

export function useStatus() {
  const accountsState = useDashboardLiveSelector((state) => state.accounts);
  const modelsState = useDashboardLiveSelector((state) => state.models);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedEffort, setSelectedEffort] = useState("medium");
  const [selectedSpeed, setSelectedSpeed] = useState<string | null>(null);

  const models = modelsState?.models ?? [];
  const modelCatalog = modelsState?.modelCatalog ?? [];

  useEffect(() => {
    if (models.length === 0) return;
    setSelectedModel((prev) => {
      if (prev && models.includes(prev)) return prev;
      return modelCatalog.find((model) => model.isDefault)?.id ?? models[0] ?? "";
    });
  }, [modelCatalog, models]);

  const modelFamilies = useMemo((): ModelFamily[] => {
    if (modelCatalog.length === 0) return [];

    const familyMap = new Map<string, ModelFamily>();
    for (const model of modelCatalog) {
      if (isTierVariant(model.id)) continue;
      const familyId = getFamilyId(model.id);
      if (familyMap.has(familyId)) continue;

      familyMap.set(familyId, {
        id: familyId,
        displayName: model.displayName,
        efforts: model.supportedReasoningEfforts,
        defaultEffort: model.defaultReasoningEffort,
      });
    }

    return [...familyMap.values()];
  }, [modelCatalog]);

  useEffect(() => {
    const currentFamily = modelFamilies.find((family) => family.id === selectedModel);
    if (!currentFamily) return;
    const supportedEfforts = currentFamily.efforts.map((effort) => effort.reasoningEffort);
    if (supportedEfforts.includes(selectedEffort)) return;
    setSelectedEffort(currentFamily.defaultEffort);
  }, [modelFamilies, selectedEffort, selectedModel]);

  const authenticated = accountsState?.authenticated === true;
  const baseUrl =
    authenticated && typeof window !== "undefined"
      ? `${window.location.origin}/v1`
      : "Loading...";
  const apiKey = authenticated ? (accountsState?.proxy_api_key || "any-string") : "Loading...";

  return {
    baseUrl,
    apiKey,
    models,
    selectedModel,
    setSelectedModel,
    selectedEffort,
    setSelectedEffort,
    selectedSpeed,
    setSelectedSpeed,
    modelFamilies,
    modelCatalog,
  };
}
