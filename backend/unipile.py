"""
LinkedFlow — Unipile Integration Service
Handles real LinkedIn actions (Connection Invites, Messaging, Profile Sync) via Unipile REST API.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional
import httpx

logger = logging.getLogger("linkedin_bot.unipile")

UNIPILE_API_KEY = os.getenv("UNIPILE_API_KEY", "qptpLmjx.T+kOGzVxBXwCbJLYd6RlSxMa+b3Gc7XacSXoWNejkA4=")
UNIPILE_DSN = os.getenv("UNIPILE_DSN", "api20.unipile.com:15032")
UNIPILE_BASE_URL = os.getenv(
    "UNIPILE_API_URL",
    f"https://{UNIPILE_DSN}" if UNIPILE_DSN.startswith("http") else f"https://{UNIPILE_DSN}/api/v1"
)

DEFAULT_ACCOUNT_ID = "bBzuBoeOQAuBCQNFu7shyQ"


def get_headers() -> Dict[str, str]:
    return {
        "X-API-KEY": UNIPILE_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def get_active_account_id() -> str:
    """Fetch the connected single LinkedIn account ID from Unipile, or fallback to default."""
    if not UNIPILE_API_KEY:
        return DEFAULT_ACCOUNT_ID

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(f"{UNIPILE_BASE_URL}/accounts", headers=get_headers())
            if resp.status_code == 200:
                data = resp.json()
                items = data.get("items") or data.get("accounts") or (data if isinstance(data, list) else [])
                if items and isinstance(items, list) and len(items) > 0:
                    account_id = items[0].get("id") or items[0].get("account_id")
                    if account_id:
                        return account_id
    except Exception as exc:
        logger.error("Failed to fetch active Unipile account: %s", exc)

    return DEFAULT_ACCOUNT_ID


def send_connection_invite(
    provider_id_or_url: str,
    message: Optional[str] = None,
    account_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Send a real LinkedIn connection request via Unipile POST /users/invite.
    """
    acc_id = account_id or get_active_account_id()
    if not UNIPILE_API_KEY:
        logger.warning("[Mock Unipile] Sending connection request to %s", provider_id_or_url)
        return {"success": True, "invite_id": f"mock_inv_{provider_id_or_url}"}

    payload = {
        "account_id": acc_id,
        "provider_id": provider_id_or_url,
    }
    if message and message.strip():
        payload["message"] = message.strip()

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(f"{UNIPILE_BASE_URL}/users/invite", headers=get_headers(), json=payload)
            if resp.status_code in (200, 201, 202):
                data = resp.json() if resp.content else {}
                return {
                    "success": True,
                    "invite_id": data.get("id") or data.get("invite_id") or "sent",
                    "status": "sent",
                }
            
            error_text = resp.text
            logger.error("Unipile invite error (%d): %s", resp.status_code, error_text)
            return {
                "success": False,
                "error": f"Unipile API ({resp.status_code}): {error_text}",
                "status": "failed",
            }
    except Exception as exc:
        logger.error("Unipile send_connection_invite exception: %s", exc)
        return {"success": False, "error": str(exc), "status": "failed"}


def send_linkedin_message(
    attendee_id_or_url: str,
    text: str,
    account_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Send a real LinkedIn message via Unipile POST /chats.
    """
    acc_id = account_id or get_active_account_id()
    if not UNIPILE_API_KEY:
        logger.warning("[Mock Unipile] Sending message to %s: %s", attendee_id_or_url, text)
        return {"success": True, "chat_id": f"mock_chat_{attendee_id_or_url}"}

    payload = {
        "account_id": acc_id,
        "attendees_ids": [attendee_id_or_url],
        "text": text,
    }

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(f"{UNIPILE_BASE_URL}/chats", headers=get_headers(), json=payload)
            if resp.status_code in (200, 201, 202):
                data = resp.json() if resp.content else {}
                return {
                    "success": True,
                    "chat_id": data.get("id") or data.get("chat_id") or "sent",
                    "status": "message_sent",
                }

            error_text = resp.text
            logger.error("Unipile message error (%d): %s", resp.status_code, error_text)
            return {
                "success": False,
                "error": f"Unipile API ({resp.status_code}): {error_text}",
                "status": "failed",
            }
    except Exception as exc:
        logger.error("Unipile send_linkedin_message exception: %s", exc)
        return {"success": False, "error": str(exc), "status": "failed"}


def get_connected_accounts() -> List[Dict[str, Any]]:
    """Retrieve connected accounts from Unipile."""
    if not UNIPILE_API_KEY:
        return []

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(f"{UNIPILE_BASE_URL}/accounts", headers=get_headers())
            if resp.status_code == 200:
                data = resp.json()
                return data.get("items") or data.get("accounts") or (data if isinstance(data, list) else [])
    except Exception as exc:
        logger.error("Unipile get_connected_accounts exception: %s", exc)

    return []
