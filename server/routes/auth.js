import { Hono } from "hono";

export function createAuthRoutes() {
  const app = new Hono();
  app.post("/login", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.post("/logout", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.get("/status", (c) => c.json({ error: "Not implemented yet" }, 501));
  return app;
}
