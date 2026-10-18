import { cors } from "hono/cors";
import { CONTRACT_VERSION } from "@atm/shared";
import type { MCPServer } from "mcp-use";
import { dbLabel } from "./db.js";
import { env } from "./env.js";
import { registerMppRoutes } from "./mpp-routes.js";
import { payments } from "./payments.js";
import { dashboard } from "./service.js";

export function registerRoutes(server: MCPServer): void {
  server.use("/api/*", cors());
  registerMppRoutes(server); // POST|GET /api/pay/:task_id (PAYMENT_MODE=mpp; Computer D)
  server.get("/health", (c) =>
    c.json({ ok: true, service: "agent-task-marketplace", contract: CONTRACT_VERSION, payments: payments().mode, db: dbLabel(), base_url: env().baseUrl, time: new Date().toISOString() }),
  );
  server.get("/api/dashboard", async (c) => {
    try {
      return c.json(await dashboard());
    } catch (err) {
      console.error(`[dashboard] ${(err as Error).message}`);
      return c.json({ error: { code: "INTERNAL_ERROR", message: "dashboard unavailable", retryable: true } }, 500);
    }
  });
}
