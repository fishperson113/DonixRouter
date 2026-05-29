function safeString(value) {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

function parseCookieExport(rawInput) {
  try {
    const parsed = JSON.parse(rawInput);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .filter((item) => item && typeof item.name === "string" && item.name && typeof item.value === "string")
      .map((item) => `${item.name}=${item.value}`);
  } catch {
    return [];
  }
}

function parseHeaderBlock(rawInput) {
  if (typeof rawInput !== "string") {
    return new Map();
  }

  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const headers = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const colonIndex = line.indexOf(":");

    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim().toLowerCase();
      const value = line.slice(colonIndex + 1).trim();
      if (key && value) {
        headers.set(key, value);
      }
      continue;
    }

    if (/^[a-z0-9-]+$/i.test(line) && i + 1 < lines.length) {
      headers.set(line.toLowerCase(), lines[i + 1].trim());
      i += 1;
    }
  }

  return headers;
}

function sanitizeTokenCandidate(value) {
  let next = safeString(value).replace(/^['"]|['"]$/g, "");
  if (!next) {
    return "";
  }

  try {
    next = decodeURIComponent(next);
  } catch {
    // Keep original if decode fails.
  }

  if (/^bearer\s+/i.test(next)) {
    next = next.replace(/^bearer\s+/i, "").trim();
  }

  return next;
}

function looksLikeAccessToken(value) {
  const next = sanitizeTokenCandidate(value);
  if (!next || next.length < 20) {
    return false;
  }
  return /^[A-Za-z0-9._~\-+/=]+$/.test(next);
}

function extractTokenFromStructuredValue(value) {
  if (typeof value === "string") {
    return looksLikeAccessToken(value) ? sanitizeTokenCandidate(value) : "";
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const candidates = [
    value.value,
    value.token,
    value.accessToken,
    value.access_token,
    value.userToken,
    value.user_token,
    value.authToken,
    value.auth_token,
    value.idToken,
    value.id_token,
    value.refreshToken,
    value.refresh_token,
    value.data?.value,
    value.data?.token,
    value.data?.accessToken,
    value.data?.access_token,
  ];

  for (const candidate of candidates) {
    const token = extractTokenFromStructuredValue(candidate);
    if (token) {
      return token;
    }
  }

  return "";
}

function parseCookiePairs(cookieHeader) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf("=");
      if (idx < 0) {
        return { name: "", value: part };
      }
      return {
        name: part.slice(0, idx).trim(),
        value: part.slice(idx + 1).trim(),
      };
    })
    .filter((part) => part.name || part.value);
}

export function normalizeDeepSeekWebCookieInput(rawInput) {
  if (typeof rawInput !== "string") return "";

  const trimmed = rawInput.trim();
  if (!trimmed) return "";

  const headers = parseHeaderBlock(trimmed);
  if (headers.has("cookie")) {
    return normalizeDeepSeekWebCookieInput(headers.get("cookie"));
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const cookiePairs = parseCookieExport(trimmed);
    if (cookiePairs.length > 0) {
      return cookiePairs.join("; ");
    }
  }

  return trimmed
    .replace(/\r?\n+/g, "; ")
    .replace(/;\s*;/g, ";")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/;\s*$/, "");
}

export function normalizeDeepSeekWebTokenInput(rawInput) {
  if (typeof rawInput !== "string") return "";

  const trimmed = rawInput.trim();
  if (!trimmed) return "";

  const headers = parseHeaderBlock(trimmed);
  if (headers.has("authorization")) {
    return normalizeDeepSeekWebTokenInput(headers.get("authorization"));
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return extractTokenFromStructuredValue(parsed);
    } catch {
      return "";
    }
  }

  if (trimmed.includes(";")) {
    return "";
  }

  return looksLikeAccessToken(trimmed) ? sanitizeTokenCandidate(trimmed) : "";
}

export function extractDeepSeekAccessTokenFromCookie(rawInput) {
  const normalized = normalizeDeepSeekWebCookieInput(rawInput);
  if (!normalized) {
    return "";
  }

  if (!normalized.includes("=")) {
    return looksLikeAccessToken(normalized) ? sanitizeTokenCandidate(normalized) : "";
  }

  const pairs = parseCookiePairs(normalized);
  const exactPriority = [
    "token",
    "access_token",
    "accessToken",
    "userToken",
    "user_token",
    "authToken",
    "auth_token",
    "jwt",
    "id_token",
    "idToken",
    "authorization",
    "ds_token",
    "deepseek_token",
  ];

  for (const key of exactPriority) {
    const match = pairs.find((pair) => pair.name === key && looksLikeAccessToken(pair.value));
    if (match) {
      return sanitizeTokenCandidate(match.value);
    }
  }

  const fuzzyMatch = pairs.find((pair) => /token|auth|jwt/i.test(pair.name) && looksLikeAccessToken(pair.value));
  if (fuzzyMatch) {
    return sanitizeTokenCandidate(fuzzyMatch.value);
  }

  const tokenValues = pairs
    .map((pair) => sanitizeTokenCandidate(pair.value))
    .filter((value) => looksLikeAccessToken(value));
  if (tokenValues.length === 1) {
    return tokenValues[0];
  }

  return "";
}

export function extractDeepSeekProfile(data) {
  const bizData = data?.data?.biz_data || data?.data || data?.biz_data || data || {};
  const user = bizData?.user || bizData?.profile || bizData?.me || bizData?.current_user || bizData;

  const email = safeString(user?.email || user?.mail || bizData?.email);
  const mobile = safeString(
    user?.mobile ||
    user?.phone ||
    user?.phone_number ||
    bizData?.mobile ||
    bizData?.phone,
  );
  const name = safeString(
    user?.nickname ||
    user?.display_name ||
    user?.displayName ||
    user?.name ||
    user?.username ||
    user?.user_name ||
    user?.nick_name ||
    bizData?.nickname ||
    bizData?.name,
  );
  const accountId = safeString(
    user?.id ||
    user?.user_id ||
    user?.uid ||
    user?.uuid ||
    bizData?.id ||
    bizData?.user_id ||
    email ||
    mobile,
  );

  return { email, mobile, name, accountId };
}

export function buildDeepSeekConnectionName(profile, fallbackName = "") {
  const explicit = safeString(fallbackName);
  if (explicit) {
    return explicit;
  }

  const label = safeString(profile?.email || profile?.mobile || profile?.name || profile?.accountId);
  if (label) {
    return `DeepSeek (${label})`;
  }

  return "DeepSeek";
}
