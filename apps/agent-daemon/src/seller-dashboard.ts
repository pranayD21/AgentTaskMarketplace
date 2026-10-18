import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readAgentState } from "./identity.js";
import { Marketplace } from "./marketplace.js";
import { createDashboardChat } from "./dashboard-chat.js";
// The shared local buyer bridge is JavaScript and bundled into the installer.
// @ts-ignore no declaration file for this workspace module
import { createBuyerBridge } from "../../web/server/buyer.mjs";


export const DASHBOARD_PORT = 43118;
export interface DashboardActions {
  status(): Promise<Record<string, unknown>>;
  prepare(update: (message: string) => void): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  payout(): Promise<Record<string, unknown>>;
}
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function writePrivate(file: string, value: unknown) {
  const tmp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" }); fs.renameSync(tmp, file);
}
const jsonFile = (file: string) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;

export async function machineSnapshot() {
  const read = async (route: string) => {
    try { const r = await fetch(`http://localhost:11434/api/${route}`, { signal: AbortSignal.timeout(2500), redirect: "error" });
      return r.ok ? await r.json() as any : null; } catch { return null; }
  };
  const [tags, running] = await Promise.all([read("tags"), read("ps")]);
  return { hostname: os.hostname(), chip: os.cpus()[0]?.model ?? "Unknown", cpu_cores: os.cpus().length,
    memory_bytes: os.totalmem(), free_memory_bytes: os.freemem(), load_average_1m: os.loadavg()[0],
    platform: os.platform(), arch: os.arch(), uptime_s: os.uptime(), ollama_online: tags !== null,
    models: (tags?.models ?? []).map((m: any) => ({ name: m.name, size: m.size, digest: m.digest,
      parameters: m.details?.parameter_size, quantization: m.details?.quantization_level })),
    loaded_models: (running?.models ?? []).map((m: any) => ({ name: m.name, size: m.size, size_vram: m.size_vram, expires_at: m.expires_at })) };
}

