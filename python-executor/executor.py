"""
LinkedFlow Python executor - replaces the Chrome extension's job execution.

Talks to the exact same backend endpoints the Chrome extension uses
(/extension/heartbeat, /extension/jobs/pending, /claim, /start, /complete,
/fail), so no backend changes are needed. Run one copy of this per LinkedIn
account, on that account's owner's own machine (keeps the same IP/region
LinkedIn already trusts for that account).

First run: a real Chrome window opens so you can log into LinkedIn manually
(handles 2FA/captcha naturally). The session is saved to ./browser-profile/
and reused on every subsequent run - you only log in once.

Usage:
    python executor.py
"""
from __future__ import annotations

import base64
import json
import logging
import os
import random
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright

load_dotenv()

BACKEND_URL = os.environ["BACKEND_URL"].rstrip("/")
PROFILE_KEY = os.environ["PROFILE_KEY"]
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "60"))
EXTENSION_ID = f"py_{PROFILE_KEY}"
EXTENSION_VERSION = "1.0.0-python"
BROWSER_PROFILE_DIR = Path(__file__).parent / "browser-profile"

# AI vision fallback - only called when the fast hardcoded button matching
# (find_button) fails, e.g. LinkedIn changed a button's wording/layout. See
# ai_locate_click() below. Optional: leave ANTHROPIC_API_KEY unset to disable
# this entirely and just fail like before.
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
AI_FALLBACK_LOG = Path(__file__).parent / "ai_fallback_log.jsonl"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("linkedflow_executor")

CONNECTION_JOB_TYPES = {"send_connections", "check_messageability"}
MESSAGE_JOB_TYPES = {"send_messages", "send_followups", "send_prepared_message", "send_prepared_inmail", "send_inmail"}
FAIL_STATUSES = {"error", "failed_with_reason", "session_expired", "restricted", "limit_reached", "cannot_connect", "not_found"}


# ── Backend API (mirrors chrome-extension/src/api.js) ──────────────────────

def _request(method: str, path: str, **kwargs) -> dict:
    res = requests.request(method, f"{BACKEND_URL}{path}", timeout=30, **kwargs)
    res.raise_for_status()
    return res.json()


def heartbeat(state: dict) -> dict:
    return _request("POST", "/extension/heartbeat", json={
        "profile_key": PROFILE_KEY,
        "extension_id": EXTENSION_ID,
        "display_name": state.get("display_name") or PROFILE_KEY,
        "current_url": state.get("current_url"),
        "session_active": state.get("login_status") == "logged_in",
        "linkedin_login_status": state.get("login_status", "unknown"),
        "extension_status": "online",
        "extension_version": EXTENSION_VERSION,
        "automation_paused": False,
    })


def pending_jobs(limit: int = 5) -> list[dict]:
    data = _request("GET", "/extension/jobs/pending", params={"profile_key": PROFILE_KEY, "limit": limit})
    return data.get("jobs", [])


def claim_job(job_id: str) -> dict | None:
    try:
        return _request("POST", f"/extension/jobs/{job_id}/claim", json={"profile_key": PROFILE_KEY})
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 409:
            return None  # already claimed by another executor
        raise


def start_job(job_id: str) -> dict:
    return _request("POST", f"/extension/jobs/{job_id}/start", json={})


def complete_job(job_id: str, result: dict) -> dict:
    return _request("POST", f"/extension/jobs/{job_id}/complete", json={"result": result})


def fail_job(job_id: str, error_message: str, result: dict) -> dict:
    return _request("POST", f"/extension/jobs/{job_id}/fail", json={"error_message": error_message, "result": result})


# ── DOM helpers (Playwright locators - auto-waiting, far more robust than
#    raw querySelector text matching) ───────────────────────────────────────

