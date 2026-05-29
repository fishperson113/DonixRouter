import { NextResponse } from "#adapter/nextShim.js";
import { KiroService } from "#lib/oauth/services/kiro.js";
import { createProviderConnection } from "#models";
import { randomBytes, createHash } from "crypto";

// In-memory store for pending cookie login sessions
const pendingSessions = new Map();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of pendingSessions) if (v.createdAt < cutoff) pendingSessions.delete(k);
}, 60_000).unref();

// Export for use by cookie-callback route
export { pendingSessions };

/**
 * POST /api/oauth/kiro/cookie-login
 * Login using browser AccessToken cookie from app.kiro.dev
 * 
 * Body: { accessToken: "aoaAAAAAG...", idp: "Google" }
 * 
 * Flow:
 * 1. Fetch CSRF from app.kiro.dev using cookie
 * 2. Call KiroWebPortalService.InitiateLogin (Smithy RPC v2 CBOR)
 * 3. Return Cognito redirect URL for user to open in browser
 * 4. User's Google session auto-approves → redirects to cookie-callback
 * 5. cookie-callback exchanges code via ExchangeToken CBOR → saves connection
 */
export async function POST(request) {
  try {
    const { accessToken, idp } = await request.json();

    if (!accessToken) {
      return NextResponse.json(
        { error: "accessToken cookie value is required" },
        { status: 400 }
      );
    }

    const kiroService = new KiroService();
    const provider = idp || "Google";

    // Step 1: Get CSRF + verify session
    const { csrf, userStatus } = await kiroService.fetchCsrf(accessToken, provider);

    if (userStatus === "anonymous") {
      return NextResponse.json(
        { error: "Cookie is not authenticated (user-status: anonymous)" },
        { status: 401 }
      );
    }

    // Step 2: Generate PKCE
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const state = randomBytes(32).toString("base64url");

    // Step 3: Call InitiateLogin via CBOR
    const redirectUrl = await kiroService.initiateLoginCbor(
      accessToken, provider, csrf, codeChallenge, state,
      "http://localhost:20128/api/oauth/kiro/cookie-callback"
    );

    // Store session for callback
    pendingSessions.set(state, {
      cookie: accessToken,
      idp: provider,
      csrf,
      codeVerifier,
      createdAt: Date.now(),
    });

    return NextResponse.json({
      success: true,
      redirectUrl,
      state,
      message: "Open redirectUrl in browser. Google will auto-approve if already logged in.",
    });
  } catch (error) {
    console.log("Kiro cookie login error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
