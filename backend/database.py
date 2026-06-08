"""
Supabase client and all database query functions.
All functions are synchronous (supabase-py uses the sync client by default).
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import secrets
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
        _, stats = db_get_campaign(c["id"])
        c.update(stats or {})
        c["prospect_count"] = (stats or {}).get("total", 0)
        if c.get("template_id"):
            tmpl = (
                supabase.table("campaign_templates")
                .select("id, key, name, status")
                .eq("id", c["template_id"])
                .limit(1)
                .execute()
            )
            c["template"] = tmpl.data[0] if tmpl.data else None
    return campaigns


def db_create_campaign(name: str, status: str = "draft", template_id: str | None = None,
                       profile_key: str | None = None,
                       sequence_config: dict | None = None,
                       schedule_config: dict | None = None,
                       settings: dict | None = None) -> dict | None:
    payload = {
        "name": name,
        "status": status or "draft",
    }
    if template_id:
        payload["template_id"] = template_id
    if profile_key:
        payload["profile_key"] = profile_key
    if sequence_config:
        payload["sequence_config"] = sequence_config
    if schedule_config:
        payload["schedule_config"] = schedule_config
    if settings:
        payload["settings"] = settings
    result = (
        supabase.table("campaigns")
        .insert(payload)
        .execute()
    )
    return result.data[0] if result.data else None


def db_update_campaign(campaign_id: str, data: dict) -> dict | None:
    allowed = {
        "name", "status", "template_id", "profile_key", "sequence_config",
        "schedule_config", "settings",
    }
    clean = {k: v for k, v in data.items() if k in allowed and v is not None}
    if not clean:
        return None
    result = supabase.table("campaigns").update(clean).eq("id", campaign_id).execute()
    row = result.data[0] if result.data else None
    # When profile_key changes, re-assign all pending/retrying jobs so the new
    # extension picks them up immediately — no manual job touching required.
    if row and "profile_key" in clean:
        (supabase.table("jobs")
         .update({"profile_key": clean["profile_key"]})
         .eq("campaign_id", campaign_id)
         .in_("status", ["pending", "retrying"])
         .execute())
    return row


def db_get_campaign(campaign_id: str) -> tuple[dict | None, dict | None]:
    result = (
        supabase.table("campaigns").select("*").eq("id", campaign_id).execute()
    )
    if not result.data:
        return None, None

    campaign = result.data[0]
    enrollments = (
        supabase.table("campaign_enrollments")
        .select("*, prospects(status, connection_status, connection_sent_date, message_sent_date)")
        .eq("campaign_id", campaign_id)
        .execute()
        .data or []
    )
    if enrollments:
        rows = []
        for item in enrollments:
            p = item.get("prospects") or {}
            rows.append({**item, "prospect_status": p.get("status"), **{f"prospect_{k}": v for k, v in p.items()}})
    else:
        prospects_res = (
            supabase.table("prospects")
            .select("status, connection_sent_date, message_sent_date")
            .eq("campaign_id", campaign_id)
            .execute()
        )
        rows = prospects_res.data or []
    stats = {
        "total":        len(rows),
        "sent":         sum(1 for r in rows if (r.get("prospect_status") or r.get("status")) == "Connection Request Sent"),
        "accepted":     sum(1 for r in rows if (r.get("prospect_status") or r.get("status")) == "Connection Accepted"),
        "already_connected": sum(1 for r in rows if (r.get("connection_status") or r.get("prospect_connection_status")) == "connected"),
        "ready_for_message": sum(1 for r in rows if (r.get("prospect_status") or r.get("status")) == "Ready to Send"),
        "messaged":     sum(1 for r in rows if (r.get("prospect_status") or r.get("status")) == "Initial Message Sent"),
        "following_up": sum(1 for r in rows if (r.get("prospect_status") or r.get("status")) == "Following Up"),
        "followup_due": sum(1 for r in rows if (r.get("prospect_status") or r.get("status")) == "Following Up"),
        "completed":    sum(1 for r in rows if (r.get("prospect_status") or r.get("status")) in ("Replied", "No Response", "Completed") or r.get("status") == "completed"),
        "failed":       sum(1 for r in rows if (r.get("prospect_status") or r.get("status")) == "Needs Attention" or r.get("status") in ("failed", "error", "needs_attention")),
        "replied":      sum(1 for r in rows if (r.get("prospect_status") or r.get("status")) == "Replied"),
        "no_response":  sum(1 for r in rows if (r.get("prospect_status") or r.get("status")) == "No Response"),
        "sequence_complete": sum(1 for r in rows if (r.get("prospect_status") or r.get("status")) == "Completed"),
        "needs_attention":   sum(1 for r in rows if (r.get("prospect_status") or r.get("status")) == "Needs Attention"),
    }
    return campaign, stats


def db_delete_campaign(campaign_id: str):
    # Campaigns are reusable containers. Deleting a campaign must not delete
    # prospects, because prospects can belong to other lists/campaigns.
    supabase.table("jobs").delete().eq("campaign_id", campaign_id).in_("status", ["pending", "retrying", "failed", "cancelled"]).execute()
    supabase.table("campaign_enrollments").delete().eq("campaign_id", campaign_id).execute()
    # Null out prospects.campaign_id to satisfy the FK constraint before deleting the campaign.
    supabase.table("prospects").update({"campaign_id": None}).eq("campaign_id", campaign_id).execute()
    supabase.table("campaigns").delete().eq("id", campaign_id).execute()


def db_duplicate_campaign(campaign_id: str, name: str | None = None, include_prospects: bool = False) -> dict | None:
    campaign, _ = db_get_campaign(campaign_id)
    if not campaign:
        return None
    copied = db_create_campaign(
        name or f"{campaign.get('name', 'Campaign')} Copy",
        status="draft",
        template_id=campaign.get("template_id"),
        profile_key=campaign.get("profile_key") or "profile_1",
        sequence_config=campaign.get("sequence_config") or {},
        schedule_config=campaign.get("schedule_config") or {},
        settings=campaign.get("settings") or {},
    )
    if copied and include_prospects:
        for enrollment in db_get_campaign_enrollments(campaign_id):
            prospect, _ = db_get_prospect(enrollment.get("prospect_id"))
            if prospect:
                db_upsert_enrollment(copied, prospect)
    return copied


# ── Prospects ─────────────────────────────────────────────────────────────────

def db_get_prospects(
    campaign_id: str | None = None,
    status: str | None = None,
    assigned_account: str | None = None,
    list_id: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    if list_id:
        member_rows = (
            supabase.table("prospect_list_members")
            .select("prospect_id")
            .eq("list_id", list_id)
            .execute()
            .data or []
        )
        ids = [r["prospect_id"] for r in member_rows if r.get("prospect_id")]
        if not ids:
            return [], 0
    else:
        ids = None

    query = supabase.table("prospects").select("*", count="exact")
    if campaign_id:
        enrollment_rows = (
            supabase.table("campaign_enrollments")
            .select("prospect_id")
            .eq("campaign_id", campaign_id)
            .execute()
            .data or []
        )
        campaign_ids = [r["prospect_id"] for r in enrollment_rows if r.get("prospect_id")]
        if campaign_ids:
            ids = sorted(set(ids).intersection(campaign_ids)) if ids else campaign_ids
        else:
            query = query.eq("campaign_id", campaign_id)
    if status is not None:
        query = query.eq("status", status)
    if assigned_account:
        query = query.eq("assigned_account", assigned_account)
    if ids is not None:
        query = query.in_("id", ids)
    if search:
        q = f"%{search}%"
        query = query.or_(f"first_name.ilike.{q},last_name.ilike.{q},company.ilike.{q},linkedin_url.ilike.{q},email.ilike.{q}")
    result = (
        query.order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return result.data or [], result.count or 0


def db_create_prospect(data: dict) -> dict | None:
    result = supabase.table("prospects").insert(data).execute()
    return result.data[0] if result.data else None


def db_create_prospect_for_campaign(campaign_id: str, data: dict) -> dict | None:
    campaign, _ = db_get_campaign(campaign_id)
    if not campaign:
        return None
    data["campaign_id"] = campaign_id
    data["assigned_account"] = campaign.get("profile_key") or data.get("assigned_account") or "profile_1"
    prospect = db_create_prospect(data)
    if prospect:
        db_upsert_enrollment(campaign, prospect)
    return prospect


def _normalise_linkedin_url(url: str) -> str:
    """Ensure LinkedIn URL has https://www. prefix."""
    url = url.strip()
    if not url:
        return url
    if url.startswith("https://"):
        return url
    if url.startswith("http://"):
        return "https://" + url[7:]
    if url.startswith("www.linkedin.com"):
        return "https://" + url
    if url.startswith("linkedin.com"):
        return "https://www." + url
    return url


def db_create_or_update_prospect(data: dict) -> tuple[str, dict | None]:
    """Create/update by linkedin_url, then email. Returns ('created'|'updated'|'skipped', row)."""
    if data.get("linkedin_url"):
        data["linkedin_url"] = _normalise_linkedin_url(data["linkedin_url"])
    linkedin_url = (data.get("linkedin_url") or "").strip()
    email = (data.get("email") or "").strip()
    if not linkedin_url and not email:
        return "skipped", None

    existing = db_get_prospect_by_linkedin_url(linkedin_url) if linkedin_url else None
    if not existing and email:
        existing = db_get_prospect_by_email(email)
    initial = (data.get("initial_message") or "").strip()
    if existing:
        clean = {k: v for k, v in data.items() if v not in (None, "")}
        if data.get("custom_fields"):
            clean["custom_fields"] = {
                **(existing.get("custom_fields") or {}),
                **(data.get("custom_fields") or {}),
            }
        if initial and existing.get("status") in ("Needs Personalization", "Connection Accepted", None, ""):
            clean["status"] = "Ready to Send"
        updated = db_update_prospect(existing["id"], clean)
        return "updated", updated or existing

    if initial and data.get("status") in ("Needs Personalization", "Connection Accepted"):
        data["status"] = "Ready to Send"
    created = db_create_prospect(data)
    return "created", created