def dismiss_popups(page: Page) -> None:
    """Close any modal/popup that might block the next action."""
    close_re = re.compile(r"close|dismiss|skip|not now|maybe later|no thanks|got it", re.I)
    try:
        for btn in page.locator("button").all()[:40]:
            try:
                label = (btn.get_attribute("aria-label") or "") + " " + (btn.inner_text(timeout=200) or "")
            except Exception:
                continue
            if close_re.search(label) and btn.is_visible():
                try:
                    btn.click(timeout=500)
                    page.wait_for_timeout(150)
                except Exception:
                    pass
    except Exception:
        pass
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass


def ensure_top(page: Page) -> None:
    dismiss_popups(page)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(700)


def is_login_required(page: Page) -> bool:
    url = page.url
    return "/login" in url or "/authwall" in url


def is_account_restricted(page: Page) -> bool:
    return "/checkpoint" in page.url


def is_profile_not_found(page: Page) -> bool:
    try:
        text = page.locator("body").inner_text(timeout=2000)[:2000]
    except Exception:
        return False
    return bool(re.search(r"this page doesn.?t exist|page not found|profile (is )?unavailable", text, re.I))


def detect_blocking_state(page: Page) -> dict | None:
    if is_account_restricted(page):
        return {"status": "restricted", "message": "LinkedIn checkpoint - account restricted"}
    if is_login_required(page):
        return {"status": "session_expired", "message": "LinkedIn login required"}
    if is_profile_not_found(page):
        return {"status": "not_found", "message": "Profile page not found"}
    return None


def find_button(page: Page, labels: list[str] | str, scope=None, exclude: list[str] | None = None):
    """Multi-strategy clickable-element finder: exact text, then substring/
    aria-label match (case-insensitive), optionally scoped to an open dialog/
    menu and excluding terms (e.g. 'disconnect' when looking for 'connect')."""
    wanted = [labels] if isinstance(labels, str) else labels
    exclude = exclude or []
    root = scope or page
    pattern = "|".join(re.escape(w) for w in wanted)

    # Strategy 1: role=button with exact-ish accessible name
    for w in wanted:
        loc = root.get_by_role("button", name=w, exact=True)
        try:
            if loc.count() and loc.first.is_visible():
                return loc.first
        except Exception:
            pass

    # Strategy 2: substring match across any visible button/link/role=button
    candidates = root.locator('button, a, [role="button"]')
    try:
        count = min(candidates.count(), 60)
    except Exception:
        return None
    for i in range(count):
        el = candidates.nth(i)
        try:
            if not el.is_visible():
                continue
            label = ((el.inner_text(timeout=200) or "") + " " + (el.get_attribute("aria-label") or "")).lower()
        except Exception:
            continue
        if any(x in label for x in exclude):
            continue
        if re.search(pattern, label, re.I):
            return el
    return None


def click_button(page: Page, labels: list[str] | str, scope=None, exclude: list[str] | None = None) -> bool:
    el = find_button(page, labels, scope, exclude)
    if el is None:
        return False
    try:
        el.click(timeout=2000)
        return True
    except Exception:
        return False


def _log_ai_fallback(goal: str, page_url: str, outcome: str, detail: str = "") -> None:
    """Append-only log of every time the AI fallback was used, so these can be
    reviewed later and turned into permanent entries in find_button()'s label
    lists - keeping the fast/free path as the primary one over time instead
    of leaning on the AI call forever for the same recurring case."""
    try:
        with open(AI_FALLBACK_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "goal": goal,
                "url": page_url,
                "outcome": outcome,
                "detail": detail,
            }) + "\n")
    except Exception as exc:
        logger.error("Could not write AI fallback log: %s", exc)


