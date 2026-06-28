# LinkedFlow — Debugging Handoff

Written: 2026-06-28. For a developer picking this up cold.

## System overview

- **Backend**: FastAPI on Railway — `backend/main.py`, `backend/database.py`. Talks to Supabase via the `supabase-py` REST client.
- **Database**: Supabase (Postgres + PostgREST). URL: `https://yvvvicrosmzcmtmdqurl.supabase.co`. Schema migrations are plain `.sql` files in `backend/*.sql`, applied manually via the Supabase SQL editor (no migration runner).
- **Chrome extension**: `chrome-extension/` — `src/background.js` (service worker: heartbeat, job polling, job execution orchestration) + `src/content-linkedin.js` (injected on linkedin.com, does the actual DOM clicking) + `src/api.js` (HTTP calls to backend) + `src/storage.js` (chrome.storage.local config).
- **Dashboard**: React (Vite) on Vercel — `dashboard/`.
- **No WebSocket** — the extension polls `GET /extension/jobs/pending` every 60s via a `chrome.alarms` tick, claims a job, executes it, reports back via `POST /extension/jobs/{id}/complete|fail`.
- **Two scheduling engines coexist**:
  1. Legacy: daily cron-like jobs in `main.py:_background_scheduler_loop` (`run_connections`, `run_followups`, `check_acceptances`, `run_messages`) for non-flow campaigns.
  2. Visual Flow Builder: campaigns with a `sequence_config.flow_sequence` graph (nodes/edges) — walked by `db_apply_completed_flow_job` / `db_queue_next_flow_step` in `database.py` (~line 2017-2310). Most active campaigns use this one.

## Root causes found and fixed this session (commits on `main`)

1. **`973a89e`** — `tick()` ran heartbeat and job-polling in one try/catch; a heartbeat failure silently skipped job execution for that whole minute. Split into independent `tickHeartbeat()`/`tickJobs()`. Also: the daily-connection-limit check read `profile.daily_sent`, a column never incremented anywhere — always a no-op. Replaced with a live count from `prospects.connection_sent_date`. Added a weekly limit using the same helper (`db_count_connections_sent_since` in `database.py`).
2. **`32fcc39` — the big one.** `db_extension_heartbeat()` built its upsert payload with `"automation_paused": data.get("automation_paused")`, which is `None` whenever the caller omits that field. An explicit `NULL` in a Postgres upsert overrides the column default (default only applies when the key is *absent*), so this violated the `NOT NULL` constraint on `automation_paused` (added by `backend/2026_06_03_chrome_extension_executor.sql`) on every heartbeat that didn't send that field. That exception hit `db_upsert_profile`'s fallback handler (`database.py` ~line 799), which **silently strips every runtime field** (`extension_id`, `extension_status`, `last_extension_heartbeat`, etc.) and retries — so heartbeat calls always returned `200 OK` while saving none of the fields that mattered. This is why the extension looked permanently offline for ~2 weeks despite actually running. Fix: `bool(data.get("automation_paused"))`.
   - Found via Railway deploy logs, searching for `db_upsert_profile: upsert failed`. The fallback handler didn't log the real exception until commit `2e2344d` added that — **if you hit silent data-loss-like symptoms again, check that this kind of swallow-and-fallback pattern isn't hiding something** (`grep -n "except Exception" backend/database.py`).
3. **Missing migration**: `backend/2026_06_03_chrome_extension_executor.sql` (adds `extension_id`, `extension_status`, `last_extension_heartbeat`, `paired_at`, `linkedin_login_status`, `extension_version`, `automation_paused`, `run_mode` to `linkedin_profiles`) had never been run against the live Supabase project. Run manually via SQL editor; if you add more columns expect to do this again — there's no automated migration runner.
4. **Campaign flow-builder UI not persisting `days: 0`**: 6 `wait` nodes in a live campaign's `sequence_config.flow_sequence.nodes[].data.config` had `{}` instead of `{"days": 0}`. The engine (`database.py` ~line 1889) defaults a missing `days` key to `1`, not `0`:
   ```python
   days = config.get("days")
   return timedelta(days=int(days if days is not None else 1))
   ```
   User confirmed intent was 0 days everywhere. Patched directly via `PUT /campaigns/{id}` with `days: 0` written into those nodes. **The actual frontend bug (UI showing 0 but not saving it) was not found/fixed — likely the Sequence Flow Builder treats `0` as falsy and drops the field before saving.** Look in `dashboard/src/components/SequenceFlowBuilder.jsx` for the wait-node save logic, probably something like `days: value || undefined`.
5. **DOM button-detection fragility** (ongoing, see below) — `chrome-extension/src/content-linkedin.js` used exact-text button matching (`clickButtonByText`) everywhere, which breaks whenever LinkedIn's button wording/markup shifts slightly. Fixed three separate instances reactively (Send button wording, Connect-in-"More"-dropdown, Message-in-"More"-dropdown) before refactoring all of it into one utility:
   - `findActionable(labels, {root, exclude})` / `clickActionable(...)` (top of `content-linkedin.js`, ~line 137-178): tries exact text match first, then falls back to substring + `aria-label` match (case-insensitive), optionally scoped to an open dialog/dropdown (`root`) and excluding terms like `"disconnect"`/`"cancel"`.
   - All action functions (`sendConnection`, `sendPreparedMessage`, `sendPreparedInmail`, `detectMessageability`, `followProfile`, `checkReply`) now route through this one utility instead of bespoke per-call-site logic.
   - Failure messages now include the actual visible button text LinkedIn rendered (e.g. `"Connect button not found. Header buttons: [More, Follow, ...]"`) so the next failure is diagnosable from `jobs.error_message` in Supabase without needing to reproduce it live.

