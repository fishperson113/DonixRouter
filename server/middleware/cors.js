/**
 * CORS middleware scoped to API routes only.
 *
 * Allows requests from loopback origins (localhost / 127.0.0.0/8 / ::1) for
 * API surfaces while leaving the admin / static UI untouched. Handles
 * OPTIONS preflight and sets response headers for matched paths.
 *
 * JavaScript port of codex-proxy-dev/src/middleware/cors.ts (#495 + #823cb4b).
 */
import { isLoopbackHostname } from "../shared/utils/host.js";

const API_ROUTE_PREFIXES = [
  "/v1/",
  "/v1beta/",
  "/api/",
  "/responses",
  "/codex/",
  "/official-agent/",
];

function isCorsEnabledPath(path) {
  if (typeof path !== "string" || !path) return false;
  for (const prefix of API_ROUTE_PREFIXES) {
    if (path === prefix || path === prefix.replace(/\/$/, "") || path.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function getAllowedOrigin(origin) {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return isLoopbackHostname(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Hono middleware factory — returns a handler that adds permissive CORS
 * headers for loopback origins on API routes only.
 */
export function loopbackCors() {
  return async (c, next) => {
    const origin = c.req.header("Origin");
    const corsEnabled = isCorsEnabledPath(c.req.path);
    const allowedOrigin = corsEnabled ? getAllowedOrigin(origin) : null;

    if (corsEnabled && c.req.method === "OPTIONS") {
      if (!allowedOrigin) {
        return c.body(null, 403);
      }
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    }

    await next();

    if (allowedOrigin) {
      c.header("Access-Control-Allow-Origin", allowedOrigin);
      c.header("Vary", "Origin", { append: true });
    }
  };
}
