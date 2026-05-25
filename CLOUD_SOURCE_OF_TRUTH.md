# LinkedFlow Cloud Source of Truth

LinkedFlow is now structured so business data lives in Supabase through the FastAPI backend. The desktop agent is only the local LinkedIn execution runtime.

## Cloud-hosted data

Supabase is the source of truth for:

- campaigns
- prospects
- jobs and retry state
- prospect statuses
- personalization workflow
- prospect message fields and message templates
- schedules
- analytics and activity logs
- queue state

The dashboard reads and writes these through the backend API. It continues to show campaigns, prospects, jobs, and analytics even when the local agent is offline.

## Local-only data

The local Windows agent stores only machine/runtime data:

- isolated Playwright browser profiles
- LinkedIn cookies/session inside those browser profiles
- local agent config, such as backend URL and selected profile key
- temporary state for tray status
- local logs
- optional browser/config backups

Default local path:

```text
%LOCALAPPDATA%\LinkedFlowAgent\
```

No prospect CSV is required for normal operation.

## Laptop replacement/reformat flow

If the laptop is replaced or reformatted:

1. Install LinkedFlow Agent.
2. Launch the agent.
3. Log into LinkedIn once inside the isolated agent browser.
4. The backend automatically still has campaigns, prospects, jobs, schedules, statuses, analytics, and personalization data.

## Backup and restore

From the tray menu:

- `Backup Browser Profile` exports the active LinkedIn browser profile to:
  `%LOCALAPPDATA%\LinkedFlowAgent\backups\`
- `Export Agent Config` exports local config to the same backups folder.
- `Open Backups` opens the backup folder.

CLI restore is available for recovery:

```powershell
LinkedFlowAgent.exe --restore-browser-backup "path\to\profile_1-browser-profile.zip" --profile profile_1
```

## What remains laptop-dependent

- LinkedIn login/session, because cookies stay local by design.
- Browser execution, because LinkedIn automation runs locally.
- The agent must be online eventually to claim and execute pending jobs.

The backend can create jobs while the laptop is offline; the agent claims them when it reconnects.
