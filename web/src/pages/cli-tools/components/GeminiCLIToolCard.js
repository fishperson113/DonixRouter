"use client";

import { useState, useEffect } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

const CLOUD_URL = import.meta.env.VITE_CLOUD_URL;

const stripTrailingSlash = (value = "") => String(value || "").replace(/\/+$/, "");
const AUTO_GEMINI_3 = "auto-gemini-3";
const AUTO_GEMINI_25 = "auto-gemini-2.5";
const MANUAL_MODE = "__manual__";
const AUTO_MODE_OPTIONS = [
  {
    value: AUTO_GEMINI_3,
    label: "Auto (Gemini 3)",
    description: "Native Gemini CLI routing for Gemini 3 Pro/Flash.",
  },
  {
    value: AUTO_GEMINI_25,
    label: "Auto (Gemini 2.5)",
    description: "Native Gemini CLI routing for Gemini 2.5 Pro/Flash.",
  },
  {
    value: MANUAL_MODE,
    label: "Manual",
    description: "Select a specific DonixRouter model manually.",
  },
];

const resolveModelMode = (model) => {
  if (!model || model === "auto" || model === AUTO_GEMINI_3) return AUTO_GEMINI_3;
  if (model === AUTO_GEMINI_25) return AUTO_GEMINI_25;
  return MANUAL_MODE;
};

const getModeSummary = (mode) => {
  const matched = AUTO_MODE_OPTIONS.find((option) => option.value === mode);
  return matched?.description || "Select a specific DonixRouter model manually.";
};

