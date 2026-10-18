import { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { registerSellerReleaseRoutes } from "./seller-release.js";
const dirs:string[]=[];
afterEach(()=>{for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true});});
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"atm-release-"));dirs.push(dir);const app=new Hono();registerSellerReleaseRoutes(app as any,dir);return{dir,app};}
it("serves only the fixed release paths and refuses unavailable or dirty metadata",async()=>{
 const {dir,app}=fixture();expect((await app.request('/api/seller-release')).status).toBe(503);
 fs.writeFileSync(path.join(dir,'release.json'),JSON.stringify({dirty:true}));expect((await app.request('/api/seller-release')).status).toBe(503);
 fs.writeFileSync(path.join(dir,'release.json'),JSON.stringify({dirty:false,revision:'fixture'}));expect(await(await app.request('/api/seller-release')).json()).toMatchObject({contract_version:'0.3',seller_protocol:1,revision:'fixture'});
 fs.writeFileSync(path.join(dir,'runner.wasm'),Buffer.from([0,97,115,109]));const result=await app.request('/runner.wasm');expect(result.headers.get('Content-Type')).toBe('application/wasm');expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([0,97,115,109]);
 expect((await app.request('/.env')).status).toBe(404);expect((await app.request('/seller/../../.env')).status).toBe(404);
});
