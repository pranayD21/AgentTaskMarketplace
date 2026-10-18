import { afterEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { ensureHumanPayoutAccount, linkSellerIdentity, registerSellerIdentityRoutes, verifyGoogleUser } from "./seller-identity.js";
import { db, unwrap, type AgentRow } from "./db.js";
import { hashApiKey } from "./auth.js";
import { env } from "./env.js";
import { payments } from "./payments.js";
const owner = { id: "11111111-1111-4111-8111-111111111111", email: "seller@example.test", name: "Seller" };
afterEach(() => vi.unstubAllGlobals());
it("retries the same machine identity, prevents takeover, and keeps ownership private", async () => {
  const key = `atm_sk_${randomBytes(32).toString("base64url")}`;
  const [a,b] = await Promise.all([linkSellerIdentity(owner,key,"My Mac"),linkSellerIdentity(owner,key,"My Mac")]);
  expect(a.agent_id).toBe(b.agent_id);
  expect(a).not.toHaveProperty("api_key");
  const rows = unwrap(await db().from("agents").select("*").eq("api_key_hash",hashApiKey(key))) as AgentRow[];
  expect(rows).toHaveLength(1); expect(rows[0]?.owner_user_id).toBe(owner.id);
  expect(unwrap(await db().from("sellers").select("*").eq("agent_id",a.agent_id))).toHaveLength(1);
  await expect(linkSellerIdentity({...owner,id:"22222222-2222-4222-8222-222222222222"},key,"Other Mac")).rejects.toThrow("ANOTHER_ACCOUNT");
  const { listSellers } = await import("./service.js");
  const publicSeller=(await listSellers()).find(s=>s.seller_id===a.agent_id);
  expect(JSON.stringify(publicSeller)).not.toContain(owner.email);expect(JSON.stringify(publicSeller)).not.toContain(owner.id);
});
it("requires a verified Google user from InsForge, rejecting admin, unverified and other-provider sessions", async () => {
  env().INSFORGE_BASE_URL="https://insforge.example.test";
  for(const value of [{projectAdmin:{id:owner.id}}, {user:{...owner,emailVerified:false,providers:["google"]}}, {user:{...owner,emailVerified:true,providers:["github"]}}]){
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json(value)));
    await expect(verifyGoogleUser("test-session")).rejects.toThrow("GOOGLE_SIGN_IN_REQUIRED");
  }
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({user:{...owner,emailVerified:true,providers:["google"],profile:{name:"Seller"}}})));
  expect(await verifyGoogleUser("test-session")).toEqual(owner);
  const app=new Hono();registerSellerIdentityRoutes(app as any);
  expect((await app.request('/api/seller/identity',{method:'POST',body:JSON.stringify({agent_key:`atm_sk_${'a'.repeat(43)}`,display_name:'x',owner_user_id:owner.id})})).status).toBe(401);
});
it("links a legacy seller only with its existing private key and never creates a buyer", async () => {
  const { registerAgent }=await import("./service.js");
  const seller=await registerAgent({kind:"seller",display_name:"Legacy"});
  const linked=await linkSellerIdentity(owner,seller.api_key,"Ignored rename");expect(linked.agent_id).toBe(seller.agent.id);
  const buyer=await registerAgent({kind:"buyer",display_name:"Existing buyer"});
  await expect(linkSellerIdentity(owner,buyer.api_key,"Wrong kind")).rejects.toThrow("ANOTHER_ACCOUNT");
});
it("serializes human payout attempts, reuses the saved account, and bounds ambiguous retries", async()=>{
 const key=`atm_sk_${randomBytes(32).toString("base64url")}`;
 const linked=await linkSellerIdentity(owner,key,"Retry Mac");
 const read=async()=>((unwrap(await db().from("agents").select("*").eq("id",linked.agent_id)) as AgentRow[])[0]!);
 const p=payments();const oldMode=p.mode;Object.defineProperty(p,'mode',{value:'card',configurable:true});
 const onboard=vi.spyOn(p,'onboardSeller').mockResolvedValue({stripe_account_id:null});
 try{
  const a=await read();await Promise.all([ensureHumanPayoutAccount(a),ensureHumanPayoutAccount(a)]);
  expect(onboard).toHaveBeenCalledTimes(1);expect((await read()).stripe_onboarding_attempts).toBe(1);
  await ensureHumanPayoutAccount(await read());expect(onboard).toHaveBeenCalledTimes(1);
  unwrap(await db().from('agents').update({stripe_onboarding_attempts:3,stripe_onboarding_retry_at:null}).eq('id',a.id));
  await expect(ensureHumanPayoutAccount(await read())).rejects.toThrow('RECONCILIATION');
  unwrap(await db().from('agents').update({stripe_onboarding_attempts:1,stripe_onboarding_started_at:new Date(Date.now()-21*3600000).toISOString()}).eq('id',a.id));
  await expect(ensureHumanPayoutAccount(await read())).rejects.toThrow('RECONCILIATION');expect(onboard).toHaveBeenCalledTimes(1);
  unwrap(await db().from('agents').update({stripe_account_id:'acct_existing'}).eq('id',a.id));
  expect((await ensureHumanPayoutAccount(await read())).stripe_account_id).toBe('acct_existing');expect(onboard).toHaveBeenCalledTimes(1);
 }finally{onboard.mockRestore();Object.defineProperty(p,'mode',{value:oldMode,configurable:true});}
});
