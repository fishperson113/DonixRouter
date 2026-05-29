import { NextResponse } from "#adapter/nextShim.js";
import { getSettings } from "#lib/localDb.js";

export async function GET() {
  try {
    const settings = await getSettings();
    const requireLogin = settings.requireLogin !== false;
    const tunnelDashboardAccess = settings.tunnelDashboardAccess !== false;
    const tunnelUrl = settings.tunnelUrl || "";
    const tailscaleUrl = settings.tailscaleUrl || "";
    return NextResponse.json({ requireLogin, tunnelDashboardAccess, tunnelUrl, tailscaleUrl });
  } catch (error) {
    return NextResponse.json({ requireLogin: true }, { status: 200 });
  }
}