## UNRESOLVED — the active blocker

One real prospect (`f493884c-dde7-48db-8500-a4e1174ad45a`, `https://www.linkedin.com/in/fatima-maqsood-a4830b3a9/`, campaign `48895d46-4d42-40e0-91d8-39b337a81a25`) has failed `send_connections` **5 times** (each retried 3x with backoff) with `"Connect button not found"`.

**Diagnostic data captured from the live failure** (visible buttons on the profile page): `[More, Why am I seeing this ad?, Hide or report this ad, Report this ad, Submit, Follow]`.

Key findings:
- **No "Connect" or "Message" button anywhere** — only "More" and "Follow". This is a known LinkedIn pattern: an account that's sent too many invites recently (or hit a soft limit) gets its direct "Connect" button hidden, with "Connect" only available inside the "More" dropdown (or sometimes not at all if rate-limited).
- The button list also contains ad-related text (`"Why am I seeing this ad?"`), which suggests `profileHeaderButtons()` (`content-linkedin.js` ~line 205) — which falls back to scoping on `main` when `.pv-top-card`/`.ph5` don't match — may be matching a broader page region than just the profile's top card. **Worth checking whether `.pv-top-card`/`.ph5` are even valid selectors on LinkedIn's current profile layout**, or whether this account is seeing a different page (e.g. is the automation tab definitely on the profile page and not redirected somewhere, like a checkpoint or an ad-injected feed view?).
- **Data mismatch**: the user states this prospect is "already connected," but the live page shows neither "Message" nor a "1st" badge — meaning either (a) the wrong LinkedIn account is paired to this campaign's profile, (b) the prospect record's status doesn't reflect LinkedIn's actual current state, or (c) this is a Follow-only profile that was never actually connected despite being marked so in the data. **Not yet resolved — needs investigation with eyes on the actual page**, which I (Claude) cannot do since I can't see the browser.
- The just-pushed `clickActionable` refactor (commit `fdb7efb`) broadens the Connect-in-More-dropdown detection beyond exact text match. **Not yet verified against this specific failure** — the extension needs to be reloaded (`chrome://extensions` → reload LinkedFlow Executor) and the job needs to retry again to know if it's actually fixed or if there's truly no Connect option available on this profile at all (rate-limited account).

### How to investigate further
1. Reload the extension, wait for the next retry (check `GET /jobs?status=retrying` or `?status=failed` on the Railway backend, filter by `prospect_id`).
2. If it still fails with the same buttons listed, the problem isn't button-matching — it's that LinkedIn genuinely isn't offering a Connect action on this profile (rate limit / already sent / blocked). Manually visit `https://www.linkedin.com/in/fatima-maqsood-a4830b3a9/` in the browser logged in as the automated account and see what's actually there.
3. Check `linkedin_profiles.daily_sent` / actual invite-sending history for this account — LinkedIn imposes weekly invite caps independent of what this codebase tracks; if the account is near LinkedIn's own cap, Connect buttons disappear platform-side.

## Architecture risk worth knowing

The entire outreach-sending mechanism is **DOM scraping a third-party website that doesn't want to be automated**. Every fix above is reactive — LinkedIn can and does change button markup/wording without notice, and there is no upstream signal when it happens; you only find out when a job fails. This was discussed with the user as a tradeoff against:
- **Unipile** (or similar LinkedIn automation APIs): more stable (official-ish API instead of clicking), but (a) costs money, (b) authenticates from the vendor's own servers — if those aren't in/near Pakistan (user's location) and don't match the account's usual login region, LinkedIn's anomaly detection can flag/restrict the account, and (c) needs a real architecture change (retire the Chrome extension's DOM-automation role, replace job execution with API calls).
- User chose to keep hardening the current DOM approach for now (see the `clickActionable` refactor above) rather than migrate.

## Where things are NOT verified end-to-end yet
- No real campaign has completed a full cycle (initial message → 4 followups) since these fixes landed. The 0-day delay fix means once a message actually sends, the rest of the sequence should fire same-day — but this is **untested in practice**.
- The desktop-notification and dashboard-alert-banner features (commit `8c7a519`) are new and not yet seen firing for a real failure end-to-end (should have fired for the failures above — worth confirming they actually appeared).

## Access/credentials a new developer will need
- GitHub repo: `github.com/nasrullahconvrtin-collab/linkedin-bot` (already has push access presumably)
- Railway: backend service (`linkedin-bot-backend-production.up.railway.app`), auto-deploys via `.github/workflows/deploy.yml` on push to `main` (needs `RAILWAY_TOKEN` repo secret, already configured)
- Supabase project (`yvvvicrosmzcmtmdqurl.supabase.co`) — SQL editor access for any future schema changes (no migration runner, must run `.sql` files manually)
- The Chrome extension only runs locally on the user's machine, loaded unpacked from `chrome-extension/` — **does not auto-update**, must be manually reloaded at `chrome://extensions` after every code change