def ai_locate_click(page: Page, goal: str) -> bool:
    """Last-resort fallback when find_button()/click_button() can't find what
    they're looking for by text/aria-label matching. Takes a screenshot of
    the page as it actually looks right now and asks a vision model to find
    and report click coordinates for whatever accomplishes `goal` - this
    doesn't rely on knowing LinkedIn's current button wording in advance the
    way the hardcoded matching does, so it keeps working even after LinkedIn
    changes something, at the cost of an API call (only happens on failure,
    not on every action - see README for the cost rationale)."""
    if not ANTHROPIC_API_KEY:
        return False

    try:
        screenshot = page.screenshot(full_page=False)
    except Exception as exc:
        logger.error("AI fallback: could not capture screenshot: %s", exc)
        return False

    viewport = page.viewport_size or {"width": 1280, "height": 900}
    b64 = base64.b64encode(screenshot).decode("ascii")
    prompt = (
        f"This is a screenshot of a LinkedIn page, {viewport['width']}x{viewport['height']} pixels. "
        f"Goal: {goal}\n\n"
        "Find the single clickable element (button/link) that best accomplishes this goal. "
        "Respond with ONLY a JSON object, no other text: "
        '{"found": true, "x": <pixel x center of the element>, "y": <pixel y center>} '
        'or {"found": false, "reason": "<short reason>"} if nothing on the page accomplishes the goal.'
    )

    try:
        res = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": 200,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                        {"type": "text", "text": prompt},
                    ],
                }],
            },
            timeout=30,
        )
        res.raise_for_status()
        text = res.json()["content"][0]["text"].strip()
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)  # strip markdown fences if present
        decision = json.loads(text)
    except Exception as exc:
        logger.error("AI fallback request failed: %s", exc)
        _log_ai_fallback(goal, page.url, "error", str(exc))
        return False

    if not decision.get("found"):
        logger.info("AI fallback: model couldn't find it either - %s", decision.get("reason", ""))
        _log_ai_fallback(goal, page.url, "not_found", decision.get("reason", ""))
        return False

    try:
        page.mouse.click(decision["x"], decision["y"])
        logger.info("AI fallback succeeded for goal=%r at (%s, %s)", goal, decision["x"], decision["y"])
        _log_ai_fallback(goal, page.url, "clicked", f"({decision['x']}, {decision['y']})")
        return True
    except Exception as exc:
        logger.error("AI fallback: click failed: %s", exc)
        _log_ai_fallback(goal, page.url, "click_error", str(exc))
        return False


def click_with_ai_fallback(page: Page, labels: list[str] | str, goal: str, scope=None, exclude: list[str] | None = None) -> bool:
    """Try the fast hardcoded match first; only pay for an AI call if it fails."""
    if click_button(page, labels, scope, exclude):
        return True
    logger.info("Hardcoded match failed for %r - trying AI fallback (goal: %s)", labels, goal)
    return ai_locate_click(page, goal)


def visible_button_texts(page: Page, limit: int = 15) -> list[str]:
    out = []
    try:
        buttons = page.locator("header button, .pv-top-card button, main button")
        for i in range(min(buttons.count(), limit)):
            try:
                t = buttons.nth(i).inner_text(timeout=200).strip()
                if t:
                    out.append(t)
            except Exception:
                continue
    except Exception:
        pass
    return out


def has_1st_degree(page: Page) -> bool:
    try:
        if page.locator('[aria-label*="1st"]').count():
            return True
        text = page.locator("body").inner_text(timeout=1500)
        return bool(re.search(r"\b1st\b", text))
    except Exception:
        return False


def has_normal_message(page: Page) -> bool:
    try:
        return bool(find_button(page, "Message")) or page.locator('[contenteditable="true"], div[role="textbox"]').count() > 0
    except Exception:
        return False


def has_pending_invite(page: Page) -> bool:
    return find_button(page, "Pending") is not None


def fill_message_box(page: Page, box, text: str) -> None:
    box.click()
    box.fill("")
    box.type(text, delay=8)


# ── Actions (mirror chrome-extension/src/content-linkedin.js) ──────────────

def detect_account(page: Page) -> dict:
    login_status = "login_required" if is_login_required(page) else "logged_in"
    display_name = ""
    try:
        img = page.locator('img.global-nav__me-photo, img[alt*="Photo of" i]').first
        alt = img.get_attribute("alt") or ""
        display_name = re.sub(r"^Photo of\s+", "", alt, flags=re.I).strip()
    except Exception:
        pass
    return {"display_name": display_name, "login_status": login_status, "current_url": page.url}


