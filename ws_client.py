"""
WebSocket client for real-time communication with the LinkedFlow backend.

Each LinkedIn profile gets its own AgentWSClient instance.  The client
connects to the backend WS endpoint and forwards every agent action so the
dashboard updates live.  All sends are fire-and-forget: failures are logged
but never raised, so CSV writes and the automation run continue regardless of
connectivity.

Requires: pip install websockets
"""
import json
import logging
from datetime import datetime, timezone

from config import WS_BASE_URL

logger = logging.getLogger("linkedin_bot")


class AgentWSClient:
    """
    Async context-manager WebSocket client for one LinkedIn profile.

    Usage
    -----
    async with AgentWSClient("profile_1") as ws:
        await ws.send_heartbeat(daily_sent=0, session_active=True)
        await ws.send_connection_result(url, "sent")
        await ws.send_message_result(url, "initial", "message_sent")
        await ws.send_accepted_batch(list_of_urls)
        await ws.send_reply(url, reply_text)
    """

    def __init__(self, profile_key: str) -> None:
        self.profile_key = profile_key
        self.url = f"{WS_BASE_URL}/{profile_key}"
        self._ws = None
        self.connected = False

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def connect(self) -> None:
        try:
            import websockets  # optional dependency — lazy import
            self._ws = await websockets.connect(
                self.url,
                ping_interval=20,
                ping_timeout=10,
                open_timeout=10,
            )
            self.connected = True
            logger.info(f"[WS:{self.profile_key}] Connected to backend")
        except ImportError:
            logger.warning(
                "[WS] 'websockets' library not installed — run: pip install websockets"
            )
            self.connected = False
        except Exception as exc:
            logger.warning(
                f"[WS:{self.profile_key}] Connection failed ({exc}) — running offline"
            )
            self.connected = False

    async def disconnect(self) -> None:
        if self._ws and self.connected:
            try:
                await self._ws.close()
                logger.info(f"[WS:{self.profile_key}] Disconnected")
            except Exception:
                pass
        self.connected = False
        self._ws = None

    async def __aenter__(self) -> "AgentWSClient":
        await self.connect()
        return self

    async def __aexit__(self, *_) -> None:
        await self.disconnect()

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _send(self, payload: dict) -> None:
        """Serialize and send payload; silently swallows all errors."""
        if not self.connected or self._ws is None:
            return
        try:
            await self._ws.send(json.dumps(payload))
        except Exception as exc:
            logger.warning(f"[WS:{self.profile_key}] Send failed: {exc}")
            self.connected = False  # mark offline — further sends become no-ops

    # ── Public message senders ────────────────────────────────────────────────

    async def send_heartbeat(
        self, daily_sent: int = 0, session_active: bool = True
    ) -> None:
        """
        Upsert the profile row in the backend DB:
        sets daily_sent, session_active, last_active.
        """
        await self._send(
            {
                "type": "heartbeat",
                "profile_key": self.profile_key,
                "daily_sent": daily_sent,
                "session_active": session_active,
                "last_active": datetime.now(timezone.utc).isoformat(),
            }
        )
        logger.debug(
            f"[WS:{self.profile_key}] Heartbeat sent (daily_sent={daily_sent})"
        )

    async def send_connection_result(
        self, linkedin_url: str, status: str
    ) -> None:
        """
        Notify backend of a send_connection attempt.

        status values:
          "sent"          — backend sets Status = 'Connection Request Sent'
          "pending"       — already pending, backend ignores
          "connected"     — already connected
          "limit_reached" / "restricted" / "not_found" / etc.
        """
        await self._send(
            {
                "type": "result",
                "task_type": "send_connection",
                "action": "send_connection",
                "profile_key": self.profile_key,
                "linkedin_url": linkedin_url,
                "status": status,
                "message": status,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

    async def send_message_result(
        self, linkedin_url: str, msg_type: str, status: str
    ) -> None:
        """
        Notify backend of a send_message attempt.

        msg_type: "initial" | "followup_1" | "followup_2" | "followup_3" | "followup_4"
        status:   "message_sent" | "error" | ...

        Backend status transitions:
          initial    → 'Initial Message Sent', schedules FU1 +2 days
          followup_1 → 'Following Up', schedules FU2 +5 working days
          followup_2 → 'Following Up', schedules FU3 +5 working days
          followup_3 → 'Following Up', schedules FU4 +5 working days
          followup_4 → 'No Response'
        """
        await self._send(
            {
                "type": "result",
                "task_type": "send_message",
                "action": "send_message",
                "profile_key": self.profile_key,
                "linkedin_url": linkedin_url,
                "message_type": msg_type,
                "msg_type": msg_type,
                "status": status,
                "message": status,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

    async def send_accepted_batch(self, urls: list) -> None:
        """
        Send the full list of profile URLs scraped from My Network.
        Backend matches them against 'Connection Request Sent' rows and
        promotes matches to 'Connection Accepted'.
        """
        if not urls:
            return
        await self._send(
            {
                "type": "accepted",
                "profile_key": self.profile_key,
                "accepted_urls": list(urls),
                "urls": list(urls),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        logger.debug(
            f"[WS:{self.profile_key}] Sent accepted batch ({len(urls)} URLs)"
        )

    async def send_reply(self, linkedin_url: str, reply_preview: str) -> None:
        """
        Notify backend that a prospect has replied.
        Backend sets Status = 'Replied' and stores the reply preview.
        """
        await self._send(
            {
                "type": "replied",
                "profile_key": self.profile_key,
                "linkedin_url": linkedin_url,
                "reply_preview": reply_preview[:200],
            }
        )
