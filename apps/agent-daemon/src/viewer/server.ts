/**
 * Live view: a localhost-only web page that streams what each sandbox
 * instance is doing (boot, policy grants, MCP calls into the runner, the
 * runner's own network traffic and the model's output as it is generated).
 *
 * Events go to the browser over Server-Sent Events. A new browser window
 * opens for every new sandbox instance (`--viewer-open each`), once for the
 * overview (`first`) or never.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SandboxObserver, VmStart, VmState } from "./types.js";

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "page.html");
const HISTORY_LIMIT = 20_000;

export type ViewerEvent = Record<string, unknown> & { t: string };
export type OpenMode = "each" | "first" | "never" | "claim";

export interface LiveViewOptions {
  port?: number;
  open?: OpenMode;
  role: string;
  runtime: string;
  marketplaceUrl: string;
  /** Observer tap routes sandbox traffic through 127.0.0.1 so prompts and output are visible. */
  tap?: boolean;
  /** Synthetic events from the demo script; the page labels them. */
  simulated?: boolean;
  openTab?:(url:string)=>void;
}

interface LiveVm { pid: number | null; closed: boolean }

export class LiveView implements SandboxObserver {
  url = "";
  private readonly history: ViewerEvent[] = [];
  private readonly clients = new Set<http.ServerResponse>();
  private readonly vms = new Map<string, LiveVm>();
  private readonly latestStats = new Map<string, ViewerEvent>();
  private readonly server: http.Server;
  private readonly opts: LiveViewOptions;
  private readonly claimCalls=new Map<string,string>();
  private readonly openedClaims=new Set<string>();
  private seq = 0;
  private vmCount = 0;
  private statsTimer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: LiveViewOptions) {
    this.opts = opts;
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      // Loopback only: the page can show decrypted prompts and model output.
      this.server.listen(this.opts.port ?? 4700, "127.0.0.1", () => resolve());
    });
    this.url = `http://localhost:${(this.server.address() as { port: number }).port}`;
    this.emit({ t: "hello", role: this.opts.role, runtime: this.opts.runtime, marketplace: this.opts.marketplaceUrl, tap: !!this.opts.tap, simulated: !!this.opts.simulated });
    this.statsTimer = setInterval(() => this.sampleStats(), 1000);
    this.statsTimer.unref();
    // "each" opens a window per instance in vmStarted instead.
    if (this.opts.open === "first") openWindow(this.url);
    return this.url;
  }

  emit(event: ViewerEvent) {
    if(this.opts.open==='claim'&&event.t==='net'){
      if(event.phase==='start'&&event.call==='claim_task')this.claimCalls.set(String(event.id),String(event.vm));
      if(event.phase==='end'&&this.claimCalls.has(String(event.id))){
        const vm=this.claimCalls.get(String(event.id));this.claimCalls.delete(String(event.id));
        const claim=(event.res as any)?.claim;
        if(event.ok&&claim?.claim_id&&vm&&!this.openedClaims.has(claim.claim_id)){
          this.openedClaims.add(claim.claim_id);
          (this.opts.openTab??openWindow)(`${this.url}/vm/${encodeURIComponent(vm)}?task=${encodeURIComponent(claim.task_id)}`);
        }
      }
    }
    const e: ViewerEvent = { ...event, seq: ++this.seq, at: Date.now() };
    if (e.t === "stats") this.latestStats.set(String(e.vm), e);
    else {
      this.history.push(e);
      if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
    }
    const frame = `data: ${JSON.stringify(e)}\n\n`;
    for (const client of this.clients) client.write(frame);
  }

  log(line: string) { this.emit({ t: "log", line }); }

  // ------------------------------------------------------- SandboxObserver --
  vmStarted(info: VmStart): string {
    const vm = `vm-${++this.vmCount}`;
    this.vms.set(vm, { pid: null, closed: false });
    this.emit({ t: "vm", vm, ...info, state: "booting" satisfies VmState });
    if (this.opts.open === "each") openWindow(`${this.url}/vm/${vm}`);
    return vm;
  }

  vmUpdate(vm: string, patch: { state?: VmState; pid?: number | null; component?: string }) {
    const live = this.vms.get(vm);
    if (live && patch.pid !== undefined) live.pid = patch.pid;
    this.emit({ t: "vm", vm, ...patch });
  }

  step(vm: string, name: string, phase: "start" | "end", detail: Record<string, unknown> = {}) {
    this.emit({ t: "step", vm, name, phase, ...detail });
  }

  stderr(vm: string, line: string) { this.emit({ t: "stderr", vm, line }); }

  vmClosed(vm: string, reason: string) {
    const live = this.vms.get(vm);
    if (live) live.closed = true;
    this.emit({ t: "vm", vm, state: (reason === "closed" ? "closed" : "crashed") satisfies VmState, reason });
  }

  /** The instance currently doing work; tapped network traffic is attributed to it. */
  activeVm(): string | null {
    let last: string | null = null;
    for (const [id, vm] of this.vms) if (!vm.closed) last = id;
    return last;
  }

  async close() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    for (const client of this.clients) client.end();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  // ------------------------------------------------------------- internals --
  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if(!/^((localhost)|(127\.0\.0\.1)):\d+$/.test(req.headers.host??"")){res.writeHead(403);res.end("Local viewer only");return;}
    res.setHeader("X-Frame-Options","DENY");
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      for (const e of this.history) res.write(`data: ${JSON.stringify(e)}\n\n`);
      for (const e of this.latestStats.values()) res.write(`data: ${JSON.stringify(e)}\n\n`);
      this.clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => { clearInterval(ping); this.clients.delete(res); });
      return;
    }
    if (url.pathname === "/" || url.pathname.startsWith("/vm/")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(fs.readFileSync(PAGE));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }

  private sampleStats() {
    for (const [vm, live] of this.vms) {
      if (live.closed || !live.pid || process.platform === "win32") continue;
      execFile("ps", ["-o", "%cpu=,rss=", "-p", String(live.pid)], (error, stdout) => {
        if (error) return;
        const [cpu = NaN, rssKb = NaN] = stdout.trim().split(/\s+/).map(Number);
        if (Number.isFinite(cpu) && Number.isFinite(rssKb)) this.emit({ t: "stats", vm, cpu, rss: rssKb * 1024 });
      });
    }
  }
}

export async function startLiveView(opts: LiveViewOptions): Promise<LiveView> {
  const view = new LiveView(opts);
  await view.listen();
  return view;
}

const CHROME_MAC = "/Applications/Google Chrome.app";

/** Open the URL in a separate browser window: Chrome app window if available, else the default browser. */
export function openWindow(url: string) {
  const run = (cmd: string, args: string[]) => new Promise<boolean>((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("spawn", () => { child.unref(); resolve(true); });
  });
  void (async () => {
    if (process.env.ATM_VIEWER_BROWSER) { await run(process.env.ATM_VIEWER_BROWSER, [url]); return; }
    if (process.platform === "darwin") {
      await run("open", [url]);
      return;
    }
    if (process.platform === "win32") { await run("cmd", ["/c", "start", "", url]); return; }
    for (const browser of ["google-chrome", "chromium", "chromium-browser"]) if (await run(browser, ["--new-window", `--app=${url}`])) return;
    await run("xdg-open", [url]);
  })();
}
