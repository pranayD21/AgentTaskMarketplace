import {expect,it} from 'vitest';
import fs from 'node:fs';import vm from 'node:vm';
it('lets an existing seller enable chat while its worker keeps running',async()=>{
 const elements=new Map<string,any>();
 const get=(id:string)=>{if(!elements.has(id))elements.set(id,{textContent:'',value:'',dataset:{},classList:{toggle(){}},replaceChildren(){}});return elements.get(id);};
 const data={owner:{email:'owner@example.test'},buyer_id:null,worker:{service:'running',prepared:true,payout_status:'ACTIVE'},machine:{models:[],loaded_models:[],ollama_online:true},allowed_models:[],busy:false};
 const context=vm.createContext({document:{getElementById:get},fetch:async()=>({ok:true,json:async()=>data}),setInterval(){},Option:class{},console});
 vm.runInContext(fs.readFileSync('ui/seller.js','utf8'),context);
 await vm.runInContext('refresh()',context);
 expect(get('google').disabled).toBe(false);
 expect(get('google').textContent).toBe('Enable chat with Google ↗');
 expect(get('chat-send').disabled).toBe(true);
 expect(get('chat-notice').textContent).toContain('worker can keep running');
});
