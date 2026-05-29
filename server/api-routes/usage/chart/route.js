import { NextResponse } from "#adapter/nextShim.js";
import { getChartData } from "#lib/usageDb.js";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d"]);
const VALID_RANGES = new Set(["6h", "24h", "3d", "7d", "30d", "60d", "90d", "all"]);
const VALID_GRANULARITIES = new Set(["five_min", "hourly", "daily"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period");
    const range = searchParams.get("range");
    const granularity = searchParams.get("granularity");

    if (period && !VALID_PERIODS.has(period) && !range) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    if (range && !VALID_RANGES.has(range)) {
      return NextResponse.json({ error: "Invalid range" }, { status: 400 });
    }

    if (granularity && !VALID_GRANULARITIES.has(granularity)) {
      return NextResponse.json({ error: "Invalid granularity" }, { status: 400 });
    }

    const resolvedRange = range || period || "7d";
    const data = await getChartData({
      period: period || undefined,
      range: resolvedRange,
      granularity: granularity || undefined,
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }
}
