import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Marketplace } from "./marketplace.js";
import { readAgentState } from "./identity.js";
import { requireCompatibleRelease } from "./release.js";
import { createSellerDashboard, DASHBOARD_PORT, writePrivate } from "./seller-dashboard.js";

export const SERVICE_LABEL = "dev.atm.seller";
export function xml(value: string) { return value.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!); }
/** The seller model the human chose on the dashboard; empty means every installed model the network accepts. */
export function chosenSellerModel(root: string): string {
  const file = path.join(root, "model.json");
  try { const model = JSON.parse(fs.readFileSync(file, "utf8")).seller_model; return typeof model === "string" ? model : ""; } catch { return ""; }
}
export function launchAgent(root: string, node: string, marketplaceUrl: string, executablePath: string, model = chosenSellerModel(root)) {
  const environment = { PATH: executablePath, HOME: os.homedir(), MARKETPLACE_URL: marketplaceUrl, OLLAMA_URL: "http://localhost:11434",
    ATM_APP_ROOT: path.join(root, "app"), ATM_STATE_DIR: path.join(root, "runtime"), ATM_STATUS_FILE: path.join(root, "status.json"), ATM_REQUIRE_RELEASE: "1", ATM_HUMAN_SELLER_REQUIRED: "1", ATM_PREPARED_FILE: path.join(root, "prepared.json") };
  const args = [node, path.join(root, "app/daemon.mjs"), "--role", "seller", "--runtime", "wassette", "--state-file", path.join(root, "seller.json"),
    "--display-name", os.hostname().slice(0, 80), "--computer-id", `host-${createHash("sha256").update(os.hostname()).digest("hex").slice(0, 12)}`,
    "--measurement-file", path.join(root, "measurements/seller.jsonl"), "--poll-ms", "5000", ...(model ? ["--model", model] : [])];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${SERVICE_LABEL}</string><key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join("")}</array><key>EnvironmentVariables</key><dict>${Object.entries(environment).map(([k,v]) => `<key>${k}</key><string>${xml(v)}</string>`).join("")}</dict><key>WorkingDirectory</key><string>${xml(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>StandardOutPath</key><string>${xml(path.join(root,"logs/seller.log"))}</string><key>StandardErrorPath</key><string>${xml(path.join(root,"logs/seller.log"))}</string></dict></plist>\n`;
}
export function sellerEnvironment(root: string, app: string, marketplaceUrl: string): NodeJS.ProcessEnv {
  // Build an allowlist: installing a seller must not inherit buyer, judge or server keys.
  return { PATH: process.env.PATH ?? "/opt/homebrew/bin:/usr/bin:/bin", HOME: os.homedir(), TMPDIR: os.tmpdir(),
    MARKETPLACE_URL: marketplaceUrl, OLLAMA_URL: "http://localhost:11434", ATM_APP_ROOT: app,
    ATM_STATE_DIR: path.join(root, "runtime"), ATM_STATUS_FILE: path.join(root, "status.json"), ATM_REQUIRE_RELEASE: "1", ATM_HUMAN_SELLER_REQUIRED: "1", ATM_PREPARED_FILE: path.join(root, "prepared.json") };
}
const root = path.join(os.homedir(), ".atm");
const app = path.join(root, "app");
const dashboardLabel = "dev.atm.seller-dashboard";
const domain = `gui/${process.getuid!()}`;
const plistFor = (label: string) => path.join(os.homedir(), "Library/LaunchAgents", `${label}.plist`);
const config = () => JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const run = (command: string, args: string[], env?: NodeJS.ProcessEnv) => {
  const result = spawnSync(command, args, { stdio: "inherit", env: env ?? process.env });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? result.error?.message})`);
};
const serviceInfo = (label = SERVICE_LABEL) => {
  const result = spawnSync("launchctl", ["print", `${domain}/${label}`], { encoding: "utf8" });
  return { loaded: result.status === 0, state: result.stdout?.match(/\bstate = ([^\n]+)/)?.[1] ?? "stopped",
    pid: Number(result.stdout?.match(/\bpid = (\d+)/)?.[1]) || null };
};
const stopService = (label = SERVICE_LABEL) => { if (serviceInfo(label).loaded) run("launchctl", ["bootout", `${domain}/${label}`]); };
const startService = (label = SERVICE_LABEL) => { if (!serviceInfo(label).loaded) run("launchctl", ["bootstrap", domain, plistFor(label)]); };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitForUnlock() {
  for (let i = 0; i < 30; i++) {
    const file = path.join(root, "seller.json.lock");
    if (!fs.existsSync(file)) return;
    const pid = Number(fs.readFileSync(file, "utf8"));
    try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return; }
    await wait(500);
  }
  throw Error("The seller is still stopping. Try again shortly.");
}
function ownedIdentity() {
  const state = readAgentState(path.join(root, "seller.json"));
  const saved = state ? JSON.parse(fs.readFileSync(path.join(root, "seller.json"), "utf8")) : null;
  if (!saved?.owner?.user_id) throw Error("Sign in with Google in the local dashboard first.");
  return saved;
}
async function callMarketplace(name: string) {
  const state = ownedIdentity(); const mp = new Marketplace(config().marketplace_url, state.api_key);
  try { return await mp.call<any>(name); } finally { await mp.close(); }
}
async function status() {
  const state = readAgentState(path.join(root, "seller.json"));
  const saved = fs.existsSync(path.join(root, "status.json")) ? JSON.parse(fs.readFileSync(path.join(root, "status.json"), "utf8")) : {};
  const prepared = fs.existsSync(path.join(root, "prepared.json")) ? JSON.parse(fs.readFileSync(path.join(root, "prepared.json"), "utf8")) : null;
  const manifest = JSON.parse(fs.readFileSync(path.join(app, "release.json"), "utf8"));
  let current: any = null;
  if (state) { try { current = await callMarketplace("whoami"); } catch {} }
  const processInfo = serviceInfo();
  return { viewer_url: processInfo.pid && processInfo.pid === saved.worker_pid ? saved.viewer_url : null, service: processInfo.state, pid: processInfo.pid, seller_id: state?.agent_id ?? null,
    prepared: Boolean(prepared && prepared.seller_id === state?.agent_id && prepared.runner_sha256 === manifest.artifacts["runner.wasm"].sha256),
    marketplace: config().marketplace_url, models: current?.seller?.models ?? saved.models ?? [], approvals: current?.seller?.approvals ?? null,
    seller_status: current?.seller?.status ?? null, strikes: current?.seller?.strikes ?? null, stopped_reason: saved.stopped_reason ?? null,
    runtime: saved.runtime ?? "wassette", component_sha256: saved.wasm_sha256 ?? manifest.artifacts["runner.wasm"].sha256,
    payout_status: current?.payout?.payout_status ?? "UNAVAILABLE", payout_label: current?.payout?.payout_label,
    server_reachable: Boolean(current) };
}
async function runAsync(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const logFile = fs.openSync(path.join(root, "logs/setup.log"), "a", 0o600);
  try { await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", logFile, logFile] });
    child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(Error(`${path.basename(command)} did not finish.`)));
  }); } finally { fs.closeSync(logFile); }
}
async function prepare(update: (message: string) => void) {
  const state = ownedIdentity();
  if (serviceInfo().loaded) throw Error("Stop selling before checking the model again.");
  const cfg = config(), release = JSON.parse(fs.readFileSync(path.join(app, "release.json"), "utf8"));
  await requireCompatibleRelease(cfg.marketplace_url);
  const environment = sellerEnvironment(root, app, cfg.marketplace_url);
  let response = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error("Ollama is not available.");
  let models = ((await response.json()) as any).models.filter((m: any) => release.allowed_models.includes(m.name));
  if (!models.length) {
    update("Downloading Qwen3 8B (about 5.2 GB). Keep this computer online. Progress is in atm-seller logs.");
    await runAsync("ollama", ["pull", "qwen3:8b"], environment);
    response = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(10000) });
    models = ((await response.json()) as any).models.filter((m: any) => release.allowed_models.includes(m.name));
  }
  if (!models.length) throw Error("No supported local model was found.");
  update("Running a short model liveness check in the Wasm sandbox…");
  await runAsync(cfg.node, [path.join(app, "daemon.mjs"), "--role", "seller", "--runtime", "wassette", "--canary-only", ...models.flatMap((m: any) => ["--model", m.name])], environment);
  update("Saving model capabilities and creating your Stripe payout account…");
  await waitForUnlock();
  await runAsync(cfg.node, [path.join(app, "daemon.mjs"), "--role", "seller", "--runtime", "wassette", "--register-only", "--display-name", state.display_name, "--state-file", path.join(root, "seller.json")], environment);
  writePrivate(path.join(root, "prepared.json"), { seller_id: state.agent_id, runner_sha256: release.artifacts["runner.wasm"].sha256, models, checked_at: new Date().toISOString() });
}
async function startSeller() {
  ownedIdentity();
  const current = await status();
  if (!current.prepared) throw Error("Prepare your local model before starting.");
  if (current.payout_status !== "ACTIVE") throw Error("Complete Stripe payout setup before starting.");
  // The launch agent carries the chosen model, so rewrite it on every start.
  const cfg = config();
  fs.writeFileSync(plistFor(SERVICE_LABEL), launchAgent(root, cfg.node, cfg.marketplace_url, process.env.PATH ?? "/opt/homebrew/bin:/usr/bin:/bin"), { mode: 0o600 });
  run("launchctl", ["enable", `${domain}/${SERVICE_LABEL}`]);
  startService();
  for (let i = 0; i < 40; i++) {
    const processInfo = serviceInfo();
    const file = path.join(root, "status.json");
    const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    if (processInfo.state === "running" && saved.worker_pid === processInfo.pid && !saved.registration_only) return;
    await wait(500);
  }
  throw Error("The worker has not reported ready yet. Check atm-seller logs.");
}
export function dashboardLaunchAgent(node: string, executablePath: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>${dashboardLabel}</string><key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(path.join(app,"control.mjs"))}</string><string>serve</string></array><key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(os.homedir())}</string><key>PATH</key><string>${xml(executablePath)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>StandardOutPath</key><string>${xml(path.join(root,"logs/dashboard.log"))}</string><key>StandardErrorPath</key><string>${xml(path.join(root,"logs/dashboard.log"))}</string></dict></plist>`;
}
async function openDashboard() {
  startService(dashboardLabel);
  const tokenFile = path.join(root, "dashboard-open.json");
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${DASHBOARD_PORT}/api/status`, { signal: AbortSignal.timeout(1000) });
      if (response.status === 401 && fs.existsSync(tokenFile)) {
        const { token } = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
        spawn("/usr/bin/open", [`http://127.0.0.1:${DASHBOARD_PORT}/open?token=${token}`], { stdio: "ignore" }).unref();
        console.log("Opened your local seller dashboard. Sign in with Google, prepare your model, and complete Stripe payout setup."); return;
      }
    } catch {}
    await wait(500);
  }
  throw Error("The local dashboard did not start. Check atm-seller logs.");
}
async function install(stage: string, marketplaceUrl: string, node: string) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw Error("This release requires an Apple silicon Mac.");
  stage = fs.realpathSync(stage);
  if (path.dirname(stage) !== root || !path.basename(stage).startsWith(".stage-") || !path.isAbsolute(node) || !fs.existsSync(node)) throw Error("Invalid installation package.");
  const endpoint = new URL(marketplaceUrl);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw Error("Marketplace URL must use HTTPS.");
  await requireCompatibleRelease(marketplaceUrl);
  const release = JSON.parse(fs.readFileSync(path.join(stage, "release.json"), "utf8"));
  const hash = createHash("sha256").update(fs.readFileSync(path.join(stage, "packages/runner-wasm/dist/runner.wasm"))).digest("hex");
  if (hash !== release.artifacts["runner.wasm"].sha256) throw Error("Runner checksum does not match the release.");
  for (const dir of [root, "logs", "runtime", "measurements", "bin"].map(d => path.isAbsolute(d) ? d : path.join(root,d))) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const backup = path.join(root, `.previous-${Date.now()}`);
  const wasRunning = serviceInfo().loaded;
  const oldPlists = [SERVICE_LABEL,dashboardLabel].map(label => ({ label, bytes: fs.existsSync(plistFor(label)) ? fs.readFileSync(plistFor(label)) : null }));
  stopService(dashboardLabel); stopService(); await waitForUnlock();
  if (fs.existsSync(app)) fs.renameSync(app, backup);
  fs.renameSync(stage, app);
  try {
    fs.mkdirSync(path.dirname(plistFor(SERVICE_LABEL)), { recursive: true });
    fs.writeFileSync(plistFor(SERVICE_LABEL), launchAgent(root, node, marketplaceUrl, process.env.PATH ?? "/opt/homebrew/bin:/usr/bin:/bin"), { mode: 0o600 });
    fs.writeFileSync(plistFor(dashboardLabel), dashboardLaunchAgent(node, process.env.PATH ?? "/opt/homebrew/bin:/usr/bin:/bin"), { mode: 0o600 });
    run("plutil", ["-lint", plistFor(SERVICE_LABEL), plistFor(dashboardLabel)]);
    writePrivate(path.join(root, "config.json"), { marketplace_url: marketplaceUrl, revision: release.revision, node });
    const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
    fs.writeFileSync(path.join(root, "bin/atm-seller"), `#!/bin/sh\n# ATM_SELLER_LAUNCHER\nexec ${quote(node)} ${quote(path.join(app,"control.mjs"))} "$@"\n`, { mode: 0o755 });
    const link = "/opt/homebrew/bin/atm-seller";
    if (!fs.existsSync(link)) { try { fs.symlinkSync(path.join(root,"bin/atm-seller"), link); } catch { console.log(`CLI: ${path.join(root,"bin/atm-seller")}`); } }
    if (!wasRunning) run("launchctl", ["disable", `${domain}/${SERVICE_LABEL}`]);
    await openDashboard();
    if (wasRunning) {
      if (!(await status()).prepared) await prepare(message => console.log(message));
      await startSeller();
    }
    console.log("Your identity and models are kept in ~/.atm. The local dashboard resumes after login.");
    console.log("Commands: atm-seller dashboard | status | logs | stop | start | uninstall");
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true });
  } catch (error) {
    stopService(dashboardLabel); stopService();
    if (fs.existsSync(backup)) {
      fs.renameSync(app,path.join(root,`.failed-${Date.now()}`));fs.renameSync(backup,app);
      for (const old of oldPlists) if (old.bytes) fs.writeFileSync(plistFor(old.label),old.bytes,{mode:0o600});
      startService(dashboardLabel);if(wasRunning)startService();
    }
    throw error;
  }
}
async function main() {
  const command = process.argv[2] ?? "dashboard";
  if (command === "install") { await install(process.argv[3]!,process.argv[4]!,process.argv[5]!); return; }
  if (command === "serve") {
    const dashboard = createSellerDashboard({ root, marketplaceUrl:config().marketplace_url, assets:path.join(app,"ui"),
      actions:{status,prepare,start:startSeller,stop:async()=>{run("launchctl",["disable",`${domain}/${SERVICE_LABEL}`]);stopService();await waitForUnlock();},payout:()=>callMarketplace("get_seller_onboarding")} });
    await dashboard.listen(); console.log(`Seller dashboard listening on 127.0.0.1:${DASHBOARD_PORT}`); return;
  }
  if (command === "dashboard") { await openDashboard(); return; }
  if (command === "start") { await startSeller(); console.log("Seller worker is running."); return; }
  if (command === "stop") { run("launchctl",["disable",`${domain}/${SERVICE_LABEL}`]);stopService(); await waitForUnlock(); console.log("Seller stopped; identity preserved."); return; }
  if (command === "status") { console.log(JSON.stringify(await status(),null,2)); return; }
  if (command === "logs") { for(const name of ["seller","setup","dashboard"])fs.closeSync(fs.openSync(path.join(root,`logs/${name}.log`),"a",0o600));run("tail",["-n","40","-F",...['seller','setup','dashboard'].map(n=>path.join(root,`logs/${n}.log`))]); return; }
  if (command === "uninstall") {
    stopService();stopService(dashboardLabel);await waitForUnlock();
    for(const label of [SERVICE_LABEL,dashboardLabel])if(fs.existsSync(plistFor(label)))fs.unlinkSync(plistFor(label));
    const link="/opt/homebrew/bin/atm-seller";
    if(fs.existsSync(link)&&fs.lstatSync(link).isSymbolicLink()&&fs.readlinkSync(link)===path.join(root,"bin/atm-seller"))fs.unlinkSync(link);
    for(const dir of ["app","bin"])if(fs.existsSync(path.join(root,dir)))fs.rmSync(path.join(root,dir),{recursive:true});
    console.log("Seller software removed. Identity, logs, Ollama and downloaded models are preserved.");return;
  }
  throw Error("Use dashboard | status | logs | stop | start | uninstall");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(`Seller setup: ${error.message}`);process.exitCode=1;});
