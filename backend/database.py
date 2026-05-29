"""
Supabase client and all database query functions.
All functions are synchronous (supabase-py uses the sync client by default).
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta, timezone

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

logger = logging.getLogger("linkedin_bot")

SUPABASE_URL: str = os.environ["SUPABASE_URL"]
SUPABASE_KEY: str = os.environ["SUPABASE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ── Date helpers ──────────────────────────────────────────────────────────────

def add_working_days(start: date, days: int) -> date:
    current = start
    added = 0
    while added < days:
        current += timedelta(days=1)
        if current.weekday() < 5:          # Mon=0 … Fri=4
            added += 1
    return current


# ── Campaigns ─────────────────────────────────────────────────────────────────

def db_get_all_campaigns() -> list[dict]:
    result = (
        supabase.table("campaigns")
        .select("*")
        .order("created_at", desc=True)
        .execute()
    )
    campaigns = result.data or []
    for c in campaigns:
        cnt = (
            supabase.table("prospects")
            .select("id", count="exact")
            .eq("campaign_id", c["id"])
            .execute()
        )
        c["prospect_count"] = cnt.count or 0
    return campaigns


def db_create_campaign(name: str) -> dict | None:
    result = (
        supabase.table("campaigns")
        .insert({"name": name, "status": "active"})
        .execute()
    )
    return result.data[0] if result.data else None


def db_get_campaign(campaign_id: str) -> tuple[dict | None, dict | None]:
    result = (
        supabase.table("campaigns").select("*").eq("id", campaign_id).execute()
    )
    if not result.data:
        return None, None

    campaign = result.data[0]
    prospects_res = (
        supabase.table("prospects")
        .select("status")
        .eq("campaign_id", campaign_id)
        .execute()
    )
    rows = prospects_res.data or []
    stats = {
        "total":        len(rows),
        "sent":         sum(1 for r in rows if r["status"] == "Connection Request Sent"),
        "accepted":     sum(1 for r in rows if r["status"] == "Connection Accepted"),
        "messaged":     sum(1 for r in rows if r["status"] == "Initial Message Sent"),
        "following_up": sum(1 for r in rows if r["status"] == "Following Up"),
        "replied":      sum(1 for r in rows if r["status"] == "Replied"),
        "no_response":  sum(1 for r in rows if r["status"] == "No Response"),
    }
    return campaign, stats


def db_delete_campaign(campaign_id: str):
    supabase.table("prospects").delete().eq("campaign_id", campaign_id).execute()
    supabase.table("campaigns").delete().eq("id", campaign_id).execute()


# ── Prospects ─────────────────────────────────────────────────────────────────

def db_get_prospects(
    campaign_id: str | None = None,
    status: str | None = None,
    assigned_account: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    query = supabase.table("prospects").select("*", count="exact")
    if campaign_id:
        query = query.eq("campaign_id", campaign_id)
    if status is not None:
        query = query.eq("status", status)
    if assigned_account:
        query = query.eq("assigned_account", assigned_account)
    result = (
        query.order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return result.data or [], result.count or 0


def db_create_prospect(data: dict) -> dict | None:
    result = supabase.table("prospects").insert(data).execute()
    return result.data[0] if result.data else None


def db_create_or_update_prospect(data: dict) -> tuple[str, dict | None]:
    """Create/update by linkedin_url. Returns ('created'|'updated'|'skipped', row)."""
    linkedin_url = (data.get("linkedin_url") or "").strip()
    if not linkedin_url:
        return "skipped", None

    existing = db_get_prospect_by_linkedin_url(linkedin_url)
    initial = (data.get("initial_message") or "").strip()
    if existing:
        clean = {k: v for k, v in data.items() if v not in (None, "")}
        if initial and existing.get("status") in ("Needs Personalization", "Connection Accepted", None, ""):
            clean["status"] = "Ready to Send"
        updated = db_update_prospect(existing["id"], clean)
        return "updated", updated or existing

    if initial and data.get("status") in ("Needs Personalization", "Connection Accepted"):
        data["status"] = "Ready to Send"
    created = db_create_prospect(data)
    return "created", created


def db_bulk_create_prospects(rows: list[dict]) -> int:
    if not rows:
        return 0
    result = supabase.table("prospects").insert(rows).execute()
    return len(result.data) if result.data else 0


def db_get_prospect(prospect_id: str) -> tuple[dict | None, list[dict]]:
    result = (
        supabase.table("prospects").select("*").eq("id", prospect_id).execute()
    )
    if not result.data:
        return None, []
    prospect = result.data[0]
    log_res = (
        supabase.table("activity_log")
        .select("*")
        .eq("prospect_id", prospect_id)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    return prospect, log_res.data or []


def db_update_prospect(prospect_id: str, data: dict) -> dict | None:
    clean = {k: v for k, v in data.items() if v is not None}
    if not clean:
        return None
    result = (
        supabase.table("prospects").update(clean).eq("id", prospect_id).execute()
    )
    return result.data[0] if result.data else None


def db_get_prospect_by_linkedin_url(linkedin_url: str) -> dict | None:
    """Find one prospect by LinkedIn URL, trying both slash variants."""
    url = (linkedin_url or "").strip()
    if not url:
        return None

    stripped = url.rstrip("/")
    variants = [url]
    if stripped and stripped != url:
        variants.append(stripped)
    elif stripped:
        variants.append(stripped + "/")

    seen = set()
    for candidate in variants:
        if candidate in seen:
            continue
        seen.add(candidate)
        result = (
            supabase.table("prospects")
            .select("*")
            .eq("linkedin_url", candidate)
            .limit(1)
            .execute()
        )
        if result.data:
            return result.data[0]
    return None


def db_delete_prospect(prospect_id: str):
    supabase.table("activity_log").delete().eq("prospect_id", prospect_id).execute()
    supabase.table("prospects").delete().eq("id", prospect_id).execute()


def db_get_pending_prospects(assigned_account: str | None = None) -> list[dict]:
    """Status is empty string or NULL."""
    q1 = supabase.table("prospects").select("*").eq("status", "")
    q2 = supabase.table("prospects").select("*").is_("status", "null")
    if assigned_account:
        q1 = q1.eq("assigned_account", assigned_account)
        q2 = q2.eq("assigned_account", assigned_account)
    return (q1.execute().data or []) + (q2.execute().data or [])


def db_get_prospects_by_status(
    status: str, assigned_account: str | None = None
) -> list[dict]:
    query = supabase.table("prospects").select("*").eq("status", status)
    if assigned_account:
        query = query.eq("assigned_account", assigned_account)
    return query.execute().data or []


def db_get_followups_due_today() -> list[dict]:
    today_str = date.today().strftime("%Y-%m-%d")
    result = (
        supabase.table("prospects")
        .select("*")
        .like("next_steps", f"%{today_str}%")
        .execute()
    )
    return result.data or []


def db_get_active_prospects() -> list[dict]:
    result = (
        supabase.table("prospects")
        .select("*")
        .in_("status", ["Initial Message Sent", "Following Up"])
        .execute()
    )
    return result.data or []


def db_get_needs_personalization(limit: int = 500, offset: int = 0) -> tuple[list[dict], int]:
    """Prospects explicitly marked Needs Personalization, plus accepted without initial message."""
    needs = (
        supabase.table("prospects")
        .select("*", count="exact")
        .eq("status", "Needs Personalization")
        .range(offset, offset + limit - 1)
        .execute()
    )
    accepted = (
        supabase.table("prospects")
        .select("*")
        .eq("status", "Connection Accepted")
        .execute()
    )
    accepted_rows = [
        row for row in (accepted.data or [])
        if not (row.get("initial_message") or "").strip()
    ]
    rows = (needs.data or []) + accepted_rows
    dedup = {}
    for row in rows:
        dedup[row["id"]] = row
    return list(dedup.values()), (needs.count or 0) + len(accepted_rows)


# ── Activity Log ──────────────────────────────────────────────────────────────

def db_log_activity(
    prospect_id: str, action: str, result: str, details: str | None = None
) -> dict | None:
    data: dict = {"prospect_id": prospect_id, "action": action, "result": result}
    if details:
        data["details"] = details
    res = supabase.table("activity_log").insert(data).execute()
    return res.data[0] if res.data else None


def db_get_activity_log(
    prospect_id: str | None = None, limit: int = 50
) -> list[dict]:
    query = (
        supabase.table("activity_log")
        .select("*, prospects(first_name, last_name, company)")
        .order("created_at", desc=True)
        .limit(limit)
    )
    if prospect_id:
        query = query.eq("prospect_id", prospect_id)
    entries = query.execute().data or []
    for entry in entries:
        p = entry.pop("prospects", None) or {}
        entry["prospect_name"] = (
            f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
        )
        entry["prospect_company"] = p.get("company", "")
    return entries


# ── LinkedIn Profiles ─────────────────────────────────────────────────────────

def db_get_all_profiles() -> list[dict]:
    db_mark_stale_profiles_offline()
    return (
        supabase.table("linkedin_profiles")
        .select("*")
        .order("profile_key")
        .execute()
        .data or []
    )


def db_create_profile(profile_key: str, display_name: str) -> dict | None:
    data = {
        "profile_key": profile_key,
        "display_name": display_name,
        "session_active": False,
        "daily_sent": 0,
    }
    result = supabase.table("linkedin_profiles").insert(data).execute()
    return result.data[0] if result.data else None


def db_update_profile(profile_key: str, data: dict) -> dict | None:
    clean = {k: v for k, v in data.items() if v is not None}
    if not clean:
        return None
    result = (
        supabase.table("linkedin_profiles")
        .update(clean)
        .eq("profile_key", profile_key)
        .execute()
    )
    return result.data[0] if result.data else None


def db_mark_stale_profiles_offline(seconds: int = 90):
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()
    try:
        supabase.table("linkedin_profiles").update({"session_active": False}).lt("last_active", cutoff).execute()
    except Exception as exc:
        logger.warning("Could not mark stale profiles offline: %s", exc)


def db_upsert_profile(profile_key: str, updates: dict) -> dict | None:
    """Create the profile row if it doesn't exist, otherwise update it."""
    updates["profile_key"] = profile_key
    result = (
        supabase.table("linkedin_profiles")
        .upsert(updates, on_conflict="profile_key")
        .execute()
    )
    return result.data[0] if result.data else None


