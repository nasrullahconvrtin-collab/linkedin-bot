"""
Step 4 & 5 — Send due follow-ups and detect replies.

Step 4: Find rows where Next Steps contains today's date (Follow-up N on YYYY-MM-DD).
        Send the correct follow-up message and schedule the next one.

Step 5: Find rows with Status = Initial Message Sent or Following Up.
        Check LinkedIn messaging for a reply from the prospect.
        If found: update Status = Replied and stop the sequence.

Real-time updates are sent to the backend WebSocket after every action so the
dashboard reflects live state.  WS failures are silent — CSV writes still happen.
"""
import asyncio
import logging
import random
import re
from datetime import date

from playwright.async_api import async_playwright

import config
from config import (
    DELAY_MIN_MESSAGE, DELAY_MAX_MESSAGE,
    COL_LINKEDIN_URL, COL_STATUS, COL_NEXT_STEPS,
    COL_FIRST_NAME, COL_LAST_NAME, COL_ASSIGNED_ACCOUNT,
    COL_FOLLOWUP_1, COL_FOLLOWUP_2, COL_FOLLOWUP_3, COL_FOLLOWUP_4,
    COL_NOTES, COL_REPLY_DATE, COL_REPLY_TYPE,
    STATUS_FOLLOWING_UP, STATUS_NO_RESPONSE, STATUS_REPLIED,
    STATUS_INITIAL_MESSAGE_SENT,
)
from csv_manager import (
    read_prospects, update_prospect,
    get_followups_due, get_active_prospects, group_by_account,
    add_working_days,
)
from linkedin_actions import send_message, check_for_reply
from session_manager import load_session
from ws_client import AgentWSClient

logger = logging.getLogger("linkedin_bot")

FOLLOWUP_COLUMNS  = [COL_FOLLOWUP_1, COL_FOLLOWUP_2, COL_FOLLOWUP_3, COL_FOLLOWUP_4]
# msg_type strings match what the backend websocket_manager expects
FOLLOWUP_MSG_TYPES = ["followup_1", "followup_2", "followup_3", "followup_4"]


def _detect_followup_number(next_steps: str) -> int | None:
    """Return 1-4 if next_steps says 'Follow-up N on TODAY', else None."""
    today_str = date.today().strftime("%Y-%m-%d")
    if today_str not in next_steps:
        return None
    m = re.search(r"Follow-up (\d)", next_steps, re.IGNORECASE)
    if m:
        n = int(m.group(1))
        if 1 <= n <= 4:
            return n
    return None


def _next_steps_after_followup(followup_num: int) -> str:
    if followup_num >= 4:
        return "Sequence Complete"
    next_date = add_working_days(date.today(), 5).strftime("%Y-%m-%d")
    return f"Follow-up {followup_num + 1} on {next_date}"


async def _send_followups(
    page,
    profile_key: str,
    due_rows: list,
    prospects: list,
    ws: AgentWSClient,
) -> int:
    count = 0
    for i, row in enumerate(due_rows):
        next_steps   = row.get(COL_NEXT_STEPS, "")
        followup_num = _detect_followup_number(next_steps)
        if followup_num is None:
            continue

        url     = row.get(COL_LINKEDIN_URL, "").strip()
        first   = row.get(COL_FIRST_NAME, "")
        last    = row.get(COL_LAST_NAME, "")
        col     = FOLLOWUP_COLUMNS[followup_num - 1]
        msg_type = FOLLOWUP_MSG_TYPES[followup_num - 1]   # e.g. "followup_2"
        message = row.get(col, "").strip()

        if not url or not message:
            logger.warning(f"Missing URL or Follow-up {followup_num} message for {first} {last}")
            continue

        logger.info(f"Sending Follow-up {followup_num} to {first} {last}")
        result = await send_message(page, url, message, profile_key)
        logger.info(f"  → {result['status']}: {result['message']}")

        if result["status"] == "message_sent":
            if followup_num < 4:
                new_next = _next_steps_after_followup(followup_num)
                # 1. CSV write
                update_prospect(prospects, url, {
                    COL_STATUS: STATUS_FOLLOWING_UP,
                    COL_NEXT_STEPS: new_next,
                })
            else:
                # 1. CSV write
                update_prospect(prospects, url, {
                    COL_STATUS: STATUS_NO_RESPONSE,
                    COL_NEXT_STEPS: "Sequence Complete",
                })
            count += 1
            # 2. WS notification
            await ws.send_message_result(url, msg_type, "message_sent")

        elif result["status"] in ("session_expired", "restricted"):
            await ws.send_heartbeat(session_active=False)
            logger.warning(f"Stopping follow-ups for {profile_key}: {result['status']}")
            break

        else:
            update_prospect(prospects, url, {
                COL_NEXT_STEPS: f"Followup error: {result['message'][:100]}",
            })
            await ws.send_message_result(url, msg_type, "error")

        if i < len(due_rows) - 1:
            delay = random.randint(DELAY_MIN_MESSAGE, DELAY_MAX_MESSAGE)
            logger.info(f"  Waiting {delay}s before next message...")
            await asyncio.sleep(delay)

    return count


