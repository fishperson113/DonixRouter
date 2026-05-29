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

export function normalizeKiroWebCookieInput(rawInput) {
  if (typeof rawInput !== "string") return "";

  const trimmed = rawInput.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const cookiePairs = parseCookieExport(trimmed);
    if (cookiePairs.length > 0) {
      return cookiePairs.join("; ");
    }
  }

  const normalized = trimmed
    .replace(/\r?\n+/g, "; ")
    .replace(/;\s*;/g, ";")
    .trim();

  if (!normalized.includes("=")) {
    return `AccessToken=${normalized}`;
  }

  return normalized;
}

export function analyzeKiroWebSessionHtml(html) {
  const userStatus = html.match(/<meta\s+name="user-status"\s+content="([^"]*)"/i)?.[1] || null;

  return {
    hasCsrfToken: /<meta\s+name="csrf-token"\s+content="[^"]+"/i.test(html),
    hasKiroTitle: /<title>\s*Kiro Web Portal\s*<\/title>/i.test(html),
    hasUnauthenticatedMarker: html.includes("User ID not available for unauthenticated user"),
    hasProfileArnMissing: html.includes("Profile ARN not available"),
    userStatus,
  };
}

export function isKiroWebSessionValid(analysis) {
  const normalizedStatus = analysis.userStatus?.toLowerCase();

  if (!analysis.hasCsrfToken || !analysis.hasKiroTitle) {
    return false;
  }

  if (analysis.hasUnauthenticatedMarker) {
    return false;
  }

  if (normalizedStatus === "anonymous" || normalizedStatus === "stale") {
    return false;
  }

  return true;
}

export function getKiroWebSessionError(analysis) {
  const normalizedStatus = analysis.userStatus?.toLowerCase();

  if (!analysis.hasCsrfToken || !analysis.hasKiroTitle) {
    return "Kiro Web did not return the expected portal page";
  }

  if (normalizedStatus === "anonymous") {
    return "Kiro Web session was not recognized. Paste the full app.kiro.dev cookie string, not only a partial value.";
  }

  if (normalizedStatus === "stale") {
    return "Kiro Web session is stale or expired. Re-export fresh cookies from app.kiro.dev after reloading the site.";
  }

  if (analysis.hasUnauthenticatedMarker) {
    return "Kiro Web still reports the session as unauthenticated. Re-export the full cookie set from app.kiro.dev.";
  }

  return "Invalid Kiro Web cookie";
}
