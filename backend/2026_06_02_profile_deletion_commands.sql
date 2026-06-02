create table if not exists public.agent_profile_commands (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null,
  command text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  handled_at timestamptz null
);

create index if not exists idx_agent_profile_commands_pending
  on public.agent_profile_commands(profile_key, status, created_at);
