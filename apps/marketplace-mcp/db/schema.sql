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
-- these itself on its first tool call (src/db.ts ensureSchema), so older
-- databases catch up without a manual migration.
-- ---------------------------------------------------------------------------
alter table tasks add column if not exists claim_runner_key_id text;
alter table tasks add column if not exists claim_runner_pubkey_b64 text;
alter table sellers add column if not exists last_claim_key_id text;
alter table sellers add column if not exists last_claim_pubkey_b64 text;

-- ---------------------------------------------------------------------------
-- Contract v0.3 (docs/CONTRACT.md §8-§12). Mirrored in src/db.ts SCHEMA_PATCHES,
-- which also backfills rows written before v0.3.
-- ---------------------------------------------------------------------------
-- §8 review deferral and replacement delivery
alter table tasks add column if not exists review_status text;
alter table tasks add column if not exists review_attempts integer not null default 0;
alter table tasks add column if not exists review_retry_at timestamptz;
alter table tasks add column if not exists replacement_status text;
alter table tasks add column if not exists replacement_attempts integer not null default 0;
alter table tasks add column if not exists replacement_retry_at timestamptz;
-- §9 durable settlement: a CANCELLED/EXPIRED task whose settlement is not finished
alter table tasks add column if not exists settle_pending boolean not null default false;
alter table verdicts add column if not exists seller_id text;
alter table settlements add column if not exists outcome text;
alter table settlements add column if not exists result_id text;
alter table settlements add column if not exists verdict_reason_code text;
alter table settlements add column if not exists decision jsonb;
alter table settlements add column if not exists payment_state text;
alter table settlements add column if not exists finalized_at timestamptz;
alter table settlements add column if not exists updated_at timestamptz;
alter table settlements add column if not exists payout_owed_cents integer;
alter table settlements add column if not exists payout_transferred_cents integer;
alter table settlements add column if not exists transfer_state text;
alter table settlements add column if not exists transfer_attempts integer not null default 0;
alter table settlements add column if not exists transfer_retry_at timestamptz;
alter table agents add column if not exists balance_keys text[] not null default '{}';
-- §10 jobs and parts
create table if not exists jobs (
  id text primary key,
  buyer_id text not null references agents(id),
  label_public text,
  budget_cents integer not null,
  reserved_cents integer not null default 0,
  spent_cents integer not null default 0,
  balance_keys text[] not null default '{}',
  client_job_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_buyer_idx on jobs(buyer_id);
alter table tasks add column if not exists job_id text;
alter table tasks add column if not exists part_key text;
alter table tasks add column if not exists part_label text;
alter table tasks add column if not exists attempt integer;
alter table tasks add column if not exists client_request_id text;
create index if not exists tasks_job_idx on tasks(job_id);
-- §12 Inkbox continuity
alter table tasks add column if not exists inkbox_thread_owner text;
alter table tasks add column if not exists inkbox_buyer_context_id text;
