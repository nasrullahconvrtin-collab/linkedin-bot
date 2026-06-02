-- Ensure all active campaign templates have their sequence steps populated.
-- Safe to run multiple times (ON CONFLICT DO UPDATE).

-- ── Invitation + 2 Messages ───────────────────────────────────────────────────
with t as (select id from public.campaign_templates where key = 'invitation_message_2_followups')
insert into public.campaign_template_steps (template_id, step_order, action_type, label, config)
select t.id, s.step_order, s.action_type, s.label, s.config::jsonb
from t,
(values
  (1, 'invitation',        'Send invitation',       '{"note_field":"inmail_message"}'),
  (2, 'wait',              'Wait for acceptance',   '{"days":2, "until":"connected"}'),
  (3, 'message',           'Initial message',       '{"message_field":"initial_message","message_type":"initial"}'),
  (4, 'wait',              'Wait 3 days',           '{"days":3}'),
  (5, 'follow-up message', 'Follow-up 1',           '{"message_field":"followup_1","message_type":"followup_1"}'),
  (6, 'wait',              'Wait 5 working days',   '{"working_days":5}'),
  (7, 'follow-up message', 'Follow-up 2',           '{"message_field":"followup_2","message_type":"followup_2"}'),
  (8, 'wait',              'Wait 5 working days',   '{"working_days":5}'),
  (9, 'follow-up message', 'Follow-up 3',           '{"message_field":"followup_3","message_type":"followup_3"}'),
  (10,'wait',              'Wait 5 working days',   '{"working_days":5}'),
  (11,'follow-up message', 'Follow-up 4',           '{"message_field":"followup_4","message_type":"followup_4"}')
) as s(step_order, action_type, label, config)
on conflict (template_id, step_order) do update
  set action_type = excluded.action_type,
      label       = excluded.label,
      config      = excluded.config,
      is_enabled  = true;

-- ── Message Only ──────────────────────────────────────────────────────────────
with t as (select id from public.campaign_templates where key = 'message_only')
insert into public.campaign_template_steps (template_id, step_order, action_type, label, config)
select t.id, s.step_order, s.action_type, s.label, s.config::jsonb
from t,
(values
  (1, 'message',           'Initial message',       '{"message_field":"initial_message","message_type":"initial"}'),
  (2, 'wait',              'Wait 3 days',           '{"days":3}'),
  (3, 'follow-up message', 'Follow-up 1',           '{"message_field":"followup_1","message_type":"followup_1"}'),
  (4, 'wait',              'Wait 5 working days',   '{"working_days":5}'),
  (5, 'follow-up message', 'Follow-up 2',           '{"message_field":"followup_2","message_type":"followup_2"}')
) as s(step_order, action_type, label, config)
on conflict (template_id, step_order) do update
  set action_type = excluded.action_type,
      label       = excluded.label,
      config      = excluded.config,
      is_enabled  = true;

-- ── Invitation Only ───────────────────────────────────────────────────────────
with t as (select id from public.campaign_templates where key = 'invitation_only')
insert into public.campaign_template_steps (template_id, step_order, action_type, label, config)
select t.id, s.step_order, s.action_type, s.label, s.config::jsonb
from t,
(values
  (1, 'invitation', 'Send invitation', '{"note_field":"inmail_message"}')
) as s(step_order, action_type, label, config)
on conflict (template_id, step_order) do update
  set action_type = excluded.action_type,
      label       = excluded.label,
      config      = excluded.config,
      is_enabled  = true;

-- ── InMail + 1 Follow-Up ─────────────────────────────────────────────────────
insert into public.campaign_templates
  (key, name, description, category, status, supported_actions, variables, default_config)
values (
  'inmail_1_followup',
  'InMail + 1 Follow-Up',
  'Send an InMail to prospects who are not connected, then follow up once.',
  'linkedin',
  'active',
  array['inmail','wait','follow-up message'],
  array['first_name','last_name','company','title','industry','location'],
  '{"requires_open_profile":true}'::jsonb
)
on conflict (key) do update
  set name = excluded.name, description = excluded.description,
      status = excluded.status, supported_actions = excluded.supported_actions,
      updated_at = now();

with t as (select id from public.campaign_templates where key = 'inmail_1_followup')
insert into public.campaign_template_steps (template_id, step_order, action_type, label, config)
select t.id, s.step_order, s.action_type, s.label, s.config::jsonb
from t,
(values
  (1, 'invitation',        'Send InMail',         '{"note_field":"inmail_message","inmail_subject_field":"inmail_subject","message_type":"inmail"}'),
  (2, 'wait',              'Wait 5 working days', '{"working_days":5}'),
  (3, 'follow-up message', 'Follow-up 1',         '{"message_field":"followup_1","message_type":"followup_1"}')
) as s(step_order, action_type, label, config)
on conflict (template_id, step_order) do update
  set action_type = excluded.action_type, label = excluded.label,
      config = excluded.config, is_enabled = true;
