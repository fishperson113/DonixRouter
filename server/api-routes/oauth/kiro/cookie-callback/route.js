import { NextResponse } from "#adapter/nextShim.js";
import { KiroService } from "#lib/oauth/services/kiro.js";
import { createProviderConnection } from "#models";

/**
 * GET /api/oauth/kiro/cookie-callback
 * Handles OAuth callback from Cognito after cookie-based InitiateLogin
 * Exchanges code for tokens via KiroWebPortalService.ExchangeToken (CBOR)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      return new Response(resultPage(false, error), {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (!code || !state) {
      return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
    }

    // Import pendingSessions from cookie-login route
    const { pendingSessions } = await import("../cookie-login/route.js");
    const session = pendingSessions.get(state);
    if (!session) {
      return new Response(resultPage(false, "Unknown or expired session. Try cookie-login again."), {
        headers: { "Content-Type": "text/html" },
      });
    }
    pendingSessions.delete(state);

    const kiroService = new KiroService();

    // Exchange code via CBOR ExchangeToken
    const tokens = await kiroService.exchangeTokenCbor(
      session.cookie,
      session.idp,
      session.csrf,
      code,
      session.codeVerifier,
      "http://localhost:20128/api/oauth/kiro/cookie-callback",
      state
    );

    // Extract email from JWT
    const email = kiroService.extractEmailFromJWT(tokens.accessToken);

    // Save connection
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokens.accessToken,
      refreshToken: null,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      email: email || null,
      providerSpecificData: {
        authMethod: "cookie",
        idp: session.idp,
        cookie: session.cookie,
        csrfToken: tokens.csrfToken,
      },
      testStatus: "active",
    });

    return new Response(resultPage(true, null, connection.id, email), {
      headers: { "Content-Type": "text/html" },
    });
  } catch (error) {
    console.log("Kiro cookie callback error:", error.message);
    return new Response(resultPage(false, error.message), {
      headers: { "Content-Type": "text/html" },
    });
  }
}

function resultPage(success, error, connectionId, email) {
  return `<!DOCTYPE html><html><head><title>Kiro Cookie Login</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#fff}
.card{background:#1a1a1a;border-radius:12px;padding:32px;max-width:400px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.5)}
.ok{color:#22c55e}.err{color:#ef4444}code{background:#2a2a2a;padding:2px 6px;border-radius:4px;font-size:13px}</style></head>
<body><div class="card">${success
    ? `<h2 class="ok">✓ Cookie Login Successful</h2><p>Connection: <code>${connectionId}</code></p>${email ? `<p>Email: ${email}</p>` : ""}<p>You can close this tab.</p>`
    : `<h2 class="err">✗ Login Failed</h2><p>${error}</p>`
}</div></body></html>`;
}
