-- InMail-first, invitation-fallback workflow.
-- Safe to run more than once.

alter table public.prospects
  add column if not exists messageability_status text,
  add column if not exists inmail_status text,
  add column if not exists inmail_sent_at timestamptz,
  add column if not exists inmail_error text,
  add column if not exists last_messageability_checked_at timestamptz,
  add column if not exists ready_to_send boolean not null default false,
  add column if not exists personalization_status text,
  add column if not exists followup_ready_at timestamptz,
  add column if not exists invitation_sent_at timestamptz;

create index if not exists idx_prospects_messageability_status on public.prospects(messageability_status);
create index if not exists idx_prospects_inmail_status on public.prospects(inmail_status);
create index if not exists idx_prospects_ready_to_send on public.prospects(ready_to_send);

-- If an old job type check exists, remove it so the data-driven engine can add new action names.
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'jobs'
      and constraint_name = 'jobs_job_type_check'
  ) then
    alter table public.jobs drop constraint jobs_job_type_check;
  end if;
end $$;

insert into public.campaign_templates (key, name, description, category, status, supported_actions, variables, default_config)
values
  ('inmail_1_followup', 'InMail + 1 Follow-Up', 'Human-reviewed InMail with one follow-up after approval.', 'linkedin', 'active',
   array['check_messageability','move_to_inmail_ready','send_prepared_inmail','wait','send_prepared_message'],
   array['first_name','company','title','sender_name'], '{"requires_human_review":true}'::jsonb),
  ('inmail_2_followups', 'InMail + 2 Follow-Ups', 'Human-reviewed InMail with two approved follow-ups.', 'linkedin', 'active',
   array['check_messageability','move_to_inmail_ready','send_prepared_inmail','wait','send_prepared_message'],
   array['first_name','company','title','sender_name'], '{"requires_human_review":true}'::jsonb),
  ('inmail_3_followups', 'InMail + 3 Follow-Ups', 'Human-reviewed InMail with three approved follow-ups.', 'linkedin', 'active',
   array['check_messageability','move_to_inmail_ready','send_prepared_inmail','wait','send_prepared_message'],
   array['first_name','company','title','sender_name'], '{"requires_human_review":true}'::jsonb),
  ('inmail_5_followups', 'InMail + 5 Follow-Ups', 'Human-reviewed InMail with five approved follow-ups.', 'linkedin', 'active',
   array['check_messageability','move_to_inmail_ready','send_prepared_inmail','wait','send_prepared_message'],
   array['first_name','company','title','sender_name'], '{"requires_human_review":true}'::jsonb),
  ('inmail_first_invitation_fallback_5', 'InMail First + Invitation Fallback + 5 Follow-Ups',
   'Check messageability first. If InMail exists, move to InMail Ready. If connected, move to Message Ready. Otherwise send invitation and wait for acceptance.',
   'linkedin', 'active',
   array['check_messageability','detect_inmail','move_to_inmail_ready','move_to_message_ready','send_invitation','wait_for_acceptance','send_prepared_inmail','send_prepared_message'],
   array['first_name','company','title','sender_name'], '{"requires_human_review":true,"fallback":"invitation"}'::jsonb)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  supported_actions = excluded.supported_actions,
  variables = excluded.variables,
  default_config = excluded.default_config,
  updated_at = now();
