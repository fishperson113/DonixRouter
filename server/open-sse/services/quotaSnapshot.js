import { getProviderConnections, updateProviderConnection } from "#lib/localDb.js";
import { getUsageForProvider } from "#open-sse/services/usage.js";
import { getExecutor } from "#open-sse/executors/index.js";
import { resolveConnectionProxyConfig } from "#lib/network/connectionProxy.js";
import { USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS } from "#shared/constants/providers.js";

function isUsageEligible(connection) {
  return (
    USAGE_SUPPORTED_PROVIDERS.includes(connection.provider) &&
    (connection.authType === "oauth" || USAGE_APIKEY_PROVIDERS.includes(connection.provider))
  );
}

async function refreshCredentials(connection, proxyOptions) {
  try {
    const executor = getExecutor(connection.provider);
    const credentials = {
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      expiresAt: connection.expiresAt || connection.tokenExpiresAt,
      providerSpecificData: connection.providerSpecificData,
      copilotToken: connection.providerSpecificData?.copilotToken,
      copilotTokenExpiresAt: connection.providerSpecificData?.copilotTokenExpiresAt,
    };

    if (!executor.needsRefresh(credentials)) return connection;

    const result = await executor.refreshCredentials(credentials, console, proxyOptions);
    if (!result) return connection;

    const now = new Date().toISOString();
    const updateData = { updatedAt: now };
    if (result.accessToken) updateData.accessToken = result.accessToken;
    if (result.refreshToken) updateData.refreshToken = result.refreshToken;
    if (result.expiresIn) {
      updateData.expiresAt = new Date(Date.now() + result.expiresIn * 1000).toISOString();
    } else if (result.expiresAt) {
      updateData.expiresAt = result.expiresAt;
    }
    if (result.copilotToken || result.copilotTokenExpiresAt) {
      updateData.providerSpecificData = {
        ...connection.providerSpecificData,
        copilotToken: result.copilotToken,
        copilotTokenExpiresAt: result.copilotTokenExpiresAt,
      };
    }

    await updateProviderConnection(connection.id, updateData);
    return { ...connection, ...updateData };
  } catch {
    return connection;
  }
}

export async function fetchAllQuotas() {
  const allConnections = await getProviderConnections();
  const eligible = allConnections.filter(isUsageEligible);

  const results = {};
  const connectionsMeta = [];

  await Promise.allSettled(
    eligible.map(async (conn) => {
      try {
        const proxyConfig = await resolveConnectionProxyConfig(conn.providerSpecificData);
        const proxyOptions = {
          connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
          connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
          connectionNoProxy: proxyConfig.connectionNoProxy || "",
          vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
          strictProxy: false,
        };

        let connection = conn;
        if (conn.authType === "oauth") {
          connection = await refreshCredentials(conn, proxyOptions);
        }

        const usage = await getUsageForProvider(connection, proxyOptions);
        results[conn.id] = { data: usage, error: null };
      } catch (err) {
        results[conn.id] = { data: null, error: err.message || "Failed to fetch quota" };
      }

      connectionsMeta.push({
        id: conn.id,
        provider: conn.provider,
        authType: conn.authType,
        isActive: conn.isActive ?? true,
        email: conn.email || null,
        displayName: conn.displayName || null,
        name: conn.name || null,
        updatedAt: conn.updatedAt || null,
        providerSpecificData: conn.providerSpecificData || null,
      });
    })
  );

  return { connections: connectionsMeta, quotas: results, timestamp: new Date().toISOString() };
}
