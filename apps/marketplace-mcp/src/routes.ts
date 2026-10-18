import { cors } from "hono/cors";
import type { MCPServer } from "mcp-use";
import { env } from "./env.js";
import { payments } from "./payments.js";
import { dashboard } from "./service.js";

export function registerRoutes(server: MCPServer): void {
  server.use("/api/*", cors());
  server.get("/health", (c) =>
    c.json({ ok: true, service: "agent-task-marketplace", payments: payments().mode, base_url: env().baseUrl, time: new Date().toISOString() }),
  );
  server.get("/api/dashboard", async (c) => {
    try {
      return c.json(await dashboard());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });
}