def db_get_prospect_by_email(email: str) -> dict | None:
    value = (email or "").strip()
    if not value:
        return None
    result = (
        supabase.table("prospects")
        .select("*")
        .eq("email", value)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


STANDARD_VARIABLE_FIELDS = {
    "first_name": "first_name",
    "last_name": "last_name",
    "company": "company",
    "title": "job_title",
    "job_title": "job_title",
    "industry": "industry",
    "location": "location",
}


def db_render_message_template(template: str, prospect: dict | None) -> str:
    """Render {{variables}} from standard prospect fields plus custom_fields."""
    if not template:
        return ""
    prospect = prospect or {}
    custom = prospect.get("custom_fields") or {}
    values = {}
    for var, field in STANDARD_VARIABLE_FIELDS.items():
        values[var] = prospect.get(field) or custom.get(var) or ""
    values.update({str(k): "" if v is None else str(v) for k, v in custom.items()})

    def replace(match):
        key = match.group(1).strip()
        return str(values.get(key, ""))

    return re.sub(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}", replace, template).strip()


def db_extract_variables(text: str) -> list[str]:
    if not text:
        return []
    return sorted(set(re.findall(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}", text)))


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


def db_get_prospect_enrollments(prospect_id: str) -> list[dict]:
    """Campaign memberships for one prospect; used by the prospect detail UI."""
    return (
        supabase.table("campaign_enrollments")
        .select("*, campaigns(id, name, status, profile_key)")
        .eq("prospect_id", prospect_id)
        .order("created_at", desc=True)
        .execute()
        .data or []
    )


def db_update_prospect(prospect_id: str, data: dict) -> dict | None:
    if data.get("linkedin_url"):
        data["linkedin_url"] = _normalise_linkedin_url(data["linkedin_url"])
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
    supabase.table("campaign_enrollments").delete().eq("prospect_id", prospect_id).execute()
    supabase.table("prospect_list_members").delete().eq("prospect_id", prospect_id).execute()
    supabase.table("jobs").delete().eq("prospect_id", prospect_id).in_("status", ["pending", "retrying", "failed", "cancelled"]).execute()
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


def db_get_ready_for_message_queue(limit: int = 500, offset: int = 0) -> tuple[list[dict], int]:
    """Global operational queue for accepted/connected prospects awaiting first message."""
    result = (
        supabase.table("prospects")
        .select("*", count="exact")
        .eq("status", "Ready to Send")
        .not_.is_("initial_message", "null")
        .is_("message_sent_date", "null")
        .range(offset, offset + limit - 1)
        .execute()
    )
    rows = [
        r for r in (result.data or [])
        if (r.get("initial_message") or "").strip()
    ]
    return rows, result.count or len(rows)


def db_get_inmail_ready_queue(limit: int = 500, offset: int = 0) -> tuple[list[dict], int]:
    result = (
        supabase.table("prospects")
        .select("*", count="exact")
        .eq("status", "inmail_available")
        .range(offset, offset + limit - 1)
        .execute()
    )
    return result.data or [], result.count or 0


def db_get_message_ready_queue(limit: int = 500, offset: int = 0) -> tuple[list[dict], int]:
    result = (
        supabase.table("prospects")
        .select("*", count="exact")
        .eq("status", "message_ready")
        .range(offset, offset + limit - 1)
        .execute()
    )
    return result.data or [], result.count or 0


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

def _count_rows(table: str, **filters) -> int:
    q = supabase.table(table).select("id", count="exact")
    for k, v in filters.items():
        q = q.eq(k, v)
    return q.execute().count or 0


def _profile_job_stats(profile_key: str) -> dict:
    jobs = (
        supabase.table("jobs")
        .select("*")
        .eq("profile_key", profile_key)
        .order("updated_at", desc=True)
        .limit(50)
        .execute()
        .data or []
    )
    running = [j for j in jobs if j.get("status") in ("claimed", "running")]
    active = [j for j in jobs if j.get("status") in ("pending", "retrying", "claimed", "running")]
    return {
        "pending_jobs": sum(1 for j in jobs if j.get("status") in ("pending", "retrying")),
        "running_jobs": len(running),
        "failed_jobs": sum(1 for j in jobs if j.get("status") == "failed"),
        "active_jobs": len(active),
        "current_job": running[0] if running else None,
        "last_job": jobs[0] if jobs else None,
        "last_job_result": (jobs[0] or {}).get("result") if jobs else None,
    }


def db_enrich_profile(profile: dict) -> dict:
    profile_key = profile.get("profile_key") or "profile_1"
    today = date.today().isoformat()
    enriched = dict(profile)
    enriched.update(_profile_job_stats(profile_key))
    try:
        enriched["active_campaign_count"] = (
            supabase.table("campaigns")
            .select("id", count="exact")
            .eq("profile_key", profile_key)
            .in_("status", ["active", "running"])
            .execute()
            .count or 0
        )
    except Exception as exc:
        if "profile_key" not in str(exc):
            raise
        enriched["active_campaign_count"] = 0
    enriched["invitations_sent_today"] = _count_rows(
        "prospects", assigned_account=profile_key, connection_sent_date=today
    )
    enriched["messages_sent_today"] = _count_rows(
        "prospects", assigned_account=profile_key, message_sent_date=today
    )
    enriched["ready_for_message_count"] = _count_rows(
        "prospects", assigned_account=profile_key, status="Ready to Send"
    )
    try:
        enriched["accepted_today"] = (
            supabase.table("prospect_profile_states")
            .select("id", count="exact")
            .eq("profile_key", profile_key)
            .gte("accepted_at", today)
            .execute()
            .count or 0
        )
    except Exception:
        enriched["accepted_today"] = 0
    enriched.setdefault("runtime_mode", "chrome_extension")
    enriched.setdefault("run_mode", enriched.get("runtime_mode") or "chrome_extension")
    if enriched["run_mode"] in ("local", "windows_agent"):
        enriched["run_mode"] = "chrome_extension"
    enriched.setdefault("session_status", "unknown")
    enriched.setdefault("extension_status", "offline")
    enriched.setdefault("linkedin_login_status", "unknown")
    enriched.setdefault("automation_paused", False)
    return enriched


def db_get_all_profiles() -> list[dict]:
    db_mark_stale_profiles_offline()
    profiles = (
        supabase.table("linkedin_profiles")
        .select("*")
        .neq("profile_key", "dashboard")
        .order("profile_key")
        .execute()
        .data or []
    )
    return [db_enrich_profile(p) for p in profiles]


def db_create_profile(profile_key: str, display_name: str, run_mode: str | None = None) -> dict | None:
    run_mode = run_mode or "chrome_extension"
    if run_mode == "windows_agent":
        run_mode = "chrome_extension"
    data = {
        "profile_key": profile_key,
        "display_name": display_name,
        "session_active": False,
        "daily_sent": 0,
        "runtime_mode": "cloud_agent" if run_mode == "cloud_agent" else "chrome_extension",
        "run_mode": run_mode,
    }
    try:
        result = supabase.table("linkedin_profiles").insert(data).execute()
    except Exception as exc:
        if "run_mode" not in str(exc):
            raise
        fallback = dict(data)
        fallback.pop("run_mode", None)
        result = supabase.table("linkedin_profiles").insert(fallback).execute()
    return db_enrich_profile(result.data[0]) if result.data else None


PROFILE_RUNTIME_FIELDS = {
    "runtime_mode",
    "run_mode",
    "proxy_settings",
    "session_status",
    "local_state",
    "last_job_result",
    "extension_id",
    "extension_status",
    "last_extension_heartbeat",
    "paired_at",
    "linkedin_login_status",
    "extension_version",
    "automation_paused",
}


def _without_profile_runtime_fields(data: dict) -> dict:
    return {k: v for k, v in data.items() if k not in PROFILE_RUNTIME_FIELDS}


def db_update_profile(profile_key: str, data: dict) -> dict | None:
    clean = {k: v for k, v in data.items() if v is not None}
    if not clean:
        return None
    try:
        result = (
            supabase.table("linkedin_profiles")
            .update(clean)
            .eq("profile_key", profile_key)
            .execute()
        )
    except Exception as exc:
        if not any(field in str(exc) for field in PROFILE_RUNTIME_FIELDS):
            raise
        fallback = _without_profile_runtime_fields(clean)
        if not fallback:
            return db_get_profile(profile_key)
        result = (
            supabase.table("linkedin_profiles")
            .update(fallback)
            .eq("profile_key", profile_key)
            .execute()
        )
    return db_enrich_profile(result.data[0]) if result.data else None


def db_mark_stale_profiles_offline(seconds: int = 90):
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()
    try:
        supabase.table("linkedin_profiles").update({"session_active": False}).lt("last_active", cutoff).execute()
    except Exception as exc:
        logger.warning("Could not mark stale profiles offline: %s", exc)


def db_upsert_profile(profile_key: str, updates: dict) -> dict | None:
    """Create the profile row if it doesn't exist, otherwise update it."""
    updates["profile_key"] = profile_key
    try:
        result = (
            supabase.table("linkedin_profiles")
            .upsert(updates, on_conflict="profile_key")
            .execute()
        )
    except Exception as exc:
        if not any(field in str(exc) for field in PROFILE_RUNTIME_FIELDS):
            raise
        fallback = _without_profile_runtime_fields(updates)
        result = (
            supabase.table("linkedin_profiles")
            .upsert(fallback, on_conflict="profile_key")
            .execute()
        )
    return db_enrich_profile(result.data[0]) if result.data else None


def db_get_profile(profile_key: str) -> dict | None:
    result = (
        supabase.table("linkedin_profiles")
        .select("*")
        .eq("profile_key", profile_key)
        .limit(1)
        .execute()
    )
    return db_enrich_profile(result.data[0]) if result.data else None


# ── Jobs ─────────────────────────────────────────────────────────────────────

def _extension_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def db_create_extension_pair_token(profile_key: str | None = None) -> dict:
    token = secrets.token_urlsafe(24)
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
    result = supabase.table("extension_pairing_tokens").insert({
        "token_hash": _extension_token_hash(token),
        "profile_key": profile_key,
        "status": "pending",
        "expires_at": expires_at,
    }).execute()
    saved = result.data[0] if result.data else {}
    return {
        "token": token,
        "token_id": saved.get("id"),
        "profile_key": profile_key,
        "expires_at": saved.get("expires_at") or expires_at,
    }


def db_pair_extension(data: dict) -> dict | None:
    token = data.get("token") or ""
    extension_id = data.get("extension_id") or secrets.token_urlsafe(16)
    now = _utc_now()
    found = (
        supabase.table("extension_pairing_tokens")
        .select("*")
        .eq("token_hash", _extension_token_hash(token))
        .eq("status", "pending")
        .gte("expires_at", now)
        .limit(1)
        .execute()
        .data or []
    )
    if not found:
        return None

    pair = found[0]
    profile_key = data.get("profile_key") or pair.get("profile_key") or f"ext_{extension_id[:10]}"
    display_name = data.get("display_name") or profile_key
    profile = db_upsert_profile(profile_key, {
        "profile_key": profile_key,
        "display_name": display_name,
        "enabled": True,
        "session_active": True,
        "runtime_mode": "chrome_extension",
        "run_mode": "chrome_extension",
        "extension_id": extension_id,
        "extension_status": "online",
        "last_extension_heartbeat": now,
        "last_active": now,
        "paired_at": now,
        "linkedin_login_status": data.get("linkedin_login_status") or "unknown",
        "extension_version": data.get("extension_version"),
        "local_state": data.get("linkedin_url") or data.get("current_url"),
    })
    supabase.table("extension_pairing_tokens").update({
        "status": "used",
        "used_at": now,
        "extension_id": extension_id,
    }).eq("id", pair["id"]).execute()
    return profile


def db_extension_heartbeat(data: dict) -> dict | None:
    profile_key = data.get("profile_key")
    if not profile_key:
        return None
    now = _utc_now()
    return db_upsert_profile(profile_key, {
        "profile_key": profile_key,
        "display_name": data.get("display_name") or profile_key,
        "session_active": data.get("session_active", True),
        "last_active": now,
        "runtime_mode": "chrome_extension",
        "run_mode": "chrome_extension",
        "extension_id": data.get("extension_id"),
        "extension_status": data.get("extension_status") or "online",
        "last_extension_heartbeat": now,
        "linkedin_login_status": data.get("linkedin_login_status") or "unknown",
        "extension_version": data.get("extension_version"),
        "local_state": data.get("current_url") or data.get("local_state"),
        "automation_paused": data.get("automation_paused"),
    })


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

    campaign_id = db_get_queue_campaign_id_for_prospect(prospect)
    campaign = None
    if campaign_id:
        campaign, _ = db_get_campaign(campaign_id)
        if campaign and campaign.get("status") not in ("active", "running"):
            logger.info("Campaign %s is not active; not queueing message for %s", campaign_id, prospect_id)
            return None

    profile_key = (campaign or {}).get("profile_key") or prospect.get("assigned_account") or "profile_1"
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


def db_queue_ready_prospect_initial_message(prospect: dict, reason: str = "") -> dict | None:
    """
    Queue the first message for a prospect that is already accepted/connected.

    This is the recovery path for prospects whose invitation job failed because
    LinkedIn showed they were already a 1st-degree connection. It treats
    Ready-to-Send as connected for the assigned profile, advances the active
    campaign enrollment, and falls back to a generic first-message job only when
    there is no running campaign sequence.
    """
    if not prospect:
        return None
    prospect_id = prospect.get("id")
    initial_message = (prospect.get("initial_message") or "").strip()
    if not prospect_id or not initial_message or prospect.get("message_sent_date"):
        return None
    if prospect.get("status") != "Ready to Send":
        return None

    running_enrollments = db_get_running_enrollments_for_prospect(prospect_id)
    for enrollment in running_enrollments:
        campaign_id = enrollment.get("campaign_id")
        campaign = enrollment.get("campaign") or {}
        profile_key = campaign.get("profile_key") or enrollment.get("profile_key") or prospect.get("assigned_account") or "profile_1"
        now = _utc_now()
        db_upsert_profile_connection_state(
            prospect_id,
            profile_key,
            campaign_id=campaign_id,
            connection_status="connected",
            detected_by=profile_key,
        )
        supabase.table("campaign_enrollments").update({
            "accepted_at": enrollment.get("accepted_at") or now,
            "connected_at": enrollment.get("connected_at") or now,
            "connection_detected_by_profile": profile_key,
            "messaging_profile": profile_key,
            "updated_at": now,
        }).eq("campaign_id", campaign_id).eq("prospect_id", prospect_id).execute()

        if not prospect.get("message_sent_date"):
            initial_step_order = db_get_initial_message_step_order(campaign_id)
            after_step_order = max((initial_step_order or 1) - 1, 0)
        else:
            after_step_order = int(enrollment.get("current_step_order") or 0)

        job = db_queue_next_campaign_step(campaign_id, prospect_id, after_step_order)
        if job:
            db_log_activity(
                prospect_id,
                "queue_initial_message",
                "queued",
                f"Queued after accepted/connected recovery ({reason or 'ready_to_send'}): {job.get('id')}",
            )
            return job

    return db_create_initial_message_job_if_ready(prospect, reason=reason or "ready_to_send")


def db_upsert_profile_connection_state(
    prospect_id: str,
    profile_key: str,
    campaign_id: str | None = None,
    connection_status: str = "connected",
    detected_by: str | None = None,
) -> dict | None:
    now = _utc_now()
    payload = {
        "prospect_id": prospect_id,
        "profile_key": profile_key or "profile_1",
        "campaign_id": campaign_id,
        "connection_status": connection_status,
        "connection_detected_by_profile": detected_by or profile_key or "profile_1",
        "messaging_profile": profile_key or "profile_1",
        "last_action_at": now,
        "updated_at": now,
    }
    if connection_status == "connected":
        payload["connected_at"] = now
        payload["accepted_at"] = now
    elif connection_status in ("invitation_sent", "pending"):
        payload["invitation_sent_at"] = now
    result = (
        supabase.table("prospect_profile_states")
        .upsert(payload, on_conflict="prospect_id,profile_key")
        .execute()
    )
    return result.data[0] if result.data else None


def db_get_profile_connection_state(prospect_id: str, profile_key: str) -> dict | None:
    result = (
        supabase.table("prospect_profile_states")
        .select("*")
        .eq("prospect_id", prospect_id)
        .eq("profile_key", profile_key)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def db_mark_invitation_sent(prospect: dict, profile_key: str | None = None, campaign_id: str | None = None) -> None:
    if not prospect:
        return
    pk = profile_key or prospect.get("assigned_account") or "profile_1"
    cid = campaign_id or prospect.get("campaign_id")
    db_upsert_profile_connection_state(
        prospect["id"],
        pk,
        campaign_id=cid,
        connection_status="invitation_sent",
        detected_by=pk,
    )
    if cid:
        supabase.table("campaign_enrollments").update({
            "profile_key": pk,
            "invitation_sent_at": _utc_now(),
            "updated_at": _utc_now(),
        }).eq("campaign_id", cid).eq("prospect_id", prospect["id"]).execute()


def db_mark_prospect_connected(prospect_id: str, details: str = "", profile_key: str | None = None,
                               campaign_id: str | None = None,
                               skip_legacy_advance: bool = False) -> dict:
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
    profile_key = profile_key or prospect.get("assigned_account") or "profile_1"
    campaign_id = campaign_id or prospect.get("campaign_id")

    db_upsert_profile_connection_state(
        prospect_id,
        profile_key,
        campaign_id=campaign_id,
        connection_status="connected",
        detected_by=profile_key,
    )
    if campaign_id:
        supabase.table("campaign_enrollments").update({
            "profile_key": profile_key,
            "messaging_profile": profile_key,
            "connection_detected_by_profile": profile_key,
            "accepted_at": _utc_now(),
            "connected_at": _utc_now(),
            "updated_at": _utc_now(),
        }).eq("campaign_id", campaign_id).eq("prospect_id", prospect_id).execute()

    if before_status in advanced_statuses or prospect.get("message_sent_date"):
        logger.info(
            "Already-connected result for prospect %s ignored because it is already past connection stage: %s",
            prospect_id,
            before_status,
        )
        return {"prospect": prospect, "queued_job": None, "status": before_status}

    # Flow campaigns manage prospect status via their own node completions;
    # don't overwrite with a legacy "Needs Personalization" / "Ready to Send"
    # status here, and skip the legacy step-advancement call entirely.
    if skip_legacy_advance:
        db_update_prospect(prospect_id, {
            "status": "Connected",
            "connection_status": "connected",
            "accepted_at": _utc_now(),
            "connected_at": _utc_now(),
            "last_action_at": _utc_now(),
        })
        db_log_activity(prospect_id, "connection_progression", "connected", details or "Connected")
        return {"prospect": prospect, "queued_job": None, "status": "Connected"}

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
        "connection_status": "connected",
        "accepted_at": _utc_now(),
        "connected_at": _utc_now(),
        "last_action_at": _utc_now(),
    }) or prospect
    logger.info(
        "Prospect %s connected transition: after_status=%r next_steps=%r",
        prospect_id,
        updated.get("status"),
        updated.get("next_steps"),
    )

    queued_job = db_advance_connected_campaign_enrollments(prospect_id)
    if next_status == "Ready to Send" and not queued_job:
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


def db_get_campaign_templates(include_coming_soon: bool = True) -> list[dict]:
    query = supabase.table("campaign_templates").select("*").order("category").order("name")
    if not include_coming_soon:
        query = query.eq("status", "active")
    templates = query.execute().data or []
    for template in templates:
        template["steps"] = db_get_campaign_template_steps(template["id"])
    return templates


def db_get_campaign_template(template_id: str) -> dict | None:
    result = (
        supabase.table("campaign_templates")
        .select("*")
        .eq("id", template_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        return None
    template = result.data[0]
    template["steps"] = db_get_campaign_template_steps(template_id)
    return template


def db_get_campaign_template_steps(template_id: str) -> list[dict]:
    return (
        supabase.table("campaign_template_steps")
        .select("*")
        .eq("template_id", template_id)
        .eq("is_enabled", True)
        .order("step_order")
        .execute()
        .data or []
    )


def db_create_campaign_template(data: dict) -> dict | None:
    steps = data.pop("steps", [])
    result = supabase.table("campaign_templates").upsert(data, on_conflict="key").execute()
    if not result.data:
        return None
    template = result.data[0]
    if steps:
        payload = []
        for idx, step in enumerate(steps, start=1):
            payload.append({
                "template_id": template["id"],
                "step_order": step.get("step_order", idx),
                "action_type": step["action_type"],
                "label": step.get("label") or step["action_type"],
                "config": step.get("config") or {},
                "is_enabled": step.get("is_enabled", True),
            })
        supabase.table("campaign_template_steps").upsert(
            payload,
            on_conflict="template_id,step_order",
        ).execute()
    return db_get_campaign_template(template["id"])


def db_get_campaign_enrollments(campaign_id: str) -> list[dict]:
    return (
        supabase.table("campaign_enrollments")
        .select("*, prospects(first_name, last_name, company, job_title, linkedin_url, status)")
        .eq("campaign_id", campaign_id)
        .order("created_at")
        .execute()
        .data or []
    )


def db_get_active_enrollments_for_prospect(prospect_id: str) -> list[dict]:
    return (
        supabase.table("campaign_enrollments")
        .select("*")
        .eq("prospect_id", prospect_id)
        .eq("status", "active")
        .execute()
        .data or []
    )


def db_get_running_enrollments_for_prospect(prospect_id: str) -> list[dict]:
    """Active enrollments whose campaign can currently progress."""
    running = []
    for enrollment in db_get_active_enrollments_for_prospect(prospect_id):
        campaign, _ = db_get_campaign(enrollment.get("campaign_id"))
        if campaign and campaign.get("status") in ("active", "running"):
            running.append({**enrollment, "campaign": campaign})
    return running


def db_get_queue_campaign_id_for_prospect(prospect: dict) -> str | None:
    """
    Resolve the campaign to use for queued jobs.

    Prospects can keep an older campaign_id after being enrolled in a newer
    running campaign. Queueing must follow the active enrollment first, or a
    ready prospect can be blocked by an archived stale campaign id.
    """
    prospect_id = (prospect or {}).get("id")
    if prospect_id:
        enrollments = db_get_running_enrollments_for_prospect(prospect_id)
        if enrollments:
            return enrollments[0].get("campaign_id")

    campaign_id = (prospect or {}).get("campaign_id")
    if campaign_id:
        campaign, _ = db_get_campaign(campaign_id)
        if campaign and campaign.get("status") in ("active", "running"):
            return campaign_id
    return None


def db_upsert_enrollment(campaign: dict, prospect: dict) -> dict | None:
    profile_key = campaign.get("profile_key") or prospect.get("assigned_account") or "profile_1"
    payload = {
        "campaign_id": campaign["id"],
        "prospect_id": prospect["id"],
        "template_id": campaign.get("template_id"),
        "profile_key": profile_key,
        "messaging_profile": profile_key,
        "status": "active",
        "updated_at": _utc_now(),
    }
    result = (
        supabase.table("campaign_enrollments")
        .upsert(payload, on_conflict="campaign_id,prospect_id")
        .execute()
    )
    supabase.table("prospects").update({
        "campaign_id": campaign["id"],
        "assigned_account": profile_key,
    }).eq("id", prospect["id"]).execute()
    return result.data[0] if result.data else None


def db_delete_profile(profile_key: str) -> bool:
    # Disable related running work first. Historical jobs/activity stay for audit.
    supabase.table("jobs").update({
        "status": "cancelled",
        "updated_at": _utc_now(),
        "error_message": "Cancelled because profile was deleted",
    }).eq("profile_key", profile_key).in_("status", ["pending", "retrying"]).execute()
    try:
        supabase.table("campaigns").update({
            "status": "paused",
            "paused_at": _utc_now(),
        }).eq("profile_key", profile_key).eq("status", "running").execute()
    except Exception as exc:
        if "profile_key" not in str(exc):
            raise
    result = supabase.table("linkedin_profiles").delete().eq("profile_key", profile_key).execute()
    return bool(result.data)


def db_add_prospects_to_campaign(campaign_id: str, prospect_ids: list[str]) -> dict:
    campaign, _ = db_get_campaign(campaign_id)
    if not campaign:
        return {"error": "campaign_not_found", "added": 0, "queued": 0}
    flow = _campaign_flow_sequence(campaign)
    added = queued = 0
    for prospect_id in sorted(set(prospect_ids or [])):
        prospect, _ = db_get_prospect(prospect_id)
        if not prospect:
            continue
        enrollment = db_upsert_enrollment(campaign, prospect)
        if enrollment:
            added += 1
            if campaign.get("status") != "running":
                continue
            queued_job = (
                db_queue_next_flow_step(campaign_id, prospect_id, enrollment.get("current_node_id"))
                if flow else
                db_queue_next_campaign_step(campaign_id, prospect_id, int(enrollment.get("current_step_order") or 0))
            )
            if queued_job:
                queued += 1
    return {"campaign_id": campaign_id, "added": added, "queued": queued}


def db_remove_prospects_from_campaign(campaign_id: str, prospect_ids: list[str]) -> int:
    removed = 0
    for prospect_id in sorted(set(prospect_ids or [])):
        supabase.table("campaign_enrollments").delete().eq("campaign_id", campaign_id).eq("prospect_id", prospect_id).execute()
        supabase.table("jobs").update({
            "status": "cancelled",
            "updated_at": _utc_now(),
            "error_message": "Cancelled because prospect was removed from campaign",
        }).eq("campaign_id", campaign_id).eq("prospect_id", prospect_id).in_("status", ["pending", "retrying"]).execute()
        active = db_get_active_enrollments_for_prospect(prospect_id)
        if not active:
            supabase.table("prospects").update({"campaign_id": None}).eq("id", prospect_id).execute()
        removed += 1
    return removed


def db_create_prospect_list(name: str, description: str | None = None, sort_order: int = 0) -> dict | None:
    result = supabase.table("prospect_lists").insert({
        "name": name,
        "description": description,
        "sort_order": sort_order,
    }).execute()
    return result.data[0] if result.data else None


def db_get_prospect_lists() -> list[dict]:
    lists = supabase.table("prospect_lists").select("*").order("sort_order").order("created_at", desc=True).execute().data or []
    for item in lists:
        count = (
            supabase.table("prospect_list_members")
            .select("prospect_id", count="exact")
            .eq("list_id", item["id"])
            .execute()
        )
        item["prospect_count"] = count.count or 0
    return lists


def db_update_prospect_list(list_id: str, data: dict) -> dict | None:
    clean = {k: v for k, v in data.items() if k in ("name", "description", "sort_order") and v is not None}
    if not clean:
        return None
    clean["updated_at"] = _utc_now()
    result = supabase.table("prospect_lists").update(clean).eq("id", list_id).execute()
    return result.data[0] if result.data else None


def db_delete_prospect_list(list_id: str) -> None:
    supabase.table("prospect_lists").delete().eq("id", list_id).execute()


def db_get_prospects_for_list(list_id: str, limit: int = 500, offset: int = 0) -> tuple[list[dict], int]:
    return db_get_prospects(list_id=list_id, limit=limit, offset=offset)


def db_add_prospects_to_list(list_id: str, prospect_ids: list[str]) -> int:
    payload = [{"list_id": list_id, "prospect_id": pid} for pid in prospect_ids]
    if not payload:
        return 0
    result = supabase.table("prospect_list_members").upsert(
        payload,
        on_conflict="list_id,prospect_id",
    ).execute()
    return len(result.data or [])


def db_remove_prospects_from_list(list_id: str, prospect_ids: list[str]) -> int:
    removed = 0
    for pid in prospect_ids:
        supabase.table("prospect_list_members").delete().eq("list_id", list_id).eq("prospect_id", pid).execute()
        removed += 1
    return removed


def db_get_list_prospect_ids(list_ids: list[str]) -> list[str]:
    if not list_ids:
        return []
    rows = (
        supabase.table("prospect_list_members")
        .select("prospect_id")
        .in_("list_id", list_ids)
        .execute()
        .data or []
    )
    return sorted({r["prospect_id"] for r in rows if r.get("prospect_id")})


def _step_wait_delta(config: dict) -> timedelta:
    if config.get("working_days") not in (None, "", 0, "0"):
        target = add_working_days(date.today(), int(config.get("working_days") or 0))
        return datetime.combine(target, datetime.min.time()).replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)
    return timedelta(days=int(config.get("days") or 0), hours=int(config.get("hours") or 0))


def _merge_wait_config(config: dict, override: dict | None) -> dict:
    merged = {**(config or {})}
    if not isinstance(override, dict):
        return merged
    merged.update(override)
    if "days" in override and "working_days" not in override:
        # Campaign editor day overrides must beat template working-day defaults.
        # Otherwise a template with {"working_days": 5} would ignore {"days": 0}.
        merged["working_days"] = 0
    return merged


def _message_for_step(step: dict, prospect: dict, campaign: dict) -> tuple[str, str]:
    config = step.get("config") or {}
    overrides = (campaign.get("sequence_config") or {}).get("messages") or {}
    field = config.get("message_field")
    message_type = config.get("message_type") or "initial"
    raw = overrides.get(str(step.get("step_order"))) or config.get("message") or ""
    if not raw and field:
        raw = prospect.get(field) or ""
    return db_render_message_template(raw, prospect), message_type


def db_get_initial_message_step_order(campaign_id: str) -> int | None:
    campaign, _ = db_get_campaign(campaign_id)
    if not campaign or not campaign.get("template_id"):
        return None
    for step in db_get_campaign_template_steps(campaign["template_id"]):
        action = step.get("action_type")
        config = step.get("config") or {}
        message_type = config.get("message_type") or "initial"
        if action in ("message", "follow-up message") and message_type == "initial":
            return int(step.get("step_order") or 0)
    return None


def db_queue_next_campaign_step(campaign_id: str, prospect_id: str, after_step_order: int = 0,
                                base_time: datetime | None = None) -> dict | None:
    campaign, _ = db_get_campaign(campaign_id)
    prospect, _ = db_get_prospect(prospect_id)
    if not campaign or not prospect or not campaign.get("template_id"):
        return None
    if campaign.get("status") != "running":
        logger.info("Campaign %s is %s; not queueing next step", campaign_id, campaign.get("status"))
        return None

    steps = db_get_campaign_template_steps(campaign["template_id"])
    scheduled_for = base_time or datetime.now(timezone.utc)
    profile_key = campaign.get("profile_key") or prospect.get("assigned_account") or "profile_1"
    profile_state = db_get_profile_connection_state(prospect_id, profile_key)
    is_connected_for_profile = (profile_state or {}).get("connection_status") == "connected"
    for step in steps:
        order = int(step.get("step_order") or 0)
        if order <= after_step_order:
            continue
        action = step.get("action_type")
        config = step.get("config") or {}

        if action == "wait":
            delay_override = ((campaign.get("sequence_config") or {}).get("delays") or {}).get(str(order))
            config = _merge_wait_config(config, delay_override)
            if config.get("until") == "connected":
                if not is_connected_for_profile and prospect.get("status") not in (
                    "Ready to Send", "Needs Personalization", "Initial Message Sent", "Following Up", "Replied", "No Response"
                ):
                    _update_enrollment_next(campaign_id, prospect_id, order, scheduled_for, None)
                    return None
                continue
            scheduled_for = scheduled_for + _step_wait_delta(config)
            continue

        if action == "already connected detection":
            continue

        if action == "invitation":
            if is_connected_for_profile:
                db_mark_prospect_connected(
                    prospect_id,
                    "Skipped invitation because prospect is already connected for this profile",
                    profile_key=profile_key,
                    campaign_id=campaign_id,
                )
                continue
            job_type = "send_connections"
            note_field = config.get("note_field") or "inmail_message"
            note = db_render_message_template(config.get("note") or prospect.get(note_field) or "", prospect)[:300]
            payload = {
                "linkedin_url": prospect.get("linkedin_url", ""),
                "note": note,
                "campaign_step_order": order,
                "action_type": action,
            }
        elif action in ("message", "follow-up message"):
            message, message_type = _message_for_step(step, prospect, campaign)
            if not message:
                db_log_activity(prospect_id, "campaign_step", "skipped", f"Missing message for step {order}")
                _update_enrollment_next(campaign_id, prospect_id, order, scheduled_for, None)
                continue
            if message_type == "initial" and not is_connected_for_profile and prospect.get("status") not in (
                "Ready to Send", "Initial Message Sent", "Following Up", "Replied", "No Response"
            ):
                db_log_activity(prospect_id, "campaign_step", "blocked", "Initial message blocked until prospect is connected and ready")
                _update_enrollment_next(campaign_id, prospect_id, order, scheduled_for, None)
                return None
            job_type = "send_messages"
            payload = {
                "linkedin_url": prospect.get("linkedin_url", ""),
                "message": message,
                "message_type": message_type,
                "campaign_step_order": order,
                "action_type": action,
            }
        else:
            db_log_activity(prospect_id, "campaign_step", "coming_soon", f"Action not implemented: {action}")
            _update_enrollment_next(campaign_id, prospect_id, order, scheduled_for, None)
            continue

        if db_has_active_job_for_prospect(job_type, prospect_id):
            logger.info("Active %s job already exists for prospect %s", job_type, prospect_id)
            return None

        job = db_create_job({
            "job_type": job_type,
            "profile_key": profile_key,
            "campaign_id": campaign_id,
            "prospect_id": prospect_id,
            "scheduled_for": scheduled_for.isoformat(),
            "payload": payload,
        })
        _update_enrollment_next(campaign_id, prospect_id, order, scheduled_for, job)
        if job:
            db_log_activity(prospect_id, "campaign_step", "queued", f"Queued {action} step {order}")
        return job

    supabase.table("campaign_enrollments").update({
        "status": "completed",
        "current_step_order": after_step_order,
        "updated_at": _utc_now(),
    }).eq("campaign_id", campaign_id).eq("prospect_id", prospect_id).execute()
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Visual Flow Builder execution engine
#
# Campaigns built with the Visual Flow Builder store their graph as
# campaign.sequence_config.flow_sequence = { nodes: [...], edges: [...] }.
# Each node has data.nodeType (one of NODE_TYPES_DEF in SequenceFlowBuilder.jsx)
# and data.config. Each edge has a `label` holding the branch condition
# (e.g. "accepted", "still_not_accepted", "replied", "default", ...).
#
# This engine walks that graph one prospect at a time:
#   - "inline" nodes (Wait, Needs Personalization, Ready to Send, Stop if
#     Replied, Completed, Failed, CRM Sync, Email Finder, Send Email) are
#     resolved immediately in the backend with no agent involvement.
#   - "agent" nodes (Visit Profile, Follow Profile, Endorse Profile,
#     Send Connection Request, Check Messageability, Send InMail, Send
#     Message, Check Reply, Wait for Acceptance, Wait for InMail Reply)
#     are turned into a job for the Chrome extension executor; when that
#     job completes, the resulting status is matched against the node's
#     outgoing edge conditions to choose the next node.
# ─────────────────────────────────────────────────────────────────────────────

# Maps a flow node type to the job_type the executor knows how to run.
FLOW_NODE_JOB_TYPES = {
    "visit_profile": "visit_profile",
    "follow_profile": "follow_profile",
    "endorse_profile": "endorse_profile",
    "send_invitation": "send_connections",
    "check_messageability": "check_messageability",
    "send_inmail": "send_inmail",
    "send_message": "send_messages",
    "check_reply": "check_reply",
    "wait_acceptance": "check_connection_status",
    "wait_reply": "check_reply",
}

# Maps (node_type, job-result status) -> the edge condition value used in the
# Visual Flow Builder so the engine can pick the matching outgoing edge.
FLOW_STATUS_CONDITIONS = {
    "send_invitation": {
        "connected": "already_connected",
        "sent": "default",
        "pending": "default",
        "cannot_connect": "error",
        "error": "error",
        "session_expired": "error",
    },
    "check_messageability": {
        "inmail_available": "inmail_available",
        "normal_message_available": "message_available",
        "not_messageable": "not_messageable",
        "invitation_sent": "default",
        "session_expired": "error",
    },
    "wait_acceptance": {
        "accepted": "accepted",
        "still_not_accepted": "still_not_accepted",
        "session_expired": "error",
    },
    "wait_reply": {
        "replied": "replied",
        "no_reply": "no_reply",
        "session_expired": "error",
    },
    "check_reply": {
        "replied": "replied",
        "no_reply": "no_reply",
        "session_expired": "error",
    },
    "send_inmail": {
        "inmail_sent": "sent",
        "failed_with_reason": "error",
    },
    "send_message": {
        "message_sent": "sent",
        "failed_with_reason": "error",
    },
}

# Negative/terminal-ish branch conditions: if the flow has no edge defined for
# these, we end the sequence quietly instead of leaving the prospect stuck.
_FLOW_NEGATIVE_CONDITIONS = {"still_not_accepted", "no_reply", "not_messageable", "error"}


def _campaign_flow_sequence(campaign: dict | None) -> dict | None:
    seq = ((campaign or {}).get("sequence_config") or {}).get("flow_sequence") or {}
    if seq.get("nodes"):
        return seq
    return None


def _flow_node_type(node: dict) -> str:
    return (node.get("data") or {}).get("nodeType") or node.get("type") or ""


def _flow_node_config(node: dict) -> dict:
    return (node.get("data") or {}).get("config") or {}


def _flow_node_label(node: dict) -> str:
    data = node.get("data") or {}
    return data.get("label") or NODE_LABELS_BY_TYPE.get(_flow_node_type(node)) or _flow_node_type(node)


# Lightweight label lookup mirrored from SequenceFlowBuilder.jsx NODE_TYPES_DEF
# (kept here only for nicer activity-log copy; not used for execution logic).
NODE_LABELS_BY_TYPE = {
    "visit_profile": "Visit Profile",
    "follow_profile": "Follow Profile",
    "endorse_profile": "Endorse Profile",
    "send_invitation": "Send Connection Request",
    "check_messageability": "Check Messageability",
    "send_inmail": "Send InMail",
    "send_message": "Send Message",
    "check_reply": "Check Reply",
    "needs_personalization": "Needs Personalization",
    "ready_to_send": "Ready to Send",
    "wait": "Wait / Delay",
    "wait_acceptance": "Wait for Acceptance",
    "wait_reply": "Wait for InMail Reply",
    "stop_if_replied": "Stop if Replied",
    "completed": "Completed",
    "failed": "Failed / Needs Attention",
    "crm_sync": "CRM Sync",
    "email_finder": "Email Finder",
    "send_email": "Send Email",
}


def _flow_start_node(nodes: list[dict], edges: list[dict]) -> dict | None:
    targets = {e.get("target") for e in edges}
    for n in nodes:
        if n.get("id") and n.get("id") not in targets:
            return n
    return nodes[0] if nodes else None


def _edge_condition(edge: dict) -> str:
    """The Visual Flow Builder stores the machine-readable branch condition in
    edge.data.condition (e.g. 'accepted', 'inmail_available') — edge.label is
    just the human-readable display text (e.g. '✅ Accepted'), so it must not
    be used for matching."""
    return (edge.get("data") or {}).get("condition") or "default"


def _flow_next_node(edges: list[dict], by_id: dict, node_id: str, condition: str) -> dict | None:
    outs = [e for e in edges if e.get("source") == node_id]
    if not outs:
        return None
    for e in outs:
        if _edge_condition(e) == condition:
            return by_id.get(e.get("target"))
    if condition != "default":
        for e in outs:
            if _edge_condition(e) == "default":
                return by_id.get(e.get("target"))
    return by_id.get(outs[0].get("target"))


def _flow_job_payload(node_type: str, config: dict, prospect: dict, campaign: dict) -> dict:
    base = {"linkedin_url": prospect.get("linkedin_url", "")}
    if node_type == "send_invitation":
        note = ""
        if config.get("add_note"):
            note = db_render_message_template(config.get("note") or "", prospect)[:300]
        return {**base, "note": note, "action_type": "invitation"}
    if node_type == "check_messageability":
        return {**base, "fallback": config.get("fallback") or "invitation"}
    if node_type == "send_inmail":
        return {
            **base,
            "subject": db_render_message_template(config.get("subject") or "", prospect),
            "message": db_render_message_template(config.get("message") or "", prospect),
        }
    if node_type == "send_message":
        return {
            **base,
            "message": db_render_message_template(config.get("message") or "", prospect),
            "message_type": config.get("message_type") or "initial",
        }
    if node_type == "wait_reply":
        return {**base, "message": db_render_message_template(config.get("message") or "", prospect),
                "check_frequency_hours": _flow_monitor_frequency_hours(node_type, config),
                "max_wait_days": _flow_monitor_max_wait_days(node_type, config)}
    if node_type == "wait_acceptance":
        return {**base,
                "check_frequency_hours": _flow_monitor_frequency_hours(node_type, config),
                "max_wait_days": _flow_monitor_max_wait_days(node_type, config)}
    if node_type == "endorse_profile":
        return {**base, "skill": config.get("skill") or ""}
    return base


def _run_inline_flow_node(campaign: dict, prospect: dict, node: dict, scheduled_for: datetime):
    """Resolve a node that needs no agent action.

    Returns one of:
      - timedelta: advance scheduled_for by this much, then continue on the default edge
      - "CONTINUE": move to the default edge immediately
      - "STOP": pause the sequence here (prospect needs human action)
      - "TERMINAL": sequence has ended for this prospect (completed/failed)
      - None: this node needs an agent job (caller should create one)
    """
    node_type = _flow_node_type(node)
    config = _flow_node_config(node)
    node_id = node.get("id")
    prospect_id = prospect.get("id")
    campaign_id = campaign.get("id")

    if node_type == "wait":
        if config.get("working_days_mode"):
            working_days = config.get("working_days")
            n = int(working_days if working_days is not None else 1)
            target = add_working_days(date.today(), n)
            return datetime.combine(target, datetime.min.time()).replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)
        days = config.get("days")
        return timedelta(days=int(days if days is not None else 1))

    if node_type == "needs_personalization":
        db_update_prospect(prospect_id, {
            "status": "Needs Personalization",
            "personalization_status": "needs_message_copy",
            "ready_to_send": False,
            "next_steps": "Write a personalized message, then mark Ready to Send",
            "last_action_at": _utc_now(),
        })
        _set_flow_position(campaign_id, prospect_id, node_id, scheduled_for, None, status="active")
        db_log_activity(prospect_id, "flow_step", "paused", "Sequence paused — needs personalization")
        return "STOP"

    if node_type == "ready_to_send":
        db_update_prospect(prospect_id, {
            "ready_to_send": True,
            "status": "Ready to Send",
            "next_steps": "Sending prepared message",
            "last_action_at": _utc_now(),
        })
        db_log_activity(prospect_id, "flow_step", "ready", "Marked Ready to Send")
        return "CONTINUE"

    if node_type == "stop_if_replied":
        if (prospect or {}).get("status") == "Replied":
            db_update_prospect(prospect_id, {"next_steps": "Sequence stopped — prospect replied", "last_action_at": _utc_now()})
            _finish_flow_enrollment(campaign_id, prospect_id, node_id, status="completed")
            db_log_activity(prospect_id, "flow_step", "stopped", "Sequence stopped — prospect already replied")
            return "TERMINAL"
        return "CONTINUE"

    if node_type == "completed":
        db_update_prospect(prospect_id, {"status": "Completed", "next_steps": "Sequence complete", "last_action_at": _utc_now()})
        _finish_flow_enrollment(campaign_id, prospect_id, node_id, status="completed")
        db_log_activity(prospect_id, "flow_step", "completed", "Sequence completed")
        return "TERMINAL"

    if node_type == "failed":
        db_update_prospect(prospect_id, {"status": "Needs Attention", "next_steps": "Flagged for manual review", "last_action_at": _utc_now()})
        _finish_flow_enrollment(campaign_id, prospect_id, node_id, status="needs_attention")
        db_log_activity(prospect_id, "flow_step", "failed", "Sequence flagged — needs attention")
        return "TERMINAL"

    if node_type in ("crm_sync", "email_finder", "send_email"):
        # These need a connected integration (HubSpot / email-finder / mailbox)
        # which isn't wired up yet. Log it clearly and let the sequence
        # continue rather than silently stalling the prospect.
        db_log_activity(
            prospect_id, "flow_step", "integration_not_configured",
            f"{_flow_node_label(node)} step skipped — connect this integration in Settings to enable it",
        )
        return "CONTINUE"

    return None


def _set_flow_position(campaign_id: str, prospect_id: str, node_id: str | None,
                        scheduled_for: datetime, job: dict | None, status: str | None = None) -> None:
    updates = {
        "current_node_id": node_id,
        "next_step_at": scheduled_for.isoformat(),
        "last_job_id": (job or {}).get("id"),
        "updated_at": _utc_now(),
    }
    if status:
        updates["status"] = status
    supabase.table("campaign_enrollments").update(updates).eq("campaign_id", campaign_id).eq("prospect_id", prospect_id).execute()


def _finish_flow_enrollment(campaign_id: str, prospect_id: str, node_id: str | None, status: str = "completed") -> None:
    supabase.table("campaign_enrollments").update({
        "status": status,
        "current_node_id": node_id,
        "updated_at": _utc_now(),
    }).eq("campaign_id", campaign_id).eq("prospect_id", prospect_id).execute()


def _parse_iso_dt(value) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _get_flow_state(campaign_id: str, prospect_id: str) -> dict:
    res = (supabase.table("campaign_enrollments")
           .select("flow_state")
           .eq("campaign_id", campaign_id).eq("prospect_id", prospect_id)
           .limit(1).execute())
    rows = res.data or []
    state = (rows[0] or {}).get("flow_state") if rows else None
    return state if isinstance(state, dict) else {}


def _update_flow_state(campaign_id: str, prospect_id: str, patch: dict) -> None:
    """Shallow-merge `patch` into campaign_enrollments.flow_state — the
    free-form jsonb bag (added in 2026_06_08_flow_sequence_execution.sql)
    used for cross-job bookkeeping such as acceptance/reply polling.
    A `None` value for a key removes that key from the bag."""
    state = _get_flow_state(campaign_id, prospect_id)
    for key, value in patch.items():
        if value is None:
            state.pop(key, None)
        else:
            state[key] = value
    supabase.table("campaign_enrollments").update({
        "flow_state": state, "updated_at": _utc_now(),
    }).eq("campaign_id", campaign_id).eq("prospect_id", prospect_id).execute()


# "Wait for Acceptance" / "Wait for InMail Reply" nodes poll periodically —
# e.g. "check once a day for up to 30 days" — rather than waiting a fixed
# number of days and checking exactly once. These helpers read the
# user-configured cadence (`check_frequency_hours` / `max_wait_days`) with
# backwards-compatible fallbacks for campaigns saved before this existed
# (which only had a single "wait N days, then check once" field).
def _flow_monitor_frequency_hours(node_type: str, config: dict) -> float:
    hours = config.get("check_frequency_hours")
    if hours:
        try:
            return max(1.0, float(hours))
        except (TypeError, ValueError):
            pass
    if node_type == "wait_reply":
        legacy_days = config.get("check_after_days")
        if legacy_days:
            try:
                return max(1.0, float(legacy_days) * 24.0)
            except (TypeError, ValueError):
                pass
    return 24.0  # sensible default: check once a day


def _flow_monitor_max_wait_days(node_type: str, config: dict) -> float:
    days = config.get("max_wait_days")
    if days:
        try:
            return max(1.0, float(days))
        except (TypeError, ValueError):
            pass
    # Legacy single-shot configs used this value as "wait this long, then
    # check once" — give the new polling behaviour generous headroom (3x)
    # so older campaigns keep monitoring at least as long as they used to.
    legacy = config.get("timeout_days") if node_type == "wait_acceptance" else config.get("check_after_days")
    if legacy:
        try:
            return max(1.0, float(legacy) * 3.0)
        except (TypeError, ValueError):
            pass
    return 30.0  # sensible default: give up after 30 days


def _format_monitor_interval(hours: float) -> str:
    if hours >= 24 and hours % 24 == 0:
        days = int(hours // 24)
        return f"{days} day{'s' if days != 1 else ''}"
    return f"{int(hours)} hour{'s' if hours != 1 else ''}"


_FLOW_MONITOR_PENDING_STATUSES = {
    "wait_acceptance": {"still_not_accepted"},
    "wait_reply": {"no_reply"},
}


def _continue_flow_wait_monitor(campaign_id: str, prospect_id: str, node_id: str, node_type: str, status: str) -> bool:
    """Decide whether a 'still pending' result from a Wait-for-Acceptance /
    Wait-for-InMail-Reply check should queue ANOTHER periodic check (still
    inside the configured max-wait window) or be allowed to fall through to
    normal edge routing (the monitoring window has expired).

    Returns True when another check was queued — the caller should stop and
    NOT advance the prospect to the next node yet."""
    campaign, _ = db_get_campaign(campaign_id)
    if (campaign or {}).get("status") != "running":
        return False
    flow = _campaign_flow_sequence(campaign)
    by_id = {n.get("id"): n for n in (flow or {}).get("nodes") or [] if n.get("id")}
    node = by_id.get(node_id)
    if not node:
        return False
    config = _flow_node_config(node)

    state = _get_flow_state(campaign_id, prospect_id)
    monitor = state.get("wait_monitor") or {}
    if monitor.get("node_id") != node_id:
        monitor = {"node_id": node_id, "started_at": _utc_now(), "checks": 0}
    started_at = _parse_iso_dt(monitor.get("started_at")) or datetime.now(timezone.utc)
    checks = int(monitor.get("checks") or 0) + 1
    max_wait_days = _flow_monitor_max_wait_days(node_type, config)
    now = datetime.now(timezone.utc)

    if now - started_at >= timedelta(days=max_wait_days):
        db_log_activity(
            prospect_id, "flow_step", "monitor_expired",
            f"{_flow_node_label_by_type(node_type)}: still '{status}' after {checks} check(s) over "
            f"~{max_wait_days:.0f} days — giving up and moving on",
        )
        return False

    freq_hours = _flow_monitor_frequency_hours(node_type, config)
    scheduled_for = now + timedelta(hours=freq_hours)
    job_type = FLOW_NODE_JOB_TYPES.get(node_type)
    prospect, _ = db_get_prospect(prospect_id)
    profile_key = campaign.get("profile_key") or (prospect or {}).get("assigned_account") or "profile_1"
    payload = {
        **_flow_job_payload(node_type, config, prospect or {}, campaign),
        "flow_node_id": node_id,
        "flow_node_type": node_type,
    }
    job = db_create_job({
        "job_type": job_type,
        "profile_key": profile_key,
        "campaign_id": campaign_id,
        "prospect_id": prospect_id,
        "scheduled_for": scheduled_for.isoformat(),
        "payload": payload,
    })
    if not job:
        return False
    _update_flow_state(campaign_id, prospect_id, {
        "wait_monitor": {
            "node_id": node_id,
            "started_at": monitor.get("started_at") or _utc_now(),
            "checks": checks,
            "last_status": status,
            "last_checked_at": _utc_now(),
        },
    })
    _set_flow_position(campaign_id, prospect_id, node_id, scheduled_for, job)
    db_log_activity(
        prospect_id, "flow_step", "monitoring",
        f"{_flow_node_label_by_type(node_type)}: still '{status}' (check #{checks}) — "
        f"checking again in {_format_monitor_interval(freq_hours)}",
    )
    return True


def db_queue_next_flow_step(campaign_id: str, prospect_id: str, node_id: str | None = None,
                            base_time: datetime | None = None) -> dict | None:
    """Graph-walking counterpart to db_queue_next_campaign_step for Visual Flow
    Builder campaigns. Walks sequence_config.flow_sequence starting at node_id
    (or the graph's start node), resolving inline nodes immediately and
    creating exactly one agent job for the next node that needs one."""
    campaign, _ = db_get_campaign(campaign_id)
    prospect, _ = db_get_prospect(prospect_id)
    if not campaign or not prospect:
        return None
    flow = _campaign_flow_sequence(campaign)
    if not flow:
        return None
    if campaign.get("status") != "running":
        logger.info("Campaign %s is %s; not queueing next flow step", campaign_id, campaign.get("status"))
        return None

    nodes = flow.get("nodes") or []
    edges = flow.get("edges") or []
    by_id = {n.get("id"): n for n in nodes if n.get("id")}
    scheduled_for = base_time or datetime.now(timezone.utc)
    profile_key = campaign.get("profile_key") or prospect.get("assigned_account") or "profile_1"

    node = by_id.get(node_id) if node_id else _flow_start_node(nodes, edges)

    guard = 0
    while node and guard < 100:
        guard += 1
        outcome = _run_inline_flow_node(campaign, prospect, node, scheduled_for)
        if outcome in ("STOP", "TERMINAL"):
            return None
        if isinstance(outcome, timedelta):
            scheduled_for = scheduled_for + outcome
            node = _flow_next_node(edges, by_id, node.get("id"), "default")
            continue
        if outcome == "CONTINUE":
            node = _flow_next_node(edges, by_id, node.get("id"), "default")
            continue
        break  # outcome is None -> this node needs an agent job

    if not node:
        prospect, _ = db_get_prospect(prospect_id)
        if (prospect or {}).get("status") not in ("Completed", "Needs Attention", "Replied"):
            db_update_prospect(prospect_id, {"status": "Completed", "next_steps": "Sequence complete", "last_action_at": _utc_now()})
        _finish_flow_enrollment(campaign_id, prospect_id, None, status="completed")
        return None

    node_id = node.get("id")
    node_type = _flow_node_type(node)
    config = _flow_node_config(node)
    job_type = FLOW_NODE_JOB_TYPES.get(node_type)

    if not job_type:
        db_log_activity(prospect_id, "flow_step", "skipped", f"Unsupported step type '{node_type}' — skipping")
        next_node = _flow_next_node(edges, by_id, node_id, "default")
        _set_flow_position(campaign_id, prospect_id, (next_node or {}).get("id"), scheduled_for, None)
        if next_node:
            return db_queue_next_flow_step(campaign_id, prospect_id, next_node.get("id"), scheduled_for)
        _finish_flow_enrollment(campaign_id, prospect_id, node_id, status="completed")
        return None

    # "Wait for Acceptance" / "Wait for InMail Reply" nodes poll periodically:
    # entering the node (re)starts the monitoring window's bookkeeping and
    # schedules the FIRST check one cadence-interval from now. Subsequent
    # checks are re-queued directly by _continue_flow_wait_monitor (called
    # from db_apply_completed_flow_job) without re-walking the graph, so this
    # branch only fires on the initial entry into the node.
    if node_type in ("wait_acceptance", "wait_reply"):
        _update_flow_state(campaign_id, prospect_id, {
            "wait_monitor": {"node_id": node_id, "started_at": _utc_now(), "checks": 0},
        })
        scheduled_for = scheduled_for + timedelta(hours=_flow_monitor_frequency_hours(node_type, config))

    if db_has_active_job_for_prospect(job_type, prospect_id):
        logger.info("Active %s job already exists for prospect %s", job_type, prospect_id)
        return None

    payload = {
        **_flow_job_payload(node_type, config, prospect, campaign),
        "flow_node_id": node_id,
        "flow_node_type": node_type,
    }
    job = db_create_job({
        "job_type": job_type,
        "profile_key": profile_key,
        "campaign_id": campaign_id,
        "prospect_id": prospect_id,
        "scheduled_for": scheduled_for.isoformat(),
        "payload": payload,
    })
    _set_flow_position(campaign_id, prospect_id, node_id, scheduled_for, job)
    if job:
        db_log_activity(prospect_id, "flow_step", "queued", f"Queued {_flow_node_label(node)}")
    return job


def _flow_condition_for_status(node_type: str, status: str) -> str:
    return (FLOW_STATUS_CONDITIONS.get(node_type) or {}).get(status, "default")


def db_apply_completed_flow_job(job: dict, result: dict) -> None:
    """Counterpart to db_apply_completed_job_result for jobs created by the
    Visual Flow Builder graph-walker (identified via payload.flow_node_id)."""
    prospect_id = job.get("prospect_id")
    campaign_id = job.get("campaign_id")
    payload = job.get("payload") or {}
    node_id = payload.get("flow_node_id")
    node_type = payload.get("flow_node_type") or ""
    if not prospect_id or not campaign_id or not node_id:
        return

    status = result.get("status") or ""
    today = date.today().isoformat()
    profile_key = job.get("profile_key")

    # Mirror the prospect-facing status transitions the template engine makes,
    # so the dashboard stays accurate regardless of which builder was used.
    if node_type == "send_invitation" and status == "connected":
        db_mark_prospect_connected(prospect_id, "Already connected (flow connection step)", profile_key=profile_key, campaign_id=campaign_id, skip_legacy_advance=True)
    elif node_type == "send_invitation" and status in ("sent", "pending"):
        db_update_prospect(prospect_id, {
            "status": "Connection Request Sent",
            "connection_sent_date": today,
            "connection_status": "invitation_sent" if status == "sent" else "invitation_pending",
            "next_steps": "Waiting for connection acceptance",
            "last_action_at": _utc_now(),
        })
        db_mark_invitation_sent({"id": prospect_id}, profile_key, campaign_id)
    elif node_type == "check_messageability" and status == "inmail_available":
        db_update_prospect(prospect_id, {
            "status": "inmail_available", "messageability_status": "inmail_available",
            "personalization_status": "needs_inmail_copy", "last_action_at": _utc_now(),
            "next_steps": "Review InMail subject/body and mark Ready to Send",
        })
    elif node_type == "check_messageability" and status == "normal_message_available":
        db_mark_prospect_connected(prospect_id, "Messageability check found normal message available", profile_key=profile_key, campaign_id=campaign_id, skip_legacy_advance=True)
    elif node_type == "check_messageability" and status == "invitation_sent":
        db_update_prospect(prospect_id, {
            "status": "Connection Request Sent", "connection_status": "invitation_sent",
            "connection_sent_date": today, "next_steps": "Waiting for connection acceptance",
            "last_action_at": _utc_now(),
        })
        db_mark_invitation_sent({"id": prospect_id}, profile_key, campaign_id)
    elif node_type == "send_inmail" and status == "inmail_sent":
        db_update_prospect(prospect_id, {
            "status": "Sent", "inmail_status": "sent", "inmail_sent_at": _utc_now(),
            "personalization_status": "sent", "ready_to_send": False, "last_action_at": _utc_now(),
        })
    elif node_type == "send_message" and status == "message_sent":
        db_update_prospect(prospect_id, {
            "status": "Initial Message Sent", "message_sent_date": today,
            "initial_message_sent_at": _utc_now(), "ready_to_send": False,
            "personalization_status": "sent", "last_action_at": _utc_now(),
        })
    elif node_type == "wait_acceptance" and status == "accepted":
        db_mark_prospect_connected(prospect_id, "Connection accepted (flow wait-for-acceptance check)", profile_key=profile_key, campaign_id=campaign_id, skip_legacy_advance=True)
    elif node_type in ("check_reply", "wait_reply") and status == "replied":
        db_update_prospect(prospect_id, {"status": "Replied", "next_steps": "Prospect replied", "last_action_at": _utc_now()})
    elif node_type == "follow_profile" and status in ("followed", "already_following"):
        db_log_activity(prospect_id, "flow_step", status, result.get("message") or "Followed prospect profile")
    elif node_type == "endorse_profile" and status == "endorsed":
        db_log_activity(prospect_id, "flow_step", "endorsed", result.get("message") or "Endorsed a skill")
    elif node_type == "visit_profile" and status == "visited":
        db_update_prospect(prospect_id, {"last_action_at": _utc_now()})

    db_log_activity(prospect_id, "flow_step", status or "completed", f"{_flow_node_label_by_type(node_type)} → {status or 'completed'}")

    # "Still pending" results from a polling node don't advance the prospect —
    # they either queue another check (still inside the max-wait window) or
    # fall through to normal edge routing once that window has expired.
    if status in _FLOW_MONITOR_PENDING_STATUSES.get(node_type, ()):
        if _continue_flow_wait_monitor(campaign_id, prospect_id, node_id, node_type, status):
            return

    if node_type in ("wait_acceptance", "wait_reply"):
        _update_flow_state(campaign_id, prospect_id, {"wait_monitor": None})

    _advance_flow_after_result(campaign_id, prospect_id, node_id, node_type, status)


def _flow_node_label_by_type(node_type: str) -> str:
    return NODE_LABELS_BY_TYPE.get(node_type, node_type)


def _advance_flow_after_result(campaign_id: str, prospect_id: str, node_id: str, node_type: str, status: str) -> None:
    campaign, _ = db_get_campaign(campaign_id)
    flow = _campaign_flow_sequence(campaign)
    if not flow:
        return
    nodes = flow.get("nodes") or []
    edges = flow.get("edges") or []
    by_id = {n.get("id"): n for n in nodes if n.get("id")}
    condition = _flow_condition_for_status(node_type, status)
    next_node = _flow_next_node(edges, by_id, node_id, condition)

    if next_node:
        db_queue_next_flow_step(campaign_id, prospect_id, next_node.get("id"))
        return

    if condition in _FLOW_NEGATIVE_CONDITIONS:
        db_update_prospect(prospect_id, {
            "status": "No Response" if condition in ("still_not_accepted", "no_reply") else "Needs Attention",
            "next_steps": "Sequence ended — no branch defined for this outcome",
            "last_action_at": _utc_now(),
        })
        _finish_flow_enrollment(campaign_id, prospect_id, node_id,
                                status="completed" if condition in ("still_not_accepted", "no_reply") else "needs_attention")
        db_log_activity(prospect_id, "flow_step", "ended", f"No '{condition}' branch from {_flow_node_label_by_type(node_type)} — ending sequence")
    else:
        db_update_prospect(prospect_id, {
            "next_steps": "Sequence paused — no matching branch for this result; review the flow",
            "last_action_at": _utc_now(),
        })
        _set_flow_position(campaign_id, prospect_id, node_id, datetime.now(timezone.utc), None, status="active")
        db_log_activity(prospect_id, "flow_step", "paused", f"No '{condition}' branch from {_flow_node_label_by_type(node_type)} — paused for review")


def db_apply_failed_flow_job(job: dict, error_message: str, result: dict | None = None) -> None:
    """Called when a flow-driven job permanently fails (after max retries)."""
    prospect_id = job.get("prospect_id")
    campaign_id = job.get("campaign_id")
    payload = job.get("payload") or {}
    node_id = payload.get("flow_node_id")
    node_type = payload.get("flow_node_type") or ""
    if not prospect_id or not campaign_id or not node_id:
        return

    db_log_activity(prospect_id, "flow_step", "failed", f"{_flow_node_label_by_type(node_type)} failed: {error_message[:200]}")
    campaign, _ = db_get_campaign(campaign_id)
    flow = _campaign_flow_sequence(campaign)
    if not flow:
        return
    nodes = flow.get("nodes") or []
    edges = flow.get("edges") or []
    by_id = {n.get("id"): n for n in nodes if n.get("id")}
    next_node = _flow_next_node(edges, by_id, node_id, "error")
    if next_node:
        db_queue_next_flow_step(campaign_id, prospect_id, next_node.get("id"))
        return
    db_update_prospect(prospect_id, {
        "status": "Needs Attention",
        "next_steps": f"Flow step failed: {error_message[:120]}",
        "last_action_at": _utc_now(),
    })
    _finish_flow_enrollment(campaign_id, prospect_id, node_id, status="needs_attention")


def _update_enrollment_next(campaign_id: str, prospect_id: str, step_order: int,
                            scheduled_for: datetime, job: dict | None):
    updates = {
        "current_step_order": step_order,
        "next_step_at": scheduled_for.isoformat(),
        "last_job_id": (job or {}).get("id"),
        "updated_at": _utc_now(),
    }
    supabase.table("campaign_enrollments").update(updates).eq("campaign_id", campaign_id).eq("prospect_id", prospect_id).execute()


def db_launch_campaign(campaign_id: str, prospect_ids: list[str] | None = None,
                       list_ids: list[str] | None = None) -> dict:
    campaign, _ = db_get_campaign(campaign_id)
    if not campaign:
        return {"error": "campaign_not_found", "queued": 0, "enrolled": 0}
    flow = _campaign_flow_sequence(campaign)
    if not campaign.get("template_id") and not flow:
        return {"error": "template_required", "queued": 0, "enrolled": 0}

    if list_ids:
        prospect_ids = sorted(set((prospect_ids or []) + db_get_list_prospect_ids(list_ids)))

    if prospect_ids:
        prospects = []
        for pid in prospect_ids:
            prospect, _ = db_get_prospect(pid)
            if prospect:
                prospects.append(prospect)
    else:
        prospects = supabase.table("prospects").select("*").eq("campaign_id", campaign_id).execute().data or []

    supabase.table("campaigns").update({
        "status": "running",
        "launched_at": _utc_now(),
    }).eq("id", campaign_id).execute()
    campaign["status"] = "running"

    enrolled = 0
    queued = 0
    for prospect in prospects:
        enrollment = db_upsert_enrollment(campaign, prospect)
        if enrollment:
            enrolled += 1
            queued_job = (
                db_queue_next_flow_step(campaign_id, prospect["id"])
                if flow else
                db_queue_next_campaign_step(campaign_id, prospect["id"], 0)
            )
            if queued_job:
                queued += 1
    return {"campaign_id": campaign_id, "enrolled": enrolled, "queued": queued}


def db_update_campaign_status(campaign_id: str, status: str) -> dict | None:
    now = _utc_now()
    payload = {"status": status}
    if status == "running":
        payload["launched_at"] = now
    elif status == "paused":
        payload["paused_at"] = now
    elif status == "archived":
        payload["archived_at"] = now
    result = supabase.table("campaigns").update(payload).eq("id", campaign_id).execute()
    return result.data[0] if result.data else None


def db_advance_connected_campaign_enrollments(prospect_id: str) -> dict | None:
    queued = None
    for enrollment in db_get_active_enrollments_for_prospect(prospect_id):
        campaign_id = enrollment["campaign_id"]
        campaign, _ = db_get_campaign(campaign_id)
        if _campaign_flow_sequence(campaign):
            # Flow campaigns manage their own advancement in db_apply_completed_flow_job
            continue
        job = db_queue_next_campaign_step(
            campaign_id,
            prospect_id,
            int(enrollment.get("current_step_order") or 0),
        )
        queued = queued or job
    return queued


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
    jobs = []
    for job in result.data or []:
        if db_job_is_still_eligible(job):
            jobs.append(job)
    return jobs


def db_job_is_still_eligible(job: dict) -> bool:
    """Cancel stale pending message jobs that no longer match prospect state."""
    if not job or job.get("job_type") not in ("send_messages", "send_followups"):
        return True

    prospect_id = job.get("prospect_id")
    if not prospect_id:
        return True

    prospect, _ = db_get_prospect(prospect_id)
    if not prospect:
        db_update_job(job["id"], {
            "status": "cancelled",
            "error_message": "Cancelled because prospect no longer exists",
        })
        return False

    payload = job.get("payload") or {}
    terminal_statuses = {"Replied", "No Response"}
    if prospect.get("status") in terminal_statuses:
        db_update_job(job["id"], {
            "status": "cancelled",
            "error_message": f"Cancelled because prospect is {prospect.get('status')}",
        })
        return False

    # Flow jobs manage their own sequencing — skip legacy message_type guard
    if payload.get("flow_node_id"):
        return True

    message_type = payload.get("message_type") or "initial"
    if message_type == "initial" and prospect.get("message_sent_date"):
        db_update_job(job["id"], {
            "status": "cancelled",
            "error_message": "Cancelled stale initial-message job; initial message is already sent",
        })
        return False

    if message_type != "initial" and not prospect.get("message_sent_date"):
        db_update_job(job["id"], {
            "status": "cancelled",
            "error_message": "Cancelled follow-up job because initial message has not been sent",
        })
        return False

    return True


def db_recover_due_campaign_message_steps() -> int:
    """
    Recover sequence progress when a prospect was marked messaged by an older
    non-campaign job. This queues the next due campaign message from the
    enrollment's current step without resending completed initial messages.
    """
    now = _utc_now()
    rows = (
        supabase.table("campaign_enrollments")
        .select("*, prospects(*)")
        .eq("status", "active")
        .lte("next_step_at", now)
        .execute()
        .data or []
    )
    queued = 0
    for enrollment in rows:
        prospect = enrollment.get("prospects") or {}
        prospect_id = enrollment.get("prospect_id")
        if not prospect_id:
            continue
        if prospect.get("status") not in ("Initial Message Sent", "Following Up"):
            continue
        campaign_id = enrollment.get("campaign_id")
        campaign, _ = db_get_campaign(campaign_id)
        if _campaign_flow_sequence(campaign):
            continue
        if db_has_active_job_for_prospect("send_messages", prospect_id) or db_has_active_job_for_prospect("send_followups", prospect_id):
            continue
        current_step = int(enrollment.get("current_step_order") or 0)
        job = db_queue_next_campaign_step(campaign_id, prospect_id, current_step)
        if job:
            queued += 1
    return queued


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
        if (job_before.get("payload") or {}).get("flow_node_id"):
            db_apply_completed_flow_job(job_before, result)
        else:
            db_apply_completed_job_result(job_before, result)
    return completed


def _job_scheduled_date(job: dict | None) -> str | None:
    value = (job or {}).get("scheduled_for")
    if not value:
        return None
    return str(value).split("T", 1)[0]


def _next_steps_for_queued_job(job: dict | None) -> str:
    if not job:
        return "Sequence Complete"
    payload = job.get("payload") or {}
    message_type = payload.get("message_type") or ""
    scheduled_date = _job_scheduled_date(job) or date.today().isoformat()
    if message_type.startswith("followup_"):
        number = message_type.rsplit("_", 1)[-1]
        return f"Follow-up {number} on {scheduled_date}"
    if message_type == "initial":
        return f"Initial message on {scheduled_date}"
    action = payload.get("action_type") or job.get("job_type") or "next step"
    return f"{action} on {scheduled_date}"


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
    prospect, _ = db_get_prospect(prospect_id)

    if task_type == "send_connection" and status == "connected":
        db_mark_prospect_connected(
            prospect_id,
            "Already connected detected during connection job completion",
            profile_key=job.get("profile_key"),
            campaign_id=job.get("campaign_id"),
        )
    elif task_type == "check_messageability" and status == "inmail_available":
        db_update_prospect(prospect_id, {
            "status": "inmail_available",
            "messageability_status": "inmail_available",
            "inmail_status": "available",
            "personalization_status": "needs_inmail_copy",
            "ready_to_send": False,
            "last_messageability_checked_at": _utc_now(),
            "next_steps": "Review InMail subject/body and mark Ready To Send",
            "last_action_at": _utc_now(),
        })
        db_log_activity(prospect_id, "check_messageability", "inmail_available", "Moved to InMail Ready queue")
    elif task_type == "check_messageability" and status in ("normal_message_available", "already_connected", "connection_accepted", "ready_for_message"):
        db_mark_prospect_connected(
            prospect_id,
            f"Messageability check returned {status}",
            profile_key=job.get("profile_key"),
            campaign_id=job.get("campaign_id"),
        )
        db_update_prospect(prospect_id, {
            "status": "message_ready",
            "messageability_status": "normal_message_available",
            "personalization_status": "needs_message_copy",
            "ready_to_send": False,
            "last_messageability_checked_at": _utc_now(),
            "next_steps": "Review message and mark Ready To Send",
            "last_action_at": _utc_now(),
        })
        db_log_activity(prospect_id, "check_messageability", status, "Moved to Message Ready queue")
    elif task_type == "check_messageability" and status == "invitation_sent":
        db_update_prospect(prospect_id, {
            "status": "waiting_connection_acceptance",
            "messageability_status": "not_messageable",
            "connection_sent_date": today,
            "invitation_sent_at": _utc_now(),
            "connection_status": "invitation_sent",
            "next_steps": "Wait for connection acceptance",
            "last_action_at": _utc_now(),
        })
        db_mark_invitation_sent(prospect or {"id": prospect_id}, job.get("profile_key"), job.get("campaign_id"))
        db_log_activity(prospect_id, "check_messageability", "invitation_sent", "No message/InMail path; invitation fallback sent")
    elif task_type == "send_prepared_inmail" and status == "inmail_sent":
        db_update_prospect(prospect_id, {
            "status": "Sent",
            "inmail_status": "sent",
            "inmail_sent_at": _utc_now(),
            "ready_to_send": False,
            "personalization_status": "sent",
            "last_action_at": _utc_now(),
            "next_steps": "Follow-up scheduling pending campaign delay",
        })
        db_log_activity(prospect_id, "send_inmail", "sent", "Prepared InMail sent")
    elif task_type == "send_prepared_message" and status == "message_sent":
        db_update_prospect(prospect_id, {
            "status": "Sent",
            "message_sent_date": today,
            "ready_to_send": False,
            "personalization_status": "sent",
            "last_action_at": _utc_now(),
            "next_steps": "Follow-up scheduling pending campaign delay",
        })
        db_log_activity(prospect_id, "send_message", "prepared_sent", "Prepared message sent")
    elif task_type == "send_connection" and status == "sent":
        db_update_prospect(prospect_id, {
            "status": "Connection Request Sent",
            "connection_sent_date": today,
            "next_steps": "Check acceptance in My Network",
            "connection_status": "invitation_sent",
            "last_action_at": _utc_now(),
        })
        db_mark_invitation_sent(prospect or {"id": prospect_id}, job.get("profile_key"), job.get("campaign_id"))
        db_log_activity(prospect_id, "send_connection", "sent", "Connection request sent by executor")
    elif task_type == "send_connection" and status == "pending":
        db_update_prospect(prospect_id, {
            "status": "Connection Request Sent",
            "next_steps": "Connection request already pending; check acceptance",
            "connection_status": "invitation_pending",
            "last_action_at": _utc_now(),
        })
        db_mark_invitation_sent(prospect or {"id": prospect_id}, job.get("profile_key"), job.get("campaign_id"))
        db_log_activity(prospect_id, "send_connection", "pending", "LinkedIn already showed a pending invitation")
    elif task_type == "send_message" and status == "message_sent" and message_type == "initial":
        db_update_prospect(prospect_id, {
            "status": "Initial Message Sent",
            "message_sent_date": today,
            "initial_message_sent_at": _utc_now(),
            "last_action_at": _utc_now(),
            "next_steps": "Queueing next campaign step",
        })
        if job.get("campaign_id"):
            supabase.table("campaign_enrollments").update({
                "last_message_sent_at": _utc_now(),
                "updated_at": _utc_now(),
            }).eq("campaign_id", job["campaign_id"]).eq("prospect_id", prospect_id).execute()
        step_order = int((job.get("payload") or {}).get("campaign_step_order") or 0)
        next_job = None
        if job.get("campaign_id") and step_order:
            next_job = db_queue_next_campaign_step(job["campaign_id"], prospect_id, step_order)
        db_update_prospect(prospect_id, {
            "next_steps": _next_steps_for_queued_job(next_job),
            "last_action_at": _utc_now(),
        })
    elif task_type == "send_message" and status == "message_sent":
        step_order = int((job.get("payload") or {}).get("campaign_step_order") or 0)
        next_job = None
        if job.get("campaign_id") and step_order:
            next_job = db_queue_next_campaign_step(job["campaign_id"], prospect_id, step_order)
        final_status = "No Response" if not next_job else "Following Up"
        db_update_prospect(prospect_id, {
            "status": final_status,
            "last_action_at": _utc_now(),
            "next_steps": _next_steps_for_queued_job(next_job),
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
    updated = db_update_job(job_id, {
        "status": status,
        "failed_at": _utc_now(),
        "error_message": error_message[:500],
        "retry_count": retry_count,
        "scheduled_for": scheduled_for if status == "retrying" else None,
        "result": result or {},
    })
    if status == "failed" and job and (job.get("payload") or {}).get("flow_node_id"):
        db_apply_failed_flow_job(job, error_message, result)
    return updated


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
    active_campaigns     = (
        supabase.table("campaigns")
        .select("id", count="exact")
        .in_("status", ["active", "running"])
        .execute()
        .count or 0
    )
    needs_personalization = _count("prospects", status="Needs Personalization")
    ready_for_message = _count("prospects", status="Ready to Send")
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

    profiles = db_get_all_profiles()

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
        "ready_for_message":       ready_for_message,
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


def _template_payload(data: dict) -> dict:
    message_type = data.get("message_type") or data.get("type") or "initial"
    status = data.get("status") or ("active" if data.get("active", True) else "archived")
    payload = {
        "name": data["name"],
        "subject": data.get("subject"),
        "body": data.get("body") or "",
        "message_type": message_type,
        "type": data.get("type") or message_type,
        "category": data.get("category"),
        "folder": data.get("folder"),
        "tags": data.get("tags") or [],
        "status": status,
        "active": status != "archived" and bool(data.get("active", True)),
        "sequence": data.get("sequence") or [],
        "variables": data.get("variables") or [],
        "custom_fields": data.get("custom_fields") or {},
        "created_by": data.get("created_by") or "LinkedFlow",
        "updated_at": _utc_now(),
    }
    if data.get("id"):
        payload["id"] = data["id"]
    return payload


def db_get_message_templates(
    search: str | None = None,
    message_type: str | None = None,
    status: str | None = None,
    include_archived: bool = False,
) -> list[dict]:
    query = supabase.table("message_templates").select("*")
    if message_type:
        query = query.eq("type", message_type)
    if status:
        query = query.eq("status", status)
    elif not include_archived:
        query = query.neq("status", "archived")
    rows = query.order("updated_at", desc=True).execute().data or []
    if search:
        needle = search.lower()
        rows = [
            row for row in rows
            if needle in (row.get("name") or "").lower()
            or needle in (row.get("body") or "").lower()
            or needle in (row.get("category") or "").lower()
            or any(needle in str(tag).lower() for tag in (row.get("tags") or []))
        ]
    return rows


def db_get_message_template(template_id: str) -> dict | None:
    result = supabase.table("message_templates").select("*").eq("id", template_id).limit(1).execute()
    return result.data[0] if result.data else None


def db_upsert_message_template(data: dict) -> dict | None:
    payload = _template_payload(data)
    if payload.get("id"):
        result = (
            supabase.table("message_templates")
            .update(payload)
            .eq("id", payload["id"])
            .execute()
        )
    else:
        result = supabase.table("message_templates").upsert(payload, on_conflict="name").execute()
    return result.data[0] if result.data else None


def db_duplicate_message_template(template_id: str) -> dict | None:
    row = db_get_message_template(template_id)
    if not row:
        return None
    row.pop("id", None)
    row["name"] = f"{row.get('name') or 'Template'} Copy {datetime.utcnow().strftime('%H%M%S')}"
    row["usage_count"] = 0
    row["last_used_at"] = None
    row["created_at"] = _utc_now()
    row["updated_at"] = _utc_now()
    result = supabase.table("message_templates").insert(row).execute()
    return result.data[0] if result.data else None


def db_archive_message_template(template_id: str) -> dict | None:
    result = (
        supabase.table("message_templates")
        .update({"status": "archived", "active": False, "updated_at": _utc_now()})
        .eq("id", template_id)
        .execute()
    )
    return result.data[0] if result.data else None


def db_delete_message_template(template_id: str) -> bool:
    supabase.table("message_templates").delete().eq("id", template_id).execute()
    return True