def db_get_profile(profile_key: str) -> dict | None:
    result = (
        supabase.table("linkedin_profiles")
        .select("*")
        .eq("profile_key", profile_key)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


# ── Jobs ─────────────────────────────────────────────────────────────────────

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def db_create_job(data: dict) -> dict | None:
    payload = {
        "job_type": data["job_type"],
        "profile_key": data.get("profile_key") or "profile_1",
        "campaign_id": data.get("campaign_id"),
        "prospect_id": data.get("prospect_id"),
        "status": data.get("status", "pending"),
        "priority": data.get("priority", 5),
        "scheduled_for": data.get("scheduled_for") or _utc_now(),
        "payload": data.get("payload") or {},
        "max_retries": data.get("max_retries", 3),
    }
    result = supabase.table("jobs").insert(payload).execute()
    return result.data[0] if result.data else None


def db_has_active_job_for_prospect(job_type: str, prospect_id: str) -> bool:
    """Return true when a non-terminal job already exists for this prospect."""
    if not prospect_id:
        return False
    result = (
        supabase.table("jobs")
        .select("id")
        .eq("job_type", job_type)
        .eq("prospect_id", prospect_id)
        .in_("status", ["pending", "retrying", "claimed", "running"])
        .limit(1)
        .execute()
    )
    return bool(result.data)


def db_create_initial_message_job_if_ready(prospect: dict, reason: str = "") -> dict | None:
    """
    Queue the first-message job exactly once for a connected prospect.
    This is intentionally conservative: no message text means no job.
    """
    if not prospect:
        return None

    prospect_id = prospect.get("id")
    initial_message = (prospect.get("initial_message") or "").strip()
    if not prospect_id or not initial_message:
        return None

    if prospect.get("message_sent_date"):
        logger.info("Initial message already sent for prospect %s", prospect_id)
        return None

    if prospect.get("status") in ("Initial Message Sent", "Following Up", "Replied", "No Response"):
        logger.info(
            "Prospect %s is past initial-message stage (%s); not queueing",
            prospect_id,
            prospect.get("status"),
        )
        return None

    if db_has_active_job_for_prospect("send_messages", prospect_id):
        logger.info("Initial message job already active for prospect %s", prospect_id)
        return None

    campaign_id = prospect.get("campaign_id")
    if campaign_id:
        campaign, _ = db_get_campaign(campaign_id)
        if campaign and campaign.get("status", "active") != "active":
            logger.info("Campaign %s is not active; not queueing message for %s", campaign_id, prospect_id)
            return None

    profile_key = prospect.get("assigned_account") or "profile_1"
    profile = db_get_profile(profile_key)
    if profile:
        if profile.get("enabled") is False:
            logger.info("Profile %s is disabled; not queueing message for %s", profile_key, prospect_id)
            return None
        if int(profile.get("daily_sent") or 0) >= 25:
            logger.info("Profile %s hit daily limit; not queueing message for %s", profile_key, prospect_id)
            return None

    job = db_create_job({
        "job_type": "send_messages",
        "profile_key": profile_key,
        "campaign_id": campaign_id,
        "prospect_id": prospect_id,
        "payload": {
            "linkedin_url": prospect.get("linkedin_url", ""),
            "message": initial_message,
            "message_type": "initial",
            "reason": reason or "connected",
        },
    })
    if job:
        logger.info("Queued initial message job %s for prospect %s", job.get("id"), prospect_id)
    return job


def db_mark_prospect_connected(prospect_id: str, details: str = "") -> dict:
    """
    Treat already-connected and newly accepted prospects the same.
    Returns the updated prospect and any queued initial-message job.
    """
    prospect, _ = db_get_prospect(prospect_id)
    if not prospect:
        return {"prospect": None, "queued_job": None, "status": "not_found"}

    before_status = prospect.get("status") or ""
    initial_message = (prospect.get("initial_message") or "").strip()
    advanced_statuses = {"Initial Message Sent", "Following Up", "Replied", "No Response"}

    if before_status in advanced_statuses or prospect.get("message_sent_date"):
        logger.info(
            "Already-connected result for prospect %s ignored because it is already past connection stage: %s",
            prospect_id,
            before_status,
        )
        return {"prospect": prospect, "queued_job": None, "status": before_status}

    next_status = "Ready to Send" if initial_message else "Needs Personalization"
    next_steps = (
        "Ready for initial message"
        if next_status == "Ready to Send"
        else "Team: Write personalized initial message"
    )

    logger.info(
        "Prospect %s connected transition: before_status=%r initial_message=%s",
        prospect_id,
        before_status,
        bool(initial_message),
    )
    updated = db_update_prospect(prospect_id, {
        "status": next_status,
        "next_steps": next_steps,
    }) or prospect
    logger.info(
        "Prospect %s connected transition: after_status=%r next_steps=%r",
        prospect_id,
        updated.get("status"),
        updated.get("next_steps"),
    )

    queued_job = None
    if next_status == "Ready to Send":
        queued_job = db_create_initial_message_job_if_ready(updated, reason="already_connected")
        if queued_job:
            db_log_activity(
                prospect_id,
                "queue_initial_message",
                "queued",
                f"Queued after connected detection: {queued_job.get('id')}",
            )

    if before_status != next_status or queued_job:
        db_log_activity(
            prospect_id,
            "connection_progression",
            "connected",
            details or f"Moved from {before_status or 'Not Contacted'} to {next_status}",
        )

    return {"prospect": updated, "queued_job": queued_job, "status": next_status}


def db_get_jobs(
    status: str | None = None,
    profile_key: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict], int]:
    db_recover_stale_jobs()
    query = supabase.table("jobs").select("*", count="exact")
    if status:
        query = query.eq("status", status)
    if profile_key:
        query = query.eq("profile_key", profile_key)
    result = (
        query.order("priority")
        .order("scheduled_for")
        .range(offset, offset + limit - 1)
        .execute()
    )
    return result.data or [], result.count or 0


