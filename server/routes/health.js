import { Hono } from "hono";

export function createHealthRoutes() {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({
      status: "ok",
      version: "1.0.0",
      uptime: process.uptime(),
    });
  });

  return app;
}
