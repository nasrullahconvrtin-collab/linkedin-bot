# LinkedFlow Chrome Extension Executor

This extension is an MVP executor for the existing LinkedFlow backend queue.
It does not replace campaigns, prospects, templates, queues, or campaign logic.
It is the local execution layer for LinkedIn actions.

## Install During MVP

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select this folder:
   `chrome-extension`
6. Open LinkedIn and log in normally.
7. In LinkedFlow dashboard Settings, generate a Chrome Extension pairing token.
8. Open the extension popup, paste the token, choose a `profile_key`, and connect.

## What It Executes

- `check_messageability`
- `send_connections`
- `send_prepared_message`
- `send_prepared_inmail` best-effort
- `visit_profile` placeholder

The backend remains the source of truth for campaigns, prospects, statuses, queue state, and human review.
