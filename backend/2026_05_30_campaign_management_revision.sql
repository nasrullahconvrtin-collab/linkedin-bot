-- LinkedFlow campaign/prospect management revision
-- Keeps campaign types data-driven while adding list-centric prospect management,
-- profile-specific connection state, ready-for-message queue support, and richer reporting.

alter table public.prospects
  add column if not exists email text null,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists state text null,
  add column if not exists connection_status text null,
  add column if not exists connected_at timestamptz null,
  add column if not exists accepted_at timestamptz null,
  add column if not exists last_action_at timestamptz null,
  add column if not exists initial_message_sent_at timestamptz null,
  add column if not exists next_action_at timestamptz null;

alter table public.prospect_lists
  add column if not exists sort_order integer not null default 0;

alter table public.campaigns
  add column if not exists schedule_config jsonb not null default '{}'::jsonb,
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.campaign_enrollments
  add column if not exists profile_key text null,
  add column if not exists invitation_sent_at timestamptz null,
  add column if not exists accepted_at timestamptz null,
  add column if not exists connected_at timestamptz null,
  add column if not exists connection_detected_by_profile text null,
  add column if not exists messaging_profile text null,
  add column if not exists last_message_sent_at timestamptz null;

update public.campaign_enrollments ce
set profile_key = coalesce(ce.profile_key, p.assigned_account, 'profile_1'),
    messaging_profile = coalesce(ce.messaging_profile, p.assigned_account, 'profile_1')
from public.prospects p
where ce.prospect_id = p.id;

create table if not exists public.prospect_profile_states (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  profile_key text not null,
  campaign_id uuid null references public.campaigns(id) on delete set null,
  connection_status text not null default 'unknown'
    check (connection_status in ('unknown', 'not_connected', 'invitation_sent', 'pending', 'connected', 'failed')),
  invitation_sent_at timestamptz null,
  accepted_at timestamptz null,
  connected_at timestamptz null,
  connection_detected_by_profile text null,
  messaging_profile text null,
  last_message_sent_at timestamptz null,
  last_action_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(prospect_id, profile_key)
);

create index if not exists idx_prospect_profile_states_profile_status
  on public.prospect_profile_states(profile_key, connection_status);

create index if not exists idx_prospect_profile_states_prospect
  on public.prospect_profile_states(prospect_id);

create index if not exists idx_prospects_email
  on public.prospects(email);

create index if not exists idx_prospects_tags
  on public.prospects using gin(tags);

create index if not exists idx_campaign_enrollments_profile
  on public.campaign_enrollments(profile_key, status);

-- Seed the expanded active LinkedIn template library.
insert into public.campaign_templates
  (key, name, description, category, status, supported_actions, variables, default_config)
