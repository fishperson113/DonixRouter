import { fetchAllQuotas } from "#open-sse/services/quotaSnapshot.js";
import { getActiveConnectionIds } from "#lib/usageDb.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await fetchAllQuotas();
    return Response.json({
      ...snapshot,
      activeConnectionIds: getActiveConnectionIds(),
    });
  } catch {
    return Response.json({
      connections: [],
      quotas: {},
      activeConnectionIds: [],
      timestamp: new Date().toISOString(),
    });
  }
}
