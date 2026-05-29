import { NextResponse } from "#adapter/nextShim.js";
import { getProviderConnectionById, updateProviderConnection } from "#models";
import { KiroService } from "#lib/oauth/services/kiro.js";
import { resolveConnectionProxyConfig } from "#lib/network/connectionProxy.js";
import { proxyAwareFetch } from "#open-sse/utils/proxyFetch.js";
import { getExecutor } from "#open-sse/executors/index.js";

function sanitizeConnection(connection) {
  const result = { ...connection };
  delete result.apiKey;
  delete result.accessToken;
  delete result.refreshToken;
  delete result.idToken;
  return result;
}

function resolveIdp(providerSpecificData = {}) {
  const raw = providerSpecificData.idp || providerSpecificData.provider || providerSpecificData.authMethod || "Google";
  const normalized = String(raw).toLowerCase();
  if (normalized.includes("github")) return "Github";
  return "Google";
}

function resolveUserId(connection) {
  const data = connection.providerSpecificData || {};
  return data.userId || data.kiroUserId || null;
}

function resolveVisitorId(connection) {
  const data = connection.providerSpecificData || {};
  return data.visitorId || data.kiroVisitorId || null;
}

function createVisitorId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

function isCsrfError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("invalid csrf") || message.includes("csrf token") || message.includes("(401)") || message.includes("(403)");
}

function resolveCookieHeader(connection, idp = "Google", overrides = {}) {
  const data = connection.providerSpecificData || {};
  const raw = data.cookieHeader || data.webCookie || data.fullCookie || "";
  if (typeof raw === "string" && raw.includes("=")) return raw;

  const parts = [];
  if (connection.accessToken) parts.push(`AccessToken=${connection.accessToken}`);
  if (connection.refreshToken) parts.push(`RefreshToken=${connection.refreshToken}`);
  parts.push(`Idp=${idp}`);

  const userId = overrides.userId || resolveUserId(connection);
  const visitorId = overrides.visitorId || resolveVisitorId(connection);
  if (userId) parts.push(`UserId=${userId}`);
  if (visitorId) parts.push(`kiro-visitor-id=${visitorId}`);

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
  } else if (refreshed.expiresAt) {
    updateData.expiresAt = refreshed.expiresAt;
  }
  if (refreshed.providerSpecificData) {
    updateData.providerSpecificData = {
      ...(connection.providerSpecificData || {}),
      ...refreshed.providerSpecificData,
    };
  }

  return updateProviderConnection(connection.id, updateData);
}