def goto(page: Page, url: str) -> None:
    target = url or "https://www.linkedin.com/feed/"
    try:
        page.goto(target, wait_until="domcontentloaded", timeout=30000)
    except PlaywrightTimeoutError:
        page.goto(target, wait_until="domcontentloaded", timeout=30000)  # retry once on timeout
    page.wait_for_timeout(1500)  # let LinkedIn's SPA finish rendering


def detect_messageability(page: Page) -> dict:
    ensure_top(page)
    blocked = detect_blocking_state(page)
    if blocked:
        return blocked

    if has_1st_degree(page):
        return {"status": "normal_message_available", "message": "1st-degree connection - normal message available"}
    if has_normal_message(page):
        return {"status": "normal_message_available", "message": "Normal LinkedIn message is available"}
    if has_pending_invite(page):
        return {"status": "pending", "message": "Connection request is already pending"}

    if not click_button(page, "Message"):
        if click_button(page, "More"):
            page.wait_for_timeout(1200)
            click_button(page, "Message")

    if page.locator('[contenteditable="true"], div[role="textbox"]').count() > 0:
        return {"status": "normal_message_available", "message": "Normal LinkedIn message is available"}

    if click_button(page, "Message"):
        page.wait_for_timeout(1500)
        if page.locator('input[name="subject"], input[placeholder*="Subject" i]').count() > 0:
            return {"status": "inmail_available", "message": "InMail composer is available"}
        if page.locator('[contenteditable="true"], div[role="textbox"]').count() > 0:
            return {"status": "normal_message_available", "message": "Normal LinkedIn message is available"}

    buttons = visible_button_texts(page)
    if find_button(page, "Connect"):
        return {"status": "not_messageable", "message": f"No message path found; invitation fallback can run. Buttons: {buttons}"}
    return {"status": "not_messageable", "message": f"No message, InMail, or Connect action found. Buttons: {buttons}"}


def send_connection(page: Page, note: str = "") -> dict:
    ensure_top(page)
    blocked = detect_blocking_state(page)
    if blocked:
        return blocked

    if has_1st_degree(page) or has_normal_message(page):
        return {"status": "connected", "message": "Already connected"}
    if has_pending_invite(page):
        return {"status": "pending", "message": "Connection request already pending"}
    if find_button(page, "Following"):
        return {"status": "connected", "message": "Already following/connected"}

    clicked = click_button(page, "Connect")
    if not clicked and click_button(page, "More"):
        page.wait_for_timeout(1200)
        menu = page.locator('[role="menu"], .artdeco-dropdown__content').first
        scope = menu if menu.count() else page
        clicked = click_button(page, "Connect", scope=scope, exclude=["disconnect"])

    if not clicked:
        clicked = ai_locate_click(page, "Click the button that sends a connection/invite request to this LinkedIn profile (may be labeled Connect, or hidden in a 'More' menu)")

    if not clicked:
        return {"status": "cannot_connect", "message": f"Connect button not found. Buttons: {visible_button_texts(page)}"}
    page.wait_for_timeout(1200)

    if note and click_button(page, "Add a note"):
        page.wait_for_timeout(700)
        box = page.locator('[contenteditable="true"], div[role="textbox"], textarea[name="message"]').first
        if box.count():
            fill_message_box(page, box, note[:300])

    dialog = page.locator('[role="dialog"], .artdeco-modal').first
    scope = dialog if dialog.count() else page
    if click_with_ai_fallback(page, ["Send without a note", "Send invitation", "Send", "Done", "Send now"],
                               "Click the button that confirms/sends the connection invitation in this open dialog",
                               scope=scope, exclude=["cancel", "close", "dismiss"]):
        return {"status": "sent", "message": "Connection request sent"}
    return {"status": "error", "message": f"Send button not found in connection dialog. Buttons: {visible_button_texts(page)}"}