def db_get_pending_jobs(profile_key: str, limit: int = 25) -> list[dict]:
    db_recover_stale_jobs()
    result = (
        supabase.table("jobs")
        .select("*")
        .eq("profile_key", profile_key)
        .in_("status", ["pending", "retrying"])
        .lte("scheduled_for", _utc_now())
        .order("priority")
        .order("scheduled_for")
        .limit(limit)
        .execute()
    )
    return result.data or []


def db_update_job(job_id: str, updates: dict) -> dict | None:
    clean = {k: v for k, v in updates.items() if v is not None}
    clean["updated_at"] = _utc_now()
    result = supabase.table("jobs").update(clean).eq("id", job_id).execute()
    return result.data[0] if result.data else None


def db_claim_job(job_id: str, profile_key: str) -> dict | None:
    result = (
        supabase.table("jobs")
        .update({"status": "claimed", "claimed_at": _utc_now(), "updated_at": _utc_now()})
        .eq("id", job_id)
        .eq("profile_key", profile_key)
        .in_("status", ["pending", "retrying"])
        .execute()
    )
    return result.data[0] if result.data else None


def db_start_job(job_id: str) -> dict | None:
    return db_update_job(job_id, {"status": "running", "started_at": _utc_now()})


def db_complete_job(job_id: str, result: dict | None = None) -> dict | None:
    fetched = supabase.table("jobs").select("*").eq("id", job_id).limit(1).execute()
    job_before = fetched.data[0] if fetched.data else None
    completed = db_update_job(job_id, {
        "status": "completed",
        "completed_at": _utc_now(),
        "result": result or {},
    })
    if job_before and result:
        db_apply_completed_job_result(job_before, result)
    return completed


