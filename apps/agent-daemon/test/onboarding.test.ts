import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { lockIdentity, readAgentState, registerSavedAgent } from "../src/identity.js";
import { launchAgent, sellerEnvironment } from "../src/seller-control.js";
import { requireCompatibleRelease } from "../src/release.js";
import { sellerLoop } from "../src/seller.js";
const directories: string[] = [];
const temporary = () => { const d=fs.mkdtempSync(path.join(os.tmpdir(),"atm-onboarding-")); directories.push(d); return d; };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); for (const d of directories.splice(0)) fs.rmSync(d,{recursive:true,force:true}); });
it("reuses the private identity and refuses corruption or an ambiguous registration", async () => {
  const file=path.join(temporary(),"seller.json");
  const register=vi.fn(async()=>({agent_id:"seller_test",api_key:"private-fixture",display_name:"Mac"}));
  await registerSavedAgent(file,register); await registerSavedAgent(file,register);
  expect(register).toHaveBeenCalledTimes(1); expect(fs.statSync(file).mode&0o777).toBe(0o600);
  fs.writeFileSync(file,"broken"); await expect(registerSavedAgent(file,register)).rejects.toThrow("INVALID_IDENTITY_FILE");
  expect(register).toHaveBeenCalledTimes(1);
  const second=path.join(temporary(),"seller.json");
  await expect(registerSavedAgent(second,async()=>{throw Error("lost response");})).rejects.toThrow("lost response");
  await expect(registerSavedAgent(second,register)).rejects.toThrow("REGISTRATION_OUTCOME_UNKNOWN");
  expect(register).toHaveBeenCalledTimes(1);
});
it("one saved identity cannot be used by two daemons", () => {
  const file=path.join(temporary(),"seller.json");const unlock=lockIdentity(file);
  expect(()=>lockIdentity(file)).toThrow("ALREADY_RUNNING"); unlock();
  const next=lockIdentity(file);next();expect(fs.existsSync(file+".lock")).toBe(false);
});
it("release mismatch or unavailable manifest prevents starting or claiming", async () => {
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({contract_version:"99",seller_protocol:1})));
  await expect(requireCompatibleRelease("https://fixture.example/mcp")).rejects.toThrow("UPDATE_REQUIRED");
  vi.stubGlobal("fetch",vi.fn(async()=>new Response("unavailable",{status:503})));
  await expect(requireCompatibleRelease("https://fixture.example/mcp")).rejects.toThrow("UNAVAILABLE");
});
it("registration-only advertises models without polling or claiming a task", async () => {
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({models:[{name:"qwen3:8b",digest:"a".repeat(64),size:1}]})));
  const call=vi.fn(async(name:string)=>{if(name==="marketplace_info")return{models:[],pricing:{mode:"task_offer"}};if(name==="register_seller")return{seller:{status:"ACTIVE"}};throw Error("unexpected tool");});
  const runCycle=vi.fn();
  await sellerLoop({call,sellerKeyMode:async()=>"per-claim"} as any,{info:()=>({runtime:"wassette"}),runCycle} as any,{marketplaceUrl:"https://fixture",ollamaUrl:"http://fixture",pollMs:100,once:false,registerOnly:true,log:()=>{}});
  expect(call.mock.calls.map(x=>x[0])).toEqual(["marketplace_info","register_seller"]);expect(runCycle).not.toHaveBeenCalled();
});
it("a contract change is checked before the sandbox can claim", async () => {
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({models:[{name:"qwen3:8b",digest:"a".repeat(64),size:1}]})));
  const call=vi.fn(async(name:string)=>{if(name==="marketplace_info")return{models:[],pricing:{mode:"task_offer"}};if(name==="register_seller")return{seller:{status:"ACTIVE"}};return{tasks:[{task_id:"task_x",price_cents:50,eligible_models:["qwen3:8b"],max_runtime_s:180}]};});
  const runCycle=vi.fn();
  await expect(sellerLoop({call,sellerKeyMode:async()=>"per-claim"} as any,{info:()=>({runtime:"wassette"}),runCycle,close:async()=>{}} as any,{marketplaceUrl:"https://fixture",ollamaUrl:"http://fixture",pollMs:100,once:true,log:()=>{},beforeClaim:async()=>{throw Error("SELLER_UPDATE_REQUIRED");}})).rejects.toThrow("UPDATE_REQUIRED");
  expect(runCycle).not.toHaveBeenCalled();
});
it("launchd keeps the service alive without embedding agent credentials", () => {
  vi.stubEnv("AGENT_API_KEY","seller-private");vi.stubEnv("ANTHROPIC_API_KEY","judge-private");
  const environment=sellerEnvironment("/tmp/atm", "/tmp/atm/app", "https://fixture/mcp");
  expect(environment).not.toHaveProperty("AGENT_API_KEY");expect(environment).not.toHaveProperty("ANTHROPIC_API_KEY");
  const data=launchAgent("/tmp/a & b", "/opt/homebrew/bin/node", "https://fixture/mcp", "/opt/homebrew/bin:/usr/bin:/bin");
  expect(data).toContain("<key>KeepAlive</key><true/>");expect(data).toContain("a &amp; b");expect(data).not.toContain("private");
  const file=path.join(temporary(),"worker.plist");fs.writeFileSync(file,data);
  expect(spawnSync("plutil",["-lint",file]).status).toBe(0);
});
