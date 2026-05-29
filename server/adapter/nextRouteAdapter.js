/**
 * Auto-adapter: Converts Next.js App Router route handlers (export GET/POST/PUT/DELETE/PATCH/OPTIONS)
 * into Hono routes. Since both use Web Standard Request/Response, the adaptation is minimal.
 *
 * Next.js route handler signature:  export async function POST(request, { params }) => Response
 * Hono handler signature:           (c) => Response
 *
 * The adapter bridges the gap by extracting params from Hono context and calling the Next.js handler.
 */

import { setRequestContext } from "./nextShim.js";

export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];

/**
 * Mount a Next.js-style route module onto a Hono app.
 * @param {import("hono").Hono} app - Hono app instance
 * @param {string} path - Hono route path (e.g., "/api/v1/chat/completions")
 * @param {object} routeModule - The imported route module (e.g., { GET, POST, OPTIONS })
 */
export function mountRoute(app, path, routeModule) {
  for (const method of HTTP_METHODS) {
    const handler = routeModule[method];
    if (typeof handler !== "function") continue;

    const honoMethod = method.toLowerCase();
    app[honoMethod](path, async (c) => {
      // Build params object from Hono context (for dynamic routes like [id])
      const params = c.req.param();

      // Inject request context for cookies()/headers() shims
      setRequestContext(c.req.raw);
      // Call the Next.js handler with the raw request + params
      try {
        const response = await handler(c.req.raw, { params });
        // Return the Response directly — Hono supports Web Standard Response
        return response;
      } catch (err) {
        console.error(`[${method} ${path}]`, err.message || err);
        return c.json({
          error: { message: err.message || "Internal server error", type: "server_error" }
        }, err.status || 500);
      }
    });
  }
}

/**
 * Convert Next.js file-system route path to Hono route path.
 * e.g., "v1/chat/completions" → "/api/v1/chat/completions"
 *       "providers/[id]/test" → "/api/providers/:id/test"
 *       "v1beta/models/[...path]" → "/api/v1beta/models/*"
 */
export function fsPathToHonoPath(fsPath) {
  return "/api/" + fsPath
    .replace(/\[\.\.\.(\w+)\]/g, "*")      // [...path] → *
    .replace(/\[(\w+)\]/g, ":$1");          // [id] → :id
}
