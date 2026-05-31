-- Rich global message template library for LinkedFlow.
-- Safe to run more than once.

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  subject text,
  body text not null default '',
  message_type text not null default 'initial',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.message_templates
  add column if not exists type text,
  add column if not exists category text,
  add column if not exists folder text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists status text not null default 'active',
  add column if not exists sequence jsonb not null default '[]'::jsonb,
  add column if not exists variables text[] not null default '{}',
  add column if not exists custom_fields jsonb not null default '{}'::jsonb,
  add column if not exists usage_count integer not null default 0,
  add column if not exists last_used_at timestamptz,
  add column if not exists created_by text default 'LinkedFlow';

update public.message_templates
set
  type = coalesce(type, message_type, 'initial'),
  status = coalesce(status, case when active then 'active' else 'archived' end)
where type is null or status is null;

create index if not exists idx_message_templates_type on public.message_templates(type);
create index if not exists idx_message_templates_status on public.message_templates(status);
create index if not exists idx_message_templates_category on public.message_templates(category);
create index if not exists idx_message_templates_tags on public.message_templates using gin(tags);

create or replace function public.set_message_templates_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_message_templates_updated_at on public.message_templates;
create trigger trg_message_templates_updated_at
before update on public.message_templates
for each row execute function public.set_message_templates_updated_at();
