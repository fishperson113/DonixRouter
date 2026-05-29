import { NextResponse } from "#adapter/nextShim.js";
import { 
  getProvider, 
  generateAuthData, 
  exchangeTokens, 
  requestDeviceCode, 
  pollForToken,
  extractCodexAccountInfo,
  extractEmailFromAccessToken,
} from "#lib/oauth/providers.js";
import { CODEX_CONFIG } from "#lib/oauth/constants/oauth.js";
import { createProviderConnection } from "#models";
import {
  startCodexProxy,
  stopCodexProxy,
  registerCodexSession,
  getCodexSessionStatus,
  clearCodexSession,
} from "#lib/oauth/utils/server.js";

async function exchangeCodexRefreshToken(refreshToken) {
  const response = await fetch(CODEX_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CODEX_CONFIG.clientId,
      refresh_token: refreshToken,
      scope: CODEX_CONFIG.scope,
    }),
  });

  const rawBody = await response.text();
  let parsedBody = null;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    parsedBody = null;
  }

  if (!response.ok) {
    const errorCode =
      parsedBody?.error?.code ||
      parsedBody?.error_code ||
      (typeof parsedBody?.error === "string" ? parsedBody.error : null);
    const errorMessage =
      parsedBody?.error?.message ||
      parsedBody?.error_description ||
      parsedBody?.message ||
      errorCode ||
      rawBody ||
      "Failed to refresh Codex token";

    throw new Error(errorMessage);
  }

  if (!parsedBody?.access_token) {
    throw new Error("Codex token endpoint did not return an access token");
  }

  return parsedBody;
}

/**
 * Dynamic OAuth API Route
 * Handles: authorize, exchange, device-code, poll
 */

