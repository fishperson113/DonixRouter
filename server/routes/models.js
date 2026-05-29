import { Hono } from "hono";

export function createModelsRoutes() {
  const app = new Hono();
  app.get("/", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.get("/alias", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.get("/availability", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.post("/custom", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.get("/disabled", (c) => c.json({ error: "Not implemented yet" }, 501));
  app.post("/test", (c) => c.json({ error: "Not implemented yet" }, 501));
  return app;
}
