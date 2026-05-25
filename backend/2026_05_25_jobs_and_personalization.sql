-- LinkedFlow job queue + personalization workflow
-- Run in Supabase SQL editor before deploying the backend job endpoints.

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in (
    'send_connections',
    'check_acceptances',
    'send_messages',
    'send_followups',
    'detect_replies'
  )),
  profile_key text not null,
  campaign_id uuid null references public.campaigns(id) on delete set null,
  prospect_id uuid null references public.prospects(id) on delete set null,
  status text not null default 'pending' check (status in (
    'pending',
    'claimed',
    'running',
    'completed',
    'failed',
    'retrying',
    'cancelled'
  )),
  priority int not null default 5,
  scheduled_for timestamptz not null default now(),
  claimed_at timestamptz null,
  started_at timestamptz null,
  completed_at timestamptz null,
  failed_at timestamptz null,
  error_message text null,
  retry_count int not null default 0,
  max_retries int not null default 3,
  payload jsonb null default '{}'::jsonb,
  result jsonb null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_jobs_profile_status_schedule
  on public.jobs(profile_key, status, scheduled_for, priority);

create index if not exists idx_jobs_prospect_id
  on public.jobs(prospect_id);

alter table public.linkedin_profiles
  add column if not exists enabled boolean not null default true;

-- Optional helper: normalize already accepted contacts with no message.
update public.prospects
set status = 'Needs Personalization',
    next_steps = 'Team: Write personalized initial message'
where status = 'Connection Accepted'
  and coalesce(initial_message, '') = '';

update public.prospects
set status = 'Ready to Send',
    next_steps = 'Ready for initial message'
where status in ('Connection Accepted', 'Needs Personalization')
  and coalesce(initial_message, '') <> '';
