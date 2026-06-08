-- Adds graph-walking state to campaign_enrollments so campaigns built with the
-- Visual Flow Builder (sequence_config.flow_sequence = { nodes, edges }) can be
-- executed step-by-step by the job engine, the same way template-based
-- campaigns are driven by current_step_order.

alter table public.campaign_enrollments
  add column if not exists current_node_id text null,
  add column if not exists flow_state jsonb null default '{}'::jsonb;

-- Defensive: the jobs.job_type check constraint was already dropped in
-- 2026_05_30_campaign_templates.sql / 2026_06_01_inmail_messageability_workflow.sql
-- so new flow job types (visit_profile, follow_profile, endorse_profile,
-- check_reply, check_connection_status, send_inmail) can be inserted. Re-drop
-- here in case it was ever recreated, so this migration is safe to run standalone.
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'jobs'
      and constraint_name = 'jobs_job_type_check'
  ) then
    alter table public.jobs drop constraint jobs_job_type_check;
  end if;
end $$;

create index if not exists idx_campaign_enrollments_current_node
  on public.campaign_enrollments(campaign_id, current_node_id);

comment on column public.campaign_enrollments.current_node_id is
  'Node id (from sequence_config.flow_sequence.nodes) the prospect is currently positioned at, for flow-based campaigns.';
comment on column public.campaign_enrollments.flow_state is
  'Free-form per-prospect bookkeeping for flow execution, e.g. {"wait_reply_checks": 2, "last_status": "still_not_accepted"}.';
