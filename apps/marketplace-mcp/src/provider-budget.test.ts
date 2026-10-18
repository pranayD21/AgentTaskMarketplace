import { beforeEach, afterEach, expect, it } from 'vitest';
import { db, unwrap } from './db.js';
import { memoryDb } from './memdb.js';
import { payments } from './payments.js';
import { reserveProviderBudget, providerBudgetStatus } from './provider-budget.js';
const baseline={buyer_id:'legacy',request_id:'import',booked_microusd:2390,state:'settled'};
let oldMode:string;
beforeEach(async()=>{
 oldMode=payments().mode;Object.defineProperty(payments(),'mode',{value:'card',configurable:true});
 const existing=memoryDb().rows('provider_budget').find(x=>x.id==='shared-judge');
 const row={id:'shared-judge',revision:0,cap_microusd:5_000_000,entries:{legacy:baseline}};
 if(existing)unwrap(await db().from('provider_budget').update(row).eq('id','shared-judge'));
 else unwrap(await db().from('provider_budget').insert(row));
});
afterEach(()=>Object.defineProperty(payments(),'mode',{value:oldMode,configurable:true}));
it('admits only two concurrent reservations within the shared cap and retains imported spend',async()=>{
 const results=await Promise.allSettled(Array.from({length:6},(_,n)=>reserveProviderBudget('buyer-'+n,'request-'+n)));
 expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(2);
 expect(await providerBudgetStatus()).toMatchObject({available:false,remaining_microusd:597610});
 const row=memoryDb().rows('provider_budget')[0]!;
 expect((row.entries as any).legacy).toEqual(baseline);
});
it('makes concurrent retries of the same request a single reservation',async()=>{
 await Promise.all(Array.from({length:6},()=>reserveProviderBudget('same-buyer','same-request')));
 expect(await providerBudgetStatus()).toMatchObject({available:true,remaining_microusd:2797610});
 expect(Object.keys(memoryDb().rows('provider_budget')[0]!.entries as object)).toHaveLength(2);
});
it('fails closed for an invalid cap and does not initialize a new allowance',async()=>{
 unwrap(await db().from('provider_budget').update({cap_microusd:5_000_001}).eq('id','shared-judge'));
 await expect(reserveProviderBudget('buyer','request')).rejects.toThrow('awaiting migration');
 expect(await providerBudgetStatus()).toMatchObject({available:false,remaining_microusd:0});
 expect(memoryDb().rows('provider_budget')[0]!.cap_microusd).toBe(5_000_001);
});
it('releases a cancelled untouched task but retains unknown reservations',async()=>{
 const {agent,post}=await import('../test/helpers.js');
 Object.defineProperty(payments(),'mode',{value:'mock',configurable:true});
 const buyer=await agent('buyer');
 const task=await post(buyer,{client_request_id:'cancelled-task-001'});
 Object.defineProperty(payments(),'mode',{value:'card',configurable:true});
 await reserveProviderBudget(buyer.id,'cancelled-task-001');
 await reserveProviderBudget(buyer.id,'unknown-task-001');
 unwrap(await db().from('tasks').update({status:'CANCELLED'}).eq('id',task.task_id));
 expect(await providerBudgetStatus()).toMatchObject({available:true,remaining_microusd:2797610});
 const entries=memoryDb().rows('provider_budget')[0]!.entries as Record<string,any>;
 expect(entries[buyer.id+':cancelled-task-001']).toMatchObject({state:'settled',booked_microusd:0});
 expect(entries[buyer.id+':unknown-task-001']).toMatchObject({state:'reserved',booked_microusd:2200000});
});