def db_apply_completed_job_result(job: dict, result: dict) -> None:
    """Apply critical prospect transitions from REST job completion as a fallback."""
    prospect_id = job.get("prospect_id")
    if not prospect_id:
        return

    task_type = result.get("task_type") or result.get("action") or ""
    status = result.get("status") or ""
    message_type = result.get("message_type") or result.get("msg_type") or (
        (job.get("payload") or {}).get("message_type")
    )
    today = date.today().isoformat()

    if task_type == "send_connection" and status == "connected":
        db_mark_prospect_connected(prospect_id, "Already connected detected during connection job completion")
    elif task_type == "send_connection" and status == "sent":
        db_update_prospect(prospect_id, {
            "status": "Connection Request Sent",
            "connection_sent_date": today,
            "next_steps": "Check acceptance in My Network",
        })
    elif task_type == "send_message" and status == "message_sent" and message_type == "initial":
        db_update_prospect(prospect_id, {
            "status": "Initial Message Sent",
            "message_sent_date": today,
            "next_steps": f"Follow-up 1 on {(date.today() + timedelta(days=2)).isoformat()}",
        })


def db_fail_job(job_id: str, error_message: str, result: dict | None = None) -> dict | None:
    job = None
    fetched = supabase.table("jobs").select("*").eq("id", job_id).limit(1).execute()
    if fetched.data:
        job = fetched.data[0]
    retry_count = (job or {}).get("retry_count", 0) + 1
    max_retries = (job or {}).get("max_retries", 3)
    status = "retrying" if retry_count < max_retries else "failed"
    backoff_minutes = {1: 10, 2: 30, 3: 120}.get(retry_count, 120)
    scheduled_for = (datetime.now(timezone.utc) + timedelta(minutes=backoff_minutes)).isoformat()
    return db_update_job(job_id, {
        "status": status,
        "failed_at": _utc_now(),
        "error_message": error_message[:500],
        "retry_count": retry_count,
        "scheduled_for": scheduled_for if status == "retrying" else None,
        "result": result or {},
    })


