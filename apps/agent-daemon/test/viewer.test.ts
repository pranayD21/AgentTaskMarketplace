import {expect,it,vi} from 'vitest';
import {startLiveView} from '../src/viewer/server.js';
it('opens a task tab only after a successful claim, once per claim',async()=>{
 const openTab=vi.fn();const view=await startLiveView({port:0,open:'claim',role:'seller',runtime:'wassette',marketplaceUrl:'https://fixture/mcp',openTab});
 try{
  const vm=view.vmStarted({role:'seller',runtime:'wassette',wassette_version:'0.8',wasm_sha256:null,network:[],env:[]});expect(openTab).not.toHaveBeenCalled();
  view.emit({t:'net',phase:'start',id:'1',vm,call:'claim_task'});view.emit({t:'net',phase:'end',id:'1',vm,ok:false});expect(openTab).not.toHaveBeenCalled();
  for(const id of ['2','3']){view.emit({t:'net',phase:'start',id,vm,call:'claim_task'});view.emit({t:'net',phase:'end',id,vm,ok:true,res:{claim:{task_id:'task_x',claim_id:'claim_x'}}});}
  expect(openTab).toHaveBeenCalledExactlyOnceWith(`${view.url}/vm/${vm}?task=task_x`);
 }finally{await view.close();}
});

it('preserves streamed reasoning and tool calls through the sandbox observer',async()=>{
 const {startTap}=await import('../src/viewer/tap.js');const http=await import('node:http');
 const tool={function:{name:'calculate',arguments:{operation:'sum',values:[30,50,5]}}};
 const upstream=http.createServer(async(req,res)=>{for await(const _ of req){}res.writeHead(200,{'content-type':'application/x-ndjson'});res.end([{message:{role:'assistant',thinking:'Check the total.'},done:false},{message:{role:'assistant',content:'',tool_calls:[tool]},done:false},{message:{role:'assistant',content:''},done:true,eval_count:12}].map(x=>JSON.stringify(x)).join('\n'));});
 await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));const events:any[]=[];const tap=await startTap({activeVm:()=> 'vm',emit:(e:any)=>events.push(e)} as any,'ollama',`http://127.0.0.1:${(upstream.address() as any).port}`);
 try{const r=await fetch(tap.url+'/api/chat',{method:'POST',body:JSON.stringify({model:'qwen3:8b',stream:false,messages:[]})});const body:any=await r.json();expect(body.message.thinking).toBe('Check the total.');expect(body.message.tool_calls).toEqual([tool]);expect(events.some(e=>e.t==='token'&&e.thinking)).toBe(true);}finally{await tap.close();upstream.closeAllConnections();await new Promise<void>(r=>upstream.close(()=>r()));}
});
