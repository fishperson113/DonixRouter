import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { ERROR_TYPES } from "../config/errorConfig.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import {
  extractDeepSeekAccessTokenFromCookie,
  extractDeepSeekProfile,
  normalizeDeepSeekWebCookieInput,
  normalizeDeepSeekWebTokenInput,
} from "#shared/utils/deepseekWebAuth.js";
import {
  asString,
  createDeepSeekContinueState,
  numberValue,
  observeDeepSeekContinueState,
  parseDeepSeekChunkForContent,
  prepareDeepSeekContinueStateForNextRound,
  shouldAutoContinueDeepSeek,
  trimContinuationOverlap,
} from "../utils/deepseekWeb.js";
import {
  createDeepSeekToolCallState,
  flushDeepSeekToolText,
  processDeepSeekToolText,
} from "../utils/deepseekToolCalls.js";
import { resolveDeepSeekFlags, resolveDeepSeekModelClass } from "../translator/request/deepseek-flags.js";

const LOGIN_URL = "https://chat.deepseek.com/api/v0/users/login";
const CREATE_SESSION_URL = "https://chat.deepseek.com/api/v0/chat_session/create";
const CREATE_POW_URL = "https://chat.deepseek.com/api/v0/chat/create_pow_challenge";
const COMPLETION_URL = "https://chat.deepseek.com/api/v0/chat/completion";
const CONTINUE_URL = "https://chat.deepseek.com/api/v0/chat/continue";
const USER_INFO_URL = "https://chat.deepseek.com/api/v0/users/current";
const DEFAULT_POW_WASM_URL = "https://fe-static.deepseek.com/chat/static/sha3_wasm_bg.7b9ca65ddd.wasm";
const COMPLETION_TARGET_PATH = "/api/v0/chat/completion";
const CONTINUE_TARGET_PATH = "/api/v0/chat/continue";
const POW_CACHE_TTL_MS = 5 * 60 * 1000;
const POW_CACHE_SKEW_MS = 2_000;
const DEFAULT_AUTO_CONTINUE_LIMIT = 8;
const EMPTY_OUTPUT_RETRY_SUFFIX = "Previous reply had no visible output. Please regenerate the visible final answer or tool call now.";
const EMPTY_OUTPUT_RETRY_MAX_ATTEMPTS = 1;
const DEEPSEEK_BROWSER_LOGIN_METHODS = new Set(["browser", "token", "web", "redirect", "oauth-browser"]);

const AUTH_KEYWORDS = [
  "token",
  "unauthorized",
  "expired",
  "not login",
  "login required",
  "invalid jwt",
  "session expired",
  "credential",
  "authorization",
  "auth",
];

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808An, 0x8000000080008000n,
  0x000000000000808Bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008An, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000An,
  0x000000008000808Bn, 0x800000000000008Bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800An, 0x800000008000000An,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

function rotl64(value, shift) {
  const mask = (1n << 64n) - 1n;
  return ((value << BigInt(shift)) | (value >> (64n - BigInt(shift)))) & mask;
}

function keccakF23(state) {
  let [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24] = state;

  for (let round = 1; round < 24; round += 1) {
    const c0 = a0 ^ a5 ^ a10 ^ a15 ^ a20;
    const c1 = a1 ^ a6 ^ a11 ^ a16 ^ a21;
    const c2 = a2 ^ a7 ^ a12 ^ a17 ^ a22;
    const c3 = a3 ^ a8 ^ a13 ^ a18 ^ a23;
    const c4 = a4 ^ a9 ^ a14 ^ a19 ^ a24;
    const d0 = c4 ^ rotl64(c1, 1);
    const d1 = c0 ^ rotl64(c2, 1);
    const d2 = c1 ^ rotl64(c3, 1);
    const d3 = c2 ^ rotl64(c4, 1);
    const d4 = c3 ^ rotl64(c0, 1);

    a0 ^= d0; a5 ^= d0; a10 ^= d0; a15 ^= d0; a20 ^= d0;
    a1 ^= d1; a6 ^= d1; a11 ^= d1; a16 ^= d1; a21 ^= d1;
    a2 ^= d2; a7 ^= d2; a12 ^= d2; a17 ^= d2; a22 ^= d2;
    a3 ^= d3; a8 ^= d3; a13 ^= d3; a18 ^= d3; a23 ^= d3;
    a4 ^= d4; a9 ^= d4; a14 ^= d4; a19 ^= d4; a24 ^= d4;

    const b0 = a0;
    const b10 = rotl64(a1, 1);
    const b20 = rotl64(a2, 62);
    const b5 = rotl64(a3, 28);
    const b15 = rotl64(a4, 27);
    const b16 = rotl64(a5, 36);
    const b1 = rotl64(a6, 44);
    const b11 = rotl64(a7, 6);
    const b21 = rotl64(a8, 55);
    const b6 = rotl64(a9, 20);
    const b7 = rotl64(a10, 3);
    const b17 = rotl64(a11, 10);
    const b2 = rotl64(a12, 43);
    const b12 = rotl64(a13, 25);
    const b22 = rotl64(a14, 39);
    const b23 = rotl64(a15, 41);
    const b8 = rotl64(a16, 45);
    const b18 = rotl64(a17, 15);
    const b3 = rotl64(a18, 21);
    const b13 = rotl64(a19, 8);
    const b14 = rotl64(a20, 18);
    const b24 = rotl64(a21, 2);
    const b9 = rotl64(a22, 61);
    const b19 = rotl64(a23, 56);
    const b4 = rotl64(a24, 14);

    a0 = b0 ^ (~b1 & b2); a1 = b1 ^ (~b2 & b3); a2 = b2 ^ (~b3 & b4); a3 = b3 ^ (~b4 & b0); a4 = b4 ^ (~b0 & b1);
    a5 = b5 ^ (~b6 & b7); a6 = b6 ^ (~b7 & b8); a7 = b7 ^ (~b8 & b9); a8 = b8 ^ (~b9 & b5); a9 = b9 ^ (~b5 & b6);
    a10 = b10 ^ (~b11 & b12); a11 = b11 ^ (~b12 & b13); a12 = b12 ^ (~b13 & b14); a13 = b13 ^ (~b14 & b10); a14 = b14 ^ (~b10 & b11);
    a15 = b15 ^ (~b16 & b17); a16 = b16 ^ (~b17 & b18); a17 = b17 ^ (~b18 & b19); a18 = b18 ^ (~b19 & b15); a19 = b19 ^ (~b15 & b16);
    a20 = b20 ^ (~b21 & b22); a21 = b21 ^ (~b22 & b23); a22 = b22 ^ (~b23 & b24); a23 = b23 ^ (~b24 & b20); a24 = b24 ^ (~b20 & b21);

    a0 ^= RC[round];
  }

  return [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24];
}

