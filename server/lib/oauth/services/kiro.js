import { randomUUID } from "crypto";
import { KIRO_CONFIG } from "../constants/oauth.js";

/**
 * Kiro OAuth Service
 * Supports multiple authentication methods:
 * 1. AWS Builder ID (Device Code Flow)
 * 2. AWS IAM Identity Center/IDC (Device Code Flow)
 * 3. Google/GitHub Social Login (Authorization Code Flow + Manual Callback)
 * 4. Import Token (Manual refresh token paste)
 */

const KIRO_AUTH_SERVICE = "https://prod.us-east-1.auth.desktop.kiro.dev";
const KIRO_REFRESH_TOKEN_PREFIXES = ["aoaAAAAAG", "aorAAAAAG"];
const KIRO_REFRESH_TOKEN_PATTERN = /^ao[a-zA-Z]AAAAAG[A-Za-z0-9_-]+(?::[A-Za-z0-9+/=_-]+)?$/;
const KIRO_IDE_USER_AGENT = "KiroIDE-0.12.184-cbc292d871e4ce3f7bafe59d8ed202b7176266c0fe5beeca4f713058c8b40b1a";

export class KiroService {
  static isLikelyRefreshToken(refreshToken) {
    if (typeof refreshToken !== "string") return false;

    const normalizedToken = refreshToken.trim();
    if (normalizedToken.length < 32) return false;

    return (
      KIRO_REFRESH_TOKEN_PREFIXES.some(prefix => normalizedToken.startsWith(prefix)) ||
      KIRO_REFRESH_TOKEN_PATTERN.test(normalizedToken)
    );
  }

  /**
   * Register OIDC client with AWS SSO
   * Returns clientId and clientSecret for device code flow
   */
  async registerClient(region = "us-east-1") {
    const endpoint = `https://oidc.${region}.amazonaws.com/client/register`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientName: KIRO_CONFIG.clientName,
        clientType: KIRO_CONFIG.clientType,
        scopes: KIRO_CONFIG.scopes,
        grantTypes: KIRO_CONFIG.grantTypes,
        issuerUrl: KIRO_CONFIG.issuerUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to register client: ${error}`);
    }

    const data = await response.json();
    return {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      clientSecretExpiresAt: data.clientSecretExpiresAt,
    };
  }

  /**
   * Start device authorization for AWS Builder ID or IDC
   */
  async startDeviceAuthorization(clientId, clientSecret, startUrl, region = "us-east-1") {
    const endpoint = `https://oidc.${region}.amazonaws.com/device_authorization`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        startUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to start device authorization: ${error}`);
    }

