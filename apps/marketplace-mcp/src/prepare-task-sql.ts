/** One database transaction creates the durable post and reserves both budgets. */
export const PREPARE_TASK_SQL = `create or replace function atm_prepare_task(p jsonb) returns jsonb
language plpgsql security invoker as $$
declare b agents%rowtype; j jobs%rowtype; t tasks%rowtype; amount integer; k text;
begin
  amount := (p->>'max_price_cents')::integer;
  k := 'reserve:' || (p->>'id');
  select * into b from agents where id = p->>'buyer_id' for update;
  if not found or b.kind <> 'buyer' then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if b.reserved_cents + b.spent_cents + amount > b.spend_cap_cents then return jsonb_build_object('error', 'SPEND_CAP_EXCEEDED'); end if;
  if p->>'job_id' is not null then
    select * into j from jobs where id = p->>'job_id' for update;
    if not found or j.buyer_id <> b.id then return jsonb_build_object('error', 'NOT_FOUND'); end if;
    if j.reserved_cents + j.spent_cents + amount > j.budget_cents then return jsonb_build_object('error', 'JOB_BUDGET_EXCEEDED'); end if;
  end if;
  insert into tasks select (jsonb_populate_record(null::tasks, p || jsonb_build_object('settle_pending', false, 'review_attempts', 0, 'replacement_attempts', 0))).* returning * into t;
  if t.payment_mode <> 'mpp' then
    update agents set reserved_cents = reserved_cents + amount, balance_keys = array_append(coalesce(balance_keys, '{}'), k), balance_revision = balance_revision + 1 where id = b.id;
    if j.id is not null then
      update jobs set reserved_cents = reserved_cents + amount, balance_keys = array_append(coalesce(balance_keys, '{}'), k), balance_revision = balance_revision + 1 where id = j.id;
    end if;
  end if;
  return jsonb_build_object('task', to_jsonb(t));
end;
$$;`;