def send_prepared_message(page: Page, message: str) -> dict:
    ensure_top(page)
    if not message:
        return {"status": "failed_with_reason", "message": "Message text is empty"}
    blocked = detect_blocking_state(page)
    if blocked:
        return blocked

    if not click_button(page, "Message"):
        if click_button(page, "More"):
            page.wait_for_timeout(1200)
        if not click_button(page, "Message") and not ai_locate_click(page, "Click the button that opens a message/chat composer to this LinkedIn profile"):
            return {"status": "failed_with_reason", "message": f"Message button not found. Buttons: {visible_button_texts(page)}"}

    page.wait_for_timeout(1500)
    box = page.locator('div[role="textbox"], [contenteditable="true"]').first
    if not box.count():
        return {"status": "failed_with_reason", "message": "Message input not found"}
    fill_message_box(page, box, message)
    page.wait_for_timeout(800)

    composer = box.locator('xpath=ancestor::*[@role="dialog" or contains(@class,"msg-form")][1]')
    scope = composer if composer.count() else page
    if not click_with_ai_fallback(page, "Send", "Click the button that sends the typed message in the currently open message composer",
                                   scope=scope, exclude=["cancel", "close", "dismiss"]):
        return {"status": "failed_with_reason", "message": "Send button not found"}
    return {"status": "message_sent", "message": "Message sent successfully"}


def send_prepared_inmail(page: Page, subject: str, message: str) -> dict:
    ensure_top(page)
    if not subject or not message:
        return {"status": "failed_with_reason", "message": "Subject or message is empty"}
    blocked = detect_blocking_state(page)
    if blocked:
        return blocked

    click_button(page, "Message")
    page.wait_for_timeout(1500)
    subject_input = page.locator('input[name="subject"], input[placeholder*="Subject" i]').first
    body = page.locator('textarea[name="message"], div[role="textbox"], [contenteditable="true"]').first
    if not subject_input.count() or not body.count():
        return {"status": "failed_with_reason", "message": "InMail composer fields not found"}
    subject_input.fill(subject)
    fill_message_box(page, body, message)
    page.wait_for_timeout(800)

    if not click_button(page, "Send", exclude=["cancel", "close", "dismiss"]):
        return {"status": "failed_with_reason", "message": "InMail send button not found"}
    return {"status": "inmail_sent", "message": "InMail sent successfully"}


def visit_profile(page: Page) -> dict:
    ensure_top(page)
    blocked = detect_blocking_state(page)
    if blocked:
        return blocked
    dismiss_popups(page)
    page.wait_for_timeout(500)
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(900)
    page.mouse.wheel(0, -200)
    page.wait_for_timeout(400)
    dismiss_popups(page)
    try:
        name = page.locator("h1").first.inner_text(timeout=1000).strip()
    except Exception:
        name = ""
    return {"status": "visited", "message": f"Visited profile: {name}" if name else "Profile visited"}


def follow_profile(page: Page) -> dict:
    ensure_top(page)
    blocked = detect_blocking_state(page)
    if blocked:
        return blocked
    if find_button(page, "Following"):
        return {"status": "already_following", "message": "Already following this profile"}

    clicked = click_button(page, "Follow")
    if not clicked and click_button(page, "More"):
        page.wait_for_timeout(1200)
        menu = page.locator('[role="menu"], .artdeco-dropdown__content').first
        scope = menu if menu.count() else page
        clicked = click_button(page, "Follow", scope=scope, exclude=["unfollow"])

    if not clicked:
        return {"status": "not_available", "message": f"Follow action not found. Buttons: {visible_button_texts(page)}"}
    page.wait_for_timeout(1000)
    return {"status": "followed", "message": "Follow clicked"}


