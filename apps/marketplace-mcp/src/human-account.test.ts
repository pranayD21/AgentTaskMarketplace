import { expect, it } from 'vitest';
import { linkHumanBuyer } from './human-account.js';
import { db, unwrap, type AgentRow } from './db.js';

it('reuses one human buyer across concurrent device logins without resetting spending', async () => {
 const owner={id:'human-shared',email:'human@example.test',name:'Human'};
 const [a,b]=await Promise.all([linkHumanBuyer(owner),linkHumanBuyer(owner)]);
 expect(a.agent_id).toBe(b.agent_id);expect(a.api_key).toBe(b.api_key);
 unwrap(await db().from('agents').update({spend_cap_cents:1234,spent_cents:321,reserved_cents:100}).eq('id',a.agent_id));
 const again=await linkHumanBuyer({...owner,name:'Updated name'});
 expect(again.agent_id).toBe(a.agent_id);
 const rows=unwrap(await db().from('agents').select('*').eq('owner_user_id',owner.id)) as AgentRow[];
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({spend_cap_cents:1234,spent_cents:321,reserved_cents:100});
 const other=await linkHumanBuyer({...owner,id:'different-human'});
 expect(other.agent_id).not.toBe(a.agent_id);expect(other.api_key).not.toBe(a.api_key);
});
it('requires reconciliation instead of replacing an existing human buyer credential',async()=>{
 const owner={id:'human-legacy',email:'legacy@example.test',name:'Legacy'};
 const a=await linkHumanBuyer(owner);
 unwrap(await db().from('agents').update({api_key_hash:'existing-legacy-hash',spent_cents:900}).eq('id',a.agent_id));
 await expect(linkHumanBuyer(owner)).rejects.toThrow('ACCOUNT_RECONCILIATION_REQUIRED');
 expect(unwrap(await db().from('agents').select('*').eq('owner_user_id',owner.id))).toMatchObject([{id:a.agent_id,api_key_hash:'existing-legacy-hash',spent_cents:900}]);
});
