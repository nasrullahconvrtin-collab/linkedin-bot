# LinkedFlow Cloud Source of Truth

LinkedFlow is now structured so business data lives in Supabase through the FastAPI backend. The Chrome Extension is the local LinkedIn execution runtime.

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

The dashboard reads and writes these through the backend API. It continues to show campaigns, prospects, jobs, and analytics even when the Chrome Extension is offline.

## Local-only data

The local Chrome Extension stores only machine/runtime data:

- Chrome extension pairing state
- selected `profile_key`
- LinkedIn cookies/session inside the user's Chrome profile
- temporary extension state such as last sync/current job

No prospect CSV is required for normal operation.

## Laptop replacement/reformat flow

If the laptop is replaced or reformatted:

1. Install/load the LinkedFlow Chrome Extension.
2. Log into LinkedIn in Chrome.
3. Pair the extension from dashboard Settings.
4. The backend automatically still has campaigns, prospects, jobs, schedules, statuses, analytics, and personalization data.

## What remains laptop-dependent

- LinkedIn login/session, because cookies stay local by design.
- Browser execution, because LinkedIn automation runs in Chrome.
- The Chrome Extension must be online eventually to claim and execute pending jobs.

The backend can create jobs while the laptop is offline; the extension claims them when Chrome reconnects.
