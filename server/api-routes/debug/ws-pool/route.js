import { NextResponse } from "#adapter/nextShim.js";
import { getWsPool } from "#open-sse/services/wsPool.js";
import { getSessionAffinityMap } from "#open-sse/services/sessionAffinity.js";

export async function GET() {
  const pool = getWsPool();
  const affinity = getSessionAffinityMap();

  return NextResponse.json({
    wsPool: {
      size: pool.size(),
    },
    sessionAffinity: {
      size: affinity.size,
    },
  });
}
