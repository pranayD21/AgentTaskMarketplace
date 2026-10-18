import { z } from 'zod';
import { dashboardUrl } from './data';
const band = z.object({p25:z.number().nullable(),median:z.number().nullable(),p75:z.number().nullable()});
export const Market = z.object({
  mode:z.literal('task_offer'), generated_at:z.string(), sample_count:z.number().int().nonnegative(), sample_limit:z.number().int(),
  groups:z.array(z.object({allowed_models:z.array(z.string()), max_runtime_s:z.number(),sample_count:z.number().int(),accepted_count:z.number().int(),
    sample_status:z.enum(['insufficient_data','observations_available']),posted_price_cents:band,accepted_price_cents:band,fill_time_ms:band,
    fill_time_sample_count:z.number().int(),claim_rate:z.number(),expiry_rate:z.number(),approved_count:z.number().int(),open_count:z.number().int()})),
});
export type MarketData = z.infer<typeof Market>;
// Public discovery only: never send a buyer key from the browser.
export async function fetchMarket(base:string, signal:AbortSignal):Promise<MarketData> {
  const endpoint=dashboardUrl(base).replace(/\/api\/dashboard$/, '/mcp');
  let session:string|null=null;
  async function rpc(id:number|undefined,method:string,params:unknown) {
    const response=await fetch(endpoint,{method:'POST',signal,cache:'no-store',credentials:'omit',redirect:'error',
      headers:{'content-type':'application/json',accept:'application/json, text/event-stream',
        ...(session?{'mcp-session-id':session}:{}),...(method!=='initialize'?{'mcp-protocol-version':'2025-06-18'}:{})},
      body:JSON.stringify({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,params})});
    if(!response.ok) throw new Error('Market observations unavailable');
    session=response.headers.get('mcp-session-id')??session;
    if(id===undefined){await response.body?.cancel();return;}
    const text=await response.text();
    const messages=response.headers.get('content-type')?.includes('text/event-stream')
      ? text.replaceAll('\r\n','\n').split('\n\n').flatMap(event=>{const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');return data?[JSON.parse(data)]:[];})
      :[JSON.parse(text)];
    const message=messages.find(value=>value.id===id);
    if(!message || message.error) throw new Error('Market observations unavailable');
    return message.result;
  }
  await rpc(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'atm-public-dashboard',version:'0.3.0'}});
  await rpc(undefined,'notifications/initialized',{});
  const result=await rpc(2,'tools/call',{name:'market_price_observations',arguments:{}});
  if(result.isError) throw new Error('Market observations unavailable');
  return Market.parse(result.structuredContent??JSON.parse(result.content?.find((item:{type:string})=>item.type==='text')?.text??'{}'));
}