// GET /api/oauth/[provider]/authorize - Generate auth URL
// GET /api/oauth/[provider]/device-code - Request device code (for device_code flow)
export async function GET(request, { params }) {
  try {
    const { provider, action } = await params;
    const { searchParams } = new URL(request.url);

    if (action === "authorize") {
      const redirectUri = searchParams.get("redirect_uri") || "http://localhost:8080/callback";
      // Collect provider-specific meta params (e.g. gitlab passes baseUrl, clientId, clientSecret)
      const reservedParams = new Set(["redirect_uri"]);
      const meta = {};
      searchParams.forEach((value, key) => { if (!reservedParams.has(key)) meta[key] = value; });
      const authData = generateAuthData(provider, redirectUri, Object.keys(meta).length ? meta : undefined);
      return NextResponse.json(authData);
    }

    if (action === "start-proxy") {
      if (provider !== "codex") {
        return NextResponse.json({ error: "Proxy only supported for codex" }, { status: 400 });
      }
      const appPort = searchParams.get("app_port");
      if (!appPort) {
        return NextResponse.json({ error: "Missing app_port" }, { status: 400 });
      }
      // Optional server-side mode params: register session for auto-exchange
      const state = searchParams.get("state");
      const codeVerifier = searchParams.get("code_verifier");
      const redirectUri = searchParams.get("redirect_uri");
      const result = await startCodexProxy(Number(appPort));
      let serverSide = false;
      if (result.success && state && codeVerifier && redirectUri) {
        serverSide = registerCodexSession({ state, codeVerifier, redirectUri });
      }
      return NextResponse.json({ ...result, serverSide });
    }

    if (action === "poll-status") {
      if (provider !== "codex") {
        return NextResponse.json({ error: "Poll only supported for codex" }, { status: 400 });
      }
      const state = searchParams.get("state");
      if (!state) {
        return NextResponse.json({ error: "Missing state" }, { status: 400 });
      }
      const session = getCodexSessionStatus(state);
      if (!session) return NextResponse.json({ status: "unknown" });
      if (session.status === "done" || session.status === "error") {
        const payload = { ...session };
        clearCodexSession(state);
        return NextResponse.json(payload);
      }
      return NextResponse.json({ status: session.status });
    }

    if (action === "stop-proxy") {
      if (provider !== "codex") {
        return NextResponse.json({ error: "Proxy only supported for codex" }, { status: 400 });
      }
      stopCodexProxy();
      return NextResponse.json({ success: true });
    }

    if (action === "device-code") {
      const providerData = getProvider(provider);
      if (providerData.flowType !== "device_code") {
        return NextResponse.json({ error: "Provider does not support device code flow" }, { status: 400 });
      }

      const authData = generateAuthData(provider, null);
      const startUrl = searchParams.get("start_url");
      const region = searchParams.get("region");
      const authMethod = searchParams.get("auth_method");
      const deviceOptions = provider === "kiro"
        ? {
            ...(startUrl ? { startUrl } : {}),
            ...(region ? { region } : {}),
            ...(authMethod ? { authMethod } : {}),
          }
        : undefined;
      
      // Providers that don't use PKCE for device code
      const noPkceDeviceProviders = ["github", "kiro", "kimi-coding", "kilocode", "codebuddy"];
      let deviceData;
      if (noPkceDeviceProviders.includes(provider)) {
        deviceData = await requestDeviceCode(provider, undefined, deviceOptions);
      } else {
        // Qwen and other PKCE providers
        deviceData = await requestDeviceCode(provider, authData.codeChallenge, deviceOptions);
      }

      return NextResponse.json({
        ...deviceData,
        codeVerifier: authData.codeVerifier,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.log("OAuth GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/oauth/[provider]/exchange - Exchange code for tokens and save
// POST /api/oauth/[provider]/poll - Poll for token (device_code flow)
export async function POST(request, { params }) {
  try {
    const { provider, action } = await params;
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
    }

    if (action === "exchange") {
      const { code, redirectUri, codeVerifier, state, meta } = body;

      // Cline uses authorization_code without PKCE
      const noPkceExchangeProviders = ["cline"];
      if (!code || !redirectUri || (!codeVerifier && !noPkceExchangeProviders.includes(provider))) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      // Exchange code for tokens (meta carries provider-specific params, e.g. gitlab clientId/baseUrl)
      const tokenData = await exchangeTokens(provider, code, redirectUri, codeVerifier, state, meta);

      // Save to database
      const connection = await createProviderConnection({
        provider,
        authType: "oauth",
        ...tokenData,
        expiresAt: tokenData.expiresIn 
          ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString() 
          : null,
        testStatus: "active",
      });

      return NextResponse.json({ 
        success: true, 
        connection: {
          id: connection.id,
          provider: connection.provider,
          email: connection.email,
          displayName: connection.displayName,
        }
      });
    }

    if (action === "import-session") {
      if (provider !== "codex") {
        return NextResponse.json({ error: "Session import is only supported for codex" }, { status: 400 });
      }

      const { accessToken, expires, account, user, sessionToken } = body || {};
      if (!accessToken || typeof accessToken !== "string") {
        return NextResponse.json({ error: "accessToken is required" }, { status: 400 });
      }

      const accountInfo = extractCodexAccountInfo(accessToken);
      const email =
        accountInfo.email ||
        user?.email ||
        extractEmailFromAccessToken(accessToken) ||
        null;

      const expiresAt = (() => {
        if (expires) {
          const t = new Date(expires);
          if (!Number.isNaN(t.getTime())) return t.toISOString();
        }
        try {
          const payload = JSON.parse(
            Buffer.from(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
          );
          if (payload?.exp) return new Date(payload.exp * 1000).toISOString();
        } catch {}
        return null;
      })();

      const providerSpecificData = {
        authMethod: "session_import",
        provider: "Imported",
        warning: "No refresh token; this connection will stop working when the access token expires.",
      };
      const chatgptAccountId = accountInfo.chatgptAccountId || account?.id;
      const chatgptPlanType = accountInfo.chatgptPlanType || account?.planType;
      if (chatgptAccountId) providerSpecificData.chatgptAccountId = chatgptAccountId;
      if (chatgptPlanType) providerSpecificData.chatgptPlanType = chatgptPlanType;
      if (sessionToken) providerSpecificData.sessionToken = sessionToken;

      const connection = await createProviderConnection({
        provider: "codex",
        authType: "oauth",
        accessToken,
        refreshToken: null,
        expiresAt,
        email,
        providerSpecificData,
        testStatus: "active",
      });

      return NextResponse.json({
        success: true,
        warning: providerSpecificData.warning,
        connection: {
          id: connection.id,
          provider: connection.provider,
          email: connection.email,
          displayName: connection.displayName,
          expiresAt,
        },
      });
    }

    if (action === "import") {
      if (provider !== "codex") {
        return NextResponse.json({ error: "Import is only supported for codex" }, { status: 400 });
      }

      const { refreshToken } = body;
      if (!refreshToken || typeof refreshToken !== "string") {
        return NextResponse.json({ error: "Refresh token is required" }, { status: 400 });
      }

      const normalizedRefreshToken = refreshToken.trim();
      const tokenData = await exchangeCodexRefreshToken(normalizedRefreshToken);
      const accountInfo = extractCodexAccountInfo(tokenData.id_token);
      const email =
        accountInfo.email ||
        extractEmailFromAccessToken(tokenData.access_token) ||
        null;

      const providerSpecificData = {
        authMethod: "refresh_token_import",
        provider: "Imported",
      };
      if (accountInfo.chatgptAccountId) {
        providerSpecificData.chatgptAccountId = accountInfo.chatgptAccountId;
      }
      if (accountInfo.chatgptPlanType) {
        providerSpecificData.chatgptPlanType = accountInfo.chatgptPlanType;
      }

      const connection = await createProviderConnection({
        provider: "codex",
        authType: "oauth",
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || normalizedRefreshToken,
        expiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
          : null,
        email,
        providerSpecificData,
        testStatus: "active",
      });

      return NextResponse.json({
        success: true,
        connection: {
          id: connection.id,
          provider: connection.provider,
          email: connection.email,
          displayName: connection.displayName,
        },
      });
    }

    if (action === "poll") {
      const { deviceCode, codeVerifier, extraData } = body;

      if (!deviceCode) {
        return NextResponse.json({ error: "Missing device code" }, { status: 400 });
      }

      // Providers that don't use PKCE for device code
      const noPkceProviders = ["github", "kimi-coding", "kilocode", "codebuddy"];
      let result;
      if (noPkceProviders.includes(provider)) {
        result = await pollForToken(provider, deviceCode);
      } else if (provider === "kiro") {
        // Kiro needs extraData (clientId, clientSecret) from device code response
        result = await pollForToken(provider, deviceCode, null, extraData);
      } else {
        // Qwen and other PKCE providers
        if (!codeVerifier) {
          return NextResponse.json({ error: "Missing code verifier" }, { status: 400 });
        }
        result = await pollForToken(provider, deviceCode, codeVerifier);
      }

      if (result.success) {
        // Save to database
        const connection = await createProviderConnection({
          provider,
          authType: "oauth",
          ...result.tokens,
          expiresAt: result.tokens.expiresIn 
            ? new Date(Date.now() + result.tokens.expiresIn * 1000).toISOString() 
            : null,
          testStatus: "active",
        });

        return NextResponse.json({ 
          success: true, 
          connection: {
            id: connection.id,
            provider: connection.provider,
          }
        });
      }

      // Still pending or error - don't create connection for pending states
      const isPending = result.pending || result.error === "authorization_pending" || result.error === "slow_down";
      
      return NextResponse.json({
        success: false,
        error: result.error,
        errorDescription: result.errorDescription,
        pending: isPending,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.log("OAuth POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
