"""
FastAPI backend for the LinkedIn automation SaaS.

Run locally:   uvicorn main:app --reload --port 8000
Run on Railway: uvicorn main:app --host 0.0.0.0 --port $PORT
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
from datetime import date, datetime
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import (
    FastAPI, File, Form, HTTPException, Query,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware

import database as db

from contextlib import asynccontextmanager
from models import (
    ActivityLogCreate,
    BulkImportResponse,
    CampaignCreate,
    CampaignDuplicateRequest,
    CampaignFromTemplateCreate,
    CampaignLaunchRequest,
    CampaignProspectsUpdate,
    CampaignStatusUpdate,
    CampaignTemplateCreate,
    CampaignUpdate,
    DashboardStats,
    ExtensionHeartbeat,
    ExtensionJobClaim,
    ExtensionPairRequest,
    ExtensionPairTokenCreate,
    ExtensionProfileState,
    HubSpotSync,
    JobCreate,
    JobStatusUpdate,
    LinkedInProfileCreate,
    LinkedInProfileUpdate,
    MessageTemplateUpsert,
    ProspectCreate,
    ProspectListCreate,
    ProspectListMembersUpdate,
    ProspectListUpdate,
    ProspectsListResponse,
    ProspectUpdate,
    SchedulerResponse,
    ScheduleUpdate,
)

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("linkedin_bot")

# ── Server-side background scheduler (pure asyncio, no extra packages) ────────
async def _background_scheduler_loop():
    """
    Runs inside the FastAPI process on Railway 24/7.
    - Flow engine:   every 10 minutes  (queues next step for all active flow enrollments)
    - Connections:   daily at 09:00 UTC
    - Follow-ups:    daily at 10:00 UTC
    - Acceptances:   daily at 12:00 UTC
    - Messages:      daily at 14:00 UTC
    No external packages required — uses asyncio only.
    """
    import asyncio as _asyncio
    from datetime import datetime as _dt, timezone as _tz

    last_run: dict[str, _dt] = {}
    FLOW_INTERVAL_SECS = 600  # 10 minutes
    DAILY_JOBS = [
        ("connections",  9,  lambda: run_connections()),
        ("followups",   10,  lambda: run_followups()),
        ("acceptances", 12,  lambda: check_acceptances()),
        ("messages",    14,  lambda: run_messages()),
    ]

    logger.info("Background scheduler started (pure asyncio)")
    while True:
        try:
            await _asyncio.sleep(60)          # wake up every minute
            now = _dt.now(_tz.utc)

            # ── Flow engine (every 10 min) ──────────────────────────────────
            last_flow = last_run.get("flow")
            if not last_flow or (now - last_flow).total_seconds() >= FLOW_INTERVAL_SECS:
                try:
                    result = await run_flow()
                    if result.queued:
                        logger.info("[scheduler] run_flow → queued=%d", result.queued)
                except Exception as exc:
                    logger.error("[scheduler] run_flow error: %s", exc)
                last_run["flow"] = now

            # ── Daily jobs ──────────────────────────────────────────────────
            # Use >= so jobs that were missed due to a server restart still
            # fire on the same day (e.g. restart at 13:00 catches up on the
            # 09:00 and 10:00 jobs that haven't run yet today).
            for key, hour, fn in DAILY_JOBS:
                last = last_run.get(key)
                already_ran_today = last and last.date() == now.date()
                if now.hour >= hour and not already_ran_today:
                    try:
                        result = await fn()
                        logger.info("[scheduler] %s → queued=%d", key, result.queued)
                    except Exception as exc:
                        logger.error("[scheduler] %s error: %s", key, exc)
                    last_run[key] = now

        except _asyncio.CancelledError:
            logger.info("Background scheduler stopped")
            break
        except Exception as exc:
            logger.error("[scheduler] unexpected error: %s", exc)

@asynccontextmanager
async def _lifespan(application: FastAPI):
    """Start background scheduler on startup; cancel it cleanly on shutdown."""
    import asyncio as _asyncio
    task = _asyncio.create_task(_background_scheduler_loop())
    logger.info("Background scheduler task created")
    yield
    task.cancel()
    try:
        await task
    except _asyncio.CancelledError:
        pass



app = FastAPI(
    title="LinkedIn Automation API",
    description="Backend for LinkedIn outreach automation campaigns, prospects, queues, and Chrome Extension execution.",
    version="1.0.0",
    lifespan=_lifespan,
)

_ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "ALLOWED_ORIGINS",
    "https://linkedflow-dashboard.vercel.app,http://localhost:5173,http://localhost:3000",
).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    # Credentials + wildcard "*" is rejected by browsers per the CORS spec.
    # Use an explicit allowlist instead; add origins via the ALLOWED_ORIGINS env var.
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ CSV column ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ DB field name mapping (bulk import) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬

_CSV_MAP: dict[str, str] = {
    "firstname":                    "first_name",
    "first_name":                   "first_name",
    "lastname":                     "last_name",
    "last_name":                    "last_name",
    "linkedinurl":                  "linkedin_url",
    "linkedin_url":                 "linkedin_url",
    "linkedin url":                 "linkedin_url",
    "company":                      "company",
    "email":                        "email",
    "linkedinemail":                "email",
    "linkedin_email":               "email",
    "linkedin email":               "email",
    "jobtitle":                     "job_title",
    "job_title":                    "job_title",
    "job title":                    "job_title",
    "occupation":                   "occupation",
    "location":                     "location",
    "assignedaccount":              "assigned_account",
    "assigned_account":             "assigned_account",
    "assigned account":             "assigned_account",
    "status":                       "status",
    "invitenote":                   "invite_note",
    "invite_note":                  "invite_note",
    "invite note":                  "invite_note",
    "connection note":              "invite_note",
    "connectionnote":               "invite_note",
    "inmailsubject":                "inmail_subject",
    "inmail_subject":               "inmail_subject",
    "inmail subject":               "inmail_subject",
    "inmailmessage":                "inmail_message",
    "inmail_message":               "inmail_message",
    "inmail message":               "inmail_message",
    "initialmessage":               "initial_message",
    "initial_message":              "initial_message",
    "initialmsg":                   "initial_message",
    "initial message text":         "initial_message",
    "initial message":              "initial_message",
    "initialMessage".lower():       "initial_message",
    "follow-up 1":                  "followup_1",
    "followup_1":                   "followup_1",
    "followup 1":                   "followup_1",
    "follow-up 2":                  "followup_2",
    "followup_2":                   "followup_2",
    "followup 2":                   "followup_2",
    "follow-up 3":                  "followup_3",
    "followup_3":                   "followup_3",
    "followup 3":                   "followup_3",
    "follow-up 4":                  "followup_4",
    "followup_4":                   "followup_4",
    "followup 4":                   "followup_4",
    "nextsteps":                    "next_steps",
    "next_steps":                   "next_steps",
    "next steps":                   "next_steps",
    "whythisicp":                   "why_this_icp",
    "why_this_icp":                 "why_this_icp",
    "why this icp":                 "why_this_icp",
    "companypainpoints":            "company_pain_points",
    "company_pain_points":          "company_pain_points",
    "company pain points":          "company_pain_points",
    "growthgoals":                  "growth_goals",
    "growth_goals":                 "growth_goals",
    "growth goals":                 "growth_goals",
    "tailoredoffer":                "tailored_offer",
    "tailored_offer":               "tailored_offer",
    "our tailored offer for them":  "tailored_offer",
    "notes":                        "notes",
    "tags":                         "tags",
    "state":                        "state",
    "connectionstatus":             "connection_status",
    "connection_status":            "connection_status",
    "connection status":            "connection_status",
    "campaignid":                   "campaign_id",
    "campaign_id":                  "campaign_id",
    "campaign/list":                "campaign_id",   # maps CSV header to field
}


def _map_csv_row(raw_row: dict, campaign_id: str | None) -> dict | None:
    """Map a raw CSV row to a DB-ready dict. Returns None if linkedin_url missing."""
    mapped: dict = {}
    custom_fields: dict = {}
    for key, value in raw_row.items():
        clean_key = key.strip()
        clean_value = value.strip() if isinstance(value, str) else value
        db_key = _CSV_MAP.get(clean_key.lower().replace("  ", " "))
        if db_key and clean_value:
            if db_key == "tags":
                mapped[db_key] = [t.strip() for t in str(clean_value).replace(";", ",").split(",") if t.strip()]
            else:
                mapped[db_key] = clean_value
        elif clean_key and clean_value:
            custom_key = clean_key.strip().lower().replace(" ", "_").replace("-", "_")
            custom_fields[custom_key] = clean_value

    if not mapped.get("linkedin_url") and not mapped.get("email"):
        return None
    if not mapped.get("linkedin_url"):
        logger.warning("CSV row has no linkedin_url — jobs for this prospect will navigate to feed: %s", mapped.get("email", "(no email)"))

    # Apply campaign override
    if campaign_id:
        mapped["campaign_id"] = campaign_id

    # Defaults
    mapped.setdefault("assigned_account", "profile_1")
    mapped.setdefault("status", "")
    if custom_fields:
        mapped["custom_fields"] = custom_fields
    return mapped


def _profile_can_queue(profile_key: str) -> tuple[bool, str]:
    profile = db.db_get_profile(profile_key)
    if not profile:
        # Profile not in DB yet (e.g. first run before heartbeat registers it).
        # Allow queueing with a warning rather than silently blocking all jobs.
        logger.warning("_profile_can_queue: profile %s not found in DB, allowing with default limit", profile_key)
        return True, ""
    if profile.get("enabled") is False:
        return False, "profile disabled"
    # Respect per-profile daily limit stored in DB; fall back to env var then hardcoded 25.
    db_limit = profile.get("daily_limit")
    env_limit = int(os.getenv("DAILY_CONNECTION_LIMIT", "25"))
    daily_limit = int(db_limit) if db_limit is not None else env_limit
    if int(profile.get("daily_sent") or 0) >= daily_limit:
        return False, "daily limit reached"
    return True, ""


def _campaign_is_active(campaign_id: str | None) -> bool:
    if not campaign_id:
        return True
    campaign, _ = db.db_get_campaign(campaign_id)
    return bool(campaign and campaign.get("status", "running") in ("active", "running"))


def _inside_sending_window() -> bool:
    start = os.getenv("SEND_WINDOW_START", "08:00")
    end = os.getenv("SEND_WINDOW_END", "20:00")
    # Railway runs in UTC. Use SEND_WINDOW_TZ env var (e.g. "Asia/Karachi") to shift
    # the window to the user's local timezone so jobs don't fire at wrong hours.
    tz_name = os.getenv("SEND_WINDOW_TZ", "UTC")
    try:
        import zoneinfo
        tz = zoneinfo.ZoneInfo(tz_name)
        now = datetime.now(tz).strftime("%H:%M")
    except Exception:
        now = datetime.utcnow().strftime("%H:%M")
    return start <= now <= end if start <= end else (now >= start or now <= end)


def _queue_job_for_prospect(job_type: str, prospect: dict, payload: dict | None = None) -> dict | None:
    profile_key = prospect.get("assigned_account") or "profile_1"
    campaign_id = db.db_get_queue_campaign_id_for_prospect(prospect)
    if db.db_has_active_job_for_prospect(job_type, prospect.get("id")):
        logger.info("Skipping duplicate active %s job for prospect %s", job_type, prospect.get("id"))
        return None
    if not _inside_sending_window():
        logger.info("Skipping job outside allowed sending window")
        return None
    ok, reason = _profile_can_queue(profile_key)
    if not ok:
        logger.info("Skipping job for %s: %s", profile_key, reason)
        return None
    if not _campaign_is_active(campaign_id):
        logger.info(
            "Skipping job for inactive campaign: prospect_campaign=%s resolved_campaign=%s prospect=%s",
            prospect.get("campaign_id"),
            campaign_id,
            prospect.get("id"),
        )
        return None
    return db.db_create_job({
        "job_type": job_type,
        "profile_key": profile_key,
        "campaign_id": campaign_id,
        "prospect_id": prospect.get("id"),
        "payload": payload or {},
    })


def _online_executor_count() -> int:
    try:
        return sum(1 for p in db.db_get_all_profiles() if p.get("session_active"))
    except Exception:
        return 0


@app.get("/needs-personalization", tags=["Prospects"])
async def needs_personalization_root(limit: int = Query(500, ge=1, le=1000), offset: int = Query(0, ge=0)):
    """Rows needing personalized initial messages before sending."""
    try:
        prospects, total = db.db_get_needs_personalization(limit=limit, offset=offset)
        return {"prospects": prospects, "total": total}
    except Exception as e:
        logger.error(f"needs_personalization: {e}")
        raise HTTPException(500, str(e))


@app.get("/inmail-ready", tags=["Prospects"])
async def inmail_ready_root(limit: int = Query(500, ge=1, le=1000), offset: int = Query(0, ge=0)):
    """Prospects where LinkedIn InMail is available but user review is still required."""
    try:
        prospects, total = db.db_get_inmail_ready_queue(limit=limit, offset=offset)
        return {"prospects": prospects, "total": total}
    except Exception as e:
        logger.error(f"inmail_ready: {e}")
        raise HTTPException(500, str(e))


@app.get("/message-ready", tags=["Prospects"])
async def message_ready_root(limit: int = Query(500, ge=1, le=1000), offset: int = Query(0, ge=0)):
    """Prospects where normal LinkedIn messaging is available but user review is still required."""
    try:
        prospects, total = db.db_get_message_ready_queue(limit=limit, offset=offset)
        return {"prospects": prospects, "total": total}
    except Exception as e:
        logger.error(f"message_ready: {e}")
        raise HTTPException(500, str(e))


@app.get("/ready-for-message", tags=["Prospects"])
async def ready_for_message_queue(limit: int = Query(500, ge=1, le=1000), offset: int = Query(0, ge=0)):
    """Global queue of connected prospects ready for first message but not messaged yet."""
    try:
        prospects, total = db.db_get_ready_for_message_queue(limit=limit, offset=offset)
        return {"prospects": prospects, "total": total}
    except Exception as e:
        logger.error(f"ready_for_message_queue: {e}")
        raise HTTPException(500, str(e))


# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
# CAMPAIGNS
# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬

@app.get("/campaigns", tags=["Campaigns"])
async def list_campaigns():
    """Return all campaigns with prospect counts."""
    try:
        return db.db_get_all_campaigns()
    except Exception as e:
        logger.error(f"list_campaigns: {e}")
        raise HTTPException(500, str(e))


@app.post("/campaigns", tags=["Campaigns"], status_code=201)
async def create_campaign(body: CampaignCreate):
    """Create a new campaign."""
    try:
        campaign = db.db_create_campaign(
            body.name,
            status=body.status or "draft",
            template_id=body.template_id,
            profile_key=body.profile_key,
            sequence_config=body.sequence_config,
            schedule_config=body.schedule_config,
            settings=body.settings,
        )
        if not campaign:
            raise HTTPException(500, "Failed to create campaign")
        return campaign
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_campaign: {e}")
        raise HTTPException(500, str(e))


@app.put("/campaigns/{campaign_id}", tags=["Campaigns"])
async def update_campaign(campaign_id: str, body: CampaignUpdate):
    """Edit campaign metadata, sequence config, schedule config, and settings."""
    try:
        data = body.model_dump(exclude_none=True)
        if not data:
            raise HTTPException(400, "No fields to update")
        if data.get("status") and data["status"] not in ("draft", "running", "paused", "archived"):
            raise HTTPException(400, "Invalid campaign status")
        updated = db.db_update_campaign(campaign_id, data)
        if not updated:
            raise HTTPException(404, "Campaign not found")
        return updated
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_campaign: {e}")
        raise HTTPException(500, str(e))


@app.get("/campaigns/{campaign_id}", tags=["Campaigns"])
async def get_campaign(campaign_id: str):
    """Get a single campaign with full statistics."""
    try:
        campaign, stats = db.db_get_campaign(campaign_id)
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        return {"campaign": campaign, **(stats or {})}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_campaign: {e}")
        raise HTTPException(500, str(e))


@app.delete("/campaigns/{campaign_id}", tags=["Campaigns"])
async def delete_campaign(campaign_id: str):
    """Delete a campaign and all its prospects."""
    try:
        campaign, _ = db.db_get_campaign(campaign_id)
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        db.db_delete_campaign(campaign_id)
        return {"deleted": True, "id": campaign_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"delete_campaign: {e}")
        raise HTTPException(500, str(e))


@app.post("/campaigns/{campaign_id}/duplicate", tags=["Campaigns"], status_code=201)
async def duplicate_campaign(campaign_id: str, body: CampaignDuplicateRequest | None = None):
    """Duplicate campaign setup. Prospects are optional and are deduped by enrollment."""
    try:
        payload = body or CampaignDuplicateRequest()
        copied = db.db_duplicate_campaign(campaign_id, payload.name, payload.include_prospects)
        if not copied:
            raise HTTPException(404, "Campaign not found")
        return copied
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"duplicate_campaign: {e}")
        raise HTTPException(500, str(e))


@app.get("/campaign-templates", tags=["Campaign Wizard"])
async def list_campaign_templates(include_coming_soon: bool = Query(True)):
    try:
        return {"templates": db.db_get_campaign_templates(include_coming_soon)}
    except Exception as e:
        logger.error(f"list_campaign_templates: {e}")
        raise HTTPException(500, str(e))


@app.get("/campaign-templates/{template_id}", tags=["Campaign Wizard"])
async def get_campaign_template(template_id: str):
    try:
        template = db.db_get_campaign_template(template_id)
        if not template:
            raise HTTPException(404, "Campaign template not found")
        return template
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_campaign_template: {e}")
        raise HTTPException(500, str(e))


@app.post("/campaign-templates", tags=["Campaign Wizard"], status_code=201)
async def create_campaign_template(body: CampaignTemplateCreate):
    try:
        template = db.db_create_campaign_template(body.model_dump())
        if not template:
            raise HTTPException(500, "Failed to save campaign template")
        return template
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_campaign_template: {e}")
        raise HTTPException(500, str(e))


@app.get("/campaign-variables", tags=["Campaign Wizard"])
async def campaign_variables():
    return {
        "standard": ["first_name", "last_name", "company", "title", "industry", "location"],
        "syntax": "{{variable_name}}",
        "custom_fields": "Any extra CSV column is stored on prospect.custom_fields and can be used as {{column_name}}.",
    }


@app.post("/campaigns/from-template", tags=["Campaign Wizard"], status_code=201)
async def create_campaign_from_template(body: CampaignFromTemplateCreate):
    try:
        template = db.db_get_campaign_template(body.template_id)
        if not template:
            raise HTTPException(404, "Campaign template not found")
        if template.get("status") != "active":
            raise HTTPException(400, "Template is not active yet")
        campaign = db.db_create_campaign(
            body.name,
            status=body.status or "draft",
            template_id=body.template_id,
            profile_key=(body.settings or {}).get("profile_key") or "profile_1",
            sequence_config=body.sequence_config,
            schedule_config=body.schedule_config,
            settings=body.settings,
        )
        if not campaign:
            raise HTTPException(500, "Failed to create campaign")
        return campaign
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_campaign_from_template: {e}")
        raise HTTPException(500, str(e))


@app.post("/campaigns/{campaign_id}/launch", tags=["Campaign Wizard"])
async def launch_campaign(campaign_id: str, body: CampaignLaunchRequest | None = None):
    try:
        payload = body or CampaignLaunchRequest()
        result = db.db_launch_campaign(
            campaign_id,
            prospect_ids=payload.prospect_ids,
            list_ids=payload.list_ids,
        )
        if result.get("error") == "campaign_not_found":
            raise HTTPException(404, "Campaign not found")
        if result.get("error") == "template_required":
            raise HTTPException(400, "Campaign requires a template before launch")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"launch_campaign: {e}")
        raise HTTPException(500, str(e))


@app.post("/campaigns/{campaign_id}/prospects", tags=["Campaign Wizard"])
async def add_campaign_prospects(campaign_id: str, body: CampaignProspectsUpdate):
    """Enroll existing prospects into a campaign without duplicating rows."""
    try:
        result = db.db_add_prospects_to_campaign(campaign_id, body.prospect_ids)
        if result.get("error") == "campaign_not_found":
            raise HTTPException(404, "Campaign not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"add_campaign_prospects: {e}")
        raise HTTPException(500, str(e))


@app.delete("/campaigns/{campaign_id}/prospects", tags=["Campaign Wizard"])
async def remove_campaign_prospects(campaign_id: str, body: CampaignProspectsUpdate):
    """Remove prospects from this campaign only; prospect records remain reusable."""
    try:
        return {"removed": db.db_remove_prospects_from_campaign(campaign_id, body.prospect_ids)}
    except Exception as e:
        logger.error(f"remove_campaign_prospects: {e}")
        raise HTTPException(500, str(e))


@app.put("/campaigns/{campaign_id}/status", tags=["Campaign Wizard"])
async def update_campaign_status(campaign_id: str, body: CampaignStatusUpdate):
    try:
        if body.status not in ("draft", "running", "paused", "archived"):
            raise HTTPException(400, "Invalid campaign status")
        updated = db.db_update_campaign_status(campaign_id, body.status)
        if not updated:
            raise HTTPException(404, "Campaign not found")
        return updated
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_campaign_status: {e}")
        raise HTTPException(500, str(e))


@app.get("/campaigns/{campaign_id}/sequence", tags=["Campaign Wizard"])
async def get_campaign_sequence(campaign_id: str):
    try:
        campaign, _ = db.db_get_campaign(campaign_id)
        if not campaign:
            raise HTTPException(404, "Campaign not found")
        template = db.db_get_campaign_template(campaign.get("template_id")) if campaign.get("template_id") else None
        enrollments = db.db_get_campaign_enrollments(campaign_id)
        return {"campaign": campaign, "template": template, "enrollments": enrollments}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_campaign_sequence: {e}")
        raise HTTPException(500, str(e))


@app.get("/prospect-lists", tags=["Prospect Lists"])
async def list_prospect_lists():
    try:
        return {"lists": db.db_get_prospect_lists()}
    except Exception as e:
        logger.error(f"list_prospect_lists: {e}")
        raise HTTPException(500, str(e))


@app.post("/prospect-lists", tags=["Prospect Lists"], status_code=201)
async def create_prospect_list(body: ProspectListCreate):
    try:
        row = db.db_create_prospect_list(body.name, body.description, body.sort_order)
        if not row:
            raise HTTPException(500, "Failed to create prospect list")
        return row
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_prospect_list: {e}")
        raise HTTPException(500, str(e))


@app.get("/prospect-lists/{list_id}/prospects", tags=["Prospect Lists"])
async def get_prospect_list_members(list_id: str, limit: int = Query(500, ge=1, le=1000), offset: int = Query(0, ge=0)):
    try:
        prospects, total = db.db_get_prospects_for_list(list_id, limit=limit, offset=offset)
        return {"prospects": prospects, "total": total}
    except Exception as e:
        logger.error(f"get_prospect_list_members: {e}")
        raise HTTPException(500, str(e))


@app.put("/prospect-lists/{list_id}", tags=["Prospect Lists"])
async def update_prospect_list(list_id: str, body: ProspectListUpdate):
    try:
        row = db.db_update_prospect_list(list_id, body.model_dump(exclude_none=True))
        if not row:
            raise HTTPException(404, "Prospect list not found")
        return row
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_prospect_list: {e}")
        raise HTTPException(500, str(e))


@app.delete("/prospect-lists/{list_id}", tags=["Prospect Lists"])
async def delete_prospect_list(list_id: str):
    try:
        deleted = db.db_delete_prospect_list(list_id)
        if not deleted:
            raise HTTPException(404, "Prospect list not found")
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"delete_prospect_list: {e}")
        raise HTTPException(500, str(e))


@app.post("/prospect-lists/{list_id}/members", tags=["Prospect Lists"])
async def add_prospect_list_members(list_id: str, body: ProspectListMembersUpdate):
    try:
        return {"added": db.db_add_prospects_to_list(list_id, body.prospect_ids)}
    except Exception as e:
        logger.error(f"add_prospect_list_members: {e}")
        raise HTTPException(500, str(e))


@app.delete("/prospect-lists/{list_id}/members", tags=["Prospect Lists"])
async def remove_prospect_list_members(list_id: str, body: ProspectListMembersUpdate):
    try:
        return {"removed": db.db_remove_prospects_from_list(list_id, body.prospect_ids)}
    except Exception as e:
        logger.error(f"remove_prospect_list_members: {e}")
        raise HTTPException(500, str(e))


# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
# PROSPECTS
# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬

@app.get("/prospects", tags=["Prospects"])
async def list_prospects(
    campaign_id:      Optional[str] = Query(None),
    status:           Optional[str] = Query(None),
    assigned_account: Optional[str] = Query(None),
    list_id:          Optional[str] = Query(None),
    search:           Optional[str] = Query(None),
    limit:            int           = Query(50, ge=1, le=500),
    offset:           int           = Query(0,  ge=0),
) -> ProspectsListResponse:
    """Return filtered list of prospects with total count."""
    try:
        prospects, total = db.db_get_prospects(
            campaign_id=campaign_id,
            status=status,
            assigned_account=assigned_account,
            list_id=list_id,
            search=search,
            limit=limit,
            offset=offset,
        )
        return ProspectsListResponse(prospects=prospects, total=total)
    except Exception as e:
        logger.error(f"list_prospects: {e}")
        raise HTTPException(500, str(e))


@app.post("/prospects", tags=["Prospects"], status_code=201)
async def create_prospect(body: ProspectCreate):
    """Add a single prospect."""
    try:
        data = body.model_dump(exclude_none=True)
        if not data.get("linkedin_url") and not data.get("email"):
            raise HTTPException(400, "linkedin_url or email is required")
        if data.get("campaign_id"):
            prospect = db.db_create_prospect_for_campaign(data["campaign_id"], data)
        else:
            prospect = db.db_create_prospect(data)
        if not prospect:
            raise HTTPException(500, "Failed to create prospect")
        return prospect
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_prospect: {e}")
        raise HTTPException(500, str(e))


@app.post("/prospects/bulk", tags=["Prospects"])
async def bulk_import_prospects(
    file:        UploadFile     = File(...),
    campaign_id: Optional[str] = Form(None),
    list_id: Optional[str] = Form(None),
    mode: str = Query("create_or_update", pattern="^(create|update|create_or_update)$"),
) -> BulkImportResponse:
    """
    Import/update prospects from CSV. Default mode is create_or_update.
    Existing rows are matched by linkedin_url and updated instead of duplicated.
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only CSV files are accepted")
    try:
        raw_bytes = await file.read()
        text = raw_bytes.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))

        errors: list[str] = []
        created = updated = skipped = ready = 0

        for i, row in enumerate(reader, start=2):
            mapped = _map_csv_row(dict(row), campaign_id)
            if mapped is None:
                errors.append(f"Row {i}: missing linkedin_url or email - skipped")
                skipped += 1
                continue

            existing = db.db_get_prospect_by_linkedin_url(mapped.get("linkedin_url", "")) if mapped.get("linkedin_url") else None
            if not existing and mapped.get("email"):
                existing = db.db_get_prospect_by_email(mapped["email"])
            if mode == "create" and existing:
                skipped += 1
                continue
            if mode == "update" and not existing:
                skipped += 1
                continue

            action, saved = db.db_create_or_update_prospect(mapped)
            if action == "created":
                created += 1
            elif action == "updated":
                updated += 1
            else:
                skipped += 1
            if saved and saved.get("status") == "Ready to Send":
                ready += 1
            if saved and campaign_id:
                campaign, _ = db.db_get_campaign(campaign_id)
                if campaign:
                    db.db_upsert_enrollment(campaign, saved)
            if saved and list_id:
                db.db_add_prospects_to_list(list_id, [saved["id"]])

        return BulkImportResponse(
            imported=created + updated,
            failed=len(errors),
            errors=errors,
            created_count=created,
            updated_count=updated,
            skipped_count=skipped,
            ready_to_send_count=ready,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"bulk_import: {e}")
        raise HTTPException(500, str(e))

