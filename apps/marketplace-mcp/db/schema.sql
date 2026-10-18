-- Agent Task Marketplace schema (Postgres via Insforge). Idempotent.
-- Private task text is never stored in plaintext: plaintext_enc_server is
-- encrypted under the server KEK and deleted once a result is submitted.

create table if not exists agents (
  id text primary key,
  kind text not null check (kind in ('buyer','seller','judge')),
  display_name text not null,
  api_key_hash text not null unique,
  inkbox_handle text,
  inkbox_identity_id text,
  buyer_pubkey_b64 text,
  buyer_key_id text,
  buyer_secret_enc text,
  stripe_customer_id text,
  stripe_payment_method_id text,
  stripe_account_id text,
  spend_cap_cents integer not null default 0,
  reserved_cents integer not null default 0,
  spent_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists sellers (
  agent_id text primary key references agents(id),
  status text not null default 'ACTIVE',
  models jsonb not null default '[]'::jsonb,
  runner_pubkey_b64 text,
  runner_key_id text,
  runner_wasm_sha256 text,
  runtime text not null default 'node-unsandboxed',
  wassette_version text,
  approvals integer not null default 0,
  rejections integer not null default 0,
  strikes integer not null default 0,
  last_seen timestamptz not null default now()
);

create table if not exists tasks (
  id text primary key,
  buyer_id text not null references agents(id),
  allowed_models text[] not null,
  max_price_cents integer not null,
  max_runtime_s integer not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  plaintext_enc_server text,
  payload_enc_judge jsonb,
  payload_enc_seller jsonb,
  claim_id text,
  seller_id text,
  model_id text,
  price_cents integer,
  lease_expires_at timestamptz,
  claim_count integer not null default 0,
  judge_id text,
  payment_mode text not null,
  payment_state text not null default 'NONE',
  stripe_payment_intent_id text,
  payment_link text,
  inkbox_context_id text
);
create index if not exists tasks_status_idx on tasks(status);
create index if not exists tasks_buyer_idx on tasks(buyer_id);
create index if not exists tasks_seller_idx on tasks(seller_id);

create table if not exists results (
  id text primary key,
  task_id text not null references tasks(id),
  claim_id text not null,
  seller_id text not null,
  model_id text not null,
  result_enc_buyer jsonb not null,
  result_enc_judge jsonb not null,
  commitment_sha256 text not null,
  runtime_ms integer not null,
  tokens_out integer,
  created_at timestamptz not null default now()
);
create index if not exists results_task_idx on results(task_id);

create table if not exists verdicts (
  id text primary key,
  task_id text not null references tasks(id),
  result_id text not null references results(id),
  judge_id text not null,
  verdict text not null,
  reason_code text not null,
  reason_public text not null,
  score real,
  replacement_enc_buyer jsonb,
  created_at timestamptz not null default now()
);
create index if not exists verdicts_task_idx on verdicts(task_id);

create table if not exists settlements (
  id text primary key,
  task_id text not null unique references tasks(id),
  kind text not null,
  state text not null,
  seller_payout_cents integer not null default 0,
  buyer_refund_cents integer not null default 0,
  stripe_capture_id text,
  stripe_transfer_id text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id bigserial primary key,
  task_id text,
  agent_id text,
  type text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_task_idx on events(task_id);
create index if not exists events_created_idx on events(created_at desc);

-- ---------------------------------------------------------------------------
-- Contract v0.2: per-claim runner keys. The key a claim's seller envelope was
-- sealed to (generated inside that sandbox instance), and the seller's latest
-- per-claim key for SellerPublic when no key is registered. The server applies
-- these at startup too (src/db.ts ensureSchema), so older databases catch up.
-- ---------------------------------------------------------------------------
alter table tasks add column if not exists claim_runner_key_id text;
alter table tasks add column if not exists claim_runner_pubkey_b64 text;
alter table sellers add column if not exists last_claim_key_id text;
alter table sellers add column if not exists last_claim_pubkey_b64 text;
