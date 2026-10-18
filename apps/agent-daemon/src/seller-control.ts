import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Marketplace } from "./marketplace.js";
import { readAgentState } from "./identity.js";
import { requireCompatibleRelease } from "./release.js";

export const SERVICE_LABEL = "dev.atm.seller";
export function xml(value: string) { return value.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!); }
export function launchAgent(root: string, node: string, marketplaceUrl: string, executablePath: string) {
  const environment = { PATH: executablePath, HOME: os.homedir(), MARKETPLACE_URL: marketplaceUrl, OLLAMA_URL: "http://localhost:11434",
    ATM_APP_ROOT: path.join(root, "app"), ATM_STATE_DIR: path.join(root, "runtime"), ATM_STATUS_FILE: path.join(root, "status.json"), ATM_REQUIRE_RELEASE: "1" };
  const args = [node, path.join(root, "app/daemon.mjs"), "--role", "seller", "--runtime", "wassette", "--state-file", path.join(root, "seller.json"),
    "--display-name", os.hostname().slice(0, 80), "--computer-id", `host-${createHash("sha256").update(os.hostname()).digest("hex").slice(0, 12)}`,
    "--measurement-file", path.join(root, "measurements/seller.jsonl"), "--poll-ms", "5000"];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${SERVICE_LABEL}</string><key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join("")}</array><key>EnvironmentVariables</key><dict>${Object.entries(environment).map(([k,v]) => `<key>${k}</key><string>${xml(v)}</string>`).join("")}</dict><key>WorkingDirectory</key><string>${xml(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>StandardOutPath</key><string>${xml(path.join(root,"logs/seller.log"))}</string><key>StandardErrorPath</key><string>${xml(path.join(root,"logs/seller.log"))}</string></dict></plist>\n`;
}
export function sellerEnvironment(root: string, app: string, marketplaceUrl: string): NodeJS.ProcessEnv {
  // Build an allowlist: installing a seller must not inherit buyer, judge or server keys.
  return { PATH: process.env.PATH ?? "/opt/homebrew/bin:/usr/bin:/bin", HOME: os.homedir(), TMPDIR: os.tmpdir(),
    MARKETPLACE_URL: marketplaceUrl, OLLAMA_URL: "http://localhost:11434", ATM_APP_ROOT: app,
    ATM_STATE_DIR: path.join(root, "runtime"), ATM_STATUS_FILE: path.join(root, "status.json"), ATM_REQUIRE_RELEASE: "1" };
}
const root = path.join(os.homedir(), ".atm");
const plist = path.join(os.homedir(), "Library/LaunchAgents", `${SERVICE_LABEL}.plist`);
const domain = `gui/${process.getuid!()}`;
const service = `${domain}/${SERVICE_LABEL}`;
const run = (command: string, args: string[], env?: NodeJS.ProcessEnv) => {
  const result = spawnSync(command, args, { stdio: "inherit", env: env ?? process.env });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? result.error?.message})`);
};
const loaded = () => spawnSync("launchctl", ["print", service], { encoding: "utf8" }).status === 0;
const stop = () => { if (loaded()) run("launchctl", ["bootout", service]); };
const start = () => { if (loaded()) return; run("launchctl", ["bootstrap", domain, plist]); };
const config = () => JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const safeStripeLink = (value: unknown): value is string => { try { const u = new URL(String(value)); return u.protocol === "https:" && (u.hostname === "stripe.com" || u.hostname.endsWith(".stripe.com")); } catch { return false; } };