export default function GeminiCLIToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  apiKeys,
  activeProviders,
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
}) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [modelMode, setModelMode] = useState(AUTO_GEMINI_3);
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !status) {
      checkStatus();
      fetchModelAliases();
    }
    if (isExpanded) fetchModelAliases();
  }, [isExpanded]);

  useEffect(() => {
    const currentModel = status?.gemini?.currentModel;
    setModelMode(resolveModelMode(currentModel));
    if (currentModel && resolveModelMode(currentModel) === MANUAL_MODE) {
      setSelectedModel(currentModel);
    }
  }, [status]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/cli-tools/gemini-cli-settings");
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    const currentUrl = status?.gemini?.currentBaseUrl;
    if (!currentUrl) return "not_configured";
    if (matchKnownEndpoint(currentUrl, { tunnelPublicUrl, tailscaleUrl, cloudUrl: cloudEnabled ? CLOUD_URL : null })) {
      return "configured";
    }
    return "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => stripTrailingSlash(customBaseUrl || baseUrl);
  const getDisplayUrl = () => stripTrailingSlash(customBaseUrl || baseUrl);
  const getEffectiveModel = () => (modelMode === MANUAL_MODE ? selectedModel.trim() : modelMode);
  const currentModelLabel = status?.gemini?.currentModel
    ? (AUTO_MODE_OPTIONS.find((option) => option.value === resolveModelMode(status.gemini.currentModel) && option.value !== MANUAL_MODE)?.label || status.gemini.currentModel)
    : "Auto (Gemini 3)";

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_donixrouter" : selectedApiKey);

      const res = await fetch("/api/cli-tools/gemini-cli-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          model: getEffectiveModel(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleReset = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/gemini-cli-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_donixrouter" : "<API_KEY_FROM_DASHBOARD>");
    const modelToUse = getEffectiveModel() || AUTO_GEMINI_3;

    return [
      {
        filename: "~/.gemini/.env",
        content: `GEMINI_API_KEY=${keyToUse}
GEMINI_MODEL=${modelToUse}
GOOGLE_GEMINI_BASE_URL=${getEffectiveBaseUrl()}
GOOGLE_GENAI_API_VERSION=v1beta
`,
      },
      {
        filename: "~/.gemini/settings.json",
        content: JSON.stringify({
          security: {
            auth: {
              selectedType: "gemini-api-key",
            },
          },
          model: {
            name: modelToUse,
          },
        }, null, 2),
      },
    ];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/gemini.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">Connected</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">Not configured</span>}
              {configStatus === "other" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">Other</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </div>

      {isExpanded && (
        <div className="mt-4 flex flex-col gap-4 border-t border-white/8 pt-4">
          <div className="surface-panel-soft rounded-xl px-3 py-2 text-xs text-text-muted">
            Applies globally through <code className="rounded bg-white/[0.06] px-1">~/.gemini/.env</code> and <code className="rounded bg-white/[0.06] px-1">~/.gemini/settings.json</code>, so new terminals inherit it automatically. Auto modes follow Gemini CLI&apos;s native routing instead of forcing one fixed model.
          </div>

          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Gemini CLI...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">Gemini CLI not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is still available if DonixRouter is reachable from this machine.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30">
                    <span className="material-symbols-outlined text-[18px] mr-1">content_copy</span>
                    Manual Config
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowInstallGuide(!showInstallGuide)}>
                    <span className="material-symbols-outlined text-[18px] mr-1">{showInstallGuide ? "expand_less" : "help"}</span>
                    {showInstallGuide ? "Hide" : "How to Install"}
                  </Button>
                </div>
              </div>
              {showInstallGuide && (
                <div className="surface-panel-soft rounded-xl p-4">
                  <h4 className="font-medium mb-3">Installation Guide</h4>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-text-muted mb-1">macOS / Linux / Windows:</p>
                      <code className="surface-code block rounded-lg px-3 py-2 font-mono text-xs">npm install -g @google/gemini-cli</code>
                    </div>
                    <p className="text-text-muted">After installation, run <code className="rounded bg-white/[0.05] px-1">gemini</code> to verify.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checking && status?.installed && (
            <>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect
                    value={customBaseUrl || getDisplayUrl()}
                    onChange={setCustomBaseUrl}
                    requiresExternalUrl={tool.requiresExternalUrl}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                    cloudEnabled={cloudEnabled}
                    cloudUrl={CLOUD_URL}
                    withV1={false}
                  />
                </div>

                {status?.gemini?.currentBaseUrl && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="surface-panel-soft min-w-0 truncate rounded-lg px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {status.gemini.currentBaseUrl}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Routing</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                    {AUTO_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setModelMode(option.value)}
                        className={`rounded-lg border px-2 py-2 text-left text-xs transition-colors ${modelMode === option.value ? "border-primary/40 bg-primary/10 text-primary" : "border-white/10 bg-white/[0.04] text-text-main hover:border-primary/30 hover:bg-white/[0.06]"}`}
                      >
                        <div className="font-medium">{option.label}</div>
                        <div className="mt-0.5 text-[11px] text-text-muted">{option.description}</div>
                      </button>
                    ))}
                  </div>
                  <span className="surface-panel-soft min-w-0 rounded-lg px-2 py-2 text-xs text-text-muted sm:py-1.5">
                    Current: {currentModelLabel}
                  </span>
                </div>

                {modelMode === MANUAL_MODE && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Model</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <div className="relative w-full min-w-0">
                      <input
                        type="text"
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        placeholder="provider/model-id"
                        className="w-full min-w-0 rounded-lg border border-white/10 bg-white/[0.04] py-2 pl-2 pr-7 text-xs text-text-main shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/40 sm:py-1.5"
                      />
                      {selectedModel && (
                        <button onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors" title="Clear">
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      )}
                    </div>
                    <button onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className={`w-full whitespace-nowrap rounded-lg border px-2 py-2 text-xs transition-colors sm:w-auto sm:shrink-0 sm:py-1.5 ${activeProviders?.length ? "border-white/10 bg-white/[0.04] text-text-main hover:border-primary/40 hover:bg-white/[0.06] cursor-pointer" : "cursor-not-allowed border-white/10 opacity-50"}`}>Select Model</button>
                  </div>
                )}

                {modelMode !== MANUAL_MODE && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Mode</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="surface-panel-soft min-w-0 rounded-lg px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {getModeSummary(modelMode)}
                    </span>
                  </div>
                )}
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={(!selectedApiKey && (cloudEnabled && apiKeys.length > 0)) || !getEffectiveModel()} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset} disabled={restoring || !status?.hasDonixRouter} loading={restoring}>
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)} disabled={!getEffectiveModel()}>
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={(model) => {
          setSelectedModel(model.value);
          setModalOpen(false);
        }}
        selectedModel={selectedModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Model for Gemini CLI"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Gemini CLI - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
