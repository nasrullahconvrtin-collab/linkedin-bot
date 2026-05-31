# LinkedFlow Master Product Gap Analysis

Date: 2026-06-01

Source of truth: https://github.com/nasrullahconvrtin-collab/linkedin-bot.git

This analysis classifies the current implementation against the master product, UX, campaign, agent, and architecture requirements before new feature implementation.

## Summary

LinkedFlow already has the core single-user architecture in place: Supabase-backed campaigns/prospects/jobs/profiles, a job queue, campaign templates, profile-specific connection state, a local agent, a desktop control panel foundation, a dashboard, message templates, and a rich message editor.

The biggest remaining gaps are product polish and workflow depth: premium visual system consistency, full queue/ready queue navigation, deeper campaign editing, more mature prospect list actions, fully synchronized desktop-agent settings, and a more complete sequence-template builder.

## Requirement Status

| Area | Status | Gap | Implementation Plan | Complexity |
|---|---|---|---|---|
| GitHub source of truth | DONE | Repo is active and current on `main`. | Continue branch/commit/push workflow. | Low |
| Do not use retired `D:\linkedin-bot` | DONE | Current work is in GitHub checkout, not retired path. | Keep retired path out of docs/scripts where practical. | Low |
| Railway/Vercel deployment workflow | DONE | Existing deploy commands work. | Continue deploy after completed feature sets. | Low |
| Dark mode first | PARTIALLY DONE | Dark mode exists and is good, but not fully premium across all pages. | Normalize cards, surfaces, typography, spacing, table density, empty states. | Medium |
| Light mode support | PARTIALLY DONE | Light mode exists, but some hard-coded dark utility classes remain. | Replace hard-coded colors with theme tokens in high-traffic pages. | Medium |
| Typography system | PARTIALLY DONE | Inter is used; Plus Jakarta Sans is not consistently implemented for headings. | Add font import and heading utility styles, update layout/page headings. | Low |
| Premium SaaS visual feel | PARTIALLY DONE | UI is functional but still has dashboard-template areas. | Redesign Dashboard, Campaigns, Prospects, Profiles with cleaner hierarchy. | High |
| Sidebar structure | PARTIALLY DONE | Sidebar is collapsible and Campaigns has Message Templates nested, but Queue is not a main route and Ready Queue is not separate. | Add Queue route and Ready Queue route or Campaigns submenu entries. | Medium |
| Campaign Wizard not in sidebar | DONE | Wizard redirects to Campaigns and opens from Start Campaign. | Keep as overlay-only. | Low |
| Dashboard command center | PARTIALLY DONE | Overview cards, profile stats, agent status, ready count, activity exist. | Add stronger per-profile table, ready queue preview, current/last job detail. | Medium |
| Per-profile stats | PARTIALLY DONE | Profiles are enriched with jobs, daily usage, heartbeat fields. | Add all requested counters per profile on Dashboard: accepted today, ready queue, current job, last job. | Medium |
| Agent status local/cloud | PARTIALLY DONE | Runtime mode placeholders exist. | Surface Local/Cloud consistently on Dashboard and Profiles. | Low |
| Ready For Message Queue | PARTIALLY DONE | Backend endpoint exists and dashboard count exists. | Add dedicated operational queue page/card with prospect actions. | Medium |
| Campaign management hub | PARTIALLY DONE | Campaigns page has tabs for list/templates/queue/ready and cards. | Improve as central hub, add search/filter polish, list/table option. | Medium |
| Campaign statuses | DONE | Draft, running, paused, archived are supported. | Keep consistent badges. | Low |
| Campaign cards | PARTIALLY DONE | Cards show name/status/profile/basic stats/progress. | Add last activity and richer profile/status treatment. | Low |
| Campaign three-dot menu | PARTIALLY DONE | Campaign actions exist in parts. | Ensure every card/row has Edit/Duplicate/Pause/Resume/Archive/Delete/View Queue. | Medium |
| Campaign details step 1 | PARTIALLY DONE | Wizard supports name/profile/prospects/messages/review. | Add explicit schedule/limits step in Wizard. | Medium |
| One campaign = one profile | DONE | `profile_key` exists and campaign execution uses it. | Keep enforced in create/edit. | Low |
| Supported campaign templates | DONE | Current/future templates seeded and represented. | Keep future templates disabled/coming soon. | Low |
| Future templates coming soon | DONE | Future campaign templates exist as coming soon/disabled. | Keep engine data-driven. | Low |
| Already-connected logic | DONE | Backend queues message after already-connected/accepted detection. | Add more regression tests when Python environment is available. | Medium |
| Message-only campaigns | PARTIALLY DONE | Template exists and sequence engine supports connected state. | Add stronger UI constraints to select only connected prospects. | Medium |
| Campaign editing | PARTIALLY DONE | Name/profile/JSON/sequence message/delay editing exists. | Replace JSON editing with premium sequence editor and safe step editing. | High |
| Prevent duplicate jobs/messages | PARTIALLY DONE | Queue helpers attempt idempotency. | Add explicit unique constraints and UI warnings for running campaign edits. | Medium |
| Future sequence builder | NOT DONE | Add/reorder/delete steps are not a real visual builder. | Build visual sequence builder with action registry. | High |
| Prospects Waalaxy-style layout | PARTIALLY DONE | Prospects/lists page exists with left panel and tables. | Improve UX, filters, bulk action toolbar, list actions. | High |
| Prospect lists | PARTIALLY DONE | CRUD/membership endpoints exist. | Add full import/export and move/copy selected prospects UX polish. | Medium |
| Prospect filters | PARTIALLY DONE | Basic filters exist. | Add tags/email/state/profile/custom field advanced filters. | Medium |
| Prospect import modes | DONE | Create/update/update-only behavior exists through bulk import. | Keep testing against duplicates. | Low |
| Dedup by LinkedIn URL/email | DONE | Backend supports dedup priority. | Continue using membership/enrollment records. | Low |
| Single prospect actions | PARTIALLY DONE | Edit/delete/add/remove campaign/list exists in parts. | Consolidate actions menu in table and detail view. | Medium |
| Prospect detail | PARTIALLY DONE | Detail panel shows fields, campaigns/lists/activity. | Add richer custom-field/tag editing and connection profile states. | Medium |
| Multi-list support | DONE | Membership tables are implemented. | Keep UI from duplicating records. | Low |
| Personalization after acceptance | PARTIALLY DONE | Needs Personalization and Ready For Message exist. | Add stronger operational workflow for generating/editing first message after acceptance. | Medium |
| Message editor | PARTIALLY DONE | Rich modal exists with preview/checker/variables. | Improve spacing further through browser QA and add sequence-step editing inside one modal. | Medium |
| Variables | DONE | Standard, sender, campaign, custom variables supported in UI utilities. | Add backend render endpoint later if needed. | Low |
| Custom field mapping | PARTIALLY DONE | Mapping panel exists in Campaign Wizard import. | Add same mapping UX in all import locations. | Medium |
| Message preview | DONE | Raw/rendered/missing variable preview exists. | Improve prospect switching and data samples. | Low |
| Message quality checker | DONE | Basic checker exists. | Tune scoring and add severity levels later. | Low |
| Message template library | PARTIALLY DONE | Library exists with create/edit/duplicate/delete/archive/search/tags/category. | Add folders UI, usage count, last used, created by display. | Medium |
| Sequence templates | PARTIALLY DONE | Sequence starters exist and Wizard can apply saved sequence templates. | Build dedicated multi-step sequence editor, not body-only representation. | High |
| Template inheritance | PARTIALLY DONE | Campaign copies messages into `sequence_config`. | Add explicit re-apply updated template action. | Medium |
| Profiles page | PARTIALLY DONE | Edit/delete/enable/disable/status/runtime mode exist. | Add linked campaigns/jobs detail panels. | Medium |
| Multi-profile support | PARTIALLY DONE | Profile-specific connection state exists. | Add more UI visibility and validation for profile-specific connection state. | Medium |
| Agent-dashboard sync | PARTIALLY DONE | Heartbeat/profile updates sync to backend. | Agent should refetch profile metadata/settings more visibly and frequently. | Medium |
| Desktop agent UI | PARTIALLY DONE | Control panel/tray foundation exists. | Improve UI parity with dashboard: accounts, jobs, logs, runtime options. | High |
| Future cloud architecture placeholders | PARTIALLY DONE | Runtime mode/cloud/proxy placeholders exist. | Normalize profile run mode across backend, dashboard, and agent UI. | Medium |

## Recommended Implementation Order

1. Premium UI system pass: typography, page shells, sidebar, cards, tables, light/dark token cleanup.
2. Campaigns hub pass: Queue and Ready Queue as clear navigation, richer campaign cards/actions.
3. Message/template pass: true sequence-template editor with per-step body/delay cards.
4. Prospect management pass: advanced filters, bulk action toolbar, list import/export polish.
5. Profile/agent sync pass: dashboard profile details and desktop control panel parity.
6. Regression/test pass: campaign progression, already-connected flow, message-only campaign eligibility, duplicate job protection.

## Immediate Risks

- Some UI is still hard-coded to dark colors, so light mode is incomplete in places.
- Sequence templates are stored and applied, but the editor is not yet a full multi-step builder.
- Python/backend tests cannot be run in the current Codex environment because Python is unavailable here.
- Live deployment is working, but larger UI changes should be browser-tested after each pass.
