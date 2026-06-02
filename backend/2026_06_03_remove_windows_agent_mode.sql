-- Remove Windows Agent as an active execution mode.
-- Chrome Extension is now the default local executor. Cloud Agent remains a future placeholder.

alter table public.linkedin_profiles
  alter column run_mode set default 'chrome_extension';

update public.linkedin_profiles
set
  run_mode = 'chrome_extension',
  runtime_mode = 'chrome_extension'
where coalesce(run_mode, '') in ('', 'windows_agent')
   or coalesce(runtime_mode, '') in ('', 'local', 'windows_agent');
