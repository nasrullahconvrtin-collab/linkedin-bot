"""
Persistent LinkedFlow agent.

Run this on the employee PC to keep profile_1 connected to the backend:

    python agent_listener.py --profile profile_1

The dashboard scheduler endpoints send tasks over WebSocket. This listener
receives those tasks, runs the existing Playwright LinkedIn actions, and sends
results back using the message shape expected by the FastAPI backend.
"""
import argparse
import asyncio
import json
import logging
import signal
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

import websockets
from playwright.async_api import async_playwright

from config import WS_BASE_URL
from agent_config import LOG_DIR, is_paused, load_config, read_state, write_state
from linkedin_actions import (
    check_for_reply,
    detect_accepted_connections,
    send_connection_request,
    send_message,
)

logger = logging.getLogger("linkedin_bot")

TASK_TIMEOUT_SECONDS = 90
API_BASE_URL = "https://linkedin-bot-backend-production.up.railway.app"


def setup_logging():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    fmt = "%(asctime)s [%(levelname)s] %(message)s"
    rotating = TimedRotatingFileHandler(
        LOG_DIR / "agent.log",
        when="midnight",
        backupCount=14,
        encoding="utf-8",
    )
    rotating.setFormatter(logging.Formatter(fmt))
    logging.basicConfig(
        level=logging.INFO,
        format=fmt,
        force=True,
        handlers=[
            rotating,
            logging.StreamHandler(sys.stdout),
        ],
    )


