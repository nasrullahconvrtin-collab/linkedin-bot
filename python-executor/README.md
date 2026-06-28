# LinkedFlow Python Executor

A simpler, more reliable replacement for the Chrome extension. Each team
member runs their own copy of this script on their own computer, logged
into their own LinkedIn account. It talks to the same backend/database
everything else uses — no backend changes needed.

Why this instead of the Chrome extension: it uses
[Playwright](https://playwright.dev), the standard tool for browser
automation, instead of hand-written button-clicking code. Playwright knows
how to find buttons reliably even when LinkedIn slightly changes its page
layout — the extension kept breaking on exactly that.

## One-time setup (per computer)

### 1. Install Python

- Go to [python.org/downloads](https://www.python.org/downloads/)
- Download and run the installer for your OS
- **Windows**: on the first installer screen, check the box **"Add Python to PATH"** before clicking Install
- To confirm it worked, open a terminal (Command Prompt / PowerShell / Terminal) and run:
  ```
  python --version
  ```
  You should see something like `Python 3.12.x`. If you get an error, restart your terminal/computer and try again.

### 2. Get this folder onto your computer

If you already have the `linkedin-bot` repo cloned, you already have this folder (`python-executor/`). Otherwise, ask whoever manages the GitHub repo for access and run:
```
git clone https://github.com/nasrullahconvrtin-collab/linkedin-bot.git
```

### 3. Open a terminal in this folder

```
cd linkedin-bot/python-executor
```

### 4. Install the Python packages this script needs

```
pip install -r requirements.txt
```

### 5. Install Playwright's browser

Playwright needs its own copy of Chrome (separate from your regular Chrome):
```
playwright install chromium
```
This downloads ~150MB, may take a minute.

### 6. Set up your config file

Copy the example config:
```
copy .env.example .env
```
(On Mac/Linux: `cp .env.example .env`)

Open `.env` in any text editor and fill in:
```
BACKEND_URL=https://linkedin-bot-backend-production.up.railway.app
PROFILE_KEY=your_name_here
POLL_INTERVAL_SECONDS=60
```
`PROFILE_KEY` just needs to be unique per team member — e.g. `ali`, `fatima_account2`. Pick anything, lowercase, no spaces. **Each team member must use a different value here.**

### Optional: AI fallback for when LinkedIn changes a button

`find_button()` looks for buttons by their known text (e.g. "Connect", "Send"). When LinkedIn changes that wording, it fails — which is the most common reason a job error shows up.

If you add an `ANTHROPIC_API_KEY` to `.env` (get one free to start at [console.anthropic.com](https://console.anthropic.com)), the script will fall back to asking an AI vision model to look at a screenshot and find the right button by *what it does*, not its exact wording. This only runs when the fast method fails, so it costs roughly $1-5/month total even across several profiles, not per-action.

Every time it's used, it's logged to `ai_fallback_log.jsonl` (timestamp, what it was looking for, whether it succeeded) — useful for spotting recurring LinkedIn changes and hardening `find_button()`'s label lists permanently instead of relying on the AI call every time.

Leave `ANTHROPIC_API_KEY` blank to skip this entirely — the script still works exactly as before, it just won't self-recover from a UI change (you'd need someone to update the code).

## Running it

```
python executor.py
```

A real Chrome window will open.

- **First time**: it'll be on the LinkedIn feed, logged out. Log into LinkedIn manually in that window (handle any 2FA/captcha as normal). Once logged in, leave the window open — the script keeps using it.
- **After that**: your login is saved in the `browser-profile/` folder next to this script. You won't need to log in again unless LinkedIn logs you out.

Leave the terminal and the browser window open and running. The script:
1. Sends a heartbeat to the dashboard every `POLL_INTERVAL_SECONDS` (default 60s) so your status shows "online"
2. Checks for any pending job (send a connection request, send a message, etc.)
3. Runs it, reports the result back
4. Waits a randomized few minutes between connection requests / messages (to look human, not spam-like)
5. Repeats forever

To stop it: close the terminal window, or press `Ctrl+C`.

## Checking it's working

Open the dashboard — your `PROFILE_KEY` should show up as a profile with status "online" once the script has run for ~60 seconds.

## If something breaks

- **Terminal shows an error and stops**: read the error message, it's usually self-explanatory (e.g. missing `.env` value). Re-run `python executor.py`.
- **"Account restricted by LinkedIn" message**: the script stops itself on purpose. This means LinkedIn flagged something — don't restart it blindly, go check the account manually in a normal browser first.
- **A job keeps failing with "button not found"**: LinkedIn changed something on their page. Tell whoever maintains this code — the fix usually lives in `executor.py`'s action functions (`send_connection`, `send_prepared_message`, etc.), specifically the `find_button(...)` calls.
- **Browser window closed by accident**: just re-run `python executor.py`, it'll reopen with your saved login.

## What this does NOT do (compared to the old Chrome extension)

- It only runs while your computer is on and the script is running — no cloud/always-on execution. If you need that, you'd run this on a server you leave running (same browser-flagging tradeoffs as discussed for Unipile apply if that server isn't in your usual login region).
- One browser profile per script — running multiple LinkedIn accounts means running multiple copies of this folder (each with its own `.env` and `browser-profile/`), not one script juggling several.