@app.get("/prospects/{prospect_id}", tags=["Prospects"])
async def get_prospect(prospect_id: str):
    """Get a single prospect with their full activity log."""
    try:
        prospect, activity = db.db_get_prospect(prospect_id)
        if not prospect:
            raise HTTPException(404, "Prospect not found")
        return {
            "prospect": prospect,
            "activity_log": activity,
            "campaign_enrollments": db.db_get_prospect_enrollments(prospect_id),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_prospect: {e}")
        raise HTTPException(500, str(e))


@app.put("/prospects/{prospect_id}", tags=["Prospects"])
async def update_prospect(prospect_id: str, body: ProspectUpdate):
    """Update any subset of prospect fields."""
    try:
        data = body.model_dump(exclude_none=True)
        if not data:
            raise HTTPException(400, "No fields to update")
        updated = db.db_update_prospect(prospect_id, data)
        if not updated:
            raise HTTPException(404, "Prospect not found or no changes")
        if (
            ((data.get("initial_message") or "").strip() or (data.get("inmail_message") or "").strip())
            and (data.get("ready_to_send") is True or data.get("status") in ("Ready to Send", "Ready To Send"))
            and not updated.get("message_sent_date")
        ):
            updated = db.db_update_prospect(prospect_id, {
                "status": "Ready To Send",
                "ready_to_send": True,
                "personalization_status": "approved",
                "next_steps": "Approved for executor send",
            }) or updated
        return updated
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_prospect: {e}")
        raise HTTPException(500, str(e))


@app.delete("/prospects/{prospect_id}", tags=["Prospects"])
async def delete_prospect(prospect_id: str):
    """Delete a prospect and their activity log."""
    try:
        prospect, _ = db.db_get_prospect(prospect_id)
        if not prospect:
            raise HTTPException(404, "Prospect not found")
        db.db_delete_prospect(prospect_id)
        return {"deleted": True, "id": prospect_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"delete_prospect: {e}")
        raise HTTPException(500, str(e))


# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬

@app.get("/prospects/needs-personalization", tags=["Prospects"])
async def needs_personalization(limit: int = Query(500, ge=1, le=1000), offset: int = Query(0, ge=0)):
    """Rows needing personalized initial messages before sending."""
    try:
        prospects, total = db.db_get_needs_personalization(limit=limit, offset=offset)
        return {"prospects": prospects, "total": total}
    except Exception as e:
        logger.error(f"needs_personalization: {e}")
        raise HTTPException(500, str(e))

# ACTIVITY LOG
# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬

@app.get("/activity-log", tags=["Activity Log"])
async def get_activity_log(
    prospect_id: Optional[str] = Query(None),
    limit:       int           = Query(50, ge=1, le=500),
):
    """Return recent activity entries with prospect name/company joined in."""
    try:
        return db.db_get_activity_log(prospect_id=prospect_id, limit=limit)
    except Exception as e:
        logger.error(f"get_activity_log: {e}")
        raise HTTPException(500, str(e))


@app.post("/activity-log", tags=["Activity Log"], status_code=201)
async def log_activity(body: ActivityLogCreate):
    """Manually log an action against a prospect."""
    try:
        entry = db.db_log_activity(
            body.prospect_id, body.action, body.result, body.details
        )
        if not entry:
            raise HTTPException(500, "Failed to log activity")
        return entry
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"log_activity: {e}")
        raise HTTPException(500, str(e))


# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
# LINKEDIN PROFILES
# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬

@app.get("/profiles", tags=["LinkedIn Profiles"])
async def list_profiles():
    """Return all LinkedIn profiles with their connection status."""
    try:
        return db.db_get_all_profiles()
    except Exception as e:
        logger.error(f"list_profiles: {e}")
        raise HTTPException(500, str(e))


@app.get("/profiles/{profile_key}", tags=["LinkedIn Profiles"])
async def get_profile(profile_key: str):
    """Return one LinkedIn profile record for dashboard/executor sync."""
    try:
        profile = db.db_get_profile(profile_key)
        if not profile:
            raise HTTPException(404, "Profile not found")
        return profile
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_profile: {e}")
        raise HTTPException(500, str(e))


@app.post("/profiles", tags=["LinkedIn Profiles"], status_code=201)
async def create_profile(body: LinkedInProfileCreate):
    """Register a new LinkedIn profile for sending."""
    try:
        profile = db.db_create_profile(body.profile_key, body.display_name, body.run_mode)
        if not profile:
            raise HTTPException(500, "Failed to create profile")
        return profile
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_profile: {e}")
        raise HTTPException(500, str(e))


@app.put("/profiles/{profile_key}", tags=["LinkedIn Profiles"])
async def update_profile(profile_key: str, body: LinkedInProfileUpdate):
    """Update profile status (session_active, daily_sent, last_active)."""
    try:
        data = body.model_dump(exclude_none=True)
        updated = db.db_update_profile(profile_key, data)
        if not updated:
            raise HTTPException(404, "Profile not found")
        return updated
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_profile: {e}")
        raise HTTPException(500, str(e))


