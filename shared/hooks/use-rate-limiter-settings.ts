import { useState, useEffect, useCallback } from "preact/hooks";
import { extractErrorMessage } from "../utils/extract-error";

export interface RateLimitRule {
  limit: number;
  window_seconds: number;
  enabled?: boolean;
}

export interface RateLimiterSettingsData {
  rate_limit_rules: Record<string, RateLimitRule>;
}

interface RateLimiterSettingsSaveResponse extends RateLimiterSettingsData {
  success: boolean;
}

export function useRateLimiterSettings(apiKey: string | null) {
  const [data, setData] = useState<RateLimiterSettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/admin/rate-limiter-settings");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result: RateLimiterSettingsData = await resp.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const save = useCallback(
    async (patch: Partial<RateLimiterSettingsData>) => {
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
        const resp = await fetch("/admin/rate-limiter-settings", {
          method: "POST",
          headers,
          body: JSON.stringify(patch),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => null);
          throw new Error(extractErrorMessage(body, `HTTP ${resp.status}`));
        }
        const result = (await resp.json()) as RateLimiterSettingsSaveResponse;
        setData({
          rate_limit_rules: result.rate_limit_rules,
        });
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

  return { data, saving, saved, error, save, load };
}
