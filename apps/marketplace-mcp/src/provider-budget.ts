import { MarketplaceError } from '@atm/shared';
import { db, one, unwrap, type TaskRow, type VerdictRow } from './db.js';
import { payments } from './payments.js';
export const CASE_RESERVATION_MICROUSD=2_200_000;
type Entry={buyer_id:string;request_id:string;booked_microusd:number;state:'reserved'|'settled'};
type Ledger={id:string;revision:number;cap_microusd:number;entries:Record<string,Entry>};
const read=async()=>one<Ledger>(await db().from('provider_budget').select('*').eq('id','shared-judge').limit(1));
async function ledger(){const row=await read();if(!row || !Number.isSafeInteger(row.cap_microusd) || row.cap_microusd<0 || row.cap_microusd>5_000_000 || !row.entries || Object.values(row.entries).some(e=>!Number.isSafeInteger(e.booked_microusd)||e.booked_microusd<0))throw new MarketplaceError('PAYMENT_REQUIRED','Shared model allowance is awaiting migration.',{next_action:'The operator must preserve and import the existing shared allowance; do not create a new ledger.'});return row;}
async function reconcile(){
 for(let attempt=0;attempt<8;attempt++){
  const row=await ledger();const entries=structuredClone(row.entries);let changed=false;
  for(const entry of Object.values(entries)){
   if(entry.state!=='reserved')continue;
   const task=await one<TaskRow>(await db().from('tasks').select('*').eq('buyer_id',entry.buyer_id).eq('client_request_id',entry.request_id).limit(1));
   if(!task)continue;
   const verdict=await one<VerdictRow>(await db().from('verdicts').select('*').eq('task_id',task.id).limit(1));
   const result=await one(await db().from('results').select('id').eq('task_id',task.id).limit(1));
   if((task.status==='APPROVED'&&verdict?.reason_code==='RUBRIC_MATCH')||(['CANCELLED','EXPIRED'].includes(task.status)&&!verdict&&!result)) {entry.state='settled';entry.booked_microusd=0;changed=true;}
  }
  if(!changed)return row;
  const won=unwrap(await db().from('provider_budget').update({entries,revision:row.revision+1}).eq('id',row.id).eq('revision',row.revision).select()) as Ledger[];if(won.length)return won[0]!;
 }
 throw new MarketplaceError('PAYMENT_REQUIRED','Shared model allowance is busy. Retry the same saved task.');
}
export async function providerBudgetStatus(){
 if(payments().mode==='mock')return {enforced:true,available:true,remaining_microusd:5_000_000,reservation_microusd:CASE_RESERVATION_MICROUSD,label:'MOCK'};
 try{const row=await reconcile();const remaining=row.cap_microusd-Object.values(row.entries).reduce((n,e)=>n+e.booked_microusd,0);return {enforced:true,available:remaining>=CASE_RESERVATION_MICROUSD,remaining_microusd:remaining,reservation_microusd:CASE_RESERVATION_MICROUSD,label:'Shared provider allowance'};}
 catch{return {enforced:true,available:false,remaining_microusd:0,reservation_microusd:CASE_RESERVATION_MICROUSD,label:'Shared provider allowance awaiting reconciliation'};}
}
export async function reserveProviderBudget(buyerId:string,requestId:string){
 if(payments().mode==='mock')return;
 await reconcile();
 for(let attempt=0;attempt<12;attempt++){
  const row=await ledger(),key=buyerId+':'+requestId;
  if(row.entries[key])return;
  const booked=Object.values(row.entries).reduce((n,e)=>n+e.booked_microusd,0);
  if(booked+CASE_RESERVATION_MICROUSD>row.cap_microusd)throw new MarketplaceError('PAYMENT_REQUIRED','The shared model allowance cannot cover another task.',{next_action:'Wait for existing tasks or operator reconciliation. Your saved draft can be retried.'});
  const entries={...row.entries,[key]:{buyer_id:buyerId,request_id:requestId,state:'reserved',booked_microusd:CASE_RESERVATION_MICROUSD}};
  const won=unwrap(await db().from('provider_budget').update({entries,revision:row.revision+1}).eq('id',row.id).eq('revision',row.revision).select()) as Ledger[];if(won.length)return;
 }
 throw new MarketplaceError('PAYMENT_REQUIRED','Shared model allowance is busy. Retry the same saved task.');
}
