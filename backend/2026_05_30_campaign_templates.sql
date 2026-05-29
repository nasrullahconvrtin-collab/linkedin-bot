-- LinkedFlow campaign template engine MVP
-- Data-driven campaign types, variable/custom-field support, and sequence enrollment.

alter table public.campaigns
  add column if not exists template_id uuid null,
  add column if not exists sequence_config jsonb not null default '{}'::jsonb,
  add column if not exists launched_at timestamptz null,
  add column if not exists paused_at timestamptz null,
  add column if not exists archived_at timestamptz null;

alter table public.prospects
  add column if not exists custom_fields jsonb not null default '{}'::jsonb,
  add column if not exists source_list text null;

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'jobs'
      and constraint_name = 'jobs_job_type_check'
  ) then
    alter table public.jobs drop constraint jobs_job_type_check;
  end if;
end $$;

create table if not exists public.campaign_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text null,
  category text not null default 'outreach',
  status text not null default 'active'
    check (status in ('active', 'coming_soon', 'archived')),
  supported_actions text[] not null default '{}'::text[],
  variables text[] not null default '{}'::text[],
  default_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'campaigns'
      and constraint_name = 'campaigns_template_id_fkey'
  ) then
    alter table public.campaigns
      add constraint campaigns_template_id_fkey
      foreign key (template_id)
      references public.campaign_templates(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.campaign_template_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.campaign_templates(id) on delete cascade,
  step_order integer not null,
  action_type text not null,
  label text not null,
  config jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(template_id, step_order)
);

create table if not exists public.prospect_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prospect_list_members (
  list_id uuid not null references public.prospect_lists(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, prospect_id)
);

create table if not exists public.campaign_enrollments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  template_id uuid null references public.campaign_templates(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'failed', 'cancelled')),
  current_step_order integer not null default 0,
  next_step_at timestamptz null,
  last_job_id uuid null references public.jobs(id) on delete set null,
  last_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, prospect_id)
);

create index if not exists idx_campaign_templates_status
  on public.campaign_templates(status, category);

create index if not exists idx_template_steps_template_order
  on public.campaign_template_steps(template_id, step_order);

create index if not exists idx_prospects_custom_fields
  on public.prospects using gin(custom_fields);

create index if not exists idx_campaign_enrollments_campaign_status
  on public.campaign_enrollments(campaign_id, status);

create index if not exists idx_campaign_enrollments_prospect
  on public.campaign_enrollments(prospect_id);

insert into public.campaign_templates
  (key, name, description, category, status, supported_actions, variables, default_config)
values
  (
    'invitation_message_2_followups',
    'Invitation + 2 Messages',
    'Send an invitation, wait for connection, then send an initial message and two follow-ups.',
    'linkedin',
    'active',
    array['invitation', 'wait', 'message', 'follow-up message', 'already connected detection'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{"recommended": true}'::jsonb
  ),
  (
    'message_only',
    'Message Only',
    'Use for prospects who are already connected. Starts with the first message.',
    'linkedin',
    'active',
    array['message', 'wait', 'follow-up message'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{"requires_connection": true}'::jsonb
  ),
  (
    'invitation_only',
    'Invitation Only',
    'Send a connection request and stop after acceptance detection.',
    'linkedin',
    'active',
    array['invitation', 'already connected detection'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{}'::jsonb
  ),
  (
    'visit_follow_invite',
    'Visit + Follow + Invitation',
    'Future multi-action LinkedIn workflow.',
    'linkedin',
    'coming_soon',
    array['visit', 'follow', 'invitation'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{}'::jsonb
  ),
  (
    'invitation_email_crm',
    'Invitation + Email + CRM Sync',
    'Future cross-channel workflow for email and CRM handoff.',
    'cross_channel',
    'coming_soon',
    array['invitation', 'email finder', 'email', 'crm sync'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{}'::jsonb
  )
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    status = excluded.status,
    supported_actions = excluded.supported_actions,
    variables = excluded.variables,
    default_config = excluded.default_config,
    updated_at = now();

with template as (
  select id from public.campaign_templates where key = 'invitation_message_2_followups'
)
insert into public.campaign_template_steps (template_id, step_order, action_type, label, config)
select id, step_order, action_type, label, config
from template,
(values
  (1, 'invitation', 'Send invitation', '{"note_field":"inmail_message"}'::jsonb),
  (2, 'wait', 'Wait for acceptance', '{"days":1, "until":"connected"}'::jsonb),
  (3, 'message', 'Initial message', '{"message_field":"initial_message", "message_type":"initial"}'::jsonb),
  (4, 'wait', 'Wait 3 days', '{"days":3}'::jsonb),
  (5, 'follow-up message', 'Follow-up 1', '{"message_field":"followup_1", "message_type":"followup_1"}'::jsonb),
  (6, 'wait', 'Wait 5 working days', '{"working_days":5}'::jsonb),
  (7, 'follow-up message', 'Follow-up 2', '{"message_field":"followup_2", "message_type":"followup_2"}'::jsonb)
) as steps(step_order, action_type, label, config)
on conflict (template_id, step_order) do update
set action_type = excluded.action_type,
    label = excluded.label,
    config = excluded.config;

with template as (
  select id from public.campaign_templates where key = 'message_only'
)
insert into public.campaign_template_steps (template_id, step_order, action_type, label, config)
select id, step_order, action_type, label, config
from template,
(values
  (1, 'message', 'Initial message', '{"message_field":"initial_message", "message_type":"initial"}'::jsonb),
  (2, 'wait', 'Wait 3 days', '{"days":3}'::jsonb),
  (3, 'follow-up message', 'Follow-up 1', '{"message_field":"followup_1", "message_type":"followup_1"}'::jsonb)
) as steps(step_order, action_type, label, config)
on conflict (template_id, step_order) do update
set action_type = excluded.action_type,
    label = excluded.label,
    config = excluded.config;

with template as (
  select id from public.campaign_templates where key = 'invitation_only'
)
insert into public.campaign_template_steps (template_id, step_order, action_type, label, config)
select id, step_order, action_type, label, config
from template,
(values
  (1, 'invitation', 'Send invitation', '{"note_field":"inmail_message"}'::jsonb)
) as steps(step_order, action_type, label, config)
on conflict (template_id, step_order) do update
set action_type = excluded.action_type,
    label = excluded.label,
    config = excluded.config;