    const data = await response.json();
    return {
      deviceCode: data.deviceCode,
      userCode: data.userCode,
      verificationUri: data.verificationUri,
      verificationUriComplete: data.verificationUriComplete,
      expiresIn: data.expiresIn,
      interval: data.interval || 5,
    };
  }

  /**
   * Poll for token using device code (AWS Builder ID/IDC)
   */
  async pollDeviceToken(clientId, clientSecret, deviceCode, region = "us-east-1") {
    const endpoint = `https://oidc.${region}.amazonaws.com/token`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        deviceCode,
        grantType: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = await response.json();

    // Handle pending/slow_down/errors
    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error,
        errorDescription: data.error_description,
        pending: data.error === "authorization_pending" || data.error === "slow_down",
      };
    }

    return {
      success: true,
      tokens: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn,
        tokenType: data.tokenType,
      },
    };
  }

  /**
   * Build Google/GitHub social login URL
   * Returns authorization URL for manual callback flow
   * Uses kiro:// custom protocol as required by AWS Cognito whitelist
   */
  buildSocialLoginUrl(provider, codeChallenge, state) {
    const idp = provider === "google" ? "Google" : "Github";
    // AWS Cognito only whitelists kiro:// protocol, not localhost
    const redirectUri = "kiro://kiro.kiroAgent/authenticate-success";
    return `${KIRO_AUTH_SERVICE}/login?idp=${idp}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}&prompt=select_account`;
  }

  /**
   * Exchange authorization code for tokens (Social Login)
   * Must use same redirect_uri as authorization request
   */
  async exchangeSocialCode(code, codeVerifier) {
    // Must match the redirect_uri used in buildSocialLoginUrl
    const redirectUri = "kiro://kiro.kiroAgent/authenticate-success";

    const response = await fetch(`${KIRO_AUTH_SERVICE}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json();
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      profileArn: data.profileArn,
      expiresIn: data.expiresIn || 3600,
    };
  }

  /**
   * Refresh token using refresh token
   */
  async refreshToken(refreshToken, providerSpecificData = {}) {
    const { authMethod, clientId, clientSecret, region } = providerSpecificData;

    // AWS SSO OIDC refresh (Builder ID or IDC)
    if (clientId && clientSecret) {
      const endpoint = `https://oidc.${region || "us-east-1"}.amazonaws.com/token`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          clientSecret,
          refreshToken,
          grantType: "refresh_token",
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${error}`);
      }

      const data = await response.json();
      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || refreshToken,
        expiresIn: data.expiresIn,
      };
    }

    // Social auth refresh (Google/GitHub)
    const response = await fetch(`${KIRO_AUTH_SERVICE}/refreshToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        "User-Agent": KIRO_IDE_USER_AGENT,
        Connection: "close",
      },
      body: JSON.stringify({
        refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data = await response.json();
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      profileArn: data.profileArn,
      expiresIn: data.expiresIn || 3600,
    };
  }

  /**
   * Validate and import refresh token
   */
  async validateImportToken(refreshToken) {
    const normalizedToken = typeof refreshToken === "string" ? refreshToken.trim() : "";

    // Validate token format
    if (!KiroService.isLikelyRefreshToken(normalizedToken)) {
      throw new Error("Invalid token format. Expected a full Kiro refresh token (for example aoaAAAAAG... or aorAAAAAG...).");
    }

    // Try to refresh to validate
    try {
      const result = await this.refreshToken(normalizedToken);
      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken || normalizedToken,
        profileArn: result.profileArn,
        expiresIn: result.expiresIn,
        authMethod: "imported",
      };
    } catch (error) {
      throw new Error(`Token validation failed: ${error.message}`);
    }
  }

  /**
   * List available models from CodeWhisperer API
   */
  async listAvailableModels(accessToken, profileArn) {
    const endpoint = "https://codewhisperer.us-east-1.amazonaws.com";
    const target = "AmazonCodeWhispererService.ListAvailableModels";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "x-amz-target": target,
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        origin: "AI_EDITOR",
        profileArn,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list models: ${error}`);
    }

    const data = await response.json();
    return (data.models || []).map(m => ({
      id: m.modelId,
      name: m.modelName || m.modelId,
      description: m.description,
      rateMultiplier: m.rateMultiplier,
      rateUnit: m.rateUnit,
      maxInputTokens: m.tokenLimits?.maxInputTokens || 0,
    }));
  }

  // ── Smithy RPC v2 CBOR helpers ──────────────────────────────────────

  /** Encode a string as CBOR text (major type 3) */
  _cborStr(s) {
    const b = Buffer.from(s);
    const l = b.length;
    if (l < 24) return Buffer.concat([Buffer.from([0x60 | l]), b]);
    if (l < 256) return Buffer.concat([Buffer.from([0x78, l]), b]);
    return Buffer.concat([Buffer.from([0x79, (l >> 8) & 0xff, l & 0xff]), b]);
  }

  /** Encode a boolean as CBOR simple value */
  _cborBool(value) {
    return Buffer.from([value ? 0xf5 : 0xf4]);
  }

  /** Encode a JavaScript value as the small CBOR subset Kiro portal uses */
  _cborValue(value) {
    if (typeof value === "string") return this._cborStr(value);
    if (typeof value === "boolean") return this._cborBool(value);
    if (value && typeof value === "object" && !Array.isArray(value)) return this._cborMap(value);
    if (value === null || value === undefined) return Buffer.from([0xf6]);
    throw new Error(`Unsupported CBOR value type: ${typeof value}`);
  }

  /** Encode an object as a CBOR indefinite-length map */
  _cborMap(obj) {
    const parts = [Buffer.from([0xbf])];
    for (const k of Object.keys(obj)) {
      parts.push(this._cborStr(k));
      parts.push(this._cborValue(obj[k]));
    }
    parts.push(Buffer.from([0xff]));
    return Buffer.concat(parts);
  }

  _decodeCbor(buf) {
    let offset = 0;

    const readLength = (additional) => {
      if (additional < 24) return additional;
      if (additional === 24) return buf[offset++];
      if (additional === 25) {
        const value = buf.readUInt16BE(offset);
        offset += 2;
        return value;
      }
      if (additional === 26) {
        const value = buf.readUInt32BE(offset);
        offset += 4;
        return value;
      }
      throw new Error(`Unsupported CBOR length marker: ${additional}`);
    };

    const readValue = () => {
      const head = buf[offset++];
      if (head === 0xff) return Symbol.for("cbor.break");
      if (head === 0xf4) return false;
      if (head === 0xf5) return true;
      if (head === 0xf6) return null;

      const major = head >> 5;
      const additional = head & 0x1f;

      if (major === 0) return readLength(additional);
      if (major === 1) return -1 - readLength(additional);
      if (major === 2) {
        const len = readLength(additional);
        const value = buf.subarray(offset, offset + len);
        offset += len;
        return value;
      }
      if (major === 3) {
        const len = readLength(additional);
        const value = buf.subarray(offset, offset + len).toString("utf8");
        offset += len;
        return value;
      }
      if (major === 4) {
        const arr = [];
        if (additional === 31) {
          while (offset < buf.length) {
            const value = readValue();
            if (value === Symbol.for("cbor.break")) break;
            arr.push(value);
          }
          return arr;
        }
        const len = readLength(additional);
        for (let i = 0; i < len; i++) arr.push(readValue());
        return arr;
      }
      if (major === 5) {
        const obj = {};
        const readPair = () => {
          const key = readValue();
          if (key === Symbol.for("cbor.break")) return false;
          obj[String(key)] = readValue();
          return true;
        };
        if (additional === 31) {
          while (offset < buf.length && readPair()) {}
          return obj;
        }
        const len = readLength(additional);
        for (let i = 0; i < len; i++) readPair();
        return obj;
      }
      if (major === 6) {
        readLength(additional);
        return readValue();
      }
      if (major === 7) {
        if (additional === 24) return buf[offset++];
        if (additional === 25) {
          const half = buf.readUInt16BE(offset);
          offset += 2;
          const sign = (half & 0x8000) ? -1 : 1;
          const exponent = (half >> 10) & 0x1f;
          const fraction = half & 0x03ff;
          if (exponent === 0) return sign * Math.pow(2, -14) * (fraction / 1024);
          if (exponent === 31) return fraction ? NaN : sign * Infinity;
          return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
        }
        if (additional === 26) {
          const value = buf.readFloatBE(offset);
          offset += 4;
          return value;
        }
        if (additional === 27) {
          const value = buf.readDoubleBE(offset);
          offset += 8;
          return value;
        }
        if (additional === 31) return Symbol.for("cbor.break");
        return additional;
      }

      throw new Error(`Unsupported CBOR major type: ${major}`);
    };

    return readValue();
  }

  /** Call a KiroWebPortalService operation via Smithy RPC v2 CBOR */
  async _callCborBuffer(operation, cookie, idp, csrf, bodyObj, options = {}) {
    const ck = options.cookieHeader || `AccessToken=${cookie}; Idp=${idp}`;
    const body = this._cborMap(bodyObj);
    const fetchFn = options.fetchFn || fetch;
    const headers = {
      Cookie: ck,
      Authorization: `Bearer ${cookie}`,
      "Content-Type": "application/cbor",
      "smithy-protocol": "rpc-v2-cbor",
      Accept: "application/cbor",
      "x-csrf-token": csrf,
      "amz-sdk-invocation-id": randomUUID(),
      "amz-sdk-request": "attempt=1; max=1",
      "x-amz-user-agent": "aws-sdk-js/1.0.0 ua/2.1 os/Windows lang/js md/browser",
      Origin: "https://app.kiro.dev",
      Referer: "https://app.kiro.dev/settings/account",
    };
    if (options.userId) headers["x-kiro-userid"] = options.userId;
    if (options.visitorId) headers["x-kiro-visitorid"] = options.visitorId;

    const res = await fetchFn(
      `https://app.kiro.dev/service/KiroWebPortalService/operation/${operation}`,
      {
        method: "POST",
        headers,
        body,
      }
    );
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString("utf8");
    if (res.status !== 200) {
      const msg = text.match(/message[\x00-\xff]([\x20-\x7e]+)/);
      throw new Error(`${operation} failed (${res.status}): ${msg ? msg[1] : text.substring(0, 200)}`);
    }
    return buf;
  }

  /** Call a KiroWebPortalService operation via Smithy RPC v2 CBOR */
  async _callCbor(operation, cookie, idp, csrf, bodyObj, options = {}) {
    const buf = await this._callCborBuffer(operation, cookie, idp, csrf, bodyObj, options);
    const text = buf.toString("utf8");
    return text;
  }

  async _callCborDecoded(operation, cookie, idp, csrf, bodyObj, options = {}) {
    const buf = await this._callCborBuffer(operation, cookie, idp, csrf, bodyObj, options);
    return {
      raw: buf.toString("utf8"),
      data: this._decodeCbor(buf),
    };
  }

  async updateBillingPreferences(accessToken, idp, csrf, { profileArn, overageEnabled }, options = {}) {
    if (!profileArn) throw new Error("Kiro profileArn is required to update billing preferences");
    if (typeof overageEnabled !== "boolean") throw new Error("overageEnabled must be a boolean");

    await this._callCbor("UpdateBillingPreferences", accessToken, idp, csrf, {
      overageConfiguration: { overageEnabled },
      profileArn,
    }, options);

    return {
      profileArn,
      overageEnabled,
      limitEnabled: !overageEnabled,
    };
  }

  async getUserUsageAndLimitsCbor(accessToken, idp, csrf, { profileArn }, options = {}) {
    if (!profileArn) throw new Error("Kiro profileArn is required to fetch usage and limits");
    return this._callCborDecoded("GetUserUsageAndLimits", accessToken, idp, csrf, {
      origin: "KIRO_IDE",
      isEmailRequired: true,
      profileArn,
    }, options);
  }

  _extractCborTextField(raw, field) {
    if (typeof raw !== "string" || !field) return "";
    const fieldIdx = raw.indexOf(field);
    if (fieldIdx < 0) return "";
    const tail = raw.slice(fieldIdx + field.length);
    const match = tail.match(/[A-Za-z0-9_.:+=/-]{20,}/);
    return match?.[0] || "";
  }

  async getTokenCbor(accessToken, idp, csrf, { profileArn }, options = {}) {
    if (!profileArn) throw new Error("Kiro profileArn is required to refresh web token");
    if (!accessToken) throw new Error("Kiro web AccessToken cookie is required to refresh token");

    const result = await this._callCborDecoded("GetToken", accessToken, idp, csrf, {
      profileArn,
      accessToken,
    }, options);
    const data = result.data && typeof result.data === "object" ? result.data : {};
    const token = data.accessToken || data.token || data.authToken || this._extractCborTextField(result.raw, "accessToken");
    if (!token) throw new Error("Could not extract accessToken from GetToken response");

    const expiresIn = Number(data.expiresIn || data.expires_in || 3600);
    return {
      accessToken: token,
      refreshToken: data.refreshToken || null,
      csrfToken: data.csrfToken || data.csrf || null,
      profileArn: data.profileArn || profileArn,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
      raw: result.raw,
      data,
    };
  }

  /** Fetch CSRF token and user status from app.kiro.dev HTML */
  async fetchCsrf(cookie, idp = "Google", options = {}) {
    const ck = options.cookieHeader || `AccessToken=${cookie}; Idp=${idp}`;
    const fetchFn = options.fetchFn || fetch;
    const res = await fetchFn("https://app.kiro.dev/", { headers: { Cookie: ck } });
    const html = await res.text();
    const csrfMatch = html.match(/csrf-token.*?content=["']([^"']+)/);
    if (!csrfMatch) throw new Error("Could not extract CSRF token. Cookie may be invalid.");
    const statusMatch = html.match(/user-status.*?content=["']([^"']+)/);
    return {
      csrf: csrfMatch[1],
      userStatus: statusMatch ? statusMatch[1] : "unknown",
    };
  }

  /** Call InitiateLogin via CBOR — returns Cognito redirect URL */
  async initiateLoginCbor(cookie, idp, csrf, codeChallenge, state, redirectUri) {
    const idpValue = idp === "github" || idp === "Github" ? "Github" : "Google";
    const text = await this._callCbor("InitiateLogin", cookie, idp, csrf, {
      idp: idpValue,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: "S256",
      state,
    });
    // Extract redirectUrl from CBOR response
    const urlStart = text.indexOf("https://");
    if (urlStart < 0) throw new Error("Could not extract redirectUrl from InitiateLogin response");
    // URL ends at the first non-printable or CBOR marker byte
    let urlEnd = urlStart;
    while (urlEnd < text.length && text.charCodeAt(urlEnd) >= 0x20 && text.charCodeAt(urlEnd) < 0x7f) urlEnd++;
    return text.substring(urlStart, urlEnd);
  }

  /** Call ExchangeToken via CBOR — returns {accessToken, csrfToken} */
  async exchangeTokenCbor(cookie, idp, csrf, code, codeVerifier, redirectUri, state) {
    const idpValue = idp === "github" || idp === "Github" ? "Github" : "Google";
    const text = await this._callCbor("ExchangeToken", cookie, idp, csrf, {
      idp: idpValue,
      code,
      codeVerifier,
      redirectUri,
      state,
    });
    // Extract tokens from CBOR text
    const atIdx = text.indexOf("ey", text.indexOf("accessToken"));
    if (atIdx < 0) throw new Error("Could not extract accessToken from ExchangeToken response");
    let atEnd = atIdx;
    while (atEnd < text.length && /[A-Za-z0-9_.-]/.test(text[atEnd])) atEnd++;
    const accessToken = text.substring(atIdx, atEnd);

    let csrfToken = csrf;
    const csrfIdx = text.indexOf("csrfToken");
    if (csrfIdx >= 0) {
      // Find the value after csrfToken key (skip CBOR length bytes)
      const valStart = text.indexOf(text.match(/[A-Za-z0-9+\/=]{20,}/)?.[0] || "", csrfIdx + 9);
      if (valStart >= 0) {
        let valEnd = valStart;
        while (valEnd < text.length && /[A-Za-z0-9+\/=]/.test(text[valEnd])) valEnd++;
        csrfToken = text.substring(valStart, valEnd);
      }
    }

    return { accessToken, csrfToken };
  }

  /**
   * Fetch user email from access token (optional, for display)
   */
  extractEmailFromJWT(accessToken) {
    try {
      const parts = accessToken.split(".");
      if (parts.length !== 3) return null;

      // Decode payload (add padding if needed)
      let payload = parts[1];
      while (payload.length % 4) {
        payload += "=";
      }

      const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      return decoded.email || decoded.preferred_username || decoded.sub;
    } catch {
      return null;
    }
  }
}
