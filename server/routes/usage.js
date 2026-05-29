import { Hono } from "hono";

export function createUsageRoutes() {
  const app = new Hono();
  app.get("/stats", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.get("/logs", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.get("/history", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.get("/chart", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.get("/:connectionId", (c) => c.json({ error: "Not implemented yet" }, 501));
  return app;
}
