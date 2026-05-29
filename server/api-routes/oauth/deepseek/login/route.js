import { NextResponse } from "#adapter/nextShim.js";
import { createProviderConnection, getProviderConnections, updateProviderConnection } from "#models";
import { getExecutor } from "#open-sse/executors/index.js";
import {
  buildDeepSeekConnectionName,
  normalizeDeepSeekWebCookieInput,
  normalizeDeepSeekWebTokenInput,
} from "#shared/utils/deepseekWebAuth.js";

export const dynamic = "force-dynamic";

function createRouteLogger(scope) {
  return {
    info: (...args) => console.log(`[${scope}]`, ...args),
    warn: (...args) => console.warn(`[${scope}]`, ...args),
    error: (...args) => console.error(`[${scope}]`, ...args),
    debug: (...args) => console.log(`[${scope}]`, ...args),
  };
}

function getDeepSeekCookieFailureMessage(result) {
  const code = result?.data?.code;
  const msg = typeof result?.data?.msg === "string" ? result.data.msg.trim() : "";

  if (code === 40002 || /missing token/i.test(msg)) {
    return "Cookie thiếu token xác thực DeepSeek. Chỉ có aws-waf-token hoặc ds_session_id là chưa đủ; hãy copy full cookie sau khi đã đăng nhập, hoặc dùng Web Login với userToken.";
  }

  if (result?.status === 401 || result?.status === 403) {
    return "DeepSeek từ chối cookie này. Hãy export cookie mới sau khi đăng nhập lại.";
  }

  return "Cookie login failed. Re-export a fresh DeepSeek cookie and try again.";
}

async function upsertDeepSeekConnection(payload) {
  const connections = await getProviderConnections({ provider: "deepseek-web" });
  const accountId = payload.providerSpecificData?.deepseekAccountId || payload.email || "";
  const existing = connections.find((connection) => {
    const sameAuthType = connection.authType === payload.authType;
    const sameEmail = payload.email && connection.email && connection.email === payload.email;
    const sameAccountId = accountId && connection.providerSpecificData?.deepseekAccountId === accountId;
    return sameAuthType && (sameEmail || sameAccountId);
  });

  if (existing) {
    return updateProviderConnection(existing.id, {
      ...payload,
      name: payload.name || existing.name,
      isActive: true,
      testStatus: payload.testStatus || "active",
    });
  }

  return createProviderConnection({
    ...payload,
    isActive: true,
    testStatus: payload.testStatus || "active",
  });
}

async function handlePasswordLogin(body, executor, log) {
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email/mobile and password are required" },
      { status: 400 },
    );
  }

  const token = await executor.login(email, password, log);
  if (!token) {
    return NextResponse.json(
      { error: "Login failed. Please check your credentials." },
      { status: 401 },
    );
  }

  const connection = await upsertDeepSeekConnection({
    provider: "deepseek-web",
    authType: "oauth",
    name: name || `DeepSeek (${email})`,
    email,
    accessToken: token,
    refreshToken: password,
    providerSpecificData: {
      email,
      deepseekAccountId: email,
      loginMethod: "oauth",
    },
    testStatus: "active",
  });

  return NextResponse.json({
    success: true,
    method: "oauth",
    token,
    connection: {
      id: connection.id,
      provider: connection.provider,
      name: connection.name,
      email: connection.email,
      authType: connection.authType,
    },
    message: "DeepSeek password login successful",
  });
}