values
  (
    'invitation_only',
    'Invitation Only',
    'Send a connection request and stop after acceptance tracking.',
    'linkedin',
    'active',
    array['invitation', 'already connected detection'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{}'::jsonb
  ),
  (
    'invitation_1_message',
    'Invitation + 1 Message',
    'Invite, wait for acceptance, then send one first message.',
    'linkedin',
    'active',
    array['invitation', 'wait', 'message', 'already connected detection'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{}'::jsonb
  ),
  (
    'invitation_message_2_followups',
    'Invitation + 2 Messages',
    'Invite, wait for acceptance, then send an initial message and one follow-up.',
    'linkedin',
    'active',
    array['invitation', 'wait', 'message', 'follow-up message', 'already connected detection'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{"recommended": true}'::jsonb
  ),
  (
    'invitation_3_messages',
    'Invitation + 3 Messages',
    'Invite, then send a three-message LinkedIn sequence after acceptance.',
    'linkedin',
    'active',
    array['invitation', 'wait', 'message', 'follow-up message', 'already connected detection'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{}'::jsonb
  ),
  (
    'invitation_5_messages',
    'Invitation + 5 Messages',
    'Invite, then run the full five-message LinkedIn sequence after acceptance.',
    'linkedin',
    'active',
    array['invitation', 'wait', 'message', 'follow-up message', 'already connected detection'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{}'::jsonb
  ),
  (
    'message_only_connected',
    'Message Only (Connected Prospects)',
    'For 1st-degree connections only. Starts the message sequence immediately.',
    'linkedin',
    'active',
    array['message', 'wait', 'follow-up message'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{"requires_connection": true, "message_only": true}'::jsonb
  ),
  (
    'visit_invitation',
    'Visit + Invitation',
    'Future LinkedIn visit and invitation workflow.',
    'linkedin',
    'coming_soon',
    array['visit', 'invitation'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{"coming_soon": true}'::jsonb
  ),
  (
    'visit_follow_invite',
    'Visit + Follow + Invitation',
    'Future LinkedIn visit, follow, and invite workflow.',
    'linkedin',
    'coming_soon',
    array['visit', 'follow', 'invitation'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{"coming_soon": true}'::jsonb
  ),
  (
    'invitation_email',
    'Invitation + Email',
    'Future cross-channel LinkedIn and email sequence.',
    'cross_channel',
    'coming_soon',
    array['invitation', 'email finder', 'email'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{"coming_soon": true}'::jsonb
  ),
  (
    'invitation_crm_sync',
    'Invitation + CRM Sync',
    'Future LinkedIn sequence with CRM handoff.',
    'cross_channel',
    'coming_soon',
    array['invitation', 'crm sync'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{"coming_soon": true}'::jsonb
  ),
  (
    'email_finder',
    'Email Finder',
    'Future enrichment workflow for finding prospect emails.',
    'data',
    'coming_soon',
    array['email finder'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{"coming_soon": true}'::jsonb
  ),
  (
    'multichannel',
    'Multichannel',
    'Future combined LinkedIn, email, CRM, webhook, and custom action workflow.',
    'cross_channel',
    'coming_soon',
    array['visit', 'follow', 'invitation', 'email finder', 'email', 'crm sync', 'webhook', 'custom action'],
    array['first_name', 'last_name', 'company', 'title', 'industry', 'location'],
    '{"coming_soon": true}'::jsonb
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

update public.campaign_templates
set status = 'archived',
    updated_at = now()
where key = 'message_only';

-- Helper blocks seed reusable sequence patterns.
with template as (select id from public.campaign_templates where key = 'invitation_1_message')
insert into public.campaign_template_steps (template_id, step_order, action_type, label, config)
select id, step_order, action_type, label, config
from template,
(values
  (1, 'invitation', 'Send invitation', '{"note_field":"inmail_message"}'::jsonb),
  (2, 'wait', 'Wait for acceptance', '{"until":"connected"}'::jsonb),
  (3, 'message', 'Initial message', '{"message_field":"initial_message", "message_type":"initial"}'::jsonb)
) as steps(step_order, action_type, label, config)
on conflict (template_id, step_order) do update set action_type = excluded.action_type, label = excluded.label, config = excluded.config;

with template as (select id from public.campaign_templates where key = 'invitation_3_messages')
insert into public.campaign_template_steps (template_id, step_order, action_type, label, config)
select id, step_order, action_type, label, config
from template,
(values
  (1, 'invitation', 'Send invitation', '{"note_field":"inmail_message"}'::jsonb),
  (2, 'wait', 'Wait for acceptance', '{"until":"connected"}'::jsonb),
  (3, 'message', 'Initial message', '{"message_field":"initial_message", "message_type":"initial"}'::jsonb),
  (4, 'wait', 'Wait 3 days', '{"days":3}'::jsonb),
  (5, 'follow-up message', 'Follow-up 1', '{"message_field":"followup_1", "message_type":"followup_1"}'::jsonb),
  (6, 'wait', 'Wait 5 working days', '{"working_days":5}'::jsonb),
  (7, 'follow-up message', 'Follow-up 2', '{"message_field":"followup_2", "message_type":"followup_2"}'::jsonb)
) as steps(step_order, action_type, label, config)
on conflict (template_id, step_order) do update set action_type = excluded.action_type, label = excluded.label, config = excluded.config;

with template as (select id from public.campaign_templates where key = 'invitation_5_messages')
insert into public.campaign_template_steps (template_id, step_order, action_type, label, config)
select id, step_order, action_type, label, config
from template,
(values
  (1, 'invitation', 'Send invitation', '{"note_field":"inmail_message"}'::jsonb),
  (2, 'wait', 'Wait for acceptance', '{"until":"connected"}'::jsonb),
  (3, 'message', 'Initial message', '{"message_field":"initial_message", "message_type":"initial"}'::jsonb),
  (4, 'wait', 'Wait 3 days', '{"days":3}'::jsonb),
  (5, 'follow-up message', 'Follow-up 1', '{"message_field":"followup_1", "message_type":"followup_1"}'::jsonb),
  (6, 'wait', 'Wait 5 working days', '{"working_days":5}'::jsonb),
  (7, 'follow-up message', 'Follow-up 2', '{"message_field":"followup_2", "message_type":"followup_2"}'::jsonb),
  (8, 'wait', 'Wait 5 working days', '{"working_days":5}'::jsonb),
  (9, 'follow-up message', 'Follow-up 3', '{"message_field":"followup_3", "message_type":"followup_3"}'::jsonb),
  (10, 'wait', 'Wait 5 working days', '{"working_days":5}'::jsonb),
  (11, 'follow-up message', 'Follow-up 4', '{"message_field":"followup_4", "message_type":"followup_4"}'::jsonb)
) as steps(step_order, action_type, label, config)
on conflict (template_id, step_order) do update set action_type = excluded.action_type, label = excluded.label, config = excluded.config;

with template as (select id from public.campaign_templates where key = 'message_only_connected')
insert into public.campaign_template_steps (template_id, step_order, action_type, label, config)
select id, step_order, action_type, label, config
from template,
(values
  (1, 'message', 'Initial message', '{"message_field":"initial_message", "message_type":"initial"}'::jsonb),
  (2, 'wait', 'Wait 3 days', '{"days":3}'::jsonb),
  (3, 'follow-up message', 'Follow-up 1', '{"message_field":"followup_1", "message_type":"followup_1"}'::jsonb),
  (4, 'wait', 'Wait 5 working days', '{"working_days":5}'::jsonb),
  (5, 'follow-up message', 'Follow-up 2', '{"message_field":"followup_2", "message_type":"followup_2"}'::jsonb),
  (6, 'wait', 'Wait 5 working days', '{"working_days":5}'::jsonb),
  (7, 'follow-up message', 'Follow-up 3', '{"message_field":"followup_3", "message_type":"followup_3"}'::jsonb),
  (8, 'wait', 'Wait 5 working days', '{"working_days":5}'::jsonb),
  (9, 'follow-up message', 'Follow-up 4', '{"message_field":"followup_4", "message_type":"followup_4"}'::jsonb)
) as steps(step_order, action_type, label, config)
on conflict (template_id, step_order) do update set action_type = excluded.action_type, label = excluded.label, config = excluded.config;
