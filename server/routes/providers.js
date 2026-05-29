import { Hono } from "hono";

export function createProvidersRoutes() {
  const app = new Hono();
  app.get("/", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.get("/:id", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.post("/", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.put("/:id", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.delete("/:id", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.get("/:id/models", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.post("/:id/test", (c) => c.json({ error: "Not implemented yet" }, 501));
  return app;
}