async function handleCookieLogin(body, executor, log) {
  const rawCookie = typeof body.cookie === "string" ? body.cookie : "";
  const cookie = normalizeDeepSeekWebCookieInput(rawCookie);
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!cookie) {
    return NextResponse.json(
      { error: "Cookie is required" },
      { status: 400 },
    );
  }

  const result = await executor.loginWithCookie(cookie, log);
  if (!result) {
    const failure = await executor.fetchCurrentUser({ cookieHeader: cookie }, log);
    return NextResponse.json(
      { error: getDeepSeekCookieFailureMessage(failure) },
      { status: 401 },
    );
  }

  const profile = result.profile || {};
  const connection = await upsertDeepSeekConnection({
    provider: "deepseek-web",
    authType: "cookie",
    name: buildDeepSeekConnectionName(profile, name),
    email: profile.email || profile.mobile || profile.accountId || null,
    apiKey: result.cookieHeader,
    accessToken: result.accessToken || null,
    providerSpecificData: {
      ...(profile.email ? { email: profile.email } : {}),
      ...(profile.mobile ? { mobile: profile.mobile } : {}),
      ...(profile.accountId ? { deepseekAccountId: profile.accountId } : {}),
      webCookie: result.cookieHeader,
      cookie: result.cookieHeader,
      loginMethod: "cookie",
    },
    testStatus: "active",
  });

  return NextResponse.json({
    success: true,
    method: "cookie",
    connection: {
      id: connection.id,
      provider: connection.provider,
      name: connection.name,
      email: connection.email,
      authType: connection.authType,
    },
    message: "DeepSeek cookie login successful",
  });
}

async function handleBrowserLogin(body, executor, log) {
  const rawToken = typeof body.token === "string" ? body.token : "";
  const token = normalizeDeepSeekWebTokenInput(rawToken);
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!token) {
    return NextResponse.json(
      { error: "DeepSeek userToken is required" },
      { status: 400 },
    );
  }

  const result = await executor.loginWithToken(token, log);
  if (!result) {
    return NextResponse.json(
      { error: "Browser login failed. Paste a valid DeepSeek userToken from Local Storage or use the cookie method." },
      { status: 401 },
    );
  }

  const profile = result.profile || {};
  const connection = await upsertDeepSeekConnection({
    provider: "deepseek-web",
    authType: "oauth",
    name: buildDeepSeekConnectionName(profile, name),
    email: profile.email || profile.mobile || profile.accountId || null,
    accessToken: result.accessToken,
    refreshToken: token,
    providerSpecificData: {
      ...(profile.email ? { email: profile.email } : {}),
      ...(profile.mobile ? { mobile: profile.mobile } : {}),
      ...(profile.accountId ? { deepseekAccountId: profile.accountId } : {}),
      userToken: token,
      loginMethod: "browser",
    },
    testStatus: "active",
  });

  return NextResponse.json({
    success: true,
    method: "browser",
    connection: {
      id: connection.id,
      provider: connection.provider,
      name: connection.name,
      email: connection.email,
      authType: connection.authType,
    },
    message: "DeepSeek browser login successful",
  });
}

async function handleHeaderLogin(body, executor, log) {
  const rawHeaders = typeof body.headers === "string" ? body.headers : "";
  const token = normalizeDeepSeekWebTokenInput(rawHeaders);
  const cookie = normalizeDeepSeekWebCookieInput(rawHeaders);

  if (token) {
    return handleBrowserLogin({ ...body, token }, executor, log);
  }

  if (cookie) {
    return handleCookieLogin({ ...body, cookie }, executor, log);
  }

  return NextResponse.json(
    { error: "No DeepSeek Authorization or Cookie header found in the pasted request headers" },
    { status: 400 },
  );
}

// POST /api/oauth/deepseek/login - DeepSeek web login via password, cookie, or browser token
export async function POST(request) {
  try {
    const body = await request.json();
    const method = body?.method === "cookie"
      ? "cookie"
      : body?.method === "headers"
        ? "headers"
      : (body?.method === "browser" || body?.method === "token")
        ? "browser"
        : "oauth";

    const executor = getExecutor("deepseek-web");
    if (!executor || !executor.login || !executor.loginWithCookie || !executor.loginWithToken) {
      return NextResponse.json(
        { error: "DeepSeek executor not available" },
        { status: 500 },
      );
    }

    const log = createRouteLogger("DeepSeek Login");
    if (method === "cookie") {
      return handleCookieLogin(body, executor, log);
    }

    if (method === "browser") {
      return handleBrowserLogin(body, executor, log);
    }

    if (method === "headers") {
      return handleHeaderLogin(body, executor, log);
    }

    return handlePasswordLogin(body, executor, log);
  } catch (error) {
    console.error("DeepSeek OAuth login error:", error);
    return NextResponse.json(
      { error: error.message || "Login failed" },
      { status: 500 },
    );
  }
}
