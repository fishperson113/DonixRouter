import { NextResponse } from "#adapter/nextShim.js";
import { getProviderConnectionById, updateProviderConnection } from "#models";
import { KiroService } from "#lib/oauth/services/kiro.js";
import { resolveConnectionProxyConfig } from "#lib/network/connectionProxy.js";
import { proxyAwareFetch } from "#open-sse/utils/proxyFetch.js";
import { getExecutor } from "#open-sse/executors/index.js";

// ──────────────────────────────────────────────────────────
// GET /api/providers/:id/kiro-debug
// Fetches raw GetUserUsageAndLimits CBOR response from Kiro
// and returns the decoded JS object for inspection.
// ──────────────────────────────────────────────────────────

function resolveIdp(providerSpecificData = {}) {
  const raw = providerSpecificData.idp || providerSpecificData.provider || providerSpecificData.authMethod || "Google";
  return String(raw).toLowerCase().includes("github") ? "Github" : "Google";
}

function resolveCookieHeader(connection, idp = "Google") {
  const data = connection.providerSpecificData || {};
  const raw = data.cookieHeader || data.webCookie || data.fullCookie || "";
  if (typeof raw === "string" && raw.includes("=")) return raw;
  const parts = [];
  if (connection.accessToken) parts.push(`AccessToken=${connection.accessToken}`);
  if (connection.refreshToken) parts.push(`RefreshToken=${connection.refreshToken}`);
  parts.push(`Idp=${idp}`);
  return parts.join("; ");
}

async function refreshIfNeeded(connection, proxyOptions) {
  if (connection.authType !== "oauth") return connection;
  const executor = getExecutor(connection.provider);
  const credentials = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt || connection.tokenExpiresAt,
    providerSpecificData: connection.providerSpecificData,
  };
  if (!executor.needsRefresh(credentials)) return connection;
  const refreshed = await executor.refreshCredentials(credentials, console, proxyOptions);
  if (!refreshed?.accessToken) return connection;
  const updateData = {
    accessToken: refreshed.accessToken,
    updatedAt: new Date().toISOString(),
  };
  if (refreshed.refreshToken) updateData.refreshToken = refreshed.refreshToken;
  if (refreshed.expiresIn) {
    updateData.expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
  }
  return updateProviderConnection(connection.id, updateData);
}

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    if (connection.provider !== "kiro") {
      return NextResponse.json({ error: "Not a Kiro account" }, { status: 400 });
    }
    if (!connection.accessToken) {
      return NextResponse.json({ error: "Missing accessToken" }, { status: 401 });
    }

    const providerSpecificData = connection.providerSpecificData || {};
    const profileArn = providerSpecificData.profileArn;
    if (!profileArn) {
      return NextResponse.json({ error: "Missing profileArn. Reconnect or import token." }, { status: 400 });
    }

    const proxyConfig = await resolveConnectionProxyConfig(providerSpecificData);
    const proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: false,
    };

    const refreshedConnection = await refreshIfNeeded(connection, proxyOptions);
    const service = new KiroService();
    const idp = resolveIdp(refreshedConnection.providerSpecificData);
    const cookieHeader = resolveCookieHeader(refreshedConnection, idp);
    const fetchFn = (url, init) => proxyAwareFetch(url, init, proxyOptions);

    // Fetch or reuse CSRF
    let csrf = refreshedConnection.providerSpecificData?.csrfToken || "";
    if (!csrf) {
      const csrfResult = await service.fetchCsrf(refreshedConnection.accessToken, idp, { fetchFn, cookieHeader });
      csrf = csrfResult.csrf;
    }

    // Call GetUserUsageAndLimits and get decoded CBOR
    const result = await service.getUserUsageAndLimitsCbor(
      refreshedConnection.accessToken,
      idp,
      csrf,
      { profileArn },
      { fetchFn, cookieHeader }
    );

    const decoded = result.data;

    // Extract the sections most useful for debugging overage
    const overageConfiguration  = decoded?.overageConfiguration  ?? null;
    const usageBreakdownList    = decoded?.usageBreakdownList     ?? null;
    const subscriptionInfo      = decoded?.subscriptionInfo       ?? null;
    const userInfo              = decoded?.userInfo               ?? null;
    const nextDateReset         = decoded?.nextDateReset          ?? null;

    return NextResponse.json({
      // Top-level summary
      _topLevelKeys: Object.keys(decoded || {}),

      // Overage section (full, raw)
      overageConfiguration,

      // Quota sections
      usageBreakdownList,

      // Plan info
      subscriptionInfo,
      userInfo,
      nextDateReset,

      // Full decoded object (for fields not captured above)
      _full: decoded,
    });
  } catch (error) {
    console.error("[kiro-debug] Error:", error);
    return NextResponse.json({
      error: error.message || "kiro-debug failed",
      stack: process.env.NODE_ENV !== "production" ? error.stack : undefined,
    }, { status: 500 });
  }
}
