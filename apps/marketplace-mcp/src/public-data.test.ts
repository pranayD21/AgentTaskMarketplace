import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { env } from './env.js';
import { publicRows, publicTaskCounts } from './public-data.js';
const state = vi.hoisted(() => ({ sql: null as DatabaseSync | null }));
vi.mock('./db.js', () => ({ rawSql: async (query: string) => state.sql!.prepare(query.replaceAll('::int', '')).all() }));
afterEach(() => { env().DB_MODE = 'memory'; state.sql?.close(); state.sql = null; });
it('filters legacy users and all related activity before limits while retaining Google-linked users', async () => {
 state.sql = new DatabaseSync(':memory:');
 state.sql.exec(`
 create table agents(id text, kind text, owner_user_id text);
 insert into agents values ('buyer','buyer','google-b'),('seller','seller','google-s'),('old-buyer','buyer',null),('old-seller','seller',null),('judge','judge',null);
 create table tasks(id text,buyer_id text,seller_id text,status text,job_id text,created_at text);
 insert into tasks values ('real','buyer','seller','APPROVED','real-job','1'),('old','old-buyer','old-seller','APPROVED','old-job','9'),('mixed','buyer','old-seller','OPEN','mixed-job','8');
 create table sellers(agent_id text,last_seen text);
 insert into sellers values ('seller','1'),('old-seller','9');
 create table jobs(id text,buyer_id text,created_at text);
 insert into jobs values ('real-job','buyer','1'),('old-job','old-buyer','9'),('mixed-job','buyer','8');
 create table events(id text,task_id text,agent_id text,created_at text);
 insert into events values ('real','real','judge','1'),('old','old','old-seller','9'),('human-signup',null,'buyer','2'),('legacy-signup',null,'old-buyer','8'),('judge-signup',null,'judge','7');
 create table verdicts(id text,task_id text,created_at text);
 insert into verdicts values ('real','real','1'),('old','old','9');
 create table settlements(id text,task_id text,created_at text);
 insert into settlements values ('real','real','1'),('old','old','9');
 `);
 env().DB_MODE = 'insforge';
 const offline = vi.fn(async () => []);
 for (const table of ['tasks','verdicts','settlements'] as const) expect(await publicRows(table,1,offline)).toMatchObject([{id:'real'}]);
 expect(await publicRows('sellers',1,offline)).toEqual([{agent_id:'seller',last_seen:'1'}]);
 expect(await publicRows('jobs',1,offline)).toMatchObject([{id:'real-job'}]);
 expect(await publicRows('events',10,offline)).toMatchObject([{id:'human-signup'},{id:'real'}]);
 expect(await publicTaskCounts()).toEqual({APPROVED:1});
 expect(await publicRows('tasks',10,offline,"and t.status = 'OPEN'",true)).toEqual([]);
 expect(offline).not.toHaveBeenCalled();
});
it('keeps isolated memory fixtures confined to offline mode',async()=>{
 const offline=vi.fn(async()=>[{id:'offline'}]);
 expect(await publicRows('tasks',1,offline)).toEqual([{id:'offline'}]);
});