@app.delete("/profiles/{profile_key}", tags=["LinkedIn Profiles"])
async def delete_profile(profile_key: str):
    """Delete a profile record and cancel pending work for that profile."""
    try:
        deleted = db.db_delete_profile(profile_key)
        if not deleted:
            raise HTTPException(404, "Profile not found")
        return {
            "deleted": True,
            "profile_key": profile_key,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"delete_profile: {e}")
        raise HTTPException(500, str(e))


# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
# DASHBOARD STATS
# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬

# Extension executor

@app.post("/extension/pair-token", tags=["Chrome Extension"])
async def create_extension_pair_token(body: ExtensionPairTokenCreate | None = None):
    """Create a short-lived token that lets the Chrome Extension pair with LinkedFlow."""
    try:
        return db.db_create_extension_pair_token((body or ExtensionPairTokenCreate()).profile_key)
    except Exception as e:
        logger.error(f"create_extension_pair_token: {e}")
        raise HTTPException(500, str(e))


@app.post("/extension/pair", tags=["Chrome Extension"])
async def pair_extension(body: ExtensionPairRequest):
    """Pair a Chrome Extension instance to a LinkedFlow profile."""
    try:
        profile = db.db_pair_extension(body.model_dump(exclude_none=True))
        if not profile:
            raise HTTPException(401, "Invalid or expired pairing token")
        return {"paired": True, "profile": profile}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"pair_extension: {e}")
        raise HTTPException(500, str(e))


