/**
 * DonixRouter — Hono server entry point.
 * Run directly: node server/index.js (no build step needed)
 *
 * Auto-mounts all 125+ API routes from api-routes/ directory.
 * Uses Web Standard Request/Response — same as Next.js route handlers.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { logger } from "hono/logger";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { errorHandler } from "./middleware/errorHandler.js";
import { loopbackCors } from "./middleware/cors.js";
import { autoMountRoutes } from "./adapter/autoRoutes.js";
import { initTransport, getTransportInfo } from "#tls";
import { initProxy } from "#tls/proxy.js";
import { installUncaughtErrorHandlers } from "./logs/error-log.js";
import { initConsoleLogCapture } from "#lib/consoleLogBuffer.js";
import { awaitServerListening } from "./shared/utils/awaitListening.js";

// Capture all console.log/warn/error output for the Console Log page
initConsoleLogCapture();

// Install global error handlers (writes to data/error-log.jsonl)
installUncaughtErrorHandlers("server");

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = new Hono();

// ── Global middleware ────────────────────────────────────────
// Loopback-only CORS for API routes; admin/static UI gets no CORS surface.
app.use("*", loopbackCors());
app.use("*", logger());
app.onError(errorHandler);

// ── Initialize TLS transport + proxy detection ──────────────
await initProxy();
await initTransport();
const tlsInfo = getTransportInfo();
console.log(`[TLS] Transport: ${tlsInfo.type} (impersonate=${tlsInfo.impersonate})`);

// ── Debug: test route to verify Hono routing ─────────────────
app.get("/api/test-route", (c) => c.json({ ok: true, path: c.req.path, server: "DonixRouter" }));
app.get("/api/debug/routes", (c) => {
  const routes = app.routes.map(r => `${r.method} ${r.path}`);
  return c.json({ count: routes.length, routes });
});

// ── Auto-mount all API routes from api-routes/ ──────────────
const apiRoutesDir = join(__dirname, "api-routes");
await autoMountRoutes(app, apiRoutesDir);

async function redispatchToApi(c) {
  const url = new URL(c.req.url);
  const newPath = "/api" + url.pathname;
  const newUrl = new URL(newPath, url.origin);
  newUrl.search = url.search;
  const newReq = new Request(newUrl.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
    duplex: "half",
  });
  return app.fetch(newReq);
}

// ── OpenAI-compatible rewrites (/v1/* → /api/v1/*) ──────────
app.all("/v1/*", redispatchToApi);
app.all("/v1beta/*", redispatchToApi);

// Codex-compatible rewrite (/codex/* → /api/v1/responses)
app.all("/codex/*", async (c) => {
  const url = new URL(c.req.url);
  const newUrl = new URL("/api/v1/responses", url.origin);
  newUrl.search = url.search;
  const newReq = new Request(newUrl.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
    duplex: "half",
  });
  return app.fetch(newReq);
});

// ── Static FE (built web/) ───────────────────────────────────
const webDistRoot = join(__dirname, "..", "web", "dist");
app.use("/assets/*", async (c, next) => {
  await next();
  if (c.res.ok) {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  }
});
app.use("/sw.js", async (c, next) => {
  await next();
  if (c.res.ok) {
    c.header("Cache-Control", "no-store, max-age=0");
  }
});
// Serve all static files from web/dist (assets, i18n, providers, favicons, etc.)
app.use("/*", serveStatic({ root: "./web/dist" }));
// SPA fallback: any GET that didn't match API or static file → index.html
const spaFallback = async (c) => {
  try {
    const { readFile } = await import("node:fs/promises");
    const html = await readFile(join(webDistRoot, "index.html"), "utf-8");
    c.header("Cache-Control", "no-store, max-age=0");
    return c.html(html);
  } catch { return c.notFound(); }
};
app.get("/dashboard", spaFallback);
app.get("/dashboard/*", spaFallback);
app.get("/login", spaFallback);
app.get("/callback", spaFallback);
app.get("/", spaFallback);
app.get("/quota-widget", spaFallback);
app.get("/quota-widget/*", spaFallback);

// Vite uses favicon.svg by default; browsers still request favicon.ico
app.get("/favicon.ico", (c) => c.redirect("/favicon.svg"));

// ── Custom 404 handler ─────────────────────────────────────────
app.notFound((c) => {
  console.warn(`[404] ${c.req.method} ${c.req.path}`);
  return c.json({ error: "Not Found", path: c.req.path }, 404);
});

// ── Start server ─────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "20128", 10);
const HOST = process.env.HOST || "0.0.0.0";

const server = serve({
  fetch: app.fetch,
  port: PORT,
  hostname: HOST,
  overrideGlobalObjects: false,
});

// Disable timeouts that kill long-lived SSE/streaming connections
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 0;

// Await TCP bind so EADDRINUSE/EACCES reject cleanly instead of escaping as uncaughtException
try {
  await awaitServerListening(server);
  const addr = server.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : PORT;
  console.log(`\n  DonixRouter v1.0.0`);
  console.log(`  Local:   http://localhost:${boundPort}`);
  console.log(`  Network: http://${HOST === "0.0.0.0" ? getLocalIP() : HOST}:${boundPort}\n`);
} catch (err) {
  console.error(`[server] failed to bind ${HOST}:${PORT} — ${err?.code || err?.message || err}`);
  process.exit(1);
}

function getLocalIP() {
  try {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === "IPv4" && !net.internal) return net.address;
      }
    }
  } catch { /* ignore */ }
  return "0.0.0.0";
}

// Graceful shutdown
process.on("SIGTERM", () => { server.close(); process.exit(0); });
process.on("SIGINT", () => { server.close(); process.exit(0); });
