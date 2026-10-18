import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const directory=path.resolve('apps/marketplace-mcp/public/seller');
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'release.json'),'utf8'));
if(manifest.dirty||manifest.schema!==1)throw Error('Invalid seller release');
for(const name of ['seller-bundle.tgz','runner.wasm']){
 const bytes=fs.readFileSync(path.join(directory,name));
 if(createHash('sha256').update(bytes).digest('hex')!==manifest.artifacts[name].sha256)throw Error('Seller release checksum mismatch: '+name);
}
if(!fs.existsSync(path.join(directory,'install.sh')))throw Error('Missing seller installer');
console.log('Seller release artifacts verified: '+manifest.revision);
