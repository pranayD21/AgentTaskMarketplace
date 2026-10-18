import {expect,it} from 'vitest';
import {runCycle} from '../src/index.js';
import {invokeWorkerTool} from '../src/worker-agent.js';
import {fixture} from './marketplace-fixture.js';
it('executes a model-selected tool and feeds the result into its next reasoning turn',async()=>{
 const service=fixture();let turns=0;
 const fetcher:typeof fetch=async(input,init)=>{
  if(String(input).endsWith('/api/chat')){
   const body=JSON.parse(String(init?.body));expect(body.think).toBe(false);expect(body.options.num_thread).toBe(2);expect(body.options.num_ctx).toBe(4096);
   if(turns++===0)return Response.json({message:{role:'assistant',thinking:'I will verify the total.',content:'',tool_calls:[{function:{name:'calculate',arguments:{operation:'sum',values:[30,50,5]}}}]},eval_count:12,eval_duration:1000000});
   expect(body.messages.at(-1)).toMatchObject({role:'tool',tool_name:'calculate'});expect(JSON.parse(body.messages.at(-1).content).result).toBe(85);
   return Response.json({message:{role:'assistant',content:'Paris'},eval_count:2,eval_duration:2000000});
  }return service.fetch(input,init);
 };
 const result=await runCycle({fetch:fetcher,now:Date.now,getSecret:async()=> 'fixture'}, {marketplace_url:'http://marketplace/mcp',ollama_url:'http://ollama',task_id:'task_fixture',model_id:'qwen3:8b',max_runtime_s:180,cpu_threads:2,context_tokens:4096});
 expect(turns).toBe(2);expect(result.tokens_out).toBe(14);expect(result.seller_usage?.eval_duration_ms).toBe(3);expect(service.summary().outputVerified).toBe(true);
});
it('rejects unavailable tools and bounds scratchpad and numeric work',()=>{const notes=new Map<string,string>();expect(()=>invokeWorkerTool('exec',{command:'anything'},notes)).toThrow('unavailable');expect(()=>invokeWorkerTool('calculate',{operation:'quotient',values:[1,0]},notes)).toThrow();for(let i=0;i<8;i++)invokeWorkerTool('scratchpad',{key:String(i),value:'note'},notes);expect(()=>invokeWorkerTool('scratchpad',{key:'9',value:'extra'},notes)).toThrow();expect(invokeWorkerTool('scratchpad',{key:'0'},new Map())).toEqual({key:'0',value:null});});
it('does not send tool or thinking requests to a model that reports neither capability',async()=>{
 const service=fixture();const fetcher:typeof fetch=async(input,init)=>{if(String(input).endsWith('/api/show'))return Response.json({capabilities:['completion']});if(String(input).endsWith('/api/chat')){const body=JSON.parse(String(init?.body));expect(body.tools).toEqual([]);expect(body.think).toBeUndefined();}return service.fetch(input,init);};
 await runCycle({fetch:fetcher,now:Date.now,getSecret:async()=> 'fixture'},{marketplace_url:'http://marketplace/mcp',ollama_url:'http://ollama',task_id:'task_fixture',model_id:'qwen3:8b',max_runtime_s:180});expect(service.summary().outputVerified).toBe(true);
});
it('does not cap worker tokens and requests a distinct answer after reasoning-only completion',async()=>{
 const service=fixture({max_tokens:1});let turns=0;
 const fetcher:typeof fetch=async(input,init)=>{
  if(String(input).endsWith('/api/chat')){
   const body=JSON.parse(String(init?.body));expect(body.options.num_predict).toBe(-1);
   if(turns++===0)return Response.json({message:{role:'assistant',thinking:'Reasoning only',content:''},eval_count:5000,done_reason:'stop'});
   expect(body.think).toBe(false);expect(body.messages.at(-2).thinking).toBe('Reasoning only');
   return Response.json({message:{role:'assistant',content:'Paris'},eval_count:2,done_reason:'stop'});
  }return service.fetch(input,init);
 };
 const out=await runCycle({fetch:fetcher,now:Date.now,getSecret:async()=> 'fixture'},{marketplace_url:'http://marketplace/mcp',ollama_url:'http://ollama',task_id:'task_fixture',model_id:'qwen3:8b',max_runtime_s:180});
 expect(out.tokens_out).toBe(5002);expect(turns).toBe(2);expect(service.summary().outputVerified).toBe(true);
});
it('uses reported thinking controls without guessing from model names',async()=>{
 const {modelThinkingControl}=await import('../src/model-controls.js');
 expect(modelThinkingControl({capabilities:['completion']})).toBeUndefined();
 expect(modelThinkingControl({})).toBeUndefined();
 expect(modelThinkingControl({thinking:{values:[true,false]}})).toBe(false);
 expect(modelThinkingControl({thinking:{values:['low','medium','high']}})).toBe('low');
});
it('discovers thinking controls for the small installation canary too',async()=>{
 const {modelCanary}=await import('../src/index.js');let metadata=false;
 const fetcher:typeof fetch=async(input,init)=>{const url=String(input);if(url.endsWith('/api/tags'))return Response.json({models:[{name:'qwen3:8b'}]});if(url.endsWith('/api/show')){metadata=true;return Response.json({capabilities:['completion','thinking','tools']});}const body=JSON.parse(String(init?.body));expect(metadata).toBe(true);expect(body.think).toBe(false);expect(body.tools).toEqual([]);expect(body.options.num_predict).toBe(8);return Response.json({message:{content:'4'},eval_count:1});};
 expect((await modelCanary({fetch:fetcher,now:Date.now,getSecret:async()=>undefined},{ollama_url:'http://ollama',model_id:'qwen3:8b'})).passed).toBe(true);
});
