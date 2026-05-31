-- Profile runtime metadata for dashboard <-> local agent synchronization.
-- Safe to run multiple times.

alter table public.linkedin_profiles
  add column if not exists enabled boolean not null default true,
  add column if not exists runtime_mode text not null default 'local',
  add column if not exists proxy_settings jsonb not null default '{}'::jsonb,
  add column if not exists session_status text,
  add column if not exists local_state text,
  add column if not exists last_job_result jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_linkedin_profiles_enabled
  on public.linkedin_profiles(enabled);

create index if not exists idx_linkedin_profiles_runtime_mode
  on public.linkedin_profiles(runtime_mode);

create or replace function public.set_linkedin_profiles_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_linkedin_profiles_updated_at on public.linkedin_profiles;
create trigger trg_linkedin_profiles_updated_at
before update on public.linkedin_profiles
for each row execute function public.set_linkedin_profiles_updated_at();