def db_cancel_job(job_id: str) -> dict | None:
    return db_update_job(job_id, {"status": "cancelled"})


def db_recover_stale_jobs(minutes: int = 15):
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    try:
        supabase.table("jobs").update({
            "status": "pending",
            "claimed_at": None,
            "started_at": None,
            "updated_at": _utc_now(),
            "error_message": "Recovered stale claimed/running job",
        }).in_("status", ["claimed", "running"]).lt("updated_at", cutoff).execute()
    except Exception as exc:
        logger.warning("Could not recover stale jobs: %s", exc)


# ── Dashboard Stats ───────────────────────────────────────────────────────────

def db_get_dashboard_stats() -> dict:
    today   = date.today().isoformat()
    week_ago = (date.today() - timedelta(days=7)).isoformat()

    def _count(table: str, **filters) -> int:
        q = supabase.table(table).select("id", count="exact")
        for k, v in filters.items():
            q = q.eq(k, v)
        return q.execute().count or 0

    total_prospects      = _count("prospects")
    sent_today           = _count("prospects", connection_sent_date=today)
    sent_week            = (
        supabase.table("prospects")
        .select("id", count="exact")
        .gte("connection_sent_date", week_ago)
        .execute()
        .count or 0
    )
    messages_today       = _count("prospects", message_sent_date=today)
    replies_today        = _count("prospects", reply_date=today)
    active_campaigns     = _count("campaigns", status="active")
    needs_personalization = _count("prospects", status="Needs Personalization")
    pending_jobs = _count("jobs", status="pending")
    failed_jobs = _count("jobs", status="failed")

    # Accepted today — inferred from activity_log
    accepted_today = (
        supabase.table("activity_log")
        .select("id", count="exact")
        .eq("result", "accepted")
        .gte("created_at", today)
        .execute()
        .count or 0
    )

    # Rate calculations
    total_replied  = _count("prospects", status="Replied")
    total_messaged = (
        supabase.table("prospects")
        .select("id", count="exact")
        .not_.is_("message_sent_date", "null")
        .execute()
        .count or 0
    )
    total_sent_ever = (
        supabase.table("prospects")
        .select("id", count="exact")
        .not_.is_("connection_sent_date", "null")
        .execute()
        .count or 0
    )
    total_accepted = (
        supabase.table("prospects")
        .select("id", count="exact")
        .in_(
            "status",
            [
                "Connection Accepted", "Ready to Send",
                "Initial Message Sent", "Following Up",
                "Replied", "No Response",
            ],
        )
        .execute()
        .count or 0
    )

    reply_rate       = round(total_replied  / total_messaged  * 100, 1) if total_messaged  else 0.0
    acceptance_rate  = round(total_accepted / total_sent_ever * 100, 1) if total_sent_ever else 0.0

    profiles = (
        supabase.table("linkedin_profiles")
        .select("profile_key, daily_sent, session_active")
        .execute()
        .data or []
    )

    return {
        "total_prospects":        total_prospects,
        "connections_sent_today": sent_today,
        "connections_sent_week":  sent_week,
        "accepted_today":         accepted_today,
        "messages_sent_today":    messages_today,
        "replies_today":          replies_today,
        "active_campaigns":       active_campaigns,
        "reply_rate":             reply_rate,
        "acceptance_rate":        acceptance_rate,
        "needs_personalization":   needs_personalization,
        "pending_jobs":            pending_jobs,
        "failed_jobs":             failed_jobs,
        "online_agents":           sum(1 for p in profiles if p.get("session_active")),
        "profiles":               profiles,
    }


