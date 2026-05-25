"""
Step 2 & 3 — Detect accepted connections and send initial messages.

Step 2: For each profile that has rows with Status="Connection Request Sent",
        load that profile's session, go to My Network, collect accepted URLs,
        and update matched rows to Status="Connection Accepted".

Step 3: For rows with Status="Ready to Send",
        navigate to the profile, send the Initial Message,
        update status and schedule Follow-up 1 (+2 calendar days).

Real-time updates are sent to the backend WebSocket after every action so the
dashboard reflects live state.  If the backend is unreachable all WS calls
become silent no-ops — CSV writes still happen regardless.
"""
import asyncio
import logging
import random
from datetime import date, timedelta

from playwright.async_api import async_playwright

import config
from config import (
    DELAY_MIN_MESSAGE, DELAY_MAX_MESSAGE,
    COL_LINKEDIN_URL, COL_STATUS, COL_NEXT_STEPS,
    COL_FIRST_NAME, COL_LAST_NAME, COL_ASSIGNED_ACCOUNT,
    COL_INITIAL_MESSAGE, COL_MESSAGE_SENT_DATE,
    STATUS_CONNECTION_SENT, STATUS_CONNECTION_ACCEPTED,
    STATUS_READY_TO_SEND, STATUS_INITIAL_MESSAGE_SENT,
)
from csv_manager import (
    read_prospects, update_prospect,
    get_sent_connections, get_ready_to_send, group_by_account,
)
from linkedin_actions import detect_accepted_connections, send_message
from session_manager import load_session
from ws_client import AgentWSClient

logger = logging.getLogger("linkedin_bot")


def _followup1_date() -> str:
    """Today + 2 calendar days."""
    return (date.today() + timedelta(days=2)).strftime("%Y-%m-%d")


async def _detect_acceptances(
    page,
    profile_key: str,
    sent_rows: list,
    prospects: list,
    ws: AgentWSClient,
) -> int:
    """
    Load My Network page, send the full URL list to the backend (backend does
    its own DB matching), then locally match against CSV sent_rows.
    Returns count of newly accepted connections in the local CSV.
    """
    # Scrape all /in/ URLs from My Network
    accepted_urls = await detect_accepted_connections(page, profile_key)

    # Send FULL list to backend — backend matches against its own DB rows
    await ws.send_accepted_batch(accepted_urls)

    if not accepted_urls:
        return 0

    # Local CSV match
    accepted_set = {u.strip().rstrip("/").lower() for u in accepted_urls}
    count = 0
    for row in sent_rows:
        url = row.get(COL_LINKEDIN_URL, "").strip().rstrip("/").lower()
        if url in accepted_set:
            update_prospect(prospects, row[COL_LINKEDIN_URL], {
                COL_STATUS: STATUS_CONNECTION_ACCEPTED,
                COL_NEXT_STEPS: "Employee: Generate messages then set Ready to Send",
            })
            logger.info(
                f"  Connection accepted: {row.get(COL_FIRST_NAME)} {row.get(COL_LAST_NAME)}"
            )
            count += 1
    return count


async def _send_initial_messages(
    page,
    profile_key: str,
    ready_rows: list,
    prospects: list,
    ws: AgentWSClient,
) -> int:
    """Send initial messages to all Ready to Send rows for this profile."""
    count = 0
    for i, row in enumerate(ready_rows):
        url     = row.get(COL_LINKEDIN_URL, "").strip()
        message = row.get(COL_INITIAL_MESSAGE, "").strip()
        first   = row.get(COL_FIRST_NAME, "")
        last    = row.get(COL_LAST_NAME, "")

        if not url:
            logger.warning("Row missing linkedinUrl — skipping")
            continue
        if not message:
            logger.warning(f"No Initial Message for {first} {last} — skipping")
            continue

        logger.info(f"Sending initial message to {first} {last}")
        result = await send_message(page, url, message, profile_key)
        logger.info(f"  → {result['status']}: {result['message']}")

        if result["status"] == "message_sent":
            today     = date.today().strftime("%Y-%m-%d")
            followup1 = _followup1_date()
            # 1. CSV write
            update_prospect(prospects, url, {
                COL_STATUS: STATUS_INITIAL_MESSAGE_SENT,
                COL_MESSAGE_SENT_DATE: today,
                COL_NEXT_STEPS: f"Follow-up 1 on {followup1}",
            })
            count += 1
            # 2. WS notification
            await ws.send_message_result(url, "initial", "message_sent")

        elif result["status"] in ("session_expired", "restricted"):
            await ws.send_heartbeat(session_active=False)
            logger.warning(f"Stopping messages for {profile_key}: {result['status']}")
            break

        else:
            update_prospect(prospects, url, {
                COL_NEXT_STEPS: f"Message error: {result['message'][:100]}",
            })
            await ws.send_message_result(url, "initial", "error")

        if i < len(ready_rows) - 1:
            delay = random.randint(DELAY_MIN_MESSAGE, DELAY_MAX_MESSAGE)
            logger.info(f"  Waiting {delay}s before next message...")
            await asyncio.sleep(delay)

    return count


async def run(prospects=None) -> dict:
    if prospects is None:
        prospects = read_prospects()

    sent_rows  = get_sent_connections(prospects)
    ready_rows = get_ready_to_send(prospects)

    if not sent_rows and not ready_rows:
        logger.info("Nothing to do in detect_and_message")
        return {"accepted": 0, "initial_sent": 0}

    by_account_sent  = group_by_account(sent_rows)
    by_account_ready = group_by_account(ready_rows)
    all_profiles = set(by_account_sent) | set(by_account_ready)

    totals = {"accepted": 0, "initial_sent": 0}

    async with async_playwright() as p:
        for profile_key in all_profiles:
            logger.info(f"=== Profile: {profile_key} ===")

            async with AgentWSClient(profile_key) as ws:
                await ws.send_heartbeat(session_active=True)

                browser = await p.chromium.launch(headless=False, args=["--start-maximized"])
                try:
                    context = await load_session(browser, profile_key)
                    page = await context.new_page()

                    # Step 2: detect acceptances
                    profile_sent = by_account_sent.get(profile_key, [])
                    if profile_sent:
                        accepted = await _detect_acceptances(
                            page, profile_key, profile_sent, prospects, ws
                        )
                        totals["accepted"] += accepted
                        logger.info(f"  Accepted connections found: {accepted}")

                    # Step 3: send initial messages
                    profile_ready = by_account_ready.get(profile_key, [])
                    if profile_ready:
                        sent = await _send_initial_messages(
                            page, profile_key, profile_ready, prospects, ws
                        )
                        totals["initial_sent"] += sent
                        logger.info(f"  Initial messages sent: {sent}")

                finally:
                    await browser.close()

                await ws.send_heartbeat(session_active=True)

    logger.info(f"detect_and_message complete: {totals}")
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