class LinkedFlowAgent:
    def __init__(self, profile_key: str | None = None):
        self.config = load_config()
        if profile_key:
            self.config["profile_key"] = profile_key
        profile_key = self.config.get("profile_key", "profile_1")
        self.profile_key = profile_key
        self.backend_url = self.config.get("backend_url", API_BASE_URL).rstrip("/")
        self.ws_url = f"{self.config.get('ws_base_url', WS_BASE_URL).rstrip('/')}/{profile_key}"
        self.daily_sent = 0
        self.stop_event = asyncio.Event()
        self.context = None
        self.page = None
        self.playwright = None
        self.running_job = None
        self.last_task_message = ""
        self.job_lock = asyncio.Lock()

    async def start_browser(self, playwright):
        user_data_dir = Path(self.config.get("user_data_dir"))
        user_data_dir.mkdir(parents=True, exist_ok=True)
        args = ["--start-maximized"]
        if self.config.get("minimized_on_launch", True):
            args = ["--start-minimized"]
        self.context = await playwright.chromium.launch_persistent_context(
            user_data_dir=str(user_data_dir),
            headless=False,
            args=args,
        )
        self.page = self.context.pages[0] if self.context.pages else await self.context.new_page()
        await self.ensure_linkedin_session()
        write_state(state="Idle", profile_key=self.profile_key, browser_profile=str(user_data_dir))

    async def ensure_linkedin_session(self):
        try:
            await self.page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30000)
            await self.page.wait_for_timeout(2000)
            if "/login" in self.page.url or "/authwall" in self.page.url:
                write_state(state="Needs LinkedIn Login")
                logger.info("LinkedIn login required in isolated browser profile")
                await self.page.goto("https://www.linkedin.com/login", timeout=30000)
                await self.page.wait_for_url("**/feed/**", timeout=300000)
                logger.info("LinkedIn login detected and stored locally in isolated profile")
        except Exception as exc:
            logger.warning("LinkedIn session check failed: %s", exc)

    async def close_browser(self):
        if self.context:
            try:
                await self.context.close()
            except Exception as exc:
                logger.warning("Browser context close failed during recovery: %s", exc)
        self.context = None
        self.page = None

    async def ensure_browser_ready(self):
        if self.page and not self.page.is_closed():
            try:
                await self.page.evaluate("() => true")
                return
            except Exception as exc:
                logger.warning("Browser page health check failed; restarting context: %s", exc)
        logger.warning("Browser page is closed or unavailable; restarting isolated browser context")
        await self.close_browser()
        if not self.playwright:
            raise RuntimeError("Playwright runtime is not available")
        await self.start_browser(self.playwright)

    async def restart_browser_context(self):
        logger.warning("Restarting isolated browser context for recovery")
        await self.close_browser()
        if not self.playwright:
            raise RuntimeError("Playwright runtime is not available")
        await self.start_browser(self.playwright)

    @staticmethod
    def is_browser_recoverable_error(exc: Exception) -> bool:
        text = str(exc).lower()
        return any(part in text for part in (
            "target page, context or browser has been closed",
            "browsercontext.new_page",
            "target.createtarget",
            "failed to open a new tab",
            "protocol error",
        ))

    async def send_heartbeat(self, ws, session_active=True):
        write_state(
            state="Idle" if session_active and not self.running_job else read_state().get("state", "Idle"),
            connected=session_active,
            profile_key=self.profile_key,
            last_heartbeat=datetime.now(timezone.utc).isoformat(),
        )
        await ws.send(json.dumps({
            "type": "heartbeat",
            "profile_key": self.profile_key,
            "daily_sent": self.daily_sent,
            "session_active": session_active,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }))

    async def send_result(self, ws, task, status, message):
        await ws.send(json.dumps({
            "type": "result",
            "task_type": task.get("type"),
            "prospect_id": task.get("prospect_id"),
            "status": status,
            "message": message,
            "message_type": task.get("message_type"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }))

    async def safe_send_result(self, ws, task, status, message):
        try:
            await self.send_result(ws, task, status, message)
        except Exception as exc:
            logger.warning("Could not send WebSocket result update: %s", exc)

    async def safe_send_heartbeat(self, ws, session_active=True):
        try:
            await self.send_heartbeat(ws, session_active=session_active)
        except Exception as exc:
            logger.warning("Could not send WebSocket heartbeat update: %s", exc)

    def _api(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{self.backend_url}{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}

    async def api(self, method, path, body=None):
        return await asyncio.to_thread(self._api, method, path, body)

    def task_from_job(self, job):
        payload = job.get("payload") or {}
        job_type = job.get("job_type")
        if job_type == "send_connections":
            return {
                "type": "send_connection",
                "job_id": job["id"],
                "prospect_id": job.get("prospect_id"),
                "linkedin_url": payload.get("linkedin_url", ""),
                "note": payload.get("note", ""),
            }
        if job_type in ("send_messages", "send_followups"):
            return {
                "type": "send_message",
                "job_id": job["id"],
                "prospect_id": job.get("prospect_id"),
                "linkedin_url": payload.get("linkedin_url", ""),
                "message": payload.get("message", ""),
                "message_type": payload.get("message_type", "initial"),
            }
        if job_type == "check_acceptances":
            return {"type": "check_acceptances", "job_id": job["id"], **payload}
        if job_type == "detect_replies":
            return {"type": "check_replies", "job_id": job["id"], **payload}
        return {"type": job_type, "job_id": job["id"], **payload}

    async def run_job(self, ws, job):
        async with self.job_lock:
            if is_paused():
                write_state(state="Paused")
                return
            task = self.task_from_job(job)
            job_id = job["id"]
            self.running_job = job
            write_state(state="Running Job", current_job=job_id, current_job_type=job.get("job_type"))
            claimed = await self.api("POST", f"/jobs/{job_id}/claim?profile_key={self.profile_key}")
            if not claimed:
                self.running_job = None
                return
            await self.api("POST", f"/jobs/{job_id}/start")
            try:
                self.last_task_message = ""
                status = await self.handle_task(ws, task)
                result = {
                    "task_type": task.get("type"),
                    "status": status,
                    "prospect_id": task.get("prospect_id"),
                    "message_type": task.get("message_type"),
                    "message": self.last_task_message,
                }
                if status in ("error", "session_expired", "restricted", "limit_reached"):
                    await self.api("POST", f"/jobs/{job_id}/fail", {
                        "error_message": self.last_task_message or status,
                        "result": result,
                    })
                else:
                    await self.api("POST", f"/jobs/{job_id}/complete", {"result": result})
            except Exception as exc:
                await self.api("POST", f"/jobs/{job_id}/fail", {"error_message": str(exc), "result": {"task_type": task.get("type")}})
                raise
            finally:
                self.running_job = None
                write_state(state="Idle", current_job=None, current_job_type=None)

    async def poll_jobs_loop(self, ws):
        interval = max(5, int(self.config.get("job_polling_interval") or 15))
        while not self.stop_event.is_set():
            try:
                if is_paused():
                    write_state(state="Paused")
                    await asyncio.sleep(5)
                    continue
                write_state(state="Idle")
                data = await self.api("GET", f"/jobs/pending?profile_key={self.profile_key}&limit=5")
                for job in data.get("jobs", []):
                    await self.run_job(ws, job)
            except Exception as exc:
                logger.warning("Job poll failed: %s", exc)
            await asyncio.sleep(interval)

    async def handle_send_connection(self, ws, task):
        url = task.get("linkedin_url", "")
        note = task.get("note", "")
        prospect_id = task.get("prospect_id")

        if not prospect_id or not url:
            await self.send_result(ws, task, "error", "Missing prospect_id or linkedin_url")
            return "error"

        logger.info("Task: send_connection %s", url)
        result = await send_connection_request(self.page, url, note, self.profile_key)
        status = result.get("status", "error")
        message = result.get("message", "")
        self.last_task_message = message

        if status == "sent":
            self.daily_sent += 1

        await self.safe_send_result(ws, task, status, message)
        await self.safe_send_heartbeat(ws, session_active=status not in ("session_expired", "restricted"))
        return status

    async def handle_send_message(self, ws, task):
        url = task.get("linkedin_url", "")
        message_text = task.get("message", "")
        prospect_id = task.get("prospect_id")

        if not prospect_id or not url or not message_text:
            await self.send_result(ws, task, "error", "Missing prospect_id, linkedin_url, or message")
            return "error"

        logger.info("Task: send_message %s (%s)", url, task.get("message_type", "initial"))
        result = await send_message(self.page, url, message_text, self.profile_key)
        status = result.get("status", "error")
        message = result.get("message", "")
        self.last_task_message = message
        if status == "error":
            logger.warning("send_message failed for %s: %s", url, message)

        await self.safe_send_result(ws, task, status, message)
        await self.safe_send_heartbeat(ws, session_active=status not in ("session_expired", "restricted"))
        return status

    async def handle_check_acceptances(self, ws, task):
        logger.info("Task: check_acceptances")
        urls = await detect_accepted_connections(self.page, self.profile_key)
        await ws.send(json.dumps({
            "type": "accepted",
            "accepted_urls": urls,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }))
        return "completed"

    async def handle_check_replies(self, ws, task):
        logger.info("Task: check_replies")
        for prospect in task.get("prospects", []):
            result = await check_for_reply(
                self.page,
                prospect.get("first_name", ""),
                prospect.get("last_name", ""),
                self.profile_key,
            )
            if result.get("status") == "replied":
                await ws.send(json.dumps({
                    "type": "replied",
                    "prospect_id": prospect.get("prospect_id"),
                    "reply_preview": result.get("reply_text", "")[:200],
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }))
        return "completed"

    async def handle_task(self, ws, task):
        task_type = task.get("type")
        if task_type == "pending_jobs":
            for job in task.get("jobs", []):
                await self.run_job(ws, job)
            return "completed"
        try:
            async def run_task():
                await self.ensure_browser_ready()
                if task_type == "send_connection":
                    return await self.handle_send_connection(ws, task)
                elif task_type == "send_message":
                    return await self.handle_send_message(ws, task)
                elif task_type == "check_acceptances":
                    return await self.handle_check_acceptances(ws, task)
                elif task_type == "check_replies":
                    return await self.handle_check_replies(ws, task)
                else:
                    logger.warning("Unknown task type: %s", task_type)
                    return "error"

            return await asyncio.wait_for(run_task(), timeout=TASK_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            self.last_task_message = f"Agent task timed out after {TASK_TIMEOUT_SECONDS}s"
            logger.error("Task timed out after %ss: %s", TASK_TIMEOUT_SECONDS, task_type)
            await self.send_result(
                ws,
                task,
                "error",
                f"Agent task timed out after {TASK_TIMEOUT_SECONDS}s",
            )
            try:
                await self.page.close()
            except Exception:
                pass
            self.page = await self.context.new_page()
            return "error"
        except Exception as exc:
            if self.is_browser_recoverable_error(exc):
                logger.warning("Recoverable browser error during %s; restarting and retrying once: %s", task_type, exc)
                try:
                    await self.restart_browser_context()
                    return await asyncio.wait_for(run_task(), timeout=TASK_TIMEOUT_SECONDS)
                except Exception as retry_exc:
                    self.last_task_message = str(retry_exc)
                    logger.exception("Task retry failed after browser restart: %s", task_type)
                    await self.safe_send_result(ws, task, "error", str(retry_exc))
                    return "error"
            self.last_task_message = str(exc)
            logger.exception("Task failed: %s", task_type)
            await self.safe_send_result(ws, task, "error", str(exc))
            return "error"

    async def heartbeat_loop(self, ws):
        while not self.stop_event.is_set():
            try:
                await self.send_heartbeat(ws)
            except Exception:
                return
            await asyncio.sleep(30)

    async def run(self):
        setup_logging()
        logger.info("Starting LinkedFlow agent for %s", self.profile_key)
        logger.info("WebSocket: %s", self.ws_url)
        write_state(state="Connecting", profile_key=self.profile_key, backend_url=self.backend_url)

        async with async_playwright() as playwright:
            self.playwright = playwright
            await self.start_browser(playwright)
            try:
                while not self.stop_event.is_set():
                    try:
                        async with websockets.connect(
                            self.ws_url,
                            ping_interval=20,
                            ping_timeout=10,
                            open_timeout=20,
                        ) as ws:
                            logger.info("Connected to backend as %s", self.profile_key)
                            write_state(state="Idle", connected=True, last_connected=datetime.now(timezone.utc).isoformat())
                            await self.send_heartbeat(ws)
                            hb = asyncio.create_task(self.heartbeat_loop(ws))
                            poller = asyncio.create_task(self.poll_jobs_loop(ws))
                            await ws.send(json.dumps({"type": "get_pending_jobs"}))
                            try:
                                async for raw in ws:
                                    task = json.loads(raw)
                                    await self.handle_task(ws, task)
                            finally:
                                hb.cancel()
                                poller.cancel()
                    except Exception as exc:
                        logger.warning("Agent disconnected: %s. Reconnecting in 10s...", exc)
                        write_state(state="Offline", connected=False, error=str(exc))
                        await asyncio.sleep(10)
            finally:
                write_state(state="Offline", connected=False)
                await self.close_browser()


def main():
    parser = argparse.ArgumentParser(description="Persistent LinkedFlow WebSocket agent")
    parser.add_argument("--profile", default=None, help="LinkedIn profile key")
    args = parser.parse_args()

    agent = LinkedFlowAgent(args.profile)

    def stop(*_):
        agent.stop_event.set()

    try:
        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)
    except Exception:
        pass

    asyncio.run(agent.run())


if __name__ == "__main__":
    main()
