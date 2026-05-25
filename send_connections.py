"""
Step 1 — Send connection requests.

- Reads CSV, filters rows with empty Status
- Groups by Assigned Account (= which LinkedIn profile to use)
- For each profile: loads session, sends up to 25 requests, waits 3-7 min between each
- Stops immediately on limit_reached or restricted
- Saves CSV after every action
- Sends real-time updates to the backend WebSocket so the dashboard reflects live state
"""
import asyncio
import logging
import random
from datetime import date

from playwright.async_api import async_playwright

import config
from config import (
    DAILY_LIMIT, DELAY_MIN_CONNECTION, DELAY_MAX_CONNECTION,
    COL_LINKEDIN_URL, COL_STATUS, COL_INMAIL_MESSAGE,
    COL_ASSIGNED_ACCOUNT, COL_CONNECTION_SENT_DATE, COL_NEXT_STEPS,
    STATUS_CONNECTION_SENT,
)
from csv_manager import read_prospects, update_prospect, get_pending_connections, group_by_account
from linkedin_actions import send_connection_request
from session_manager import load_session
from ws_client import AgentWSClient

logger = logging.getLogger("linkedin_bot")


async def run(prospects=None) -> dict:
    """Send connection requests. Returns summary dict."""
    if prospects is None:
        prospects = read_prospects()

    pending = get_pending_connections(prospects)
    if not pending:
        logger.info("No pending connection requests to send")
        return {"sent": 0, "skipped": 0, "errors": 0}

    by_account = group_by_account(pending)
    logger.info(f"Pending: {len(pending)} prospects across {len(by_account)} account(s)")

    totals = {"sent": 0, "skipped": 0, "errors": 0}

    async with async_playwright() as p:
        for profile_key, rows in by_account.items():
            logger.info(f"=== Profile: {profile_key} ({len(rows)} prospects) ===")
            sent_count = 0
            stop = False

            # Open WS connection for this profile — runs alongside the browser.
            # If the backend is unreachable, ws.connected will be False and all
            # ws.send_* calls become silent no-ops.
            async with AgentWSClient(profile_key) as ws:
                # Heartbeat at session start
                await ws.send_heartbeat(daily_sent=0, session_active=True)

                browser = await p.chromium.launch(headless=False, args=["--start-maximized"])
                try:
                    context = await load_session(browser, profile_key)
                    page = await context.new_page()

                    for row in rows:
                        if stop or sent_count >= DAILY_LIMIT:
                            break

                        url = row.get(COL_LINKEDIN_URL, "").strip()
                        if not url:
                            logger.warning("Row has no linkedinUrl — skipping")
                            totals["skipped"] += 1
                            continue

                        note = row.get(COL_INMAIL_MESSAGE, "").strip()
                        logger.info(f"[{sent_count+1}/{DAILY_LIMIT}] {url}")

                        result = await send_connection_request(page, url, note, profile_key)
                        status = result["status"]
                        logger.info(f"  → {status}: {result['message']}")

                        today = date.today().strftime("%Y-%m-%d")

                        if status == "sent":
                            # 1. CSV write (primary persistence)
                            update_prospect(prospects, url, {
                                COL_STATUS: STATUS_CONNECTION_SENT,
                                COL_CONNECTION_SENT_DATE: today,
                                COL_NEXT_STEPS: "Check acceptance in My Network",
                            })
                            sent_count += 1
                            totals["sent"] += 1
                            # 2. WS notification (real-time dashboard)
                            await ws.send_connection_result(url, "sent")
                            await ws.send_heartbeat(
                                daily_sent=sent_count, session_active=True
                            )

                        elif status == "pending":
                            update_prospect(prospects, url, {
                                COL_STATUS: STATUS_CONNECTION_SENT,
                                COL_NEXT_STEPS: "Already pending — check acceptance",
                            })
                            await ws.send_connection_result(url, "pending")
                            totals["skipped"] += 1

                        elif status == "connected":
                            update_prospect(prospects, url, {
                                COL_STATUS: "Connection Accepted",
                                COL_NEXT_STEPS: "Employee: Generate messages then set Ready to Send",
                            })
                            await ws.send_connection_result(url, "connected")
                            totals["skipped"] += 1

                        elif status in ("limit_reached", "restricted", "session_expired"):
                            update_prospect(prospects, url, {COL_NEXT_STEPS: status})
                            await ws.send_connection_result(url, status)
                            await ws.send_heartbeat(
                                daily_sent=sent_count, session_active=False
                            )
                            stop = True
                            logger.warning(f"Stopping this profile: {status}")
                            break

                        elif status in ("not_found", "private", "cannot_connect"):
                            update_prospect(prospects, url, {
                                COL_STATUS: status,
                                COL_NEXT_STEPS: result["message"],
                            })
                            await ws.send_connection_result(url, status)
                            totals["skipped"] += 1

                        else:  # error
                            update_prospect(prospects, url, {
                                COL_NEXT_STEPS: f"Error: {result['message'][:100]}",
                            })
                            await ws.send_connection_result(url, "error")
                            totals["errors"] += 1

                        # Random delay between connections (only if more to send)
                        if not stop and sent_count < DAILY_LIMIT and row != rows[-1]:
                            delay = random.randint(DELAY_MIN_CONNECTION, DELAY_MAX_CONNECTION)
                            logger.info(f"  Waiting {delay}s before next connection...")
                            await asyncio.sleep(delay)

                finally:
                    await browser.close()

                # Final heartbeat for this profile
                await ws.send_heartbeat(daily_sent=sent_count, session_active=not stop)

    logger.info(f"Connection run complete: {totals}")
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
