-- Seed steps for "InMail + 5 Follow-Ups" template
alter table public.prospects
  add column if not exists followup_5 text null;

with t as (select id from public.campaign_templates where key = 'inmail_5_followups')
insert into public.campaign_template_steps (template_id, step_order, action_type, label, config)
select t.id, s.step_order, s.action_type, s.label, s.config::jsonb
from t,
(values
  (1,  'check_messageability',  'Check messageability',   '{"fallback":"invitation"}'),
  (2,  'wait',                  'Wait for InMail review', '{"days":0,"until":"inmail_ready"}'),
  (3,  'send_prepared_inmail',  'Send InMail',            '{"message_field":"inmail_message","subject_field":"inmail_subject","message_type":"inmail"}'),
  (4,  'wait',                  'Wait 5 working days',    '{"working_days":5}'),
  (5,  'send_prepared_message', 'Follow-up 1',            '{"message_field":"followup_1","message_type":"followup_1"}'),
  (6,  'wait',                  'Wait 5 working days',    '{"working_days":5}'),
  (7,  'send_prepared_message', 'Follow-up 2',            '{"message_field":"followup_2","message_type":"followup_2"}'),
  (8,  'wait',                  'Wait 5 working days',    '{"working_days":5}'),
  (9,  'send_prepared_message', 'Follow-up 3',            '{"message_field":"followup_3","message_type":"followup_3"}'),
  (10, 'wait',                  'Wait 5 working days',    '{"working_days":5}'),
  (11, 'send_prepared_message', 'Follow-up 4',            '{"message_field":"followup_4","message_type":"followup_4"}'),
  (12, 'wait',                  'Wait 5 working days',    '{"working_days":5}'),
  (13, 'send_prepared_message', 'Follow-up 5',            '{"message_field":"followup_5","message_type":"followup_5"}')
) as s(step_order, action_type, label, config)
on conflict (template_id, step_order) do update
  set action_type = excluded.action_type, label = excluded.label,
      config = excluded.config, is_enabled = true;
