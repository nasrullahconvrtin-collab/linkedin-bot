-- LinkedFlow single-user cloud source-of-truth additions.
-- Run this in Supabase SQL editor after the jobs/personalization migration.

create table if not exists agent_schedules (
  id uuid primary key default gen_random_uuid(),
  task_key text not null unique,
  label text not null,
  time text not null,
  enabled boolean not null default true,
  run_on_startup boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into agent_schedules (task_key, label, time, enabled, run_on_startup)
values
  ('conn', 'Send connections', '09:00', true, false),
  ('acc', 'Check acceptances', '12:00', true, false),
  ('msg', 'Send messages', '14:00', true, false),
  ('fu', 'Send follow-ups', '10:00', true, false)
on conflict (task_key) do nothing;

create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  subject text,
  body text not null,
  message_type text not null default 'initial',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agent_schedules_enabled on agent_schedules(enabled);
create index if not exists idx_message_templates_type on message_templates(message_type);

-- Guardrail: each prospect LinkedIn URL should be unique when present.
create unique index if not exists idx_prospects_linkedin_url_unique
  on prospects (linkedin_url)
  where linkedin_url is not null and linkedin_url <> '';
