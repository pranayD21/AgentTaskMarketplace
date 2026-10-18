import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planJob, saveJob, loadJob, runJob, collectJob, taskOfferFields } from '../../../skills/marketplace/scripts/job.mjs';

const endpoint = 'http://fixture.test/mcp';
const input = { instruction: 'Compute each record independently.', records: [{id:'a',value:1},{id:'b',value:2},{id:'c',value:3}], rubric: {kind:'contains_text',expected_text:'output'} };
const plan = () => planJob(input, {endpoint, budget:201, parts:2, id:'fixture-00000001'});
function server() {
  const tasks = []; const calls = []; let lost = false;
  return { tasks, calls, loseResponse: false, identity: 'buyer_fixture',
    async tools() { return {tools:[{name:'create_job'},{name:'get_job'},{name:'post_task',inputSchema:{properties:{client_request_id:{}}}}]}; },
    async tool(name, args = {}) {
      calls.push({name,args});
      if (name === 'marketplace_info') return {pricing:{mode:'task_offer'},payments:{min_cents:50},models:[{model_id:'qwen3:8b'}]};
      if (name === 'whoami') return {agent_id:this.identity,kind:'buyer',spend:{available_cents:1000}};
      if (name === 'create_job') return {job:{job_id:'job_fixture'}};
      if (name === 'get_job') return {job:{reserved_cents:0,spent_cents:201},parts:tasks};
      if (name === 'post_task') {
        let task = tasks.find(t => t.request === args.client_request_id);
        if (!task) { task = {task_id:`task_${tasks.length}`,part_key:args.part_key,attempt:1,status:'APPROVED',request:args.client_request_id,context:args.context,seller_id:`seller_${tasks.length}`}; tasks.push(task); }
        if (this.loseResponse && !lost) { lost = true; throw new Error('accepted response lost'); }
        return {task};
      }
      if (name === 'get_result') { const task = tasks.find(t => t.task_id === args.task_id); return {task,result:{commitment_verified:task.verified !== false,answer:task.answer ?? JSON.stringify(JSON.parse(task.context).map(r=>({id:r.id,output:r.value})))}}; }
      throw new Error(`Unexpected tool ${name}`);
    }
  };
}
describe('bounded buyer jobs', () => {
  it('partitions every independent record once and allocates an exact total budget', () => {
    const state = plan();
    expect(state.plan.parts.flatMap(p=>p.record_ids)).toEqual(['a','b','c']);
    expect(state.plan.parts.map(p=>p.offer_cents)).toEqual([101,100]);
    expect(state.plan.parts.every(p=>p.client_request_id.length <= 64)).toBe(true);
    expect(state.plan.parts.map(p=>p.part_label)).toEqual(['Part 1','Part 2']);
    expect(()=>planJob({...input,records:[{id:'a'},{id:'a'}]},{endpoint,budget:100})).toThrow();
    expect(()=>taskOfferFields(100,{})).toThrow(/not enabled/);
  });
  it('resumes after acceptance before local task ID save without a second purchase', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'atm-job-'));
    try {
      const file = path.join(directory,'job.json'); saveJob(file,plan()); const api = server(); api.loseResponse = true;
      await expect(runJob(file,api,endpoint,{postFields:taskOfferFields})).rejects.toThrow('accepted response lost');
      expect(loadJob(file).tasks).toEqual({}); expect(api.tasks).toHaveLength(1);
      const result = await runJob(file,api,endpoint,{postFields:taskOfferFields});
      expect(result.status).toBe('COMPLETE'); expect(result.records.map(r=>r.id)).toEqual(['a','b','c']);
      expect(api.tasks).toHaveLength(2); expect(api.calls.filter(c=>c.name==='post_task')).toHaveLength(2);
      await runJob(file,api,endpoint,{postFields:taskOfferFields});
      expect(api.calls.filter(c=>c.name==='post_task')).toHaveLength(2);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      api.identity = 'buyer_changed'; await expect(runJob(file,api,endpoint,{postFields:taskOfferFields})).rejects.toMatchObject({code:'JOB_BUYER_CHANGED'});
      await expect(runJob(file,api,'http://different.test/mcp',{postFields:taskOfferFields})).rejects.toMatchObject({code:'JOB_ENDPOINT_MISMATCH'});
      const changed = loadJob(file); changed.plan.budget_cents++; fs.writeFileSync(file,JSON.stringify(changed)); expect(()=>loadJob(file)).toThrow(/changed/);
    } finally { fs.rmSync(directory,{recursive:true,force:true}); }
  });
  it('keeps failed, invalid and unverified parts visible and excludes their answers', async () => {
    const state = plan(); state.job_id='job_fixture'; const api=server();
    for (const part of state.plan.parts) await api.tool('post_task',part);
    api.tasks[1].status='REJECTED';
    let result=await collectJob(state,api); expect(result.status).toBe('PARTIAL_FAILURE'); expect(result.records).toHaveLength(1); expect(result.parts[1].included).toBe(false);
    api.tasks[1].status='APPROVED'; api.tasks[1].verified=false;
    result=await collectJob(state,api); expect(result.parts[1].error).toBe('UNVERIFIED_RESULT'); expect(result.records).toHaveLength(1);
    api.tasks[1].verified=true; api.tasks[1].answer='[{"id":"b","output":1},{"id":"b","output":2}]';
    result=await collectJob(state,api); expect(result.parts[1].error).toBe('INVALID_PART_OUTPUT'); expect(result.records).toHaveLength(1);
  });
});