@app.post("/extension/heartbeat", tags=["Chrome Extension"])
async def extension_heartbeat(body: ExtensionHeartbeat):
    """Update extension online/login state for one profile."""
    try:
        profile = db.db_extension_heartbeat(body.model_dump(exclude_none=True))
        if not profile:
            raise HTTPException(400, "profile_key is required")
        return profile
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"extension_heartbeat: {e}")
        raise HTTPException(500, str(e))


@app.post("/extension/profile-state", tags=["Chrome Extension"])
async def extension_profile_state(body: ExtensionProfileState):
    """Update non-job runtime state from the Chrome Extension."""
    try:
        profile = db.db_extension_heartbeat(body.model_dump(exclude_none=True))
        if not profile:
            raise HTTPException(400, "profile_key is required")
        return profile
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"extension_profile_state: {e}")
        raise HTTPException(500, str(e))


@app.get("/extension/jobs/pending", tags=["Chrome Extension"])
async def extension_pending_jobs(profile_key: str = Query(...), limit: int = Query(5, ge=1, le=25)):
    try:
        return {"jobs": db.db_get_pending_jobs(profile_key, limit=limit)}
    except Exception as e:
        logger.error(f"extension_pending_jobs: {e}")
        raise HTTPException(500, str(e))


@app.post("/extension/jobs/{job_id}/claim", tags=["Chrome Extension"])
async def extension_claim_job(job_id: str, body: ExtensionJobClaim):
    job = db.db_claim_job(job_id, body.profile_key)
    if not job:
        raise HTTPException(409, "Job is not available to claim")
    return job


