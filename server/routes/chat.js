/**
 * Chat / Responses / Completions routes — the core proxy endpoints.
 * Handles: POST /chat/completions, POST /responses, POST /messages, etc.
 */

import { Hono } from "hono";
import { stream } from "hono/streaming";

export function createChatRoutes() {
  const app = new Hono();

  // OpenAI Chat Completions
  app.post("/chat/completions", async (c) => {
    const body = await c.req.json();
    // TODO: wire to open-sse handleChat
    return c.json({ error: "Not implemented yet — migrating from donixrouter" }, 501);
  });

  // OpenAI Responses API
  app.post("/responses", async (c) => {
    const body = await c.req.json();
    // TODO: wire to open-sse handleChat (responses format)
    return c.json({ error: "Not implemented yet — migrating from donixrouter" }, 501);
  });

  // Responses compact
  app.post("/responses/compact", async (c) => {
    const body = await c.req.json();
    return c.json({ error: "Not implemented yet" }, 501);
  });

  // Anthropic Messages
  app.post("/messages", async (c) => {
    const body = await c.req.json();
    return c.json({ error: "Not implemented yet" }, 501);
  });

  // Models list
  app.get("/models", async (c) => {
    return c.json({ error: "Not implemented yet" }, 501);
  });

  return app;
}
