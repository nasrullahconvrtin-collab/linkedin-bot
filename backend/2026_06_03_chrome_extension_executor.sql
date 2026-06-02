alter table public.linkedin_profiles
  add column if not exists run_mode text not null default 'windows_agent',
  add column if not exists extension_id text null,
  add column if not exists extension_status text null,
  add column if not exists last_extension_heartbeat timestamptz null,
  add column if not exists paired_at timestamptz null,
  add column if not exists linkedin_login_status text null,
  add column if not exists extension_version text null,
  add column if not exists automation_paused boolean not null default false;

update public.linkedin_profiles
set run_mode = case
  when runtime_mode in ('chrome_extension', 'extension') then 'chrome_extension'
  when runtime_mode in ('cloud_agent', 'cloud') then 'cloud_agent'
  else 'windows_agent'
end
where run_mode is null or run_mode = 'windows_agent';

create table if not exists public.extension_pairing_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  profile_key text null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  used_at timestamptz null,
  extension_id text null
);

create index if not exists idx_extension_pairing_tokens_status
  on public.extension_pairing_tokens(status, expires_at);

create index if not exists idx_linkedin_profiles_run_mode
  on public.linkedin_profiles(run_mode);

create index if not exists idx_linkedin_profiles_extension_id
  on public.linkedin_profiles(extension_id);