@app.post("/extension/jobs/{job_id}/start", tags=["Chrome Extension"])
async def extension_start_job(job_id: str):
    job = db.db_start_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.post("/extension/jobs/{job_id}/complete", tags=["Chrome Extension"])
async def extension_complete_job(job_id: str, body: JobStatusUpdate):
    job = db.db_complete_job(job_id, body.result)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.post("/extension/jobs/{job_id}/fail", tags=["Chrome Extension"])
async def extension_fail_job(job_id: str, body: JobStatusUpdate):
    job = db.db_fail_job(job_id, body.error_message or "Extension job failed", body.result)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.get("/stats", tags=["Stats"])
async def get_stats():
    """Return overall dashboard statistics."""
    try:
        return db.db_get_dashboard_stats()
    except Exception as e:
        logger.error(f"get_stats: {e}")
        raise HTTPException(500, str(e))


@app.get("/stats/campaign/{campaign_id}", tags=["Stats"])
async def get_campaign_stats(campaign_id: str):
    """Return statistics for a specific campaign."""
    try:
        stats = db.db_get_campaign_stats(campaign_id)
        if not stats:
            raise HTTPException(404, "Campaign not found")
        return stats
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_campaign_stats: {e}")
        raise HTTPException(500, str(e))


# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
# ─────────────────────────────────────────────────────────────────────────────
# JOBS
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/jobs", tags=["Jobs"])
async def list_jobs(
    status: Optional[str] = Query(None),
    profile_key: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    try:
        jobs, total = db.db_get_jobs(status=status, profile_key=profile_key, limit=limit, offset=offset)
        return {"jobs": jobs, "total": total}
    except Exception as e:
        logger.error(f"list_jobs: {e}")
        raise HTTPException(500, str(e))


@app.get("/jobs/pending", tags=["Jobs"])
async def pending_jobs(profile_key: str = Query(...), limit: int = Query(25, ge=1, le=100)):
    try:
        return {"jobs": db.db_get_pending_jobs(profile_key, limit=limit)}
    except Exception as e:
        logger.error(f"pending_jobs: {e}")
        raise HTTPException(500, str(e))


@app.post("/jobs", tags=["Jobs"], status_code=201)
async def create_job(body: JobCreate):
    try:
        job = db.db_create_job(body.model_dump(exclude_none=True))
        if not job:
            raise HTTPException(500, "Failed to create job")
        return job
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_job: {e}")
        raise HTTPException(500, str(e))


@app.post("/jobs/{job_id}/claim", tags=["Jobs"])
async def claim_job(job_id: str, profile_key: str = Query(...)):
    job = db.db_claim_job(job_id, profile_key)
    if not job:
        raise HTTPException(409, "Job is not available to claim")
    return job


@app.post("/jobs/{job_id}/start", tags=["Jobs"])
async def start_job(job_id: str):
    job = db.db_start_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.post("/jobs/{job_id}/complete", tags=["Jobs"])
async def complete_job(job_id: str, body: JobStatusUpdate):
    job = db.db_complete_job(job_id, body.result)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.post("/jobs/{job_id}/fail", tags=["Jobs"])
async def fail_job(job_id: str, body: JobStatusUpdate):
    job = db.db_fail_job(job_id, body.error_message or "Job failed", body.result)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.post("/jobs/{job_id}/cancel", tags=["Jobs"])
async def cancel_job(job_id: str):
    job = db.db_cancel_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.get("/schedules", tags=["Schedules"])
async def get_schedules():
    try:
        return {"schedules": db.db_get_schedules()}
    except Exception as e:
        logger.error(f"get_schedules: {e}")
        raise HTTPException(500, str(e))


@app.put("/schedules", tags=["Schedules"])
async def update_schedules(rows: list[ScheduleUpdate]):
    try:
        schedules = db.db_upsert_schedules([r.model_dump() for r in rows])
        return {"schedules": schedules}
    except Exception as e:
        logger.error(f"update_schedules: {e}")
        raise HTTPException(500, str(e))


@app.get("/messages", tags=["Messages"])
async def get_message_templates(
    search: Optional[str] = None,
    type: Optional[str] = None,
    status: Optional[str] = None,
    include_archived: bool = False,
):
    try:
        return {"messages": db.db_get_message_templates(search, type, status, include_archived)}
    except Exception as e:
        logger.error(f"get_message_templates: {e}")
        raise HTTPException(500, str(e))


@app.post("/messages", tags=["Messages"], status_code=201)
async def upsert_message_template(body: MessageTemplateUpsert):
    try:
        row = db.db_upsert_message_template(body.model_dump())
        if not row:
            raise HTTPException(500, "Failed to save message template")
        return row
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"upsert_message_template: {e}")
        raise HTTPException(500, str(e))