async function install(stage: string, marketplaceUrl: string, node: string) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("This release requires an Apple silicon Mac");
  stage = fs.realpathSync(stage);
  if (path.dirname(stage) !== root || !path.basename(stage).startsWith(".stage-")) throw new Error("Invalid installation staging directory");
  const endpoint = new URL(marketplaceUrl);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("Marketplace URL must use HTTPS");
  await requireCompatibleRelease(marketplaceUrl);
  const release = JSON.parse(fs.readFileSync(path.join(stage, "release.json"), "utf8"));
  const hash = createHash("sha256").update(fs.readFileSync(path.join(stage, "packages/runner-wasm/dist/runner.wasm"))).digest("hex");
  if (hash !== release.artifacts["runner.wasm"].sha256) throw new Error("Runner checksum does not match the release");
  const tags = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(10000) }).then(r => r.json()) as { models: { name: string; digest: string }[] };
  let models = tags.models.filter(m => release.allowed_models.includes(m.name));
  if (!models.length) {
    console.log("Downloading Qwen3 8B (about 5.2 GB). Ollama shows download progress below.");
    run("ollama", ["pull", "qwen3:8b"]);
    models = (await fetch("http://localhost:11434/api/tags").then(r => r.json())).models.filter((m: any) => release.allowed_models.includes(m.name));
  }
  if (!models.length) throw new Error("No supported local model was found");
  for (const dir of [root, path.join(root, "logs"), path.join(root, "runtime"), path.join(root, "measurements"), path.join(root, "bin")]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const canaryArgs = [path.join(stage, "daemon.mjs"), "--role", "seller", "--runtime", "wassette", "--canary-only", ...models.flatMap(m => ["--model", m.name])];
  run(node, canaryArgs, sellerEnvironment(root, stage, marketplaceUrl));
  const app = path.join(root, "app");
  const backup = path.join(root, `.previous-${Date.now()}`);
  const wasRunning = loaded();
  const oldPlist = fs.existsSync(plist) ? fs.readFileSync(plist) : null;
  stop();
  if (fs.existsSync(app)) fs.renameSync(app, backup);
  fs.renameSync(stage, app);
  try {
    run(node, [path.join(app, "daemon.mjs"), "--role", "seller", "--runtime", "wassette", "--register-only", "--display-name", os.hostname().slice(0, 80), "--state-file", path.join(root, "seller.json")], sellerEnvironment(root, app, marketplaceUrl));
    const status = JSON.parse(fs.readFileSync(path.join(root, "status.json"), "utf8"));
    if (safeStripeLink(status.payout_onboarding_url)) spawn("/usr/bin/open", [status.payout_onboarding_url], { stdio: "ignore" }).unref();
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, launchAgent(root, node, marketplaceUrl, process.env.PATH ?? "/opt/homebrew/bin:/usr/bin:/bin"), { mode: 0o600 });
    run("plutil", ["-lint", plist]);
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ marketplace_url: marketplaceUrl, revision: release.revision, node }, null, 2), { mode: 0o600 });
    const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
    const launcher = `#!/bin/sh\n# ATM_SELLER_LAUNCHER\nexec ${quote(node)} ${quote(path.join(root,"app/control.mjs"))} "$@"\n`;
    fs.writeFileSync(path.join(root, "bin/atm-seller"), launcher, { mode: 0o755 });
    const link = "/opt/homebrew/bin/atm-seller";
    if (!fs.existsSync(link) || (fs.lstatSync(link).isSymbolicLink() && fs.readlinkSync(link) === path.join(root, "bin/atm-seller"))) {
      try { if (!fs.existsSync(link)) fs.symlinkSync(path.join(root, "bin/atm-seller"), link); } catch { console.log(`Use ${path.join(root,"bin/atm-seller")} if atm-seller is not on PATH.`); }
    }
    start();
    console.log(`\nSeller ${status.seller_id} installed. General worker launched and polling for tasks.`);
    for (const m of models) console.log(`Model ${m.name}: ${m.digest}`);
    console.log(`Runner SHA-256: ${hash}\nWassette: ${status.wassette_version}\nPayout status: ${status.payout_status} (${status.payout_label ?? "Stripe TEST mode"})`);
    console.log("Model detection is self-reported plus a liveness canary; it is not attestation.");
    console.log("The worker starts at login after a reboot. Commands: atm-seller status | logs | stop | start | uninstall");
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true });
  } catch (error) {
    stop();
    if (fs.existsSync(backup)) {
      fs.renameSync(app, path.join(root, `.failed-${Date.now()}`)); fs.renameSync(backup, app);
      if (oldPlist) fs.writeFileSync(plist, oldPlist, { mode: 0o600 });
      if (wasRunning) start();
    }
    throw error;
  }
}

async function main() {
  const command = process.argv[2] ?? "status";
  if (command === "install") { await install(process.argv[3]!, process.argv[4]!, process.argv[5]!); return; }
  if (command === "start") { start(); console.log("Seller started."); return; }
  if (command === "stop") { stop(); console.log("Seller stopped; identity preserved."); return; }
  if (command === "logs") { run("tail", ["-n", "80", "-F", path.join(root, "logs/seller.log")]); return; }
  if (command === "uninstall") {
    stop(); if (fs.existsSync(plist)) fs.unlinkSync(plist);
    const link = "/opt/homebrew/bin/atm-seller";
    if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink() && fs.readlinkSync(link) === path.join(root,"bin/atm-seller")) fs.unlinkSync(link);
    for (const dir of ["app", "bin"]) if (fs.existsSync(path.join(root, dir))) fs.rmSync(path.join(root, dir), { recursive: true });
    console.log("Seller software removed. Identity, measurements, logs, Ollama and downloaded models are preserved."); return;
  }
  if (command !== "status") throw new Error("Use status | logs | stop | start | uninstall");
  const state = readAgentState(path.join(root, "seller.json"));
  if (!state) throw new Error("Seller is not registered");
  const saved = fs.existsSync(path.join(root,"status.json")) ? JSON.parse(fs.readFileSync(path.join(root,"status.json"),"utf8")) : {};
  const mp = new Marketplace(config().marketplace_url, state.api_key);
  let current: any;
  try { current = await mp.call("whoami"); } catch { current = { unavailable: true }; } finally { await mp.close(); }
  const processInfo = spawnSync("launchctl", ["print", service], { encoding: "utf8" });
  const processState = processInfo.stdout.match(/\bstate = ([^\n]+)/)?.[1] ?? "stopped";
  const pid = processInfo.stdout.match(/\bpid = (\d+)/)?.[1];
  console.log(JSON.stringify({ service: processState, pid: pid ? Number(pid) : null, seller_id: state.agent_id,
    marketplace: config().marketplace_url, models: current.seller?.models ?? saved.models,
    runtime: saved.runtime, component_sha256: saved.wasm_sha256, wassette_version: saved.wassette_version,
    payout_status: current.payout?.payout_status ?? saved.payout_status ?? "UNAVAILABLE",
    payout_label: current.payout?.payout_label ?? saved.payout_label, server_reachable: !current.unavailable }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`Seller setup: ${error.message}`); process.exitCode = 1; });
