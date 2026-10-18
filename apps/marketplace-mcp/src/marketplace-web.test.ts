import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, expect, it } from "vitest";
import { registerMarketplaceWebRoutes } from "./marketplace-web.js";

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });

it("serves the public build and versioned assets without exposing local state or an API bridge", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atm-web-")); directories.push(root);
  const dist = path.join(root, "dist"); await fs.mkdir(path.join(dist, "assets"), { recursive: true });
  const app = new Hono(); registerMarketplaceWebRoutes(app as any, dist);
  const home = await app.request("/"); expect(home.status).toBe(302); expect(home.headers.get("location")).toBe("/marketplace/");
  expect((await app.request("/marketplace/")).status).toBe(503);
  await fs.writeFile(path.join(dist, "index.html"), '<div id="root"></div><script src="/marketplace/assets/index-Abc12345.js"></script>');
  await fs.writeFile(path.join(dist, "assets/index-Abc12345.js"), "console.log('public board')");
  await fs.writeFile(path.join(dist, "assets/index-Abc12345.css"), "body{color:black}");
  await fs.writeFile(path.join(root, "private.js"), "PRIVATE_FIXTURE");
  await fs.symlink(path.join(root, "private.js"), path.join(dist, "assets/escape.js"));
  const redirect = await app.request("/marketplace"); expect(redirect.status).toBe(308); expect(redirect.headers.get("location")).toBe("/marketplace/");
  const index = await app.request("/marketplace/"); expect(index.status).toBe(200); expect(index.headers.get("content-security-policy")).toContain("connect-src 'self'"); expect(index.headers.get("cache-control")).toBe("no-cache");
  const js = await app.request("/marketplace/assets/index-Abc12345.js"); expect(js.status).toBe(200); expect(js.headers.get("content-type")).toContain("text/javascript"); expect(js.headers.get("cache-control")).toContain("immutable"); expect(await js.text()).toContain("public board");
  const css = await app.request("/marketplace/assets/index-Abc12345.css"); expect(css.status).toBe(200); expect(css.headers.get("content-type")).toContain("text/css");
  for (const url of ["/marketplace/.env", "/marketplace/.atm-state/buyer.json", "/marketplace/assets/escape.js", "/marketplace/assets/index-Abc12345.js.map", "/marketplace/assets/%2E%2E%2Fprivate.js", "/marketplace/assets/missing.js", "/api/buyer"]) expect((await app.request(url)).status).toBe(404);
  for (const url of ["/api/buyer", "/marketplace/api/buyer"]) expect((await app.request(url, { method: "POST" })).status).toBe(404);
});
