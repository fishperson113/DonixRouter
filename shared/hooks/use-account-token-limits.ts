import { useState, useEffect } from "preact/hooks";
import { useSettings } from "./use-settings.js";
import { extractErrorMessage } from "../utils/extract-error.js";

export interface TokenLimitStatus {
  limit: number;
  used: number;
  percent: number;
  status: "ok" | "warning" | "exhausted";
  resetAt: string | null;
}

export interface AccountTokenLimits {
  accountId: string;
  email: string | null;
  daily: TokenLimitStatus | null;
  weekly: TokenLimitStatus | null;
  monthly: TokenLimitStatus | null;
  warningThreshold: number;
}

export function useAccountTokenLimits(accountId?: string) {
  const { apiKey } = useSettings();
  const [data, setData] = useState<AccountTokenLimits | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId || !apiKey) {
      setData(null);
      return;
    }

    const loadTokenLimits = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/admin/token-limit-status/${accountId}`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            setError("Account not found");
          } else {
            const errorData = await response.json();
            setError(errorData.error || "Failed to fetch token limits");
          }
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

    loadTokenLimits();
  }, [accountId, apiKey]);

  return { data, loading, error };
}