def db_get_campaign_stats(campaign_id: str) -> dict | None:
    campaign, stats = db_get_campaign(campaign_id)
    if not campaign:
        return None
    return {**campaign, **(stats or {})}


# Cloud schedules and reusable messages

DEFAULT_SCHEDULES = [
    {"task_key": "conn", "label": "Send connections", "time": "09:00", "enabled": True, "run_on_startup": False},
    {"task_key": "acc", "label": "Check acceptances", "time": "12:00", "enabled": True, "run_on_startup": False},
    {"task_key": "msg", "label": "Send messages", "time": "14:00", "enabled": True, "run_on_startup": False},
    {"task_key": "fu", "label": "Send follow-ups", "time": "10:00", "enabled": True, "run_on_startup": False},
]


def db_get_schedules() -> list[dict]:
    rows = supabase.table("agent_schedules").select("*").order("task_key").execute().data or []
    existing = {r["task_key"]: r for r in rows}
    missing = [s for s in DEFAULT_SCHEDULES if s["task_key"] not in existing]
    if missing:
        supabase.table("agent_schedules").upsert(missing, on_conflict="task_key").execute()
        rows = supabase.table("agent_schedules").select("*").order("task_key").execute().data or []
    return rows


def db_upsert_schedules(rows: list[dict]) -> list[dict]:
    payload = []
    for row in rows:
        payload.append({
            "task_key": row["task_key"],
            "label": row.get("label") or row["task_key"],
            "time": row.get("time") or "09:00",
            "enabled": bool(row.get("enabled", True)),
            "run_on_startup": bool(row.get("run_on_startup", False)),
            "updated_at": _utc_now(),
        })
    if payload:
        supabase.table("agent_schedules").upsert(payload, on_conflict="task_key").execute()
    return db_get_schedules()


def db_get_message_templates() -> list[dict]:
    return (
        supabase.table("message_templates")
        .select("*")
        .order("created_at", desc=True)
        .execute()
        .data or []
    )


def db_upsert_message_template(data: dict) -> dict | None:
    payload = {
        "name": data["name"],
        "subject": data.get("subject"),
        "body": data["body"],
        "message_type": data.get("message_type", "initial"),
        "active": data.get("active", True),
        "updated_at": _utc_now(),
    }
    result = supabase.table("message_templates").upsert(payload, on_conflict="name").execute()
    return result.data[0] if result.data else None