export function deepSeekHashV1(data) {
  const rate = 136;
  let state = new Array(25).fill(0n);
  const buffer = Buffer.from(data);

  let offset = 0;
  while (offset + rate <= buffer.length) {
    for (let i = 0; i < rate / 8; i += 1) {
      state[i] ^= buffer.readBigUInt64LE(offset + i * 8);
    }
    state = keccakF23(state);
    offset += rate;
  }

  const finalBlock = Buffer.alloc(rate);
  buffer.copy(finalBlock, 0, offset);
  finalBlock[buffer.length - offset] = 0x06;
  finalBlock[rate - 1] |= 0x80;

  for (let i = 0; i < rate / 8; i += 1) {
    state[i] ^= finalBlock.readBigUInt64LE(i * 8);
  }
  state = keccakF23(state);

  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i += 1) {
    out.writeBigUInt64LE(state[i], i * 8);
  }
  return out;
}

export function deepSeekHashV1Hex(data) {
  return deepSeekHashV1(data).toString("hex");
}

function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractResponseStatus(data) {
  const code = numberValue(data?.code);
  const bizCode = numberValue(data?.data?.biz_code);
  const msg = asString(data?.msg);
  const bizMsg = asString(data?.data?.biz_msg || data?.data?.biz_data?.msg);
  return { code, bizCode, msg, bizMsg };
}

function isBizSuccess(status, data) {
  const { code, bizCode } = extractResponseStatus(data);
  return status === 200 && code === 0 && bizCode === 0;
}

function looksLikeAuthFailure(status, data) {
  if (status === 401 || status === 403) {
    return true;
  }

  const { code, bizCode, msg, bizMsg } = extractResponseStatus(data);
  if ([40001, 40002, 40003].includes(code) || [40001, 40002, 40003].includes(bizCode)) {
    return true;
  }

  const combined = `${msg} ${bizMsg}`.toLowerCase();
  return AUTH_KEYWORDS.some((keyword) => combined.includes(keyword));
}

function extractCreateSessionID(data) {
  const bizData = data?.data?.biz_data;
  if (typeof bizData?.id === "string" && bizData.id.trim()) {
    return bizData.id.trim();
  }
  if (typeof bizData?.chat_session?.id === "string" && bizData.chat_session.id.trim()) {
    return bizData.chat_session.id.trim();
  }
  return "";
}

function buildDeepSeekProfileProviderSpecificData(profile = {}, fallback = {}) {
  const email = asString(profile?.email || fallback?.email);
  const mobile = asString(profile?.mobile);
  const accountId = asString(profile?.accountId || fallback?.deepseekAccountId || email || mobile);

  return {
    ...(fallback || {}),
    ...(email ? { email } : {}),
    ...(mobile ? { mobile } : {}),
    ...(accountId ? { deepseekAccountId: accountId } : {}),
  };
}

function buildLoginPayload(email, password) {
  const payload = {
    password: password.trim(),
    device_id: "deepseek_donixrouter",
    os: "android",
  };

  if (email.includes("@")) {
    payload.email = email.trim();
  } else {
    payload.mobile = email.trim();
    payload.area_code = "+86";
  }

  return payload;
}

function mergeProviderSpecificData(credentials, loginId) {
  return {
    ...(credentials?.providerSpecificData || {}),
    email: loginId,
    deepseekAccountId: loginId,
    loginMethod: credentials?.providerSpecificData?.loginMethod || "oauth",
  };
}

function appendEmptyOutputRetrySuffix(text) {
  const base = asString(text).trimEnd();
  if (!base) {
    return EMPTY_OUTPUT_RETRY_SUFFIX;
  }
  return `${base}\n\n${EMPTY_OUTPUT_RETRY_SUFFIX}`;
}

function cloneCompletionPayloadForEmptyOutputRetry(payload, parentMessageID) {
  const clone = { ...(payload || {}) };
  if (Object.prototype.hasOwnProperty.call(clone, "message")) {
    clone.message = appendEmptyOutputRetrySuffix(clone.message);
  } else if (Object.prototype.hasOwnProperty.call(clone, "prompt")) {
    clone.prompt = appendEmptyOutputRetrySuffix(clone.prompt);
  }
  if (parentMessageID && parentMessageID > 0) {
    clone.parent_message_id = parentMessageID;
  }
  return clone;
}

function buildRefreshedCredentialsSnapshot(
  credentials,
  originalAccessToken,
  originalRefreshToken,
  originalProviderSpecificDataJson,
) {
  if (!credentials?.accessToken) {
    return null;
  }

  const providerSpecificDataJson = JSON.stringify(credentials?.providerSpecificData || null);
  if (
    credentials.accessToken === originalAccessToken &&
    credentials.refreshToken === originalRefreshToken &&
    providerSpecificDataJson === originalProviderSpecificDataJson
  ) {
    return null;
  }

  return {
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    providerSpecificData: credentials.providerSpecificData,
  };
}

function createDeepSeekStreamObservationState() {
  return {
    currentType: "text",
    outputText: "",
    thinkingText: "",
    hadToolCalls: false,
    contentFilter: false,
    errorMessage: "",
    toolTextState: createDeepSeekToolCallState(),
  };
}

function observeDeepSeekStreamObservationState(state, chunk) {
  if (!state || !chunk || typeof chunk !== "object") {
    return;
  }

  const parsed = parseDeepSeekChunkForContent(chunk, true, state.currentType);
  if (!parsed?.parsed) {
    return;
  }

  state.currentType = parsed.newType || state.currentType;
  if (parsed.contentFilter) {
    state.contentFilter = true;
  }
  if (parsed.errorMessage) {
    state.errorMessage = parsed.errorMessage;
  }

  for (const part of parsed.parts || []) {
    if (!part?.text) {
      continue;
    }

    if (part.type === "thinking") {
      const nextThinking = trimContinuationOverlap(state.thinkingText, part.text);
      if (nextThinking) {
        state.thinkingText += nextThinking;
      }
      continue;
    }

    const nextText = trimContinuationOverlap(state.outputText, part.text);
    if (!nextText) {
      continue;
    }
    state.outputText += nextText;

    const toolEvents = processDeepSeekToolText(state.toolTextState, nextText);
    for (const event of toolEvents) {
      if (event.type === "tool_calls" && Array.isArray(event.calls) && event.calls.length > 0) {
        state.hadToolCalls = true;
      }
    }
  }
}

