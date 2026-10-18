import { cors } from "hono/cors";
import { CONTRACT_VERSION } from "@atm/shared";
import type { MCPServer } from "mcp-use";
import { dbLabel } from "./db.js";
import { env } from "./env.js";
import { registerMppRoutes } from "./mpp-routes.js";
import { payments } from "./payments.js";
import { dashboard } from "./service.js";
import { registerSellerReleaseRoutes } from "./seller-release.js";
import { registerSellerIdentityRoutes } from "./seller-identity.js";
import { registerMarketplaceWebRoutes } from "./marketplace-web.js";

export function registerRoutes(server: MCPServer): void {
  server.use("/api/*", cors());
  registerSellerReleaseRoutes(server);
  registerSellerIdentityRoutes(server);
  registerMarketplaceWebRoutes(server);
  registerMppRoutes(server); // POST|GET /api/pay/:task_id (PAYMENT_MODE=mpp; Computer D)
  // mcp-use start owns /health in production; keep an application-specific path.
  for (const route of ["/health", "/api/health"]) {
    server.get(route, (c) =>
      c.json({ ok: true, service: "agent-task-marketplace", contract: CONTRACT_VERSION, pricing: "task_offer", revision: env().ATM_BUILD_REVISION ?? null, payments: payments().mode, db: dbLabel(), base_url: env().baseUrl, time: new Date().toISOString() }),
    );
  }
  server.get("/api/dashboard", async (c) => {
    try {
      return c.json(await dashboard());
    } catch (err) {
      console.error(`[dashboard] ${(err as Error).message}`);
      return c.json({ error: { code: "INTERNAL_ERROR", message: "dashboard unavailable", retryable: true } }, 500);
    }
  });
}
