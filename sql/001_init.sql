-- Fewer schema (idempotent). Run via `npm run migrate`.

create table if not exists journeys (
  id text primary key,
  rank int,
  title text,
  keywords jsonb
);

create table if not exists boundaries (
  id text primary key,
  strength text,
  label text,
  rule jsonb
);

create table if not exists asks (
  id text primary key,
  inbox_message_id text unique,
  thread_id text,
  from_email text,
  from_name text,
  subject text,
  received_at timestamptz default now(),
  raw_text text,
  parsed jsonb,
  status text default 'received'  -- received|triaged|awaiting_approval|sent|declined|blocked|error
);

create table if not exists evidence (
  id bigserial primary key,
  ask_id text,
  claims jsonb,
  created_at timestamptz default now()
);

create table if not exists decisions (
  id bigserial primary key,
  ask_id text,
  verdict text,
  rule text,
  decision jsonb,
  fits jsonb,
  created_at timestamptz default now()
);

create table if not exists drafts (
  id text primary key,
  ask_id text,
  to_email text,
  reply_to_message_id text,
  body text,
  kind text,
  created_at timestamptz default now()
);

create table if not exists approvals (
  id text primary key,
  code text,
  payload_sha256 text,
  draft_ids jsonb,
  status text default 'pending',  -- pending|approved|declined|expired
  brief_message_id text,
  created_at timestamptz default now(),
  expires_at timestamptz,
  used_at timestamptz
);

create table if not exists actions (
  id bigserial primary key,
  approval_id text,
  draft_id text,
  status text,
  sent_message_id text,
  error text,
  created_at timestamptz default now(),
  unique (approval_id, draft_id)
);

create table if not exists checkins (
  id bigserial primary key,
  ask_id text,
  sent_message_id text,
  thread_id text,
  status text default 'sent',
  created_at timestamptz default now()
);

create table if not exists outcomes (
  id bigserial primary key,
  ask_id text,
  tag text,
  rating int,
  result text,  -- completed|changed|abandoned|unknown
  note text,
  at timestamptz default now()
);

create table if not exists events_log (
  id bigserial primary key,
  kind text,
  ask_id text,
  detail jsonb,
  at timestamptz default now()
);

create index if not exists asks_status_idx on asks (status);
create index if not exists decisions_ask_idx on decisions (ask_id);
create index if not exists drafts_ask_idx on drafts (ask_id);
create index if not exists events_log_kind_idx on events_log (kind);
create index if not exists checkins_thread_idx on checkins (thread_id);

-- One live send per draft across ALL approvals (two processes can brief the same draft; only one may send).
create unique index if not exists actions_one_live_per_draft
  on actions (draft_id) where status in ('sending', 'sent', 'ready');