/** Loopback server. Browser gets a session cookie; OAuth/agent keys stay in Node. */
export function createSellerDashboard(options: { root: string; marketplaceUrl: string; assets: string; actions: DashboardActions; port?: number }) {
  const { root, actions } = options;
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const tokenFile = path.join(root, "dashboard-open.json");
  writePrivate(tokenFile, { token: randomBytes(32).toString("hex") });
  const sessions = new Set<string>();
  const pending = new Map<string, { state: string; verifier: string; until: number; insforge: string }>();
  let phase = "Ready to set up your account", lastError: string | null = null, busy = false;
  let cache: { at: number; value: Record<string, unknown> } | undefined;
  const buyerFile = path.join(root, "buyer.json");
  function buyerIdentity() {
    const seller = jsonFile(path.join(root, "seller.json"));
    const buyer = jsonFile(buyerFile);
    if (!seller?.owner?.user_id || !buyer?.owner?.user_id || seller.owner.user_id !== buyer.owner.user_id ||
      buyer.marketplace_url !== options.marketplaceUrl || !/^atm_sk_[A-Za-z0-9_-]{43}$/.test(buyer.api_key ?? "")) {
      throw Error("Sign in with Google to link your buyer account.");
    }
    return buyer;
  }
  async function buyerCall(tool: string) {
    const saved = buyerIdentity();
    const client = new Marketplace(options.marketplaceUrl, saved.api_key);
    try {
      const account = await client.call<any>("whoami");
      if (account.kind !== "buyer" || account.agent_id !== saved.agent_id || account.owner?.user_id !== saved.owner.user_id)
        throw Error("The saved buyer does not match this Google account.");
      return tool === "whoami" ? account : await client.call<any>(tool);
    } finally { await client.close(); }
  }
  const buyerBridge = createBuyerBridge({ endpoint: options.marketplaceUrl, statePath: buyerFile,
    journalDir: path.join(root, "buyer-drafts"), humanAccount: true, getSession: async () => {
      const saved = buyerIdentity(); return { owner: { user_id: saved.owner.user_id } };
    } });
  // Keep task activity in the dashboard. Per-task viewers remain opt-in links.
  const chat = createDashboardChat({ root, marketplaceUrl: options.marketplaceUrl });
  let buyerCache: { at: number; value: Record<string, unknown> } | undefined;
  const origin = () => `http://127.0.0.1:${(server.address() as any).port}`;
  const redirect = (res: http.ServerResponse, to: string) => { res.writeHead(303, { Location: to }); res.end(); };
  /**
   * Same-origin relay of the worker's live view. The worker's viewer listens on
   * a loopback port of its own; the browser never talks to it directly, so the
   * dashboard's CSP stays `connect-src 'self'` and no second site is embedded.
   */
  async function liveEvents(res: http.ServerResponse) {
    const saved = jsonFile(path.join(root, "status.json"));
    const viewer = typeof saved?.viewer_url === "string" && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(saved.viewer_url) ? saved.viewer_url : null;
    const fail = (status: number, message: string) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: message })); };
    if (!viewer) return fail(503, "The worker is not running.");
    const control = new AbortController();
    let upstream: Response;
    try { upstream = await fetch(`${viewer}/events`, { signal: control.signal, redirect: "error", headers: { Accept: "text/event-stream" } }); }
    catch { return fail(503, "The worker is not running."); }
    if (!upstream.ok || !upstream.body) return fail(503, "The worker is not running.");
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.on("close", () => control.abort());
    try { for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk); } catch { /* worker stopped or the page left */ }
    res.end();
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (status: number, value: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    if (req.headers.host !== new URL(origin()).host) return json(403, { error: "Invalid local host" });
    const url = new URL(req.url ?? "/", origin());
    const cookie = /(?:^|;\s*)atm_local=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? "")?.[1] ?? "";
    const authorized = sessions.has(cookie);
    try {
      if (req.method === "GET" && url.pathname === "/open") {
        const token = jsonFile(tokenFile)?.token ?? "";
        if (!token || !equal(url.searchParams.get("token") ?? "", token)) return json(403, { error: "Run atm-seller dashboard to open this page." });
        const session = randomBytes(32).toString("hex"); sessions.add(session);
        writePrivate(tokenFile, { token: randomBytes(32).toString("hex") });
        res.setHeader("Set-Cookie", `atm_local=${session}; HttpOnly; SameSite=Lax; Path=/`);
        const task = url.searchParams.get("task");
        return redirect(res, task && /^task_[A-Za-z0-9_-]+$/.test(task) ? `/task.html?task=${encodeURIComponent(task)}` : "/");
      }
      if (!authorized) return json(401, { error: "Run atm-seller dashboard to open this page." });
      if (req.method === "POST" && (req.headers.origin !== origin() || (url.pathname !== "/api/buyer" && req.headers["x-atm-request"] !== "1"))) return json(403, { error: "Invalid local request" });
      if (url.pathname === "/api/buyer") {
        buyerIdentity();
        return await buyerBridge(req, res, () => json(404, { error: "Not found" }));
      }
      if (url.pathname === "/api/chat" || url.pathname.startsWith("/api/chat/")) {
        if (await chat.handle(req, res)) return;
      }
      if (req.method === "POST" && url.pathname === "/api/buyer-payment") {
        const payment = await buyerCall("get_buyer_setup");
        if (payment.setup_url) {
          const link = new URL(payment.setup_url);
          if (link.protocol !== "https:" || !(link.hostname === "stripe.com" || link.hostname.endsWith(".stripe.com")))
            throw Error("Stripe returned an invalid setup link.");
        }
        buyerCache = undefined;
        return json(200, payment);
      }
      if (req.method === "GET" && url.pathname === "/auth/callback") {
        const flow = pending.get(cookie); pending.delete(cookie);
        if (!flow || Date.now() > flow.until || !equal(url.searchParams.get("state") ?? "", flow.state)) throw Error("Sign-in expired. Please try Google sign-in again.");
        const code = url.searchParams.get("insforge_code");
        if (!code) throw Error("Google sign-in was cancelled or did not complete.");
        const exchange = await fetch(new URL("/api/auth/oauth/exchange?client_type=desktop", flow.insforge), {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, code_verifier: flow.verifier }),
          redirect: "error", signal: AbortSignal.timeout(20000) });
        if (!exchange.ok) throw Error("Google sign-in could not be verified. Please try again.");
        const session = await exchange.json() as any;
        if (typeof session.accessToken !== "string") throw Error("Sign-in did not return a user session.");
        const stateFile = path.join(root, "seller.json");
        const existing = readAgentState(stateFile);
        const enrollmentFile = path.join(root, "enrollment.json");
        let enrollment = jsonFile(enrollmentFile);
        if (!enrollment) { enrollment = { api_key: existing?.api_key ?? `atm_sk_${randomBytes(32).toString("base64url")}` }; writePrivate(enrollmentFile, enrollment); }
        const linked = await fetch(new URL("/api/account/identity", options.marketplaceUrl), { method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
          body: JSON.stringify({ agent_key: enrollment.api_key, display_name: os.hostname().slice(0, 80) }), redirect: "error", signal: AbortSignal.timeout(30000) });
        if (!linked.ok) throw Error(linked.status === 409 ? "This seller belongs to another Google account. Sign in with its owner." : "Could not save your seller identity. Retry Google sign-in; the same identity will be reused.");
        const account = await linked.json() as any;
        const saved = account.seller, buyer = account.buyer;
        const previousBuyer = jsonFile(buyerFile);
        if (!saved || !buyer?.agent_id || !buyer.owner?.user_id || buyer.owner.user_id !== saved.owner?.user_id ||
          account.owner?.user_id !== buyer.owner.user_id || !/^atm_sk_[A-Za-z0-9_-]{43}$/.test(buyer.api_key ?? ""))
          throw Error("The marketplace did not confirm both account identities.");
        if (previousBuyer && (previousBuyer.agent_id !== buyer.agent_id || previousBuyer.api_key !== buyer.api_key ||
          previousBuyer.owner?.user_id !== buyer.owner.user_id || previousBuyer.marketplace_url !== options.marketplaceUrl))
          throw Error("Existing buyer identity does not match. Nothing was replaced.");
        if (!saved.agent_id || !saved.owner?.user_id) throw Error("The marketplace did not confirm an account link.");
        if (existing && existing.agent_id !== saved.agent_id) throw Error("Existing seller identity does not match. Nothing was replaced.");
        writePrivate(stateFile, { agent_id: saved.agent_id, api_key: enrollment.api_key, display_name: saved.display_name, owner: saved.owner });
        writePrivate(buyerFile, { agent_id: buyer.agent_id, api_key: buyer.api_key, display_name: buyer.display_name,
          owner: buyer.owner, marketplace_url: options.marketplaceUrl });
        buyerCache = undefined;
        phase = "Google account linked. You can buy tasks and set up local selling."; lastError = null; cache = undefined;
        return redirect(res, "/");
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        const machine = await machineSnapshot();
        if (!cache || Date.now() - cache.at > 15000) {
          try { cache = { at: Date.now(), value: await actions.status() }; }
          catch { cache = { at: Date.now(), value: { server_reachable: false } }; }
        }
        const saved = jsonFile(path.join(root, "seller.json"));
        const release = jsonFile(path.join(root, "app/release.json"));
        if (!buyerCache || Date.now() - buyerCache.at > 15000) {
          try { const account = await buyerCall("whoami"); buyerCache = { at: Date.now(), value: {
            buyer_id: account.agent_id, buyer_payment: account.buyer_payment, provider_budget: account.provider_budget } }; }
          catch { buyerCache = { at: Date.now(), value: { buyer_id: null, buyer_payment: null, provider_budget: null } }; }
        }
        return json(200, { ...buyerCache.value, machine, worker: cache.value, owner: saved?.owner ?? null, seller_id: saved?.agent_id ?? null,
          allowed_models: release?.allowed_models ?? [], phase, error: lastError, busy, payments_label: "Stripe TEST MODE" });
      }
      if (req.method === "GET" && url.pathname === "/api/live") return liveEvents(res);
      if (req.method === "POST" && url.pathname === "/api/auth/google") {
        const configResponse = await fetch(new URL("/api/seller-auth-config", options.marketplaceUrl), { signal: AbortSignal.timeout(15000), redirect: "error" });
        if (!configResponse.ok) throw Error("Marketplace sign-in is unavailable. Please try again.");
        const config = await configResponse.json() as any;
        const insforge = new URL(config.insforge_url);
        if (insforge.protocol !== "https:") throw Error("Sign-in configuration is invalid.");
        const verifier = randomBytes(32).toString("base64url"), state = randomBytes(32).toString("hex");
        const callback = new URL("/auth/callback", origin()); callback.searchParams.set("state", state);
        const begin = new URL("/api/auth/oauth/google", insforge);
        begin.searchParams.set("redirect_uri", callback.toString()); begin.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
        const response = await fetch(begin, { signal: AbortSignal.timeout(15000), redirect: "error" });
        const result = await response.json() as any;
        if (!response.ok || new URL(result.authUrl).origin !== "https://accounts.google.com") throw Error("Google sign-in is not configured for this marketplace.");
        pending.set(cookie, { verifier, state, until: Date.now() + 10 * 60_000, insforge: insforge.origin });
        return json(200, { url: result.authUrl });
      }
      if (req.method === "POST" && ["/api/prepare", "/api/start", "/api/stop", "/api/payout"].includes(url.pathname)) {
        const saved = jsonFile(path.join(root, "seller.json"));
        if (!saved?.owner?.user_id) return json(401, { error: "Sign in with Google first." });
        if (busy) return json(409, { error: "Setup is already running. See its progress below." });
        if (url.pathname === "/api/prepare") {
          busy = true; lastError = null; phase = "Checking your installed models…";
          void actions.prepare(message => { phase = message; }).then(() => { phase = "Local model ready. Complete Stripe setup, then start selling."; })
            .catch(() => { lastError = "Model setup did not finish. Check atm-seller logs, then retry Prepare model."; })
            .finally(() => { busy = false; cache = undefined; });
          return json(202, { ok: true });
        }
        if (url.pathname === "/api/payout") {
          const payout = await actions.payout(); cache = undefined;
          const link = payout.payout_onboarding_url;
          if (typeof link === "string") {
            const u = new URL(link);
            if (u.protocol !== "https:" || !(u.hostname === "stripe.com" || u.hostname.endsWith(".stripe.com"))) throw Error("Stripe returned an invalid setup link.");
          }
          return json(200, payout);
        }
        if (url.pathname === "/api/start") { const buyer = await buyerCall("whoami"); if (!["READY", "MOCK"].includes(buyer.buyer_payment?.buyer_payment_status)) return json(402, {error:"Complete Stripe buying setup before starting to sell."}); await actions.start(); phase = "Seller started. Waiting for a matching task."; }
        else { await actions.stop(); phase = "Seller stopped. Your identity and models are saved."; }
        cache = undefined; return json(200, { ok: true });
      }
      if (req.method === "GET" && ["/", "/seller.css", "/seller.js", "/task.html"].includes(url.pathname)) {
        const name = url.pathname === "/" ? "seller.html" : url.pathname.slice(1);
        res.writeHead(200, { "Content-Type": name.endsWith(".html") ? "text/html; charset=utf-8" : name.endsWith(".css") ? "text/css" : "text/javascript" });
        return res.end(fs.readFileSync(path.join(options.assets, name)));
      }
      return json(404, { error: "Not found" });
    } catch (error) {
      // Never echo upstream bodies or tokens. Controlled messages cover expected failures.
      const message = error instanceof Error && /^[A-Z][A-Za-z0-9 .,;’'\-]+[.!]$/.test(error.message) ? error.message : "Setup could not finish. Please try again.";
      lastError = message;
      if (url.pathname === "/auth/callback") return redirect(res, "/");
      return json(400, { error: message });
    }
  });
  server.on("close", () => { chat.close(); });
  server.requestTimeout = 35000; server.headersTimeout = 10000;
  return { server, listen: () => new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? DASHBOARD_PORT, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); }); }) };
}