function finalizeDeepSeekStreamObservationState(state) {
  if (!state) {
    return;
  }

  const toolEvents = flushDeepSeekToolText(state.toolTextState);
  for (const event of toolEvents) {
    if (event.type === "tool_calls" && Array.isArray(event.calls) && event.calls.length > 0) {
      state.hadToolCalls = true;
    }
  }
}

function shouldRetryDeepSeekEmptyOutput(state) {
  if (!state || state.contentFilter || state.hadToolCalls) {
    return false;
  }
  return state.outputText.trim() === "";
}

function hasVisibleDeepSeekOutput(state) {
  if (!state) {
    return false;
  }
  return state.hadToolCalls === true || state.outputText.trim() !== "";
}

function getOpenAIStreamErrorType(statusCode) {
  return ERROR_TYPES[statusCode]?.type || (statusCode >= 500 ? "server_error" : "invalid_request_error");
}

function upstreamEmptyOutputDetail(state) {
  if (state?.contentFilter) {
    return {
      status: 400,
      message: "Upstream content filtered the response and returned no output.",
      code: "content_filter",
    };
  }
  if (state?.thinkingText?.trim()) {
    return {
      status: 429,
      message: "Upstream account hit a rate limit and returned reasoning without visible output.",
      code: "upstream_empty_output",
    };
  }
  return {
    status: 503,
    message: "Upstream service is unavailable and returned no output.",
    code: "upstream_unavailable",
  };
}

function buildDeepSeekTerminalErrorChunk(state) {
  if (!state || state.hadToolCalls || state.outputText.trim() !== "") {
    return null;
  }

  const detail = upstreamEmptyOutputDetail(state);
  return {
    _deepseekWebTerminalError: true,
    status_code: detail.status,
    error: {
      message: detail.message,
      type: getOpenAIStreamErrorType(detail.status),
      code: detail.code,
      param: null,
    },
  };
}

function buildDeepSeekErrorPayload(detail) {
  return {
    error: {
      message: detail.message,
      type: getOpenAIStreamErrorType(detail.status),
      code: detail.code,
      param: null,
    },
  };
}

function createDeepSeekPreparedStage(type, body, completionPayload = null) {
  return {
    type,
    body,
    completionPayload,
  };
}