def check_connection_status(page: Page) -> dict:
    ensure_top(page)
    blocked = detect_blocking_state(page)
    if blocked:
        return blocked
    if has_1st_degree(page) or has_normal_message(page):
        return {"status": "accepted", "message": "Connection request accepted"}
    if has_pending_invite(page) or find_button(page, "Connect"):
        return {"status": "still_not_accepted", "message": "Connection request not yet accepted"}
    return {"status": "still_not_accepted", "message": "Could not confirm acceptance yet"}


def check_reply(page: Page) -> dict:
    ensure_top(page)
    blocked = detect_blocking_state(page)
    if blocked:
        return blocked
    if not click_button(page, "Message"):
        return {"status": "no_reply", "message": "Could not open the message thread"}
    page.wait_for_timeout(1500)

    bubbles = page.locator('.msg-s-event-listitem, [class*="message-list-item"], li[class*="msg"]')
    count = bubbles.count()
    if not count:
        return {"status": "no_reply", "message": "No conversation found yet"}

    last = bubbles.nth(count - 1)
    try:
        last_text = last.inner_text(timeout=1000).strip()
    except Exception:
        last_text = ""
    try:
        class_name = last.get_attribute("class") or ""
    except Exception:
        class_name = ""
    is_sent_by_cls = bool(re.search(r"--is-sender|--self|outgoing|sent-by-me", class_name, re.I))
    has_edit_icon = last.locator('[data-control-name="edit_message"], button[aria-label*="Edit" i]').count() > 0
    from_me = is_sent_by_cls or has_edit_icon

    if last_text and not from_me:
        return {"status": "replied", "message": "Prospect has replied", "reply_excerpt": last_text[:280]}
    return {"status": "no_reply", "message": "No new reply from prospect yet"}


# ── Job dispatch (mirrors taskFromJob in background.js) ────────────────────

def task_from_job(job: dict) -> dict:
    payload = job.get("payload") or {}
    job_type = job["job_type"]
    if job_type == "send_connections":
        return {"action": "send_connection", "report_type": "send_connection", "url": payload.get("linkedin_url"), "note": payload.get("note", "")}
    if job_type == "check_messageability":
        return {"action": "check_messageability", "report_type": "check_messageability", "url": payload.get("linkedin_url"),
                "note": payload.get("note", ""), "fallback": payload.get("fallback", "invitation")}
    if job_type in ("send_messages", "send_followups"):
        return {"action": "send_prepared_message", "report_type": "send_message", "url": payload.get("linkedin_url"),
                "message": payload.get("message", ""), "message_type": payload.get("message_type", "initial")}
    if job_type == "send_prepared_message":
        return {"action": "send_prepared_message", "report_type": "send_prepared_message", "url": payload.get("linkedin_url"),
                "message": payload.get("message", ""), "message_type": payload.get("message_type", "initial")}
    if job_type in ("send_prepared_inmail", "send_inmail"):
        return {"action": "send_prepared_inmail", "report_type": job_type, "url": payload.get("linkedin_url"),
                "subject": payload.get("subject", ""), "message": payload.get("message", ""), "message_type": "inmail"}
    if job_type == "visit_profile":
        return {"action": "visit_profile", "report_type": "visit_profile", "url": payload.get("linkedin_url")}
    if job_type == "follow_profile":
        return {"action": "follow_profile", "report_type": "follow_profile", "url": payload.get("linkedin_url")}
    if job_type in ("check_reply", "wait_reply"):
        return {"action": "check_reply", "report_type": "check_reply", "url": payload.get("linkedin_url")}
    if job_type in ("check_connection_status", "wait_acceptance"):
        return {"action": "check_connection_status", "report_type": "check_connection_status", "url": payload.get("linkedin_url")}
    return {"action": job_type, "report_type": job_type, "url": payload.get("linkedin_url")}