async function getKiroBillingContext(connection) {
  if (connection.provider !== "kiro") {
    return { error: "Connection is not a Kiro account", status: 400 };
  }
  if (!connection.accessToken) {
    return { error: "Kiro access token is missing. Reconnect this account.", status: 401 };
  }

  const providerSpecificData = connection.providerSpecificData || {};
  const profileArn = providerSpecificData.profileArn;
  if (!profileArn) {
    return { error: "Kiro profileArn is missing. Reconnect this account or import a token with profileArn.", status: 400 };
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
  let csrf = refreshedConnection.providerSpecificData?.csrfToken || "";

  if (!csrf) {
    const csrfResult = await service.fetchCsrf(refreshedConnection.accessToken, idp, { fetchFn, cookieHeader });
    csrf = csrfResult.csrf;
    await updateProviderConnection(refreshedConnection.id, {
      providerSpecificData: {
        ...(refreshedConnection.providerSpecificData || {}),
        csrfToken: csrf,
      },
    });
    refreshedConnection.providerSpecificData = {
      ...(refreshedConnection.providerSpecificData || {}),
      csrfToken: csrf,
    };
  }

  return {
    connection: refreshedConnection,
    service,
    idp,
    csrf,
    profileArn,
    proxyOptions,
    fetchFn,
    cookieHeader,
  };
}

async function resolveKiroWebIdentity(context) {
  let userId = resolveUserId(context.connection);
  let visitorId = resolveVisitorId(context.connection);
  let currentOverageEnabled = null;

  if (!userId) {
    let usage;
    try {
      usage = await context.service.getUserUsageAndLimitsCbor(
        context.connection.accessToken,
        context.idp,
        context.csrf,
        { profileArn: context.profileArn },
        { fetchFn: context.fetchFn, cookieHeader: context.cookieHeader }
      );
    } catch (error) {
      if (!isCsrfError(error)) throw error;
      const csrfResult = await context.service.fetchCsrf(context.connection.accessToken, context.idp, {
        fetchFn: context.fetchFn,
        cookieHeader: context.cookieHeader,
      });
      context.csrf = csrfResult.csrf;
      usage = await context.service.getUserUsageAndLimitsCbor(
        context.connection.accessToken,
        context.idp,
        context.csrf,
        { profileArn: context.profileArn },
        { fetchFn: context.fetchFn, cookieHeader: context.cookieHeader }
      );
    }
    userId = usage.data?.userInfo?.userId || null;
    currentOverageEnabled = usage.data?.overageConfiguration?.overageEnabled ?? null;
  }

  if (!visitorId) visitorId = createVisitorId();

  const cookieHeader = resolveCookieHeader(context.connection, context.idp, { userId, visitorId });
  const csrfResult = await context.service.fetchCsrf(context.connection.accessToken, context.idp, {
    fetchFn: context.fetchFn,
    cookieHeader,
  });

  return {
    userId,
    visitorId,
    cookieHeader,
    csrf: csrfResult.csrf,
    currentOverageEnabled,
  };
}

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    const context = await getKiroBillingContext(connection);
    if (context.error) return NextResponse.json({ error: context.error }, { status: context.status });

    const data = context.connection.providerSpecificData || {};
    return NextResponse.json({
      profileArn: context.profileArn,
      overageEnabled: typeof data.kiroOverageEnabled === "boolean" ? data.kiroOverageEnabled : null,
      limitEnabled: typeof data.kiroLimitEnabled === "boolean" ? data.kiroLimitEnabled : null,
    });
  } catch (error) {
    console.log("Kiro billing GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch Kiro billing settings" }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const connection = await getProviderConnectionById(id);
    if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    const context = await getKiroBillingContext(connection);
    if (context.error) return NextResponse.json({ error: context.error }, { status: context.status });

    const identity = await resolveKiroWebIdentity(context);
    context.cookieHeader = identity.cookieHeader;
    context.csrf = identity.csrf;

    let overageEnabled;
    if (typeof body.overageEnabled === "boolean") {
      overageEnabled = body.overageEnabled;
    } else if (typeof body.limitEnabled === "boolean") {
      overageEnabled = !body.limitEnabled;
    } else {
      return NextResponse.json({ error: "Send boolean overageEnabled or limitEnabled" }, { status: 400 });
    }

    const callOptions = {
      fetchFn: context.fetchFn,
      cookieHeader: context.cookieHeader,
      userId: identity.userId,
      visitorId: identity.visitorId,
    };
    const billingPayload = {
      profileArn: context.profileArn,
      overageEnabled,
    };

    let billing;
    try {
      billing = await context.service.updateBillingPreferences(
        context.connection.accessToken,
        context.idp,
        context.csrf,
        billingPayload,
        callOptions
      );
    } catch (error) {
      if (!isCsrfError(error)) throw error;
      const csrfResult = await context.service.fetchCsrf(context.connection.accessToken, context.idp, {
        fetchFn: context.fetchFn,
        cookieHeader: context.cookieHeader,
      });
      context.csrf = csrfResult.csrf;
      await updateProviderConnection(context.connection.id, {
        providerSpecificData: {
          ...(context.connection.providerSpecificData || {}),
          csrfToken: context.csrf,
        },
      });
      billing = await context.service.updateBillingPreferences(
        context.connection.accessToken,
        context.idp,
        context.csrf,
        billingPayload,
        callOptions
      );
    }

    const updated = await updateProviderConnection(context.connection.id, {
      providerSpecificData: {
        ...(context.connection.providerSpecificData || {}),
        csrfToken: context.csrf,
        ...(identity.userId ? { userId: identity.userId } : {}),
        ...(identity.visitorId ? { visitorId: identity.visitorId } : {}),
        kiroOverageEnabled: billing.overageEnabled,
        kiroLimitEnabled: billing.limitEnabled,
        kiroBillingUpdatedAt: new Date().toISOString(),
      },
      testStatus: "active",
      lastError: null,
    });

    return NextResponse.json({
      success: true,
      overageEnabled: billing.overageEnabled,
      limitEnabled: billing.limitEnabled,
      connection: sanitizeConnection(updated),
    });
  } catch (error) {
    console.log("Kiro billing update error:", error);
    if (isCsrfError(error)) {
      return NextResponse.json({
        error: "Kiro rejected the CSRF token after retry. Reconnect this Kiro account or import a fresh Kiro token, then try again.",
      }, { status: 401 });
    }
    return NextResponse.json({ error: error.message || "Failed to update Kiro billing settings" }, { status: 500 });
  }
}
