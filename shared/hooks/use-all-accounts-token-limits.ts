import { useState, useEffect } from "preact/hooks";
import { useSettings } from "./use-settings.js";
import { extractErrorMessage } from "../utils/extract-error.js";

export interface AccountLimitStatus {
  id: string;
  email: string | null;
  status: string;
  isLimitExhausted: boolean;
  exhaustedPeriod: "daily" | "weekly" | "monthly" | null;
  hasWarnings: boolean;
  warningPeriods: Array<{
    period: "daily" | "weekly" | "monthly";
    percentUsed: number;
  }>;
  usage: {
    daily: { used: number; limit: number } | null;
    weekly: { used: number; limit: number } | null;
    monthly: { used: number; limit: number } | null;
  };
}

export interface TokenLimitsStatusResponse {
  accounts: AccountLimitStatus[];
  config: {
    dailyLimit: number;
    weeklyLimit: number;
    monthlyLimit: number;
    warningThreshold: number;
  };
}

export function useAllAccountsTokenLimits() {
  const { apiKey } = useSettings();
  const [data, setData] = useState<TokenLimitsStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTokenLimitsStatus = async () => {
    if (!apiKey) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/admin/token-limits-status", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || "Failed to fetch token limits");
        setData(null);
        return;
      }

      const limits = await response.json();
      setData(limits);
    } catch (err) {
      const msg = extractErrorMessage(err);
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTokenLimitsStatus();
    // Refresh every 30 seconds
    const interval = setInterval(loadTokenLimitsStatus, 30000);
    return () => clearInterval(interval);
  }, [apiKey]);

  return { data, loading, error, refresh: loadTokenLimitsStatus };
}
