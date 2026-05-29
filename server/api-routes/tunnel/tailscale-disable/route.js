import { NextResponse } from "#adapter/nextShim.js";
import { disableTailscale } from "#lib/tunnel/tunnelManager.js";

export async function POST() {
  try {
    const result = await disableTailscale();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale disable error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