def run_action(page: Page, task: dict) -> dict:
    goto(page, task["url"])
    action = task["action"]
    if action == "send_connection":
        return send_connection(page, task.get("note", ""))
    if action == "check_messageability":
        return detect_messageability(page)
    if action == "send_prepared_message":
        return send_prepared_message(page, task.get("message", ""))
    if action == "send_prepared_inmail":
        return send_prepared_inmail(page, task.get("subject", ""), task.get("message", ""))
    if action == "visit_profile":
        return visit_profile(page)
    if action == "follow_profile":
        return follow_profile(page)
    if action == "check_reply":
        return check_reply(page)
    if action == "check_connection_status":
        return check_connection_status(page)
    return {"status": "failed_with_reason", "message": f"Unknown action: {action}"}


def run_job(page: Page, job: dict) -> None:
    task = task_from_job(job)
    claimed = claim_job(job["id"])
    if not claimed:
        logger.info("Job %s already claimed elsewhere, skipping", job["id"])
        return
    start_job(job["id"])

    result = run_action(page, task)

    # Inline "auto-send invitation when not messageable" fallback for legacy
    # (non flow-builder) jobs - mirrors background.js's same special case.
    is_flow_job = bool((job.get("payload") or {}).get("flow_node_id"))
    if task["action"] == "check_messageability" and result.get("status") == "not_messageable" \
            and task.get("fallback") == "invitation" and not is_flow_job:
        result = send_connection(page, task.get("note", ""))
        if result.get("status") == "sent":
            result["status"] = "invitation_sent"

    final = {
        "task_type": task["report_type"],
        "status": result.get("status", "failed_with_reason"),
        "message": result.get("message", ""),
        "prospect_id": job.get("prospect_id"),
        "message_type": task.get("message_type"),
    }

    if final["status"] in FAIL_STATUSES:
        fail_job(job["id"], final["message"] or final["status"], final)
        if final["status"] == "restricted":
            logger.warning("ACCOUNT RESTRICTED - stopping until you investigate manually")
            raise SystemExit("Account restricted by LinkedIn - stopping the executor.")
    else:
        completed = complete_job(job["id"], final)
        logger.info("Job %s completed: %s", job["id"], final["status"])
        if job["job_type"] in CONNECTION_JOB_TYPES and final["status"] in ("sent", "invitation_sent"):
            delay = random.uniform(3 * 60, 7 * 60)
            logger.info("Connection sent - waiting %.0fs before the next one", delay)
            time.sleep(delay)
        elif job["job_type"] in MESSAGE_JOB_TYPES and final["status"] == "message_sent":
            delay = random.uniform(5 * 60, 10 * 60)
            logger.info("Message sent - waiting %.0fs before the next one", delay)
            time.sleep(delay)
        return completed


# ── Main loop ────────────────────────────────────────────────────────────────

def main() -> None:
    BROWSER_PROFILE_DIR.mkdir(exist_ok=True)
    logger.info("Starting LinkedFlow executor for profile_key=%s", PROFILE_KEY)
    logger.info("Browser session stored at %s - log into LinkedIn if prompted", BROWSER_PROFILE_DIR)

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(BROWSER_PROFILE_DIR),
            headless=False,
            viewport={"width": 1280, "height": 900},
        )
        page = context.pages[0] if context.pages else context.new_page()

        while True:
            logged_in = False
            try:
                page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(1000)
                state = detect_account(page)
                heartbeat(state)
                logged_in = state["login_status"] == "logged_in"
                if not logged_in:
                    logger.warning("Not logged into LinkedIn - log in in the open browser window, then this will resume automatically")
            except Exception as exc:
                # Heartbeat failing must not block job processing - mirrors the
                # tickHeartbeat/tickJobs split in the Chrome extension's
                # background.js, which fixed the exact same "extension looks
                # stuck" bug there.
                logger.error("Heartbeat failed: %s", exc)

            if logged_in:
                try:
                    jobs = pending_jobs()
                    if jobs:
                        job = jobs[0]
                        logger.info("Running job %s (%s)", job["id"], job["job_type"])
                        run_job(page, job)
                    else:
                        logger.debug("No pending jobs")
                except SystemExit:
                    raise
                except Exception as exc:
                    logger.error("Job processing failed: %s", exc)

            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
