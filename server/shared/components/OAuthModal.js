"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "#shared/components.js";
import { useCopyToClipboard } from "#shared/hooks/useCopyToClipboard.js";

/**
 * OAuth Modal Component
 * - Localhost: Auto callback via popup message
 * - Remote: Manual paste callback URL
 */
export default function OAuthModal({ isOpen, provider, providerInfo, onSuccess, onClose, oauthMeta, idcConfig }) {
  const [step, setStep] = useState("waiting"); // waiting | input | success | error
  const [authData, setAuthData] = useState(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [error, setError] = useState(null);
  const [isDeviceCode, setIsDeviceCode] = useState(false);
  const [deviceData, setDeviceData] = useState(null);
  const [polling, setPolling] = useState(false);
  const [importingRefreshToken, setImportingRefreshToken] = useState(false);
  const popupRef = useRef(null);
  const pollingAbortRef = useRef(false);
  const { copied, copy } = useCopyToClipboard();

  // State for client-only values to avoid hydration mismatch
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [placeholderUrl, setPlaceholderUrl] = useState("/callback?code=...");
  const callbackProcessedRef = useRef(false);

  // Detect if running on localhost (client-side only)
  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsLocalhost(
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      );
      setPlaceholderUrl(
        provider === "codex"
          ? "http://localhost:1455/auth/callback?code=..."
          : `${window.location.origin}/callback?code=...`
      );
    }
  }, [provider]);

  // Define all useCallback hooks BEFORE the useEffects that reference them

  const submitCodeExchange = useCallback(async (code, state) => {
    if (!authData) {
      throw new Error("Authorization data is not ready yet. Please try again.");
    }
    const res = await fetch(`/api/oauth/${provider}/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        redirectUri: authData.redirectUri,
        codeVerifier: authData.codeVerifier,
        state,
        ...(oauthMeta ? { meta: oauthMeta } : {}),
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Authentication failed");
    return data;
  }, [authData, provider, oauthMeta]);

  // Exchange tokens
  const exchangeTokens = useCallback(async (code, state, { inlineError = false } = {}) => {
    try {
      await submitCodeExchange(code, state);
      setStep("success");
      onSuccess?.();
      return true;
    } catch (err) {
      setError(err.message);
      if (!inlineError) {
        setStep("error");
      }
      return false;
    }
  }, [submitCodeExchange, onSuccess]);

  // Poll for device code token
  const startPolling = useCallback(async (deviceCode, codeVerifier, interval, extraData) => {
    pollingAbortRef.current = false;
    setPolling(true);
    const maxAttempts = 60;

    for (let i = 0; i < maxAttempts; i++) {
      // Check if polling should be aborted
      if (pollingAbortRef.current) {
        console.log("[OAuthModal] Polling aborted");
        setPolling(false);
        return;
      }

      await new Promise((r) => setTimeout(r, interval * 1000));

      // Check again after sleep
      if (pollingAbortRef.current) {
        console.log("[OAuthModal] Polling aborted after sleep");
        setPolling(false);
        return;
      }

      try {
        const res = await fetch(`/api/oauth/${provider}/poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode, codeVerifier, extraData }),
        });

        const data = await res.json();

        if (data.success) {
          pollingAbortRef.current = true; // Stop polling immediately
          setStep("success");
          setPolling(false);
          onSuccess?.();
          return;
        }

        if (data.error === "expired_token" || data.error === "access_denied") {
          throw new Error(data.errorDescription || data.error);
        }

        if (data.error === "slow_down") {
          interval = Math.min(interval + 5, 30);
        }
      } catch (err) {
        setError(err.message);
        setStep("error");
        setPolling(false);
        return;
      }
    }

    setError("Authorization timeout");
    setStep("error");
    setPolling(false);
  }, [provider, onSuccess]);

  // Start OAuth flow
  const startOAuthFlow = useCallback(async () => {
    if (!provider) return;
    try {
      setError(null);

      // Device code flow providers
      const deviceCodeProviders = ["github", "qwen", "kiro", "kimi-coding", "kilocode", "codebuddy"];
      if (deviceCodeProviders.includes(provider)) {
        setIsDeviceCode(true);
        setStep("waiting");

        const deviceCodeUrl = new URL(`/api/oauth/${provider}/device-code`, window.location.origin);
        if (provider === "kiro" && idcConfig?.startUrl) {
          deviceCodeUrl.searchParams.set("start_url", idcConfig.startUrl);
          if (idcConfig.region) {
            deviceCodeUrl.searchParams.set("region", idcConfig.region);
          }
          deviceCodeUrl.searchParams.set("auth_method", "idc");
        }
        const res = await fetch(deviceCodeUrl.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setDeviceData(data);

        // Auto-open verification URL in new tab
        const verifyUrl = data.verification_uri_complete || data.verification_uri;
        if (verifyUrl) window.open(verifyUrl, "_blank", "noopener,noreferrer");

        // Pass extraData for Kiro (contains _clientId, _clientSecret)
        const extraData = provider === "kiro"
          ? {
              _clientId: data._clientId,
              _clientSecret: data._clientSecret,
              _region: data._region,
              _authMethod: data._authMethod,
              _startUrl: data._startUrl,
            }
          : null;
        startPolling(data.device_code, data.codeVerifier, data.interval || 5, extraData);
        return;
      }

      // Authorization code flow - build redirect URI (some providers require fixed ports)
      const appPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
      let redirectUri;
      if (provider === "codex") {
        redirectUri = "http://localhost:1455/auth/callback";
      } else {
        redirectUri = `http://localhost:${appPort}/callback`;
      }

      // Build authorize URL first to get codeVerifier/state for codex server-side mode
      const authorizeUrl = new URL(`/api/oauth/${provider}/authorize`, window.location.origin);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      if (oauthMeta) {
        Object.entries(oauthMeta).forEach(([k, v]) => { if (v) authorizeUrl.searchParams.set(k, v); });
      }
      const res = await fetch(authorizeUrl.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Codex: start proxy with server-side session (auto-exchange) + fallback to channels
      let codexProxyActive = false;
      let codexServerSide = false;
      if (provider === "codex") {
        try {
          const proxyUrl = new URL(`/api/oauth/codex/start-proxy`, window.location.origin);
          proxyUrl.searchParams.set("app_port", appPort);
          proxyUrl.searchParams.set("state", data.state);
          proxyUrl.searchParams.set("code_verifier", data.codeVerifier);
          proxyUrl.searchParams.set("redirect_uri", redirectUri);
          const proxyRes = await fetch(proxyUrl.toString());
          const proxyData = await proxyRes.json();
          codexProxyActive = proxyData.success;
          codexServerSide = !!proxyData.serverSide;
        } catch {
          codexProxyActive = false;
        }
      }

      setAuthData({ ...data, redirectUri, codexServerSide });

      if (provider === "codex" && codexProxyActive) {
        // Proxy active: callback will be handled server-side (auto-exchange) or via channels (fallback)
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      } else if (!isLocalhost || provider === "codex") {
        // Non-localhost or proxy failed: manual input mode
        setStep("input");
        window.open(data.authUrl, "_blank");
      } else {
        // Localhost (non-Codex): Open popup and wait for message
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      }
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
  }, [provider, isLocalhost, startPolling, oauthMeta, idcConfig]);

  // Reset state and start OAuth when modal opens
  useEffect(() => {
    if (isOpen && provider) {
      setAuthData(null);
      setCallbackUrl("");
      setRefreshToken("");
      setError(null);
      setIsDeviceCode(false);
      setDeviceData(null);
      setPolling(false);
      setImportingRefreshToken(false);
      pollingAbortRef.current = false;
      startOAuthFlow();
    } else if (!isOpen) {
      // Abort polling and cleanup proxy when modal closes
      pollingAbortRef.current = true;
      if (provider === "codex") {
        fetch("/api/oauth/codex/stop-proxy").catch(() => {});
      }
    }
  }, [isOpen, provider, startOAuthFlow]);

  // Codex server-side mode: poll status (proxy auto-exchanges + saves DB)
  useEffect(() => {
    if (!authData?.codexServerSide || !authData?.state) return;
    if (callbackProcessedRef.current) return;
    let cancelled = false;
    const POLL_INTERVAL_MS = 1500;
    const MAX_ATTEMPTS = 200; // ~5 minutes
    let attempts = 0;

    const tick = async () => {
      if (cancelled || callbackProcessedRef.current) return;
      attempts += 1;
      try {
        const res = await fetch(`/api/oauth/codex/poll-status?state=${encodeURIComponent(authData.state)}`);
        const data = await res.json();
        if (cancelled || callbackProcessedRef.current) return;
        if (data.status === "done") {
          callbackProcessedRef.current = true;
          setStep("success");
          onSuccess?.();
          return;
        }
        if (data.status === "error") {
          callbackProcessedRef.current = true;
          setError(data.error || "Authentication failed");
          setStep("error");
          return;
        }
      } catch {
        // Network error, keep polling
      }
      if (attempts >= MAX_ATTEMPTS) {
        callbackProcessedRef.current = true;
        setError("Authentication timeout");
        setStep("error");
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    setTimeout(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; };
  }, [authData, onSuccess]);

  // Listen for OAuth callback via multiple methods
  useEffect(() => {
    if (!authData) return;
    callbackProcessedRef.current = false; // Reset when authData changes

    // Handler for callback data - only process once
    const handleCallback = async (data) => {
      if (callbackProcessedRef.current) return; // Already processed

      const { code, state, error: callbackError, errorDescription } = data;

      if (callbackError) {
        callbackProcessedRef.current = true;
        setError(errorDescription || callbackError);
        setStep("error");
        return;
      }

      if (code) {
        callbackProcessedRef.current = true;
        await exchangeTokens(code, state);
      }
    };

    // Method 1: postMessage from popup
    const handleMessage = (event) => {
      // Allow messages from same origin or localhost (any port)
      const isLocalhost = event.origin.includes("localhost") || event.origin.includes("127.0.0.1");
      const isSameOrigin = event.origin === window.location.origin;
      if (!isLocalhost && !isSameOrigin) return;
      
      if (event.data?.type === "oauth_callback") {
        handleCallback(event.data.data);
      }
    };
    window.addEventListener("message", handleMessage);

    // Method 2: BroadcastChannel
    let channel;
    try {
      channel = new BroadcastChannel("oauth_callback");
      channel.onmessage = (event) => handleCallback(event.data);
    } catch (e) {
      console.log("BroadcastChannel not supported");
    }

    // Method 3: localStorage event
    const handleStorage = (event) => {
      if (event.key === "oauth_callback" && event.newValue) {
        try {
          const data = JSON.parse(event.newValue);
          handleCallback(data);
          localStorage.removeItem("oauth_callback");
        } catch (e) {
          console.log("Failed to parse localStorage data");
        }
      }
    };
    window.addEventListener("storage", handleStorage);

    // Also check localStorage on mount (in case callback already happened)
    try {
      const stored = localStorage.getItem("oauth_callback");
      if (stored) {
        const data = JSON.parse(stored);
        if (data.timestamp && Date.now() - data.timestamp < 30000) {
          handleCallback(data);
        }
        localStorage.removeItem("oauth_callback");
      }
    } catch {
      // localStorage may be unavailable or data may be malformed - ignore silently
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
      if (channel) channel.close();
    };
  }, [authData, exchangeTokens]);

  // Handle manual URL input
  const handleManualSubmit = async () => {
    try {
      setError(null);
      const url = new URL(callbackUrl);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");

      if (errorParam) {
        throw new Error(url.searchParams.get("error_description") || errorParam);
      }

      if (!code) {
        throw new Error("No authorization code found in URL");
      }

      await exchangeTokens(code, state, { inlineError: provider === "codex" });
    } catch (err) {
      setError(err.message);
      if (provider !== "codex") {
        setStep("error");
      }
    }
  };

  const handleRefreshTokenImport = async () => {
    if (!refreshToken.trim()) {
      setError("Please enter a refresh token");
      return;
    }

    try {
      setError(null);
      setImportingRefreshToken(true);

      const res = await fetch("/api/oauth/codex/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refreshToken.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to import refresh token");
      }

      setStep("success");
      onSuccess?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setImportingRefreshToken(false);
    }
  };

  // Clear session on modal close + cleanup proxy
  const handleClose = useCallback(() => {
    if (provider === "codex") {
      fetch("/api/oauth/codex/stop-proxy").catch(() => {});
    }
    onClose();
  }, [onClose, provider]);

  if (!provider || !providerInfo) return null;
  const deviceLoginUrl = deviceData?.verification_uri_complete || deviceData?.verification_uri || "";

  return (
    <Modal isOpen={isOpen} title={`Connect ${providerInfo.name}`} onClose={handleClose} size="lg">
      <div className="flex flex-col gap-4">
        {/* Waiting + Manual Input combined (non-device-code) */}
        {(step === "waiting" || step === "input") && !isDeviceCode && (
          provider === "codex" ? (
            <>
              <div className="rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(16,163,127,0.12),transparent_55%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))] p-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
                    <span className="material-symbols-outlined text-[22px]">verified_user</span>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold">Connect Codex with your ChatGPT account</h3>
                    <p className="mt-1 text-sm text-text-muted">
                      Use browser login for a fresh OAuth session, or paste an existing refresh token if you already exported one from Codex.
                    </p>
                  </div>
                </div>
              </div>

              <div className="surface-panel-soft flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2">
                <span className="material-symbols-outlined text-base text-primary animate-spin">
                  progress_activity
                </span>
                <span className="text-sm">
                  {authData?.codexServerSide
                    ? "Listening on localhost:1455. If auto-capture fails, paste the callback URL below."
                    : "Browser login opened. If the redirect is not captured, paste the callback URL below."}
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="surface-panel rounded-2xl border border-white/10 p-4">
                  <div className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                      Browser Login
                    </p>
                    <h4 className="mt-2 text-sm font-semibold">Paste callback URL manually</h4>
                    <p className="mt-1 text-sm text-text-muted">
                      Best when you want to sign in directly from this machine.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <p className="mb-2 text-sm font-medium">Step 1: Open the Codex login URL</p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          icon="open_in_new"
                          onClick={() => window.open(authData?.authUrl, "_blank", "noopener,noreferrer")}
                          disabled={!authData?.authUrl}
                          fullWidth
                        >
                          Open Login
                        </Button>
                        <Button
                          variant="secondary"
                          icon={copied === "auth_url" ? "check" : "content_copy"}
                          onClick={() => copy(authData?.authUrl, "auth_url")}
                          disabled={!authData?.authUrl}
                          fullWidth
                        >
                          Copy URL
                        </Button>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-medium">Step 2: Paste the full callback URL</p>
                      <Input
                        value={callbackUrl}
                        onChange={(e) => setCallbackUrl(e.target.value)}
                        placeholder={placeholderUrl}
                        className="font-mono text-xs"
                      />
                      <p className="mt-2 text-xs text-text-muted">
                        Expected redirect starts with <span className="font-mono">http://localhost:1455/auth/callback</span>.
                      </p>
                    </div>

                    <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl.trim()}>
                      Connect via Callback URL
                    </Button>
                  </div>
                </div>

                <div className="surface-panel rounded-2xl border border-white/10 p-4">
                  <div className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                      Refresh Token
                    </p>
                    <h4 className="mt-2 text-sm font-semibold">Import existing Codex session</h4>
                    <p className="mt-1 text-sm text-text-muted">
                      Best when you already have a valid Codex refresh token and want DonixRouter to handle future token refresh automatically.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium">
                        Refresh Token <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={refreshToken}
                        onChange={(e) => setRefreshToken(e.target.value)}
                        placeholder="Paste Codex refresh token here..."
                        rows={5}
                        className="w-full resize-none rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-mono text-text-main transition-all duration-150 ease-out placeholder-text-muted/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                      />
                    </div>

                    <Button
                      onClick={handleRefreshTokenImport}
                      fullWidth
                      loading={importingRefreshToken}
                      disabled={!refreshToken.trim()}
                    >
                      Add with Refresh Token
                    </Button>
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={startOAuthFlow} variant="secondary" fullWidth>
                  Restart Login
                </Button>
                <Button onClick={handleClose} variant="ghost" fullWidth>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* Option A: Auto via popup */}
              <div className="surface-panel-soft flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2">
                <span className="material-symbols-outlined text-base text-primary animate-spin">
                  progress_activity
                </span>
                <span className="text-sm">Waiting for popup authorization...</span>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 my-1">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-text-muted uppercase tracking-wider">Or paste callback URL manually</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Option B: Manual paste */}
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">Step 1: Open this URL in your browser</p>
                  <div className="flex gap-2">
                    <Input value={authData?.authUrl || ""} readOnly className="flex-1 font-mono text-xs" />
                    <Button variant="secondary" icon={copied === "auth_url" ? "check" : "content_copy"} onClick={() => copy(authData?.authUrl, "auth_url")} disabled={!authData?.authUrl}>
                      Copy
                    </Button>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Step 2: Paste the callback URL here</p>
                  <p className="text-xs text-text-muted mb-2">
                    After authorization, copy the full URL from your browser.
                  </p>
                  <Input
                    value={callbackUrl}
                    onChange={(e) => setCallbackUrl(e.target.value)}
                    placeholder={placeholderUrl}
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl}>
                  Connect
                </Button>
                <Button onClick={handleClose} variant="ghost" fullWidth>
                  Cancel
                </Button>
              </div>
            </>
          )
        )}

        {/* Device Code Flow - Waiting */}
        {step === "waiting" && isDeviceCode && deviceData && (
          <>
            <div className="text-center py-4">
              <p className="text-sm text-text-muted mb-4">
                Visit the login URL below and authorize:
              </p>
              <div className="surface-panel-soft mb-4 rounded-lg p-4">
                <p className="text-xs text-text-muted mb-1">Login URL</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm break-all">{deviceLoginUrl}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied === "login_url" ? "check" : "content_copy"}
                    onClick={() => copy(deviceLoginUrl, "login_url")}
                    disabled={!deviceLoginUrl}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="open_in_new"
                    onClick={() => window.open(deviceLoginUrl, "_blank", "noopener,noreferrer")}
                    disabled={!deviceLoginUrl}
                  >
                    Open
                  </Button>
                </div>
              </div>
              <div className="bg-primary/10 p-4 rounded-lg">
                <p className="text-xs text-text-muted mb-1">Your Code</p>
                <div className="flex items-center justify-center gap-2">
                  <p className="text-2xl font-mono font-bold text-primary">{deviceData.user_code}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied === "user_code" ? "check" : "content_copy"}
                    onClick={() => copy(deviceData.user_code, "user_code")}
                  />
                </div>
              </div>
            </div>
            {polling && (
              <div className="flex items-center justify-center gap-2 text-sm text-text-muted">
                <span className="material-symbols-outlined animate-spin">progress_activity</span>
                Waiting for authorization...
              </div>
            )}
          </>
        )}

        {/* Success Step */}
        {step === "success" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connected Successfully!</h3>
            <p className="text-sm text-text-muted mb-4">
              Your {providerInfo.name} account has been connected.
            </p>
            <Button onClick={handleClose} fullWidth>
              Done
            </Button>
          </div>
        )}

        {/* Error Step */}
        {step === "error" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connection Failed</h3>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <div className="flex gap-2">
              <Button onClick={startOAuthFlow} variant="secondary" fullWidth>
                Try Again
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

OAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerInfo: PropTypes.shape({ name: PropTypes.string }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  /** Extra metadata passed to /authorize and /exchange (e.g. gitlab clientId/baseUrl) */
  oauthMeta: PropTypes.object,
  /** Optional Kiro IDC config for AWS IAM Identity Center device flow */
  idcConfig: PropTypes.shape({
    startUrl: PropTypes.string,
    region: PropTypes.string,
  }),
};
