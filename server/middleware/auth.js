/**
 * Auth middleware — validates API keys for protected routes.
 */

export function authMiddleware() {
  return async (c, next) => {
    // API key validation (when requireApiKey is enabled)
    // TODO: migrate from donixrouter src/sse/services/auth.js
    await next();
  };
}
