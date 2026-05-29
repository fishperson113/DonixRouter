import { Hono } from "hono";

export function createSettingsRoutes() {
  const app = new Hono();
  app.get("/", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.put("/", (c) => c.json({ error: "Not implemented yet" }, 501));
  return app;
}
