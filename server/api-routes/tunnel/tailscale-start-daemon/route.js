"use server";

import { NextResponse } from "#adapter/nextShim.js";
import { startDaemonWithPassword } from "#lib/tunnel/tailscale.js";
import { getCachedPassword, loadEncryptedPassword, initDbHooks } from "#mitm/manager-esm.js";
import { getSettings, updateSettings } from "#lib/localDb.js";

initDbHooks(getSettings, updateSettings);

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    // Use provided password, or fall back to cached/stored MITM password
    const password = body.sudoPassword || getCachedPassword() || await loadEncryptedPassword() || "";
    await startDaemonWithPassword(password);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Tailscale start daemon error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
