import { Hono } from "hono";

export function createKeysRoutes() {
  const app = new Hono();
  app.get("/", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.post("/", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.delete("/:id", (c) => c.json({ error: "Not implemented yet" }, 501));
  return app;
}