async def _check_replies(
    page,
    profile_key: str,
    active_rows: list,
    prospects: list,
    ws: AgentWSClient,
) -> int:
    count = 0
    today = date.today().strftime("%Y-%m-%d")
    for row in active_rows:
        first = row.get(COL_FIRST_NAME, "")
        last  = row.get(COL_LAST_NAME, "")
        url   = row.get(COL_LINKEDIN_URL, "").strip()

        result = await check_for_reply(page, first, last, profile_key)
        logger.info(f"  Reply check {first} {last}: {result['status']}")

        if result["status"] == "replied":
            reply_text = result.get("reply_text", "")
            # 1. CSV write
            update_prospect(prospects, url, {
                COL_STATUS: STATUS_REPLIED,
                COL_REPLY_DATE: today,
                COL_REPLY_TYPE: "LinkedIn DM",
                COL_NOTES: reply_text[:200],
                COL_NEXT_STEPS: "Manual Follow-up Required",
            })
            logger.info(f"  REPLY from {first} {last}: {reply_text[:80]}")
            count += 1
            # 2. WS notification
            await ws.send_reply(url, reply_text)

        elif result["status"] in ("session_expired", "restricted"):
            await ws.send_heartbeat(session_active=False)
            logger.warning(f"Stopping reply check for {profile_key}: {result['status']}")
            break

        await asyncio.sleep(2)  # brief pause between messaging checks

    return count


async def run(prospects=None) -> dict:
    if prospects is None:
        from csv_manager import read_prospects
        prospects = read_prospects()

    due_rows    = get_followups_due(prospects)
    active_rows = get_active_prospects(prospects)

    if not due_rows and not active_rows:
        logger.info("No follow-ups due and no active prospects to check for replies")
        return {"followups_sent": 0, "replies_found": 0}

    by_account_due    = group_by_account(due_rows)
    by_account_active = group_by_account(active_rows)
    all_profiles = set(by_account_due) | set(by_account_active)

    totals = {"followups_sent": 0, "replies_found": 0}

    async with async_playwright() as p:
        for profile_key in all_profiles:
            logger.info(f"=== Profile: {profile_key} ===")

            async with AgentWSClient(profile_key) as ws:
                await ws.send_heartbeat(session_active=True)

                browser = await p.chromium.launch(headless=False, args=["--start-maximized"])
                try:
                    context = await load_session(browser, profile_key)
                    page = await context.new_page()

                    # Step 4: send follow-ups
                    profile_due = by_account_due.get(profile_key, [])
                    if profile_due:
                        n = await _send_followups(
                            page, profile_key, profile_due, prospects, ws
                        )
                        totals["followups_sent"] += n
                        logger.info(f"  Follow-ups sent: {n}")

                    # Step 5: check for replies
                    profile_active = by_account_active.get(profile_key, [])
                    if profile_active:
                        n = await _check_replies(
                            page, profile_key, profile_active, prospects, ws
                        )
                        totals["replies_found"] += n
                        logger.info(f"  Replies found: {n}")

                finally:
                    await browser.close()

                await ws.send_heartbeat(session_active=True)

    logger.info(f"followups_and_replies complete: {totals}")
    return totals


if __name__ == "__main__":
    import logging as _logging
    _logging.basicConfig(
        level=_logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            _logging.FileHandler(config.LOG_FILE, encoding="utf-8"),
            _logging.StreamHandler(),
        ],
    )
    asyncio.run(run())