@app.get("/messages/{template_id}", tags=["Messages"])
async def get_message_template(template_id: str):
    try:
        row = db.db_get_message_template(template_id)
        if not row:
            raise HTTPException(404, "Message template not found")
        return row
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_message_template: {e}")
        raise HTTPException(500, str(e))


@app.put("/messages/{template_id}", tags=["Messages"])
async def update_message_template(template_id: str, body: MessageTemplateUpsert):
    try:
        payload = body.model_dump()
        payload["id"] = template_id
        row = db.db_upsert_message_template(payload)
        if not row:
            raise HTTPException(404, "Message template not found")
        return row
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_message_template: {e}")
        raise HTTPException(500, str(e))


@app.post("/messages/{template_id}/duplicate", tags=["Messages"], status_code=201)
async def duplicate_message_template(template_id: str):
    try:
        row = db.db_duplicate_message_template(template_id)
        if not row:
            raise HTTPException(404, "Message template not found")
        return row
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"duplicate_message_template: {e}")
        raise HTTPException(500, str(e))


@app.post("/messages/{template_id}/archive", tags=["Messages"])
async def archive_message_template(template_id: str):
    try:
        row = db.db_archive_message_template(template_id)
        if not row:
            raise HTTPException(404, "Message template not found")
        return row
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"archive_message_template: {e}")
        raise HTTPException(500, str(e))


@app.delete("/messages/{template_id}", tags=["Messages"])
async def delete_message_template(template_id: str):
    try:
        db.db_delete_message_template(template_id)
        return {"deleted": True}
    except Exception as e:
        logger.error(f"delete_message_template: {e}")
        raise HTTPException(500, str(e))


# ─────────────────────────────────────────────────────────────────────────────
# SCHEDULER ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/scheduler/run-connections", tags=["Scheduler"])
async def run_connections() -> SchedulerResponse:
    try:
        pending = db.db_get_pending_prospects()
        queued = 0
        for prospect in pending:
            if _queue_job_for_prospect("check_messageability", prospect, {
                "linkedin_url": prospect.get("linkedin_url", ""),
                "note": (prospect.get("inmail_message") or "")[:300],
                "fallback": "invitation",
            }):
                queued += 1
        return SchedulerResponse(queued=queued, agents_available=_online_executor_count(), message=f"Created {queued} messageability check job(s)")
    except Exception as e:
        logger.error(f"run_connections: {e}")
        raise HTTPException(500, str(e))


@app.post("/scheduler/run-messages", tags=["Scheduler"])
async def run_messages() -> SchedulerResponse:
    try:
        ready = (db.db_get_prospects_by_status("Ready to Send") or []) + (db.db_get_prospects_by_status("Ready To Send") or [])
        queued = 0
        for prospect in ready:
            has_inmail = (prospect.get("inmail_subject") or "").strip() and (prospect.get("inmail_message") or "").strip()
            initial = (prospect.get("initial_message") or "").strip()
            if not has_inmail and not initial:
                continue
            if has_inmail and (prospect.get("messageability_status") == "inmail_available" or prospect.get("inmail_status") == "available"):
                job = _queue_job_for_prospect("send_prepared_inmail", prospect, {
                    "linkedin_url": prospect.get("linkedin_url", ""),
                    "subject": prospect.get("inmail_subject", ""),
                    "message": prospect.get("inmail_message", ""),
                    "message_type": "inmail",
                })
            else:
                job = _queue_job_for_prospect("send_prepared_message", prospect, {
                    "linkedin_url": prospect.get("linkedin_url", ""),
                    "message": initial,
                    "message_type": "initial",
                })
            if job:
                queued += 1
        return SchedulerResponse(queued=queued, agents_available=_online_executor_count(), message=f"Created {queued} prepared send job(s)")
    except Exception as e:
        logger.error(f"run_messages: {e}")
        raise HTTPException(500, str(e))


@app.post("/scheduler/run-followups", tags=["Scheduler"])
async def run_followups() -> SchedulerResponse:
    import re
    try:
        due = db.db_get_followups_due_today()
        queued = db.db_recover_due_campaign_message_steps()
        col_map = {1: "followup_1", 2: "followup_2", 3: "followup_3", 4: "followup_4"}
        for prospect in due:
            m = re.search(r"Follow-up (\d)", prospect.get("next_steps") or "")
            if not m:
                continue
            num = int(m.group(1))
            col = col_map.get(num)
            if not col or not (prospect.get(col) or "").strip():
                continue
            if _queue_job_for_prospect("send_followups", prospect, {
                "linkedin_url": prospect.get("linkedin_url", ""),
                "message": prospect.get(col, ""),
                "message_type": f"followup_{num}",
            }):
                queued += 1
        return SchedulerResponse(queued=queued, agents_available=_online_executor_count(), message=f"Created {queued} pending follow-up job(s)")
    except Exception as e:
        logger.error(f"run_followups: {e}")
        raise HTTPException(500, str(e))


@app.post("/scheduler/check-acceptances", tags=["Scheduler"])
async def check_acceptances() -> SchedulerResponse:
    """Queue one check_connection_status job per pending prospect.
    Previously created a single bulk job per profile which the extension had
    no handler for, causing every acceptance check to permanently fail."""
    try:
        sent = db.db_get_prospects_by_status("Connection Request Sent")
        queued = 0
        for p in sent:
            if not (p.get("linkedin_url") or "").strip():
                continue
            if _queue_job_for_prospect("check_connection_status", p, {
                "linkedin_url": p.get("linkedin_url", ""),
            }):
                queued += 1
        return SchedulerResponse(queued=queued, agents_available=_online_executor_count(), message=f"Created {queued} connection-status check job(s)")
    except Exception as e:
        logger.error(f"check_acceptances: {e}")
        raise HTTPException(500, str(e))

# HUBSPOT INTEGRATION
# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬


