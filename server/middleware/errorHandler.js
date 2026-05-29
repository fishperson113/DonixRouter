/**
 * Global error handler for Hono.
 */

export function errorHandler(err, c) {
  console.error("[ERROR]", err.message || err);
  const status = err.status || 500;
  return c.json({
    error: {
      message: err.message || "Internal server error",
      type: "server_error",
      code: status,
    }
  }, status);
}
