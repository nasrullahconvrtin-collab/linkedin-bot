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

UNIPILE_API_KEY = os.getenv("UNIPILE_API_KEY", "6SlhX8Ii.R7wP5y2dLTREmrXKCTpnoEg3clwHKT9wZtIc++MRAkg=")
UNIPILE_DSN = os.getenv("UNIPILE_DSN", "api20.unipile.com:15032")
UNIPILE_BASE_URL = os.getenv(
    "UNIPILE_API_URL",
    f"https://{UNIPILE_DSN}" if UNIPILE_DSN.startswith("http") else f"https://{UNIPILE_DSN}/api/v1"
)

DEFAULT_ACCOUNT_ID = "zXneBg9WRZ-m7iFuKULo1Q"


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


def get_unipile_account_info(account_id: Optional[str] = None) -> Dict[str, Any]:
    """Fetch detailed profile information for a connected account from Unipile."""
    acc_id = account_id or get_active_account_id()
    if not UNIPILE_API_KEY:
        return {
            "id": acc_id,
            "name": "Maryam Ansar",
            "username": "maryamansar",
            "provider": "LINKEDIN",
            "status": "CONNECTED",
            "headline": "LinkedIn Outreach Specialist",
        }

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(f"{UNIPILE_BASE_URL}/accounts/{acc_id}", headers=get_headers())
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "id": data.get("id") or acc_id,
                    "name": data.get("name") or data.get("username") or "Maryam Ansar",
                    "username": data.get("username") or data.get("email") or "maryamansar",
                    "provider": data.get("provider") or "LINKEDIN",
                    "status": data.get("status") or "CONNECTED",
                    "headline": data.get("headline") or "LinkedIn Profile",
                    "avatar": data.get("avatar") or data.get("profile_picture_url"),
                }
    except Exception as exc:
        logger.error("Unipile get_unipile_account_info exception: %s", exc)

    return {
        "id": acc_id,
        "name": "Maryam Ansar",
        "username": "maryamansar",
        "provider": "LINKEDIN",
        "status": "CONNECTED",
    }


def connect_linkedin_direct(username: str, password: Optional[str] = None) -> Dict[str, Any]:
    """Connect LinkedIn profile directly in-app via Unipile username/password."""
    if not UNIPILE_API_KEY:
        return {"success": True, "account_id": f"acc_mock_{secrets.token_hex(4)}", "name": username}

    payload: dict = {
        "provider_name": "LINKEDIN",
        "provider": "LINKEDIN",
        "username": username,
    }
    if password:
        payload["password"] = password

    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(f"{UNIPILE_BASE_URL}/accounts", headers=get_headers(), json=payload)
            data = resp.json() if resp.content else {}
            if resp.status_code == 202 or data.get("checkpoint") or data.get("checkpoint_type"):
                return {
                    "success": False,
                    "checkpoint_required": True,
                    "checkpoint_type": data.get("checkpoint_type") or "2FA",
                    "account_id": data.get("account_id") or data.get("id"),
                }
            if resp.status_code in (200, 201):
                return {
                    "success": True,
                    "account_id": data.get("account_id") or data.get("id"),
                    "name": data.get("name") or username,
                }
            return {"success": False, "error": data.get("message") or f"Unipile error {resp.status_code}"}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def connect_linkedin_cookie(cookie_val: str) -> Dict[str, Any]:
    """Connect LinkedIn profile via li_at session cookie."""
    if not UNIPILE_API_KEY:
        return {"success": True, "account_id": f"acc_cookie_{secrets.token_hex(4)}", "name": "LinkedIn Profile (Cookie)"}

    payload = {
        "provider_name": "LINKEDIN",
        "access_token": cookie_val.strip(),
    }
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(f"{UNIPILE_BASE_URL}/accounts", headers=get_headers(), json=payload)
            data = resp.json() if resp.content else {}
            if resp.status_code in (200, 201):
                return {
                    "success": True,
                    "account_id": data.get("account_id") or data.get("id"),
                    "name": data.get("name") or "Connected LinkedIn Account",
                }
            return {"success": False, "error": data.get("message") or f"Cookie auth error {resp.status_code}"}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def submit_2fa_code(account_id: str, code: str) -> Dict[str, Any]:
    """Submit 2FA / OTP code to resolve authentication checkpoint."""
    if not UNIPILE_API_KEY:
        return {"success": True, "account_id": account_id}

    payload = {
        "account_id": account_id,
        "provider_name": "LINKEDIN",
        "code": code,
    }
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(f"{UNIPILE_BASE_URL}/accounts/checkpoint", headers=get_headers(), json=payload)
            data = resp.json() if resp.content else {}
            if resp.status_code in (200, 201):
                return {"success": True, "account_id": data.get("account_id") or account_id}
            return {"success": False, "error": data.get("message") or "2FA verification failed"}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def list_connections(account_id: str = None, cursor: str = None) -> List[Dict[str, Any]]:
    acc_id = account_id or DEFAULT_UNIPILE_ACCOUNT_ID
    all_items = []
    curr_cursor = cursor
    for _ in range(20):
        url = f"{UNIPILE_BASE_URL}/users/relations?account_id={acc_id}&limit=100"
        return {"success": False, "error": str(exc)}


def list_invitations(account_id: Optional[str] = None) -> Dict[str, Any]:
    """List pending outbound invitations."""
    acc_id = account_id or get_active_account_id()
    if not UNIPILE_API_KEY:
        return {"success": True, "invitations": []}

    try:
        url = f"{UNIPILE_BASE_URL}/users/invites/sent?account_id={acc_id}"
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(url, headers=get_headers())
            if resp.status_code == 200:
                data = resp.json()
                items = data.get("items") or data.get("invitations") or (data if isinstance(data, list) else [])
                return {"success": True, "invitations": items}
            return {"success": False, "invitations": []}
    except Exception as exc:
        logger.error("list_invitations exception: %s", exc)
        return {"success": False, "invitations": []}


def cancel_invitation(invitation_id: str) -> Dict[str, Any]:
    """Cancel / withdraw a pending connection invitation."""
    if not UNIPILE_API_KEY:
        return {"success": True}

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.delete(f"{UNIPILE_BASE_URL}/users/invitations/{invitation_id}", headers=get_headers())
            if resp.status_code in (200, 204):
                return {"success": True}
            return {"success": False, "error": resp.text}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def withdraw_old_invitations(account_id: Optional[str] = None, max_age_days: int = 90) -> Dict[str, Any]:
    """Withdraw pending outbound invitations older than max_age_days (e.g. 7, 30, 60, 90)."""
    inv_res = list_invitations(account_id)
    invitations = inv_res.get("invitations") or []
    cutoff_ms = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).timestamp() * 1000

    withdrawn_count = 0
    for inv in invitations:
        sent_ts = inv.get("sent_at") or inv.get("created_at") or inv.get("timestamp")
        inv_ms = 0
        if sent_ts:
            try:
                inv_ms = datetime.fromisoformat(str(sent_ts).replace("Z", "+00:00")).timestamp() * 1000
            except Exception:
                inv_ms = 0

        if inv_ms > 0 and inv_ms <= cutoff_ms:
            inv_id = inv.get("id") or inv.get("invitation_id")
            if inv_id:
                res = cancel_invitation(inv_id)
                if res.get("success"):
                    withdrawn_count += 1

    return {"success": True, "withdrawn_count": withdrawn_count}

