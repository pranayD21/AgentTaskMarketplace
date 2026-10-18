import fs from "node:fs/promises";
import path from "node:path";
import type { MCPServer } from "mcp-use";
import { CONTRACT_VERSION } from "@atm/shared";
import { env } from "./env.js";
export function registerSellerReleaseRoutes(server: MCPServer, directory = path.resolve(process.cwd(), "public/seller")) {
  server.get("/api/seller-release", async (c) => {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(directory, "release.json"), "utf8"));
      if (manifest.dirty) throw new Error("Uncommitted release");
      c.header("Cache-Control", "no-store");
      return c.json({ ...manifest, contract_version: CONTRACT_VERSION, seller_protocol: 1 });
    } catch { return c.json({ error: "SELLER_RELEASE_UNAVAILABLE" }, 503); }
  });
  for (const [name, type] of Object.entries({ "install.sh": "text/x-shellscript", "seller-bundle.tgz": "application/gzip", "runner.wasm": "application/wasm", "runner.wasm.sha256": "text/plain" })) {
    server.get(`/${name}`, async (c) => {
      try {
        const content = await fs.readFile(path.join(directory, name));
        c.header("Cache-Control", "no-cache"); c.header("Content-Type", type);
        if (name === "install.sh") return c.body(content.toString().replaceAll("__ATM_BASE_URL__", new URL(env().baseUrl).origin));
        return c.body(new Uint8Array(content));
      } catch { return c.json({ error: "SELLER_RELEASE_UNAVAILABLE" }, 503); }
    });
  }
}
