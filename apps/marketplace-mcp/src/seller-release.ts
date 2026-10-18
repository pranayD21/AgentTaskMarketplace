import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MCPServer } from "mcp-use";
import { CONTRACT_VERSION } from "@atm/shared";
import { env } from "./env.js";
export function registerSellerReleaseRoutes(server: MCPServer, directory?: string) {
  async function releaseDirectory() {
    if (directory) return directory;
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    for (const candidate of [path.resolve(process.cwd(), "public/seller"), path.resolve(process.cwd(), "apps/marketplace-mcp/public/seller"),
      path.resolve(moduleDir, "../../public/seller"), path.resolve(moduleDir, "../public/seller")]) {
      try { await fs.access(path.join(candidate, "release.json")); directory = candidate; return candidate; } catch {}
    }
    throw new Error("SELLER_RELEASE_UNAVAILABLE");
  }
  for (const state of ["return", "refresh"]) server.get(`/seller/setup-${state}`, c => {
    c.header("Cache-Control", "no-store");
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    return c.html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stripe setup · Your seller</title><style>body{font:16px -apple-system,system-ui,sans-serif;color:#243b31;background:#f5f8f4;max-width:540px;margin:15vh auto;padding:30px;line-height:1.6}h1{font-size:30px;letter-spacing:-1px}a{display:inline-block;background:#175d4b;color:white;padding:12px 20px;border-radius:8px;text-decoration:none}small{color:#748278}</style><h1>${state === "return" ? "Return to your seller." : "Your setup link needs refreshing."}</h1><p>${state === "return" ? "Your local dashboard will check Stripe’s current payout status. A return from Stripe alone does not mean setup is complete." : "Open your local dashboard and click Set up Stripe to get a fresh link."}</p><p><a href="http://127.0.0.1:43118/">Open local dashboard →</a></p><small>Open this on the computer where you installed the seller. If the page asks you to reconnect, run <code>atm-seller dashboard</code>. Payments are in Stripe TEST MODE.</small></html>`);
  });
  server.get("/api/seller-release", async (c) => {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(await releaseDirectory(), "release.json"), "utf8"));
      if (manifest.dirty) throw new Error("Uncommitted release");
      c.header("Cache-Control", "no-store");
      return c.json({ ...manifest, contract_version: CONTRACT_VERSION, seller_protocol: 1 });
    } catch { return c.json({ error: "SELLER_RELEASE_UNAVAILABLE" }, 503); }
  });
  for (const [name, type] of Object.entries({ "install.sh": "text/x-shellscript", "seller-bundle.tgz": "application/gzip", "runner.wasm": "application/wasm", "runner.wasm.sha256": "text/plain" })) {
    server.get(`/${name}`, async (c) => {
      try {
        const content = await fs.readFile(path.join(await releaseDirectory(), name));
        c.header("Cache-Control", "no-cache"); c.header("Content-Type", type);
        if (name === "install.sh") return c.body(content.toString().replaceAll("__ATM_BASE_URL__", new URL(env().baseUrl).origin));
        return c.body(new Uint8Array(content));
      } catch { return c.json({ error: "SELLER_RELEASE_UNAVAILABLE" }, 503); }
    });
  }
}
