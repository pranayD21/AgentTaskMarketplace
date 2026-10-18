/**
 * HTTP route for Machine Payments Protocol tasks: `POST|GET /api/pay/:task_id`.
 * Registered from routes.ts (one line). Works on any server that has
 * STRIPE_PROFILE_ID, whatever its PAYMENT_MODE; otherwise it answers 409 so
 * agents get a clear message instead of a 404.
 */
import type { MCPServer } from "mcp-use";
import { MarketplaceError } from "@atm/shared";
import { payTask } from "./mpp.js";
import { mppProvider, payments } from "./payments.js";

export function registerMppRoutes(server: MCPServer): void {
  server.get("/openapi.json", (c) => {
    const provider = mppProvider();
    if (!provider) return c.json({ error: { code: "NOT_FOUND", message: "No MPP-payable routes on this server (no STRIPE_PROFILE_ID)." } }, 404);
    return c.json(provider.discoveryDocument());
  });
  server.all("/api/pay/:task_id", async (c) => {
    const provider = mppProvider();
    if (!provider) {
      return c.json(
        { error: { code: "INVALID_STATE", message: `This server runs PAYMENT_MODE=${payments().mode} without STRIPE_PROFILE_ID; MPP payment links cannot be paid here.`, retryable: false } },
        409,
      );
    }
    try {
      const outcome = await payTask(provider, c.req.param("task_id"), c.req.raw);
      if (outcome.paid) console.log(`[mpp] task ${outcome.paid.task_id} paid via MPP (${outcome.paid.payment_intent_id}) → OPEN`);
      return outcome.response;
    } catch (err) {
      if (err instanceof MarketplaceError) return c.json(err.toJSON(), err.status as 400);
      console.error("[mpp] /api/pay failed:", err);
      return c.json({ error: { code: "PAYMENT_FAILED", message: (err as Error).message, retryable: true } }, 402);
    }
  });
}