@app.post("/scheduler/run-flow", tags=["Scheduler"])
async def run_flow() -> SchedulerResponse:
    """
    Flow-sequence engine: for every active campaign enrollment that uses a
    visual flow sequence and has NO pending/running job, queue the next step.
    Call this endpoint on a schedule (e.g. every 5-10 minutes).
    """
    try:
        # Find all active flow enrollments
        enrollments = (
            db.supabase.table("campaign_enrollments")
            .select("id, campaign_id, prospect_id, current_node_id, status")
            .eq("status", "active")
            .execute()
            .data or []
        )
        queued = 0
        skipped = 0
        for enrollment in enrollments:
            campaign_id = enrollment["campaign_id"]
            prospect_id = enrollment["prospect_id"]
            current_node_id = enrollment.get("current_node_id")

            # Only process flow-sequence campaigns
            campaign, _ = db.db_get_campaign(campaign_id)
            if not db._campaign_flow_sequence(campaign):
                skipped += 1
                continue

            # Check if prospect already has a non-terminal job (includes "claimed"
            # which sits between pending→running; missing it caused double-queuing)
            existing_jobs = (
                db.supabase.table("jobs")
                .select("id, status")
                .eq("prospect_id", prospect_id)
                .in_("status", ["pending", "claimed", "running", "retrying"])
                .execute()
                .data or []
            )
            if existing_jobs:
                skipped += 1
                continue

            # No active job — queue the next flow step
            next_job = db.db_queue_next_flow_step(campaign_id, prospect_id, current_node_id)
            if next_job:
                queued += 1
                logger.info(
                    "run_flow: queued flow step for prospect=%s campaign=%s node=%s → job=%s",
                    prospect_id, campaign_id, current_node_id, next_job.get("id")
                )
            else:
                skipped += 1

        return SchedulerResponse(
            queued=queued,
            agents_available=_online_executor_count(),
            message=f"Flow engine: queued {queued} step(s), skipped {skipped}",
        )
    except Exception as e:
        logger.error(f"run_flow: {e}")
        raise HTTPException(500, str(e))


@app.post("/campaigns/{campaign_id}/prospects/{prospect_id}/advance-flow", tags=["Campaigns"])
async def advance_flow_enrollment(campaign_id: str, prospect_id: str, node_id: str | None = None):
    """
    Manually advance a prospect's flow enrollment to a specific node (or the
    next node from current_node_id). Useful for recovering stuck enrollments.
    """
    try:
        # Validate campaign and enrollment exist
        campaign, err = db.db_get_campaign(campaign_id)
        if not campaign:
            raise HTTPException(404, f"Campaign not found: {err}")
        if not db._campaign_flow_sequence(campaign):
            raise HTTPException(400, "Campaign does not have a flow sequence")

        enrollment_rows = (
            db.supabase.table("campaign_enrollments")
            .select("*")
            .eq("campaign_id", campaign_id)
            .eq("prospect_id", prospect_id)
            .execute()
            .data or []
        )
        if not enrollment_rows:
            raise HTTPException(404, "Enrollment not found")

        current = enrollment_rows[0].get("current_node_id")
        use_node = node_id or current

        # If caller supplied a node_id, update enrollment to that node first
        if node_id and node_id != current:
            db.supabase.table("campaign_enrollments").update({
                "current_node_id": node_id,
                "updated_at": db._utc_now(),
            }).eq("campaign_id", campaign_id).eq("prospect_id", prospect_id).execute()
            use_node = node_id

        next_job = db.db_queue_next_flow_step(campaign_id, prospect_id, use_node)
        return {
            "ok": True,
            "previous_node": current,
            "queued_from_node": use_node,
            "next_job": next_job,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"advance_flow_enrollment: {e}")
        raise HTTPException(500, str(e))

@app.post("/hubspot/sync/{prospect_id}", tags=["HubSpot"])
async def hubspot_sync(prospect_id: str, body: HubSpotSync):
    """
    Push a replied prospect to HubSpot as a Contact + Deal.
    Updates hubspot_deal_id and pushed_to_hubspot in Supabase.
    """
    try:
        prospect, _ = db.db_get_prospect(prospect_id)
        if not prospect:
            raise HTTPException(404, "Prospect not found")

        headers = {
            "Authorization": f"Bearer {body.hubspot_api_key}",
            "Content-Type":  "application/json",
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            # 1. Create or update contact
            contact_payload = {
                "properties": {
                    "firstname":    prospect.get("first_name", ""),
                    "lastname":     prospect.get("last_name", ""),
                    "company":      prospect.get("company", ""),
                    "jobtitle":     prospect.get("job_title", ""),
                    "hs_linkedin_profile_url": prospect.get("linkedin_url", ""),
                }
            }
            contact_res = await client.post(
                "https://api.hubapi.com/crm/v3/objects/contacts",
                json=contact_payload,
                headers=headers,
            )
            if contact_res.status_code not in (200, 201):
                raise HTTPException(
                    502,
                    f"HubSpot contact creation failed: {contact_res.text[:200]}",
                )
            contact_id = contact_res.json()["id"]

            # 2. Create deal
            name_part = f"{prospect.get('first_name', '')} {prospect.get('last_name', '')}".strip()
            company   = prospect.get("company", "Unknown")
            deal_payload = {
                "properties": {
                    "dealname":   f"{name_part} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â {company}",
                    "dealstage":  "appointmentscheduled",
                    "pipeline":   "default",
                }
            }
            deal_res = await client.post(
                "https://api.hubapi.com/crm/v3/objects/deals",
                json=deal_payload,
                headers=headers,
            )
            if deal_res.status_code not in (200, 201):
                raise HTTPException(
                    502,
                    f"HubSpot deal creation failed: {deal_res.text[:200]}",
                )
            deal_id = deal_res.json()["id"]

            # 3. Associate contact ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ deal
            assoc_res = await client.put(
                f"https://api.hubapi.com/crm/v3/objects/deals/{deal_id}"
                f"/associations/contacts/{contact_id}/deal_to_contact",
                headers=headers,
            )
            # 204 = success, tolerate other 2xx too
            if assoc_res.status_code >= 400:
                logger.warning(
                    f"HubSpot association warning: {assoc_res.status_code}"
                )

        # 4. Update Supabase
        today = date.today().isoformat()
        db.db_update_prospect(prospect_id, {
            "hubspot_deal_id":    deal_id,
            "pushed_to_hubspot":  True,
            "hubspot_push_date":  today,
        })
        db.db_log_activity(
            prospect_id,
            "hubspot_sync",
            "pushed",
            f"HubSpot contact {contact_id}, deal {deal_id}",
        )

        return {
            "success":     True,
            "contact_id":  contact_id,
            "deal_id":     deal_id,
            "pushed_date": today,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"hubspot_sync: {e}")
        raise HTTPException(500, str(e))


# ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
@app.get("/health", tags=["Health"])
async def health():
    return {
        "status":           "ok",
        "executors_online": _online_executor_count(),
    }


@app.get("/ping", tags=["Health"])
async def ping():
    """Lightweight keep-alive endpoint.
    The Chrome Extension heartbeats every 60 s, but if no extension is paired
    Railway will still sleep the service on the free tier.  Point an external
    uptime monitor (e.g. UptimeRobot free tier) at /ping to keep it awake."""
    return {"ok": True}


@app.get("/", tags=["Health"])
async def root():
    return {"message": "LinkedIn Automation API", "docs": "/docs"}


