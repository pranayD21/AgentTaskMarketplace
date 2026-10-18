import { rawSql } from './db.js';
import { env } from './env.js';

// Ownership is written only after server-side verification of a Google session.
// Internal judges and legacy audit rows are never public marketplace users.
export const HUMAN_TASK = `exists (select 1 from agents b where b.id=t.buyer_id and b.kind='buyer' and b.owner_user_id is not null)
  and (t.seller_id is null or exists (select 1 from agents s where s.id=t.seller_id and s.kind='seller' and s.owner_user_id is not null))`;

const predicates = {
  tasks: HUMAN_TASK,
  sellers: `exists (select 1 from agents a where a.id=t.agent_id and a.kind='seller' and a.owner_user_id is not null)`,
  jobs: `exists (select 1 from agents a where a.id=t.buyer_id and a.kind='buyer' and a.owner_user_id is not null)
    and not exists (select 1 from tasks p where p.job_id=t.id and p.seller_id is not null and not exists
      (select 1 from agents s where s.id=p.seller_id and s.kind='seller' and s.owner_user_id is not null))`,
  verdicts: `t.task_id in (select t.id from tasks t where ${HUMAN_TASK})`,
  settlements: `t.task_id in (select t.id from tasks t where ${HUMAN_TASK})`,
  events: `(t.task_id in (select t.id from tasks t where ${HUMAN_TASK}) or
    (t.task_id is null and exists (select 1 from agents a where a.id=t.agent_id and a.kind in ('buyer','seller') and a.owner_user_id is not null)))`,
};

/** Apply eligibility before ordering/limiting so legacy rows cannot crowd out humans. */
export async function publicRows<T>(table: keyof typeof predicates, limit: number, offline: () => PromiseLike<T[]>, extra = '', ascending = false): Promise<T[]> {
  if (env().DB_MODE === 'memory') return offline();
  const order = table === 'sellers' ? 'last_seen' : 'created_at';
  return rawSql<T>(`select t.* from ${table} t where ${predicates[table]} ${extra} order by t.${order} ${ascending ? 'asc' : 'desc'} limit ${Math.max(1, Math.trunc(limit))}`);
}

export async function publicTaskCounts(): Promise<Record<string, number>> {
  const rows = await rawSql<{status:string;n:number}>(`select t.status, count(*)::int as n from tasks t where ${HUMAN_TASK} group by t.status`);
  return Object.fromEntries(rows.map(r => [r.status, r.n]));
}