function createDeepSeekTerminalErrorResponse(state) {
  const chunk = buildDeepSeekTerminalErrorChunk(state);
  if (!chunk) {
    return null;
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

function createDeepSeekFallbackErrorResponse(state) {
  const detail = upstreamEmptyOutputDetail(state);
  return new Response(JSON.stringify(buildDeepSeekErrorPayload(detail)), {
    status: detail.status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function applyPreparedStageTransition(stage, sessionID, continueState, activeCompletionPayload) {
  if (!stage?.body) {
    return {
      currentBody: null,
      continueState,
      activeCompletionPayload,
    };
  }

  if (stage.type === "continue") {
    return {
      currentBody: stage.body,
      continueState: prepareDeepSeekContinueStateForNextRound(continueState),
      activeCompletionPayload,
    };
  }

  if (stage.type === "retry") {
    return {
      currentBody: stage.body,
      continueState: createDeepSeekContinueState(sessionID),
      activeCompletionPayload: stage.completionPayload ? { ...stage.completionPayload } : activeCompletionPayload,
    };
  }

  return {
    currentBody: stage.body,
    continueState,
    activeCompletionPayload: stage.completionPayload ? { ...stage.completionPayload } : activeCompletionPayload,
  };
}

function abortIfNeeded(signal) {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason || new DOMException("The operation was aborted", "AbortError");
}

export class DeepSeekWebExecutor extends BaseExecutor {
  constructor() {
    super("deepseek-web", PROVIDERS["deepseek-web"]);
    this._powCache = new Map();
    this._powWasm = null;
    this._powWasmLoadPromise = null;
    this._powWasmUrl = asString(this.config?.powWasmUrl) || DEFAULT_POW_WASM_URL;
  }

  getCacheKey(credentials) {
    return (
      credentials?.connectionId ||
      credentials?.providerSpecificData?.deepseekAccountId ||
      credentials?.deepseekAccountId ||
      credentials?.providerSpecificData?.email ||
      credentials?.email ||
      "default"
    );
  }

  getPowCacheKey(credentials, targetPath) {
    return `${this.getCacheKey(credentials)}:${targetPath}`;
  }

  clearCaches(credentials) {
    const accountKey = this.getCacheKey(credentials);
    for (const key of this._powCache.keys()) {
      if (key.startsWith(`${accountKey}:`)) {
        this._powCache.delete(key);
      }
    }
  }

  shouldReusePowResponse(targetPath) {
    return targetPath !== COMPLETION_TARGET_PATH;
  }

  getPowCacheExpiry(challenge) {
    const expireAt = numberValue(challenge?.expire_at ?? challenge?.expireAt);
    if (Number.isFinite(expireAt) && expireAt > Date.now()) {
      const boundedExpiry = Math.min(expireAt - POW_CACHE_SKEW_MS, Date.now() + POW_CACHE_TTL_MS);
      if (boundedExpiry > Date.now()) {
        return boundedExpiry;
      }
    }
    return Date.now() + POW_CACHE_TTL_MS;
  }

  buildHeaders(credentials, stream = true) {
    const cookieHeader = this.getCookieHeader(credentials);
    const accessToken =
      credentials?.accessToken ||
      normalizeDeepSeekWebTokenInput(credentials?.providerSpecificData?.userToken) ||
      extractDeepSeekAccessTokenFromCookie(cookieHeader);
    const headers = {
      Host: "chat.deepseek.com",
      Accept: "application/json",
      "Content-Type": "application/json",
      "accept-charset": "UTF-8",
      "User-Agent": "DeepSeek/2.0.4 Android/35",
      "x-client-platform": "android",
      "x-client-version": "2.0.4",
      "x-client-locale": "zh_CN",
      ...(this.config?.headers || {}),
    };

    if (accessToken) {
      headers.authorization = `Bearer ${accessToken}`;
    }
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
    if (stream) {
      headers.Accept = "text/event-stream";
    }

    return headers;
  }

  getCookieHeader(credentials) {
    const rawCookie =
      credentials?.providerSpecificData?.webCookie ||
      credentials?.providerSpecificData?.cookie ||
      (credentials?.authType === "cookie" ? credentials?.apiKey : "");
    return normalizeDeepSeekWebCookieInput(rawCookie);
  }

  async login(email, password, log, proxyOptions = null) {
    try {
      const response = await proxyAwareFetch(
        LOGIN_URL,
        {
          method: "POST",
          headers: this.buildHeaders(null, false),
          body: JSON.stringify(buildLoginPayload(email, password)),
        },
        proxyOptions,
      );

      const data = await response.json().catch(() => null);
      if (isBizSuccess(response.status, data)) {
        const token = data?.data?.biz_data?.user?.token;
        if (token) {
          log?.info?.("TOKEN", "deepseek-web login successful");
          return token;
        }
      }

      log?.error?.("TOKEN", `deepseek-web login failed: ${data?.msg || response.status}`);
      return null;
    } catch (error) {
      log?.error?.("TOKEN", `deepseek-web login error: ${error.message}`);
      return null;
    }
  }

  async fetchCurrentUser(auth, log, proxyOptions = null, signal = null) {
    const cookieHeader = normalizeDeepSeekWebCookieInput(
      auth?.cookieHeader ||
      auth?.cookie ||
      auth?.providerSpecificData?.webCookie ||
      auth?.providerSpecificData?.cookie,
    );
    const accessToken = auth?.accessToken || extractDeepSeekAccessTokenFromCookie(cookieHeader);

    try {
      const response = await proxyAwareFetch(
        USER_INFO_URL,
        {
          method: "GET",
          headers: this.buildHeaders({
            accessToken,
            providerSpecificData: cookieHeader ? { webCookie: cookieHeader } : null,
          }, false),
          signal,
        },
        proxyOptions,
      );

      const text = await response.text();
      const data = safeJsonParse(text);
      const profile = extractDeepSeekProfile(data);
      const ok = response.ok && !!(profile.accountId || profile.email || profile.mobile || profile.name);

      if (!ok) {
        log?.warn?.("TOKEN", `deepseek-web current user lookup failed: ${response.status}`);
      }

      return {
        ok,
        status: response.status,
        data,
        profile,
        accessToken,
        cookieHeader,
      };
    } catch (error) {
      log?.error?.("TOKEN", `deepseek-web current user lookup error: ${error.message}`);
      return {
        ok: false,
        status: 0,
        data: null,
        profile: extractDeepSeekProfile(null),
        accessToken,
        cookieHeader,
        error,
      };
    }
  }

  async loginWithCookie(cookieInput, log, proxyOptions = null, signal = null) {
    const cookieHeader = normalizeDeepSeekWebCookieInput(cookieInput);
    if (!cookieHeader) {
      return null;
    }

    const result = await this.fetchCurrentUser(
      { cookieHeader, accessToken: extractDeepSeekAccessTokenFromCookie(cookieHeader) },
      log,
      proxyOptions,
      signal,
    );

    if (!result.ok) {
      return null;
    }

    return {
      accessToken: result.accessToken || "",
      cookieHeader,
      profile: result.profile,
      data: result.data,
    };
  }

  async loginWithToken(tokenInput, log, proxyOptions = null, signal = null) {
    const accessToken = normalizeDeepSeekWebTokenInput(tokenInput);
    if (!accessToken) {
      return null;
    }

    const result = await this.fetchCurrentUser(
      { accessToken },
      log,
      proxyOptions,
      signal,
    );

    if (!result.ok) {
      return null;
    }

    return {
      accessToken,
      profile: result.profile,
      data: result.data,
    };
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    const cookieHeader = this.getCookieHeader(credentials);
    const loginMethod = credentials?.providerSpecificData?.loginMethod || credentials?.authType;

    if (DEEPSEEK_BROWSER_LOGIN_METHODS.has(loginMethod)) {
      const storedToken = normalizeDeepSeekWebTokenInput(
        credentials?.providerSpecificData?.userToken ||
        credentials?.refreshToken ||
        credentials?.accessToken,
      );
      if (!storedToken) {
        return null;
      }

      const tokenLogin = await this.loginWithToken(storedToken, log, proxyOptions);
      if (!tokenLogin) {
        return null;
      }

      return {
        accessToken: tokenLogin.accessToken,
        refreshToken: storedToken,
        providerSpecificData: {
          ...buildDeepSeekProfileProviderSpecificData(tokenLogin.profile, credentials?.providerSpecificData || {}),
          userToken: storedToken,
          loginMethod,
        },
      };
    }

    if (cookieHeader && loginMethod === "cookie") {
      const cookieLogin = await this.loginWithCookie(cookieHeader, log, proxyOptions);
      if (!cookieLogin) {
        return null;
      }

      return {
        accessToken: cookieLogin.accessToken || credentials?.accessToken || "",
        refreshToken: credentials?.refreshToken,
        providerSpecificData: {
          ...buildDeepSeekProfileProviderSpecificData(cookieLogin.profile, credentials?.providerSpecificData || {}),
          webCookie: cookieLogin.cookieHeader,
          cookie: cookieLogin.cookieHeader,
          loginMethod: "cookie",
        },
      };
    }

    const loginId =
      credentials?.providerSpecificData?.email ||
      credentials?.email ||
      credentials?.providerSpecificData?.deepseekAccountId ||
      credentials?.deepseekAccountId;
    const password = credentials?.refreshToken;

    if (!loginId || !password) {
      return null;
    }

    const token = await this.login(loginId, password, log, proxyOptions);
    if (!token) {
      return null;
    }

    this.clearCaches(credentials);
    return {
      accessToken: token,
      refreshToken: password,
      providerSpecificData: mergeProviderSpecificData(credentials, loginId),
    };
  }

  applyCredentialsUpdate(credentials, refreshedCredentials) {
    if (!credentials || !refreshedCredentials) {
      return;
    }

    if (refreshedCredentials.accessToken) {
      credentials.accessToken = refreshedCredentials.accessToken;
    }
    if (refreshedCredentials.refreshToken) {
      credentials.refreshToken = refreshedCredentials.refreshToken;
    }
    if (refreshedCredentials.providerSpecificData) {
      credentials.providerSpecificData = {
        ...(credentials.providerSpecificData || {}),
        ...refreshedCredentials.providerSpecificData,
      };
    }
  }

  async maybeRefreshCredentials(credentials, log, proxyOptions = null, onCredentialsRefreshed = null) {
    const refreshedCredentials = await this.refreshCredentials(credentials, log, proxyOptions);
    if (!refreshedCredentials?.accessToken) {
      return null;
    }
    this.applyCredentialsUpdate(credentials, refreshedCredentials);
    if (onCredentialsRefreshed) {
      try {
        await onCredentialsRefreshed(refreshedCredentials);
      } catch (error) {
        log?.warn?.("TOKEN", `persist deepseek-web refreshed credentials failed: ${error.message}`);
      }
    }
    return refreshedCredentials;
  }

  async postJson(url, payload, { credentials, log, proxyOptions = null, signal = null, extraHeaders = {}, allowRefresh = true, onCredentialsRefreshed = null }) {
    abortIfNeeded(signal);

    const response = await proxyAwareFetch(
      url,
      {
        method: "POST",
        headers: {
          ...this.buildHeaders(credentials, false),
          ...extraHeaders,
        },
        body: JSON.stringify(payload),
        signal,
      },
      proxyOptions,
    );

    const text = await response.text();
    const data = safeJsonParse(text);

    if (allowRefresh && looksLikeAuthFailure(response.status, data)) {
      const refreshedCredentials = await this.maybeRefreshCredentials(
        credentials,
        log,
        proxyOptions,
        onCredentialsRefreshed,
      );
      if (refreshedCredentials?.accessToken) {
        return this.postJson(url, payload, {
          credentials,
          log,
          proxyOptions,
          signal,
          extraHeaders,
          allowRefresh: false,
          onCredentialsRefreshed,
        });
      }
    }

    return { status: response.status, data };
  }

  async postStream(url, payload, { credentials, log, proxyOptions = null, signal = null, extraHeaders = {}, allowRefresh = true, onCredentialsRefreshed = null }) {
    abortIfNeeded(signal);

    const response = await proxyAwareFetch(
      url,
      {
        method: "POST",
        headers: {
          ...this.buildHeaders(credentials, true),
          ...extraHeaders,
        },
        body: JSON.stringify(payload),
        signal,
      },
      proxyOptions,
    );

    if (allowRefresh && (response.status === 401 || response.status === 403)) {
      try {
        await response.body?.cancel?.();
      } catch {}

      const refreshedCredentials = await this.maybeRefreshCredentials(
        credentials,
        log,
        proxyOptions,
        onCredentialsRefreshed,
      );
      if (refreshedCredentials?.accessToken) {
        return this.postStream(url, payload, {
          credentials,
          log,
          proxyOptions,
          signal,
          extraHeaders,
          allowRefresh: false,
          onCredentialsRefreshed,
        });
      }
    }

    return { response };
  }

  async createSession(credentials, log, proxyOptions = null, signal = null) {
    const { status, data } = await this.postJson(
      CREATE_SESSION_URL,
      { agent: "chat" },
      { credentials, log, proxyOptions, signal },
    );

    if (isBizSuccess(status, data)) {
      const sessionID = extractCreateSessionID(data);
      if (sessionID) {
        return sessionID;
      }
    }

    const { msg, bizMsg } = extractResponseStatus(data);
    throw new Error(`DeepSeek session creation failed: ${bizMsg || msg || status}`);
  }

  async loadPowWasm(proxyOptions = null, signal = null) {
    if (this._powWasm) {
      return this._powWasm;
    }

    if (!this._powWasmLoadPromise) {
      this._powWasmLoadPromise = (async () => {
        const response = await proxyAwareFetch(
          this._powWasmUrl,
          {
            method: "GET",
            signal,
          },
          proxyOptions,
        );

        if (!response.ok) {
          throw new Error(`DeepSeek PoW wasm fetch failed with status ${response.status}`);
        }

        const wasmBuffer = await response.arrayBuffer();
        const { instance } = await WebAssembly.instantiate(wasmBuffer, {});
        const wasm = instance?.exports;
        if (
          !wasm?.memory ||
          typeof wasm.wasm_solve !== "function" ||
          typeof wasm.__wbindgen_export_0 !== "function" ||
          typeof wasm.__wbindgen_add_to_stack_pointer !== "function"
        ) {
          throw new Error("DeepSeek PoW wasm exports are invalid");
        }

        this._powWasm = {
          wasm,
          encoder: new TextEncoder(),
        };
        return this._powWasm;
      })().catch((error) => {
        this._powWasmLoadPromise = null;
        throw error;
      });
    }

    return this._powWasmLoadPromise;
  }

  async solvePowWithWasm(challenge, log, proxyOptions = null, signal = null) {
    abortIfNeeded(signal);

    const challengeHex = asString(challenge?.challenge);
    const salt = asString(challenge?.salt);
    const expireAt = asString(challenge?.expire_at ?? challenge?.expireAt);
    const difficulty = numberValue(challenge?.difficulty) || 0;

    if (!challengeHex || !salt || !expireAt || difficulty <= 0) {
      throw new Error("DeepSeek PoW challenge is invalid");
    }

    const { wasm, encoder } = await this.loadPowWasm(proxyOptions, signal);
    const memoryU8 = () => new Uint8Array(wasm.memory.buffer);
    const memoryDV = () => new DataView(wasm.memory.buffer);
    const passString = (value) => {
      const bytes = encoder.encode(String(value));
      const ptr = wasm.__wbindgen_export_0(bytes.length, 1) >>> 0;
      memoryU8().set(bytes, ptr);
      return { ptr, len: bytes.length };
    };

    const prefix = `${salt}_${expireAt}_`;
    log?.debug?.("POW", `deepseek-web solving challenge with wasm difficulty=${difficulty}`);

    const retPtr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const challengeBuf = passString(challengeHex);
    const prefixBuf = passString(prefix);

    try {
      wasm.wasm_solve(
        retPtr,
        challengeBuf.ptr,
        challengeBuf.len,
        prefixBuf.ptr,
        prefixBuf.len,
        difficulty,
      );
      const okFlag = memoryDV().getInt32(retPtr + 0, true);
      const answerFloat = memoryDV().getFloat64(retPtr + 8, true);
      if (okFlag === 0 || !Number.isFinite(answerFloat)) {
        throw new Error("DeepSeek PoW wasm solver returned no answer");
      }
      return Math.trunc(answerFloat);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }

  async solvePow(challenge, log, signal = null, proxyOptions = null) {
    const challengeHex = asString(challenge?.challenge);
    const salt = asString(challenge?.salt);
    const expireAt = numberValue(challenge?.expire_at);
    const difficulty = numberValue(challenge?.difficulty) || 144000;

    if (challengeHex.length !== 64) {
      throw new Error("DeepSeek PoW challenge is invalid");
    }

    try {
      return await this.solvePowWithWasm(challenge, log, proxyOptions, signal);
    } catch (error) {
      log?.warn?.("POW", `deepseek-web wasm fallback to js: ${error.message}`);
    }

    const target = Buffer.from(challengeHex, "hex");
    const t0 = target.readBigUInt64LE(0);
    const t1 = target.readBigUInt64LE(8);
    const t2 = target.readBigUInt64LE(16);
    const t3 = target.readBigUInt64LE(24);
    const prefix = `${salt}_${expireAt}_`;

    log?.debug?.("POW", `deepseek-web solving challenge difficulty=${difficulty}`);

    for (let nonce = 0; nonce < difficulty; nonce += 1) {
      if (nonce % 2048 === 0) {
        abortIfNeeded(signal);
      }

      const hash = deepSeekHashV1(prefix + nonce);
      if (
        hash.readBigUInt64LE(0) === t0 &&
        hash.readBigUInt64LE(8) === t1 &&
        hash.readBigUInt64LE(16) === t2 &&
        hash.readBigUInt64LE(24) === t3
      ) {
        return nonce;
      }
    }

    throw new Error("DeepSeek PoW challenge could not be solved");
  }

  buildPowHeader(challenge, answer) {
    return Buffer.from(
      JSON.stringify({
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        salt: challenge.salt,
        answer,
        signature: challenge.signature,
        target_path: challenge.target_path,
      }),
    ).toString("base64");
  }

  async getPowResponse(
    credentials,
    targetPath,
    log,
    proxyOptions = null,
    signal = null,
    onCredentialsRefreshed = null,
  ) {
    const cacheKey = this.getPowCacheKey(credentials, targetPath);
    const cached = this._powCache.get(cacheKey);
    if (this.shouldReusePowResponse(targetPath) && cached && cached.expiresAt > Date.now()) {
      return cached.powResponse;
    }

    const { status, data } = await this.postJson(
      CREATE_POW_URL,
      { target_path: targetPath },
      { credentials, log, proxyOptions, signal, onCredentialsRefreshed },
    );

    if (!isBizSuccess(status, data)) {
      const { msg, bizMsg } = extractResponseStatus(data);
      throw new Error(`DeepSeek PoW challenge request failed: ${bizMsg || msg || status}`);
    }

    const challenge = data?.data?.biz_data?.challenge;
    if (!challenge) {
      throw new Error("DeepSeek PoW challenge was empty");
    }

    const answer = await this.solvePow(challenge, log, signal, proxyOptions);
    const powResponse = this.buildPowHeader(challenge, answer);
    if (this.shouldReusePowResponse(targetPath)) {
      this._powCache.set(cacheKey, {
        powResponse,
        expiresAt: this.getPowCacheExpiry(challenge),
      });
    }
    return powResponse;
  }

  transformRequest(model, body) {
    // Already in DeepSeek format (check both old 'message' and new 'prompt' field)
    if ((body?.message !== undefined || body?.prompt !== undefined) && body?.model_class !== undefined) {
      const { searchEnabled, thinkingEnabled } = resolveDeepSeekFlags(model, body);
      return {
        ...body,
        search_enabled: body.search_enabled ?? searchEnabled,
        thinking_enabled: body.thinking_enabled ?? thinkingEnabled,
      };
    }

    const messages = body?.messages || [];
    let systemMessage = "";
    const conversationMessages = [];

    for (const message of messages) {
      if (message.role === "system") {
        const content = extractTextContent(message.content);
        if (content) {
          systemMessage += (systemMessage ? "\n\n" : "") + content;
        }
      } else {
        conversationMessages.push({
          role: message.role,
          content: extractTextContent(message.content),
        });
      }
    }

    const lastMessage = conversationMessages[conversationMessages.length - 1];
    const { searchEnabled, thinkingEnabled } = resolveDeepSeekFlags(model, body);
    const transformed = {
      prompt: lastMessage?.content || "",
      model_class: resolveDeepSeekModelClass(model),
      model_preference: null,
      temperature: body?.temperature ?? 0,
      stream: body?.stream !== false,
      ref_file_ids: [],
      search_enabled: searchEnabled,
      thinking_enabled: thinkingEnabled,
    };

    if (systemMessage) {
      transformed.system_prompt = systemMessage;
    }

    return transformed;
  }

  async inspectBodyForVisibleOutput(body, continueState, observationState, signal = null) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hadDone = false;
    let committed = false;

    try {
      while (true) {
        abortIfNeeded(signal);
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (!trimmed.startsWith("data:")) {
            continue;
          }

          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            hadDone = true;
            continueState.finished = true;
            continue;
          }

          if (!payload) {
            continue;
          }

          const chunk = safeJsonParse(payload);
          if (!chunk) {
            continue;
          }

          observeDeepSeekContinueState(continueState, chunk);
          observeDeepSeekStreamObservationState(observationState, chunk);
          if (hasVisibleDeepSeekOutput(observationState)) {
            committed = true;
            return { committed, hadDone };
          }
        }
      }

      const remaining = buffer + decoder.decode();
      if (remaining) {
        const trimmed = remaining.trim();
        if (trimmed.startsWith("data:")) {
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            hadDone = true;
            continueState.finished = true;
          } else if (payload) {
            const chunk = safeJsonParse(payload);
            if (chunk) {
              observeDeepSeekContinueState(continueState, chunk);
              observeDeepSeekStreamObservationState(observationState, chunk);
              if (hasVisibleDeepSeekOutput(observationState)) {
                committed = true;
              }
            }
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {}
    }

    return { committed, hadDone };
  }

  async prepareStreamingResponse(response, {
    credentials,
    sessionID,
    signal,
    log,
    proxyOptions = null,
    onCredentialsRefreshed = null,
    completionPayload = null,
  }) {
    if (!response?.body || !sessionID) {
      return {
        mode: "ready",
        response,
        preparedStages: response?.body ? [createDeepSeekPreparedStage("initial", response.body, completionPayload)] : [],
        initialAutoContinueRounds: 0,
        initialEmptyOutputRetryAttempts: 0,
      };
    }

    let currentResponse = response;
    let nextStageType = "initial";
    let continueState = createDeepSeekContinueState(sessionID);
    const observationState = createDeepSeekStreamObservationState();
    const preparedStages = [];
    let rounds = 0;
    let emptyOutputRetryAttempts = 0;
    let activeCompletionPayload = completionPayload ? { ...completionPayload } : null;

    while (currentResponse?.body) {
      const [inspectBody, clientBody] = currentResponse.body.tee();
      preparedStages.push(createDeepSeekPreparedStage(nextStageType, clientBody, activeCompletionPayload));

      const inspectResult = await this.inspectBodyForVisibleOutput(
        inspectBody,
        continueState,
        observationState,
        signal,
      );
      if (inspectResult.committed) {
        return {
          mode: "ready",
          response,
          preparedStages,
          initialAutoContinueRounds: rounds,
          initialEmptyOutputRetryAttempts: emptyOutputRetryAttempts,
        };
      }

      if (shouldAutoContinueDeepSeek(continueState) && rounds < DEFAULT_AUTO_CONTINUE_LIMIT) {
        rounds += 1;
        log?.info?.("AUTO_CONTINUE", `deepseek-web round=${rounds} message_id=${continueState.responseMessageID}`);

        const powResponse = await this.getPowResponse(
          credentials,
          CONTINUE_TARGET_PATH,
          log,
          proxyOptions,
          signal,
          onCredentialsRefreshed,
        );
        const { response: continueResponse } = await this.postStream(
          CONTINUE_URL,
          {
            chat_session_id: sessionID,
            message_id: continueState.responseMessageID,
            fallback_to_resume: true,
          },
          {
            credentials,
            log,
            proxyOptions,
            signal,
            extraHeaders: { "x-ds-pow-response": powResponse },
            onCredentialsRefreshed,
          },
        );

        if (!continueResponse.ok || !continueResponse.body) {
          throw new Error(`DeepSeek continue failed with status ${continueResponse.status}`);
        }

        currentResponse = continueResponse;
        continueState = prepareDeepSeekContinueStateForNextRound(continueState);
        nextStageType = "continue";
        continue;
      }

      finalizeDeepSeekStreamObservationState(observationState);
      if (
        activeCompletionPayload &&
        emptyOutputRetryAttempts < EMPTY_OUTPUT_RETRY_MAX_ATTEMPTS &&
        shouldRetryDeepSeekEmptyOutput(observationState)
      ) {
        emptyOutputRetryAttempts += 1;
        const retryPayload = cloneCompletionPayloadForEmptyOutputRetry(
          activeCompletionPayload,
          continueState.responseMessageID,
        );
        log?.info?.(
          "EMPTY_OUTPUT_RETRY",
          `deepseek-web retry=${emptyOutputRetryAttempts} parent_message_id=${continueState.responseMessageID || 0}`,
        );

        const powResponse = await this.getPowResponse(
          credentials,
          COMPLETION_TARGET_PATH,
          log,
          proxyOptions,
          signal,
          onCredentialsRefreshed,
        );
        const { response: retryResponse } = await this.postStream(
          COMPLETION_URL,
          retryPayload,
          {
            credentials,
            log,
            proxyOptions,
            signal,
            extraHeaders: { "x-ds-pow-response": powResponse },
            onCredentialsRefreshed,
          },
        );

        if (!retryResponse.ok || !retryResponse.body) {
          throw new Error(`DeepSeek completion retry failed with status ${retryResponse.status}`);
        }

        activeCompletionPayload = retryPayload;
        continueState = createDeepSeekContinueState(sessionID);
        currentResponse = retryResponse;
        nextStageType = "retry";
        continue;
      }

      if (observationState.contentFilter) {
        return {
          mode: "terminal",
          response: createDeepSeekTerminalErrorResponse(observationState),
        };
      }

      return {
        mode: "fallback",
        response: createDeepSeekFallbackErrorResponse(observationState),
      };
    }

    return {
      mode: "ready",
      response,
      preparedStages,
      initialAutoContinueRounds: rounds,
      initialEmptyOutputRetryAttempts: emptyOutputRetryAttempts,
    };
  }

  wrapCompletionWithAutoContinue(response, {
    credentials,
    sessionID,
    signal,
    log,
    proxyOptions = null,
    onCredentialsRefreshed = null,
    completionPayload = null,
    preparedStages = null,
    initialAutoContinueRounds = 0,
    initialEmptyOutputRetryAttempts = 0,
  }) {
    const stageQueue = Array.isArray(preparedStages) && preparedStages.length > 0
      ? preparedStages.map((stage) => ({
          ...stage,
          completionPayload: stage.completionPayload ? { ...stage.completionPayload } : null,
        }))
      : (response?.body ? [createDeepSeekPreparedStage("initial", response.body, completionPayload)] : []);

    if (stageQueue.length === 0 || !sessionID) {
      return response;
    }

    const wrappedBody = new ReadableStream({
      start: async (controller) => {
        const encoder = new TextEncoder();
        const firstStage = stageQueue.shift();
        let currentBody = firstStage?.body || null;
        let continueState = createDeepSeekContinueState(sessionID);
        const observationState = createDeepSeekStreamObservationState();
        let rounds = initialAutoContinueRounds;
        let emptyOutputRetryAttempts = initialEmptyOutputRetryAttempts;
        let activeCompletionPayload = firstStage?.completionPayload
          ? { ...firstStage.completionPayload }
          : (completionPayload ? { ...completionPayload } : null);

        try {
          while (currentBody) {
            const hadDone = await this.pipeBodyWithContinueState(
              currentBody,
              controller,
              continueState,
              observationState,
              signal,
            );

            if (stageQueue.length > 0) {
              const nextStage = stageQueue.shift();
              const transitioned = applyPreparedStageTransition(
                nextStage,
                sessionID,
                continueState,
                activeCompletionPayload,
              );
              currentBody = transitioned.currentBody;
              continueState = transitioned.continueState;
              activeCompletionPayload = transitioned.activeCompletionPayload;
              continue;
            }

            if (shouldAutoContinueDeepSeek(continueState) && rounds < DEFAULT_AUTO_CONTINUE_LIMIT) {
              rounds += 1;
              log?.info?.("AUTO_CONTINUE", `deepseek-web round=${rounds} message_id=${continueState.responseMessageID}`);

              const powResponse = await this.getPowResponse(
                credentials,
                CONTINUE_TARGET_PATH,
                log,
                proxyOptions,
                signal,
                onCredentialsRefreshed,
              );
              const { response: continueResponse } = await this.postStream(
                CONTINUE_URL,
                {
                  chat_session_id: sessionID,
                  message_id: continueState.responseMessageID,
                  fallback_to_resume: true,
                },
                {
                  credentials,
                  log,
                  proxyOptions,
                  signal,
                  extraHeaders: { "x-ds-pow-response": powResponse },
                  onCredentialsRefreshed,
                },
              );

              if (!continueResponse.ok || !continueResponse.body) {
                throw new Error(`DeepSeek continue failed with status ${continueResponse.status}`);
              }

              currentBody = continueResponse.body;
              continueState = prepareDeepSeekContinueStateForNextRound(continueState);
              continue;
            }

            finalizeDeepSeekStreamObservationState(observationState);
            if (
              activeCompletionPayload &&
              emptyOutputRetryAttempts < EMPTY_OUTPUT_RETRY_MAX_ATTEMPTS &&
              shouldRetryDeepSeekEmptyOutput(observationState)
            ) {
              emptyOutputRetryAttempts += 1;
              const retryPayload = cloneCompletionPayloadForEmptyOutputRetry(
                activeCompletionPayload,
                continueState.responseMessageID,
              );
              log?.info?.(
                "EMPTY_OUTPUT_RETRY",
                `deepseek-web retry=${emptyOutputRetryAttempts} parent_message_id=${continueState.responseMessageID || 0}`,
              );

              const powResponse = await this.getPowResponse(
                credentials,
                COMPLETION_TARGET_PATH,
                log,
                proxyOptions,
                signal,
                onCredentialsRefreshed,
              );
              const { response: retryResponse } = await this.postStream(
                COMPLETION_URL,
                retryPayload,
                {
                  credentials,
                  log,
                  proxyOptions,
                  signal,
                  extraHeaders: { "x-ds-pow-response": powResponse },
                  onCredentialsRefreshed,
                },
              );

              if (!retryResponse.ok || !retryResponse.body) {
                throw new Error(`DeepSeek completion retry failed with status ${retryResponse.status}`);
              }

              activeCompletionPayload = retryPayload;
              continueState = createDeepSeekContinueState(sessionID);
              currentBody = retryResponse.body;
              continue;
            }

            const terminalErrorChunk = buildDeepSeekTerminalErrorChunk(observationState);
            if (terminalErrorChunk) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(terminalErrorChunk)}\n\n`));
              controller.close();
              return;
            }

            if (hadDone) {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            }
            controller.close();
            return;
          }

          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  async pipeBodyWithContinueState(body, controller, continueState, observationState, signal = null) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    let hadDone = false;

    try {
      while (true) {
        abortIfNeeded(signal);
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const rawLine of lines) {
          const line = `${rawLine}\n`;
          const trimmed = rawLine.trim();

          if (trimmed.startsWith("data:")) {
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") {
              hadDone = true;
              continueState.finished = true;
              continue;
            }
            if (payload) {
              const chunk = safeJsonParse(payload);
              if (chunk) {
                observeDeepSeekContinueState(continueState, chunk);
                observeDeepSeekStreamObservationState(observationState, chunk);
              }
            }
          }

          controller.enqueue(encoder.encode(line));
        }
      }

      const remaining = buffer + decoder.decode();
      if (remaining) {
        const trimmed = remaining.trim();
        if (trimmed.startsWith("data:")) {
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            hadDone = true;
            continueState.finished = true;
          } else if (payload) {
            const chunk = safeJsonParse(payload);
            if (chunk) {
              observeDeepSeekContinueState(continueState, chunk);
              observeDeepSeekStreamObservationState(observationState, chunk);
            }
            controller.enqueue(encoder.encode(remaining.endsWith("\n") ? remaining : `${remaining}\n`));
          } else {
            controller.enqueue(encoder.encode(remaining.endsWith("\n") ? remaining : `${remaining}\n`));
          }
        } else {
          controller.enqueue(encoder.encode(remaining.endsWith("\n") ? remaining : `${remaining}\n`));
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {}
    }

    return hadDone;
  }

  async execute({
    model,
    body,
    stream,
    credentials,
    signal,
    log,
    proxyOptions = null,
    onCredentialsRefreshed = null,
  }) {
    const originalAccessToken = credentials?.accessToken;
    const originalRefreshToken = credentials?.refreshToken;
    const originalProviderSpecificDataJson = JSON.stringify(credentials?.providerSpecificData || null);

    const transformedBody = this.transformRequest(model, body);
    const sessionID = await this.createSession(credentials, log, proxyOptions, signal);
    transformedBody.chat_session_id = sessionID;
    transformedBody.stream = stream;

    const powResponse = await this.getPowResponse(credentials, COMPLETION_TARGET_PATH, log, proxyOptions, signal);
    const result = await this.postStream(
      COMPLETION_URL,
      transformedBody,
      {
        credentials,
        log,
        proxyOptions,
        signal,
        extraHeaders: { "x-ds-pow-response": powResponse },
      },
    );

    const response = result.response;
    const requestHeaders = {
      ...this.buildHeaders(credentials, stream),
      "x-ds-pow-response": powResponse,
    };
    const refreshedCredentials = buildRefreshedCredentialsSnapshot(
      credentials,
      originalAccessToken,
      originalRefreshToken,
      originalProviderSpecificDataJson,
    );
    if (!response.ok) {
      return {
        response,
        url: COMPLETION_URL,
        headers: requestHeaders,
        transformedBody,
        ...(refreshedCredentials ? { refreshedCredentials } : {}),
      };
    }

    let finalResponse = response;
    if (stream || response.headers.get("content-type")?.includes("text/event-stream")) {
      const prepared = await this.prepareStreamingResponse(response, {
        credentials,
        sessionID,
        signal,
        log,
        proxyOptions,
        onCredentialsRefreshed,
        completionPayload: transformedBody,
      });

      if (prepared.mode !== "ready") {
        return {
          response: prepared.response,
          url: COMPLETION_URL,
          headers: requestHeaders,
          transformedBody,
          ...(refreshedCredentials ? { refreshedCredentials } : {}),
        };
      }

      finalResponse = this.wrapCompletionWithAutoContinue(response, {
        credentials,
        sessionID,
        signal,
        log,
        proxyOptions,
        onCredentialsRefreshed,
        completionPayload: transformedBody,
        preparedStages: prepared.preparedStages,
        initialAutoContinueRounds: prepared.initialAutoContinueRounds,
        initialEmptyOutputRetryAttempts: prepared.initialEmptyOutputRetryAttempts,
      });
    }

    return {
      response: finalResponse,
      url: COMPLETION_URL,
      headers: requestHeaders,
      transformedBody,
      ...(refreshedCredentials ? { refreshedCredentials } : {}),
    };
  }
}

function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text")
      .map((part) => part.text || "")
      .join("");
  }
  return "";
}

export default DeepSeekWebExecutor;
