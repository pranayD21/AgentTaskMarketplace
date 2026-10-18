import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MCPServer } from "mcp-use";

export function registerMarketplaceWebRoutes(server: MCPServer, directory?: string): void {
  async function buildDirectory(): Promise<string> {
    if (directory) return directory;
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    for (const candidate of [path.resolve(process.cwd(), "../web/dist"), path.resolve(process.cwd(), "apps/web/dist"),
      path.resolve(moduleDir, "../../web/dist"), path.resolve(moduleDir, "../../../web/dist")]) {
      try { await fs.access(path.join(candidate, "index.html")); directory = candidate; return candidate; } catch {}
    }
    throw new Error("MARKETPLACE_WEB_UNAVAILABLE");
  }

  server.get("/", c => c.redirect("/marketplace/", 302));
  server.get("/marketplace", c => c.redirect("/marketplace/", 308));
  server.get("/marketplace/", async c => {
    try {
      const html = await fs.readFile(path.join(await buildDirectory(), "index.html"), "utf8");
      c.header("Cache-Control", "no-cache");
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Referrer-Policy", "no-referrer");
      c.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      return c.html(html);
    } catch { return c.json({ error: "MARKETPLACE_WEB_UNAVAILABLE" }, 503); }
  });
  server.get("/marketplace/assets/:filename", async c => {
    const name = c.req.param("filename");
    if (!/^[A-Za-z0-9_-]+\.(js|css)$/.test(name)) return c.notFound();
    try {
      const assets = await fs.realpath(path.join(await buildDirectory(), "assets"));
      const file = await fs.realpath(path.join(assets, name));
      if (path.dirname(file) !== assets) return c.notFound();
      const content = await fs.readFile(file);
      c.header("Content-Type", name.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8");
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Cache-Control", /-[A-Za-z0-9_-]{6,}\.(js|css)$/.test(name) ? "public, max-age=31536000, immutable" : "no-cache");
      return c.body(new Uint8Array(content));
    } catch { return c.notFound(); }
  });
}
