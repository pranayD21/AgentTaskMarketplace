#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'apps/marketplace-mcp/public/seller');
const staging=path.join(root,'.atm-state/seller-release-staging');
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dirty=Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim());
if(dirty&&!process.argv.includes('--allow-dirty'))throw Error('Commit source before creating a deployable release. --allow-dirty is for local tests only.');
fs.mkdirSync(output,{recursive:true});
fs.rmSync(staging,{recursive:true,force:true});fs.mkdirSync(staging,{recursive:true});
const metafiles=[];
for(const [entry,name] of [['main.ts','daemon.mjs'],['seller-control.ts','control.mjs']]){
 const result=await build({entryPoints:[path.join(root,'apps/agent-daemon/src',entry)],outfile:path.join(staging,name),bundle:true,platform:'node',target:'node22',format:'esm',metafile:true,
  banner:{js:"import { createRequire as __atmCreateRequire } from 'node:module'; const require = __atmCreateRequire(import.meta.url);"}});
 metafiles.push(result.metafile);
}
fs.writeFileSync(path.join(staging,'package.json'),JSON.stringify({name:'atm-seller-release',version:'0.1.0',private:true,type:'module',packageManager:'pnpm@10.33.2'},null,2)+'\n');
fs.writeFileSync(path.join(staging,'pnpm-lock.yaml'),"lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n");
const packages=new Map();
for(const meta of metafiles)for(const input of Object.keys(meta.inputs)){
 let dir=path.dirname(path.resolve(root,input));
 while(dir!==path.dirname(dir)&&dir!==root){
  const pkg=path.join(dir,'package.json');
  if(fs.existsSync(pkg)){
   const p=JSON.parse(fs.readFileSync(pkg,'utf8'));
   if(p.name&&!p.name.startsWith('@atm/')){
    const files=fs.readdirSync(dir).filter(n=>/^licen[cs]e(?:\.|$)/i.test(n)&&fs.statSync(path.join(dir,n)).isFile());
    packages.set(`${p.name}@${p.version}`,files.map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n')||`License: ${p.license??'see upstream package'}`);
   }
   break;
  }
  dir=path.dirname(dir);
 }
}
fs.cpSync(path.join(root,'apps/agent-daemon/ui'),path.join(staging,'ui'),{recursive:true});
fs.copyFileSync(path.join(root,'apps/agent-daemon/src/viewer/page.html'),path.join(staging,'page.html'));
fs.writeFileSync(path.join(staging,'THIRD_PARTY_NOTICES.txt'),[...packages].sort().map(([name,license])=>`${name}\n${license}`).join('\n\n'));
execFileSync('tar',['-czf',path.join(output,'seller-bundle.tgz'),'-C',staging,'daemon.mjs','control.mjs','package.json','pnpm-lock.yaml','THIRD_PARTY_NOTICES.txt','page.html','ui'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
fs.copyFileSync(path.join(root,'packages/runner-wasm/dist/runner.wasm'),path.join(output,'runner.wasm'));
fs.copyFileSync(path.join(root,'apps/agent-daemon/install.sh'),path.join(output,'install.sh'));
const artifacts={};
for(const name of ['seller-bundle.tgz','runner.wasm']){const bytes=fs.readFileSync(path.join(output,name));artifacts[name]={sha256:createHash('sha256').update(bytes).digest('hex'),size_bytes:bytes.length};}
const shared=fs.readFileSync(path.join(root,'packages/shared/src/index.ts'),'utf8');
const contract=shared.match(/CONTRACT_VERSION = "([^"]+)"/)?.[1];
const allowed=[...shared.slice(shared.indexOf('export const MODEL_ALLOWLIST'),shared.indexOf('export function isAllowlistedModel')).matchAll(/^  "([^"]+)":/gm)].map(m=>m[1]);
if(!contract||!allowed.length)throw Error('Cannot read shared release metadata');
const manifest={schema:1,revision,dirty,created_at:new Date().toISOString(),platform:'darwin-arm64',contract_version:contract,seller_protocol:1,node_min:'22.22.0',wassette:'0.8.x',allowed_models:allowed,artifacts};
fs.writeFileSync(path.join(output,'release.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(output,'runner.wasm.sha256'),`${artifacts['runner.wasm'].sha256}  runner.wasm\n`);
console.log(JSON.stringify({output,revision,dirty,artifacts},null,2));
