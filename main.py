"""
Main orchestrator — runs all steps in sequence.

Usage:
  python main.py            # run everything (steps 1 → 2+3 → 4+5)
  python main.py --step 1   # only send connections
  python main.py --step 2   # only detect acceptances + send initial messages
  python main.py --step 3   # only send follow-ups + detect replies

Real-time updates
-----------------
Each step connects to the backend WebSocket at:
  wss://linkedin-bot-backend-production.up.railway.app/ws/agent/{profile_key}

Results are forwarded to the backend as they happen so the LinkedFlow dashboard
reflects live state.  CSV writes remain the primary persistence layer — WS is
additive and fails silently if the backend is unreachable.
"""
import argparse
import asyncio
import json
import logging
import sys
from datetime import datetime
from urllib import request

import config
from config import WS_BASE_URL

logger = logging.getLogger("linkedin_bot")
API_BASE_URL = "https://linkedin-bot-backend-production.up.railway.app"


def setup_logging():
    fmt = "%(asctime)s [%(levelname)s] %(message)s"
    log_path = config.LOG_FILE
    import os
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format=fmt,
        handlers=[
            logging.FileHandler(log_path, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


async def main():
    setup_logging()

    parser = argparse.ArgumentParser(description="LinkedFlow cloud scheduler")
    parser.add_argument(
        "--step", type=int, choices=[1, 2, 3, 4],
        help="1=connections, 2=acceptances, 3=messages, 4=follow-ups; default: all",
    )
    parser.add_argument("--api-url", default=API_BASE_URL, help="Backend API URL")
    args = parser.parse_args()

    start = datetime.now()
    logger.info("=" * 60)
    logger.info(f"LinkedFlow cloud scheduler started at {start.strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info(f"Backend API: {args.api_url.rstrip('/')}")
    logger.info(f"Backend WebSocket: {WS_BASE_URL}/{{profile_key}}")
    logger.info("=" * 60)

    # Read CSV once — all modules share and mutate this list in memory.
    # Every update_prospect() call also persists to disk immediately.
    logger.info("Using backend/Supabase as source of truth; local CSV is not read.")

    summary  = {}
    run_all  = args.step is None
    api_url = args.api_url.rstrip("/")

    def post(path: str) -> dict:
        req = request.Request(
            f"{api_url}{path}",
            data=b"{}",
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}

    # Step 1 — Send connection requests
    if run_all or args.step == 1:
        logger.info("\n--- Queue connection jobs ---")
        summary["connections"] = await asyncio.to_thread(post, "/scheduler/run-connections")

    # Step 2+3 — Detect accepted connections & send initial messages
    if run_all or args.step == 2:
        logger.info("\n--- Queue acceptance check jobs ---")
        summary["acceptances"] = await asyncio.to_thread(post, "/scheduler/check-acceptances")

    # Step 4+5 — Follow-ups & reply detection
    if run_all or args.step == 3:
        logger.info("\n--- Queue initial message jobs ---")
        summary["messages"] = await asyncio.to_thread(post, "/scheduler/run-messages")

    if run_all or args.step == 4:
        logger.info("\n--- Queue follow-up jobs ---")
        summary["followups"] = await asyncio.to_thread(post, "/scheduler/run-followups")

    elapsed = (datetime.now() - start).seconds
    logger.info("\n" + "=" * 60)
    logger.info("SUMMARY")
    logger.info("=" * 60)
    for step, result in summary.items():
        logger.info(f"  {step}: {result}")
    logger.info(f"  Total time: {elapsed}s")
    logger.info("=" * 60)

    return summary


if __name__ == "__main__":
    asyncio.run(main())
