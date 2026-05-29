import { useState, useEffect, useCallback } from "preact/hooks";
import { extractErrorMessage } from "../utils/extract-error";

export interface GeneralSettingsData {
  port: number;
  proxy_url: string | null;
  force_http11: boolean;
  inject_desktop_context: boolean;
  suppress_desktop_directives: boolean;
  default_model: string;
  default_reasoning_effort: string | null;
  refresh_enabled: boolean;
  refresh_margin_seconds: number;
  refresh_concurrency: number;
  max_concurrent_per_account: number | null;
  request_interval_ms: number | null;
  auto_update: boolean;
  auto_download: boolean;
  show_update_dialog: boolean;
  logs_enabled: boolean;
  logs_capacity: number;
  logs_capture_body: boolean;
  logs_llm_only: boolean;
  usage_history_retention_days: number | null;
  rtk_enabled: boolean;
  rtk_mode: string;
  prefetch_images: boolean;
  in_request_token_refresh: boolean;
  normalize_input: boolean;
  max_request_body_mb: number;
  daily_token_limit: number;
  weekly_token_limit: number;
  monthly_token_limit: number;
  token_limit_warning_percent: number;
  thinking_budget_mode: string;
  thinking_budget_custom_tokens: number;
  thinking_budget_effort_level: string;
  thinking_budget_enabled: boolean;
}

interface GeneralSettingsSaveResponse extends GeneralSettingsData {
  success: boolean;
  restart_required: boolean;
}

export function useGeneralSettings(apiKey: string | null) {
  const [data, setData] = useState<GeneralSettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/admin/general-settings");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result: GeneralSettingsData = await resp.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const save = useCallback(
    async (patch: Partial<GeneralSettingsData>) => {
      setSaving(true);
      setSaved(false);
      setError(null);
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }
        const resp = await fetch("/admin/general-settings", {
          method: "POST",
          headers,
          body: JSON.stringify(patch),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => null);
          throw new Error(extractErrorMessage(body, `HTTP ${resp.status}`));
        }
        const result = (await resp.json()) as GeneralSettingsSaveResponse;
        setData({
          port: result.port,
          proxy_url: result.proxy_url,
          force_http11: result.force_http11,
          inject_desktop_context: result.inject_desktop_context,
          suppress_desktop_directives: result.suppress_desktop_directives,
          default_model: result.default_model,
          default_reasoning_effort: result.default_reasoning_effort,
          refresh_enabled: result.refresh_enabled,
          refresh_margin_seconds: result.refresh_margin_seconds,
          refresh_concurrency: result.refresh_concurrency,
          max_concurrent_per_account: result.max_concurrent_per_account,
          request_interval_ms: result.request_interval_ms,
          auto_update: result.auto_update,
          auto_download: result.auto_download,
          show_update_dialog: result.show_update_dialog,
          logs_enabled: result.logs_enabled,
          logs_capacity: result.logs_capacity,
          logs_capture_body: result.logs_capture_body,
          logs_llm_only: result.logs_llm_only,
          usage_history_retention_days: result.usage_history_retention_days,
          rtk_enabled: result.rtk_enabled,
          rtk_mode: result.rtk_mode,
          prefetch_images: result.prefetch_images,
          in_request_token_refresh: result.in_request_token_refresh,
          normalize_input: result.normalize_input,
          max_request_body_mb: result.max_request_body_mb,
          daily_token_limit: result.daily_token_limit,
          weekly_token_limit: result.weekly_token_limit,
          monthly_token_limit: result.monthly_token_limit,
          token_limit_warning_percent: result.token_limit_warning_percent,
          thinking_budget_mode: result.thinking_budget_mode,
          thinking_budget_custom_tokens: result.thinking_budget_custom_tokens,
          thinking_budget_effort_level: result.thinking_budget_effort_level,
          thinking_budget_enabled: result.thinking_budget_enabled,
        });
        setRestartRequired(result.restart_required);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [apiKey],
  );

  useEffect(() => {
    load();
  }, [load]);

  return { data, saving, saved, error, save, load, restartRequired };
}
