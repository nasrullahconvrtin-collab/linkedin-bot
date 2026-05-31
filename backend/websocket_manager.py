"""
WebSocket manager — handles real-time communication between the FastAPI backend
and the LinkedIn agent(s) running on employee PCs.

All WebSocket I/O is async; Supabase DB calls are synchronous (supabase-py).
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Dict

from fastapi import WebSocket

import database as db

logger = logging.getLogger("linkedin_bot")


class WebSocketManager:
    """Manages connected agents and routes tasks/results."""

    def __init__(self):
        # profile_key → WebSocket
        self.connected_agents: Dict[str, WebSocket] = {}

    # ── Connection lifecycle ──────────────────────────────────────────────────

    async def connect(self, profile_key: str, websocket: WebSocket):
        await websocket.accept()
        self.connected_agents[profile_key] = websocket
        db.db_upsert_profile(profile_key, {
            "session_active": True,
            "last_active": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"[WS] Agent connected: {profile_key}")

    def disconnect(self, profile_key: str):
        self.connected_agents.pop(profile_key, None)
        try:
            db.db_update_profile(profile_key, {"session_active": False})
        except Exception:
            pass
        logger.info(f"[WS] Agent disconnected: {profile_key}")

    def is_connected(self, profile_key: str) -> bool:
        return profile_key in self.connected_agents

    def connected_count(self) -> int:
        return len([k for k in self.connected_agents if k != "dashboard"])

    def connected_keys(self) -> list[str]:
        return [k for k in self.connected_agents.keys() if k != "dashboard"]

    # ── Sending tasks ─────────────────────────────────────────────────────────

    async def send_task(self, profile_key: str, task: dict) -> bool:
        ws = self.connected_agents.get(profile_key)
        if not ws:
            logger.warning(f"[WS] Agent {profile_key} not connected — task dropped")
            return False
        try:
            await ws.send_text(json.dumps(task))
            logger.info(f"[WS] Task sent to {profile_key}: {task.get('type')}")
            return True
        except Exception as e:
            logger.error(f"[WS] Send error to {profile_key}: {e}")
            self.disconnect(profile_key)
            return False

    async def broadcast(self, task: dict):
        """Send the same task to every connected agent."""
        stale = []
        for pk, ws in list(self.connected_agents.items()):
            try:
                await ws.send_text(json.dumps(task))
            except Exception as e:
                logger.error(f"[WS] Broadcast error to {pk}: {e}")
                stale.append(pk)
        for pk in stale:
            self.disconnect(pk)

    # ── Receiving results ─────────────────────────────────────────────────────

    async def handle_result(self, profile_key: str, raw: dict):
        """Dispatch incoming agent message to the correct handler."""
        msg_type = raw.get("type")
        logger.debug(f"[WS] Result from {profile_key}: {msg_type}")

        if msg_type == "heartbeat":
            self._handle_heartbeat(profile_key, raw)
            await self._push_pending_jobs(profile_key)

        elif msg_type == "get_pending_jobs":
            await self._push_pending_jobs(profile_key)

        elif msg_type == "claim_job":
            job = db.db_claim_job(raw.get("job_id"), profile_key)
            await self.send_task(profile_key, {"type": "job_claimed", "job": job})

        elif msg_type == "job_started":
            db.db_start_job(raw.get("job_id"))

        elif msg_type == "job_completed":
            db.db_complete_job(raw.get("job_id"), raw.get("result") or {})

        elif msg_type == "job_failed":
            db.db_fail_job(raw.get("job_id"), raw.get("error_message", "Job failed"), raw.get("result") or {})

        elif msg_type == "result":
            self._handle_action_result(profile_key, raw)

        elif msg_type == "accepted":
            self._handle_acceptances(raw.get("accepted_urls") or raw.get("urls", []), profile_key)

        elif msg_type == "replied":
            self._handle_reply(raw)

        else:
            logger.warning(f"[WS] Unknown message type from {profile_key}: {msg_type}")

    async def _push_pending_jobs(self, profile_key: str):
        if profile_key == "dashboard":
            return
        jobs = db.db_get_pending_jobs(profile_key)
        if jobs:
            await self.send_task(profile_key, {"type": "pending_jobs", "jobs": jobs})

    # ── Internal result handlers (all sync — DB calls are sync) ──────────────

    def _handle_heartbeat(self, profile_key: str, data: dict):
        db.db_upsert_profile(profile_key, {
            "daily_sent":     data.get("daily_sent", 0),
            "session_active": data.get("session_active", True),
            "last_active":    datetime.now(timezone.utc).isoformat(),
            "session_status": data.get("session_status"),
            "local_state":    data.get("local_state"),
            "runtime_mode":   data.get("runtime_mode"),
        })

    def _handle_action_result(self, profile_key: str, result: dict):
        prospect_id = result.get("prospect_id")
        status      = result.get("status", "")
        task_type   = result.get("task_type") or result.get("action", "")
        message     = result.get("message", "")
        today       = date.today().isoformat()

        if not prospect_id:
            prospect = db.db_get_prospect_by_linkedin_url(result.get("linkedin_url", ""))
            prospect_id = prospect.get("id") if prospect else None

        if not prospect_id:
            logger.warning("[WS] Result missing prospect_id and no URL match: %s", result)
            return

        # ── Connection results ────────────────────────────────────────────────
        if task_type == "send_connection":
            if status == "sent":
                db.db_update_prospect(prospect_id, {
                    "status":                "Connection Request Sent",
                    "connection_sent_date":  today,
                    "next_steps":            "Check acceptance in My Network",
                    "connection_status":     "invitation_sent",
                    "last_action_at":        datetime.now(timezone.utc).isoformat(),
                })
                prospect, _ = db.db_get_prospect(prospect_id)
                db.db_mark_invitation_sent(prospect or {"id": prospect_id}, profile_key)
                db.db_log_activity(prospect_id, "send_connection", "sent", message)

            elif status == "pending":
                db.db_update_prospect(prospect_id, {
                    "status":     "Connection Request Sent",
                    "next_steps": "Already pending — check acceptance",
                })
                prospect, _ = db.db_get_prospect(prospect_id)
                db.db_mark_invitation_sent(prospect or {"id": prospect_id}, profile_key)
                db.db_log_activity(prospect_id, "send_connection", "pending", message)

            elif status == "connected":
                transition = db.db_mark_prospect_connected(
                    prospect_id,
                    message or "Already connected",
                    profile_key=profile_key,
                )
                queued_job = transition.get("queued_job")
                if queued_job:
                    logger.info(
                        "[WS] Queued initial message job %s after already-connected result for %s",
                        queued_job.get("id"),
                        prospect_id,
                    )
                db.db_log_activity(prospect_id, "send_connection", "already_connected", message)

            elif status == "limit_reached":
                db.db_update_profile(profile_key, {"session_active": False})
                db.db_log_activity(prospect_id, "send_connection", "limit_reached", message)

            elif status == "session_expired":
                db.db_update_profile(profile_key, {"session_active": False})
                db.db_log_activity(prospect_id, "send_connection", "session_expired", message)

            elif status in ("not_found", "private", "cannot_connect"):
                db.db_update_prospect(prospect_id, {
                    "status":     status,
                    "next_steps": message[:200],
                })
                db.db_log_activity(prospect_id, "send_connection", status, message)

            else:
                db.db_log_activity(prospect_id, "send_connection", status, message)

        # ── Message results ───────────────────────────────────────────────────
        elif task_type == "send_message":
            msg_type_field = result.get("message_type") or result.get("msg_type", "initial")

            if status == "message_sent":
                self._apply_message_sent(prospect_id, msg_type_field, today)
            elif status == "session_expired":
                db.db_update_profile(profile_key, {"session_active": False})
                db.db_log_activity(prospect_id, "send_message", "session_expired", message)
            else:
                db.db_log_activity(prospect_id, "send_message", status, message)

    def _apply_message_sent(self, prospect_id: str, msg_type: str, today: str):
        """Update prospect and log after a successful message send."""
        next_job = None
        for enrollment in db.db_get_active_enrollments_for_prospect(prospect_id):
            current_step = int(enrollment.get("current_step_order") or 0)
            if current_step:
                next_job = db.db_queue_next_campaign_step(
                    enrollment["campaign_id"],
                    prospect_id,
                    current_step,
                )
                break

        if msg_type == "initial":
            db.db_update_prospect(prospect_id, {
                "status":             "Initial Message Sent",
                "message_sent_date":  today,
                "initial_message_sent_at": datetime.now(timezone.utc).isoformat(),
                "last_action_at":     datetime.now(timezone.utc).isoformat(),
                "next_steps":         db._next_steps_for_queued_job(next_job),
            })
            db.db_log_activity(prospect_id, "send_message", "initial_sent",
                               "Initial message delivered")

        elif msg_type == "followup_1":
            fallback = db.add_working_days(date.today(), 5).isoformat()
            db.db_update_prospect(prospect_id, {
                "status":     "Following Up",
                "next_steps": db._next_steps_for_queued_job(next_job) if next_job else f"Follow-up 2 on {fallback}",
            })
            db.db_log_activity(prospect_id, "send_message", "followup_1_sent",
                               "Follow-up 1 delivered")

        elif msg_type == "followup_2":
            fallback = db.add_working_days(date.today(), 5).isoformat()
            db.db_update_prospect(prospect_id, {
                "status":     "Following Up",
                "next_steps": db._next_steps_for_queued_job(next_job) if next_job else f"Follow-up 3 on {fallback}",
            })
            db.db_log_activity(prospect_id, "send_message", "followup_2_sent",
                               "Follow-up 2 delivered")

        elif msg_type == "followup_3":
            fallback = db.add_working_days(date.today(), 5).isoformat()
            db.db_update_prospect(prospect_id, {
                "status":     "Following Up",
                "next_steps": db._next_steps_for_queued_job(next_job) if next_job else f"Follow-up 4 on {fallback}",
            })
            db.db_log_activity(prospect_id, "send_message", "followup_3_sent",
                               "Follow-up 3 delivered")

        elif msg_type == "followup_4":
            db.db_update_prospect(prospect_id, {
                "status":     "No Response",
                "next_steps": db._next_steps_for_queued_job(next_job),
            })
            db.db_log_activity(prospect_id, "send_message", "followup_4_sent",
                               "Follow-up 4 delivered — sequence complete")

    def _handle_acceptances(self, accepted_urls: list[str], profile_key: str):
        """Match accepted URLs against Connection Request Sent rows."""
        today = date.today().isoformat()
        accepted_set = {
            u.strip().rstrip("/").lower() for u in accepted_urls if u
        }
        if not accepted_set:
            return

        sent_prospects = db.db_get_prospects_by_status("Connection Request Sent")
        for p in sent_prospects:
            p_url = (p.get("linkedin_url") or "").strip().rstrip("/").lower()
            if p_url in accepted_set:
                transition = db.db_mark_prospect_connected(
                    p["id"],
                    f"Connection accepted - {p.get('first_name')} {p.get('last_name')}",
                    profile_key=profile_key,
                )
                queued_job = transition.get("queued_job")
                if queued_job:
                    logger.info(
                        "[WS] Queued initial message job %s after acceptance for %s",
                        queued_job.get("id"),
                        p["id"],
                    )
                db.db_log_activity(
                    p["id"],
                    "check_acceptances",
                    "accepted",
                    f"Connection accepted — {p.get('first_name')} {p.get('last_name')}",
                )
                logger.info(
                    f"[WS] Connection accepted: {p.get('first_name')} {p.get('last_name')}"
                )

    def _handle_reply(self, result: dict):
        prospect_id   = result.get("prospect_id")
        reply_preview = result.get("reply_preview", "")
        today         = date.today().isoformat()

        if not prospect_id:
            prospect = db.db_get_prospect_by_linkedin_url(result.get("linkedin_url", ""))
            prospect_id = prospect.get("id") if prospect else None

        if not prospect_id:
            logger.warning("[WS] Reply missing prospect_id and no URL match: %s", result)
            return

        db.db_update_prospect(prospect_id, {
            "status":     "Replied",
            "reply_date": today,
            "reply_type": "LinkedIn DM",
            "notes":      reply_preview[:200],
            "next_steps": "Manual Follow-up Required",
        })
        db.db_log_activity(
            prospect_id,
            "check_replies",
            "replied",
            f"Reply detected: {reply_preview[:100]}",
        )
        logger.info(f"[WS] Reply logged for prospect {prospect_id}")


# Singleton used throughout the app
manager = WebSocketManager()
