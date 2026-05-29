import { NextResponse } from "#adapter/nextShim.js";
import { cookies } from "#adapter/nextShim.js";
import { clearDashboardAuthCookie } from "#lib/auth/dashboardSession.js";

export async function POST() {
  const cookieStore = await cookies();
  clearDashboardAuthCookie(cookieStore);
  cookieStore.delete("oidc_state");
  cookieStore.delete("oidc_nonce");
  cookieStore.delete("oidc_code_verifier");
  return NextResponse.json({ success: true });
}
