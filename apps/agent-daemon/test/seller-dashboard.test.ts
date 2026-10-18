import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { createSellerDashboard } from "../src/seller-dashboard.js";
const realFetch=globalThis.fetch;
const cleanup: Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.unstubAllGlobals();for(const fn of cleanup.splice(0))await fn();});
async function fixture() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'atm-dashboard-'));
 const actions={status:vi.fn(async()=>({service:'stopped'})),prepare:vi.fn(async()=>{}),start:vi.fn(async()=>{}),stop:vi.fn(async()=>{}),payout:vi.fn(async()=>({payout_status:'PENDING_ONBOARDING',payout_onboarding_url:'https://connect.stripe.com/setup/fixture'}))};
 const d=createSellerDashboard({root,marketplaceUrl:'https://marketplace.example/mcp',assets:path.resolve('ui'),actions,port:0});await d.listen();
 const origin=`http://127.0.0.1:${(d.server.address() as any).port}`;
 cleanup.push(async()=>{d.server.closeAllConnections();await new Promise<void>(r=>d.server.close(()=>r()));fs.rmSync(root,{recursive:true,force:true});});
 const token=JSON.parse(fs.readFileSync(path.join(root,'dashboard-open.json'),'utf8')).token;
 const opened=await realFetch(origin+'/open?token='+token,{redirect:'manual'});
 const cookie=opened.headers.get('set-cookie')!.split(';')[0]!;
 return {root,actions,d,origin,cookie,token,request:(route:string,method='GET',extra:Record<string,string>={})=>realFetch(origin+route,{method,redirect:'manual',headers:{Cookie:cookie,...(method==='POST'?{Origin:origin,'X-ATM-Request':'1'}:{}),...extra}})};
}
it('binds only loopback, consumes open tokens, and blocks cross-origin actions and unauthenticated reads',async()=>{
 const f=await fixture();
 expect((f.d.server.address() as any).address).toBe('127.0.0.1');
 expect((await realFetch(f.origin+'/api/status')).status).toBe(401);
 expect((await realFetch(f.origin+'/open?token='+f.token,{redirect:'manual'})).status).toBe(403);
 expect((await f.request('/api/start','POST',{Origin:'https://evil.example'})).status).toBe(403);
 expect((await f.request('/api/start','POST')).status).toBe(401);expect(f.actions.start).not.toHaveBeenCalled();
 const badHost=await new Promise<number|undefined>(resolve=>{http.get(f.origin+'/',{headers:{Host:'evil.example',Cookie:f.cookie}},r=>{r.resume();resolve(r.statusCode);});});
 expect(badHost).toBe(403);
 expect((await f.request('/../../.env')).status).toBe(404);
});
it('completes PKCE in Node, retries the same enrollment key after a lost response, and never exposes credentials to the browser',async()=>{
 const f=await fixture();let callback='',challenge='',tries=0;const keys:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:any,init:any)=>{
  const u=new URL(String(input));
  if(u.pathname==='/api/seller-auth-config')return Response.json({insforge_url:'https://insforge.example'});
  if(u.pathname==='/api/auth/oauth/google'){callback=u.searchParams.get('redirect_uri')!;challenge=u.searchParams.get('code_challenge')!;return Response.json({authUrl:'https://accounts.google.com/o/oauth2/v2/auth?fixture=1'});}
  if(u.pathname==='/api/auth/oauth/exchange'){
   const b=JSON.parse(init.body);expect(createHash('sha256').update(b.code_verifier).digest('base64url')).toBe(challenge);
   return Response.json({accessToken:'private-human-session',refreshToken:'private-refresh'});
  }
  if(u.pathname==='/api/seller/identity'){
   expect(init.headers.Authorization).toBe('Bearer private-human-session');const b=JSON.parse(init.body);keys.push(b.agent_key);
   if(tries++===0)return Response.json({error:'temporary'}, {status:503});
   return Response.json({agent_id:'seller_fixture',display_name:'Mac',owner:{user_id:'human-fixture',email:'human@example.test'}});
  }
  if(u.hostname==='localhost')return Response.json({models:[]});
  throw Error('Unexpected URL '+u.pathname);
 }));
 for(let i=0;i<2;i++){
  expect((await f.request('/api/auth/google','POST')).status).toBe(200);
  const redirect=new URL(callback);redirect.searchParams.set('insforge_code','fixture-code');
  expect((await f.request(redirect.pathname+redirect.search)).status).toBe(303);
 }
 expect(keys[0]).toBe(keys[1]);expect(keys[0]).toMatch(/^atm_sk_[A-Za-z0-9_-]{43}$/);
 const saved=JSON.parse(fs.readFileSync(path.join(f.root,'seller.json'),'utf8'));
 expect(saved.api_key).toBe(keys[0]);expect(saved.owner.user_id).toBe('human-fixture');
 expect(fs.statSync(path.join(f.root,'seller.json')).mode&0o777).toBe(0o600);
 const status=await(await f.request('/api/status')).text();
 expect(status).not.toContain(keys[0]!);expect(status).not.toContain('private-human-session');expect(status).not.toContain('private-refresh');
 const page=await(await f.request('/')).text();expect(page).toContain('Continue with Google');expect(page).toContain('Set up Stripe');
 expect(f.actions.prepare).not.toHaveBeenCalled();expect(f.actions.start).not.toHaveBeenCalled();
});
it('rejects wrong or replayed OAuth callbacks before exchanging tokens',async()=>{
 const f=await fixture();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 expect((await f.request('/auth/callback?state=wrong&insforge_code=bad')).status).toBe(303);
 expect(fetcher).not.toHaveBeenCalled();expect(fs.existsSync(path.join(f.root,'seller.json'))).toBe(false);
});
