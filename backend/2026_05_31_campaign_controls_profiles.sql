-- LinkedFlow campaign controls and profile ownership
-- Adds one-profile-per-campaign support and keeps campaign membership reusable.

alter table public.campaigns
  add column if not exists profile_key text not null default 'profile_1';

create index if not exists idx_campaigns_profile_status
  on public.campaigns(profile_key, status);

update public.campaigns c
set profile_key = coalesce(
  c.profile_key,
  (c.settings ->> 'profile_key'),
  (
    select ce.profile_key
    from public.campaign_enrollments ce
    where ce.campaign_id = c.id
      and ce.profile_key is not null
    order by ce.created_at asc
    limit 1
  ),
  'profile_1'
);

update public.campaign_enrollments ce
set profile_key = c.profile_key,
    messaging_profile = c.profile_key,
    updated_at = now()
from public.campaigns c
where ce.campaign_id = c.id
  and (ce.profile_key is null or ce.profile_key <> c.profile_key);

update public.prospects p
set assigned_account = c.profile_key
from public.campaigns c
where p.campaign_id = c.id
  and c.profile_key is not null
  and (p.assigned_account is null or p.assigned_account = '');
