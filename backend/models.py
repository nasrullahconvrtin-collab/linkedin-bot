"""
Pydantic models for request/response validation.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel


# ── Campaigns ─────────────────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    name: str
    status: Optional[str] = "draft"
    template_id: Optional[str] = None
    profile_key: Optional[str] = "profile_1"
    sequence_config: Optional[dict] = None
    schedule_config: Optional[dict] = None
    settings: Optional[dict] = None


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    template_id: Optional[str] = None
    profile_key: Optional[str] = None
    sequence_config: Optional[dict] = None
    schedule_config: Optional[dict] = None
    settings: Optional[dict] = None


class CampaignResponse(BaseModel):
    id: str
    name: str
    status: Optional[str] = None
    created_at: Optional[datetime] = None
    prospect_count: int = 0


class CampaignDetail(BaseModel):
    campaign: dict
    total: int = 0
    sent: int = 0
    accepted: int = 0
    messaged: int = 0
    following_up: int = 0
    replied: int = 0
    no_response: int = 0


# ── Prospects ─────────────────────────────────────────────────────────────────

class ProspectCreate(BaseModel):
    campaign_id: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    linkedin_url: Optional[str] = None
    company: Optional[str] = None
    email: Optional[str] = None
    job_title: Optional[str] = None
    occupation: Optional[str] = None
    location: Optional[str] = None
    assigned_account: str = "profile_1"
    status: str = ""
    inmail_subject: Optional[str] = None
    inmail_message: Optional[str] = None
    messageability_status: Optional[str] = None
    inmail_status: Optional[str] = None
    inmail_error: Optional[str] = None
    ready_to_send: Optional[bool] = False
    personalization_status: Optional[str] = None
    initial_message: Optional[str] = None
    followup_1: Optional[str] = None
    followup_2: Optional[str] = None
    followup_3: Optional[str] = None
    followup_4: Optional[str] = None
    next_steps: Optional[str] = None
    why_this_icp: Optional[str] = None
    company_pain_points: Optional[str] = None
    growth_goals: Optional[str] = None
    tailored_offer: Optional[str] = None
    notes: Optional[str] = None
    custom_fields: Optional[dict] = None
    source_list: Optional[str] = None
    tags: Optional[List[str]] = None
    state: Optional[str] = None
    connection_status: Optional[str] = None


class ProspectUpdate(BaseModel):
    campaign_id: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    linkedin_url: Optional[str] = None
    company: Optional[str] = None
    email: Optional[str] = None
    job_title: Optional[str] = None
    occupation: Optional[str] = None
    location: Optional[str] = None
    assigned_account: Optional[str] = None
    status: Optional[str] = None
    inmail_subject: Optional[str] = None
    inmail_message: Optional[str] = None
    messageability_status: Optional[str] = None
    inmail_status: Optional[str] = None
    inmail_error: Optional[str] = None
    last_messageability_checked_at: Optional[str] = None
    ready_to_send: Optional[bool] = None
    personalization_status: Optional[str] = None
    followup_ready_at: Optional[str] = None
    invitation_sent_at: Optional[str] = None
    initial_message: Optional[str] = None
    followup_1: Optional[str] = None
    followup_2: Optional[str] = None
    followup_3: Optional[str] = None
    followup_4: Optional[str] = None
    next_steps: Optional[str] = None
    why_this_icp: Optional[str] = None
    company_pain_points: Optional[str] = None
    growth_goals: Optional[str] = None
    tailored_offer: Optional[str] = None
    notes: Optional[str] = None
    connection_sent_date: Optional[str] = None
    message_sent_date: Optional[str] = None
    reply_date: Optional[str] = None
    reply_type: Optional[str] = None
    hubspot_deal_id: Optional[str] = None
    pushed_to_hubspot: Optional[bool] = None
    hubspot_push_date: Optional[str] = None
    custom_fields: Optional[dict] = None
    source_list: Optional[str] = None
    tags: Optional[List[str]] = None
    state: Optional[str] = None
    connection_status: Optional[str] = None
    connected_at: Optional[str] = None
    accepted_at: Optional[str] = None
    last_action_at: Optional[str] = None
    initial_message_sent_at: Optional[str] = None
    next_action_at: Optional[str] = None


class ProspectsListResponse(BaseModel):
    prospects: List[Any]
    total: int


class BulkImportResponse(BaseModel):
    imported: int
    failed: int
    errors: List[str] = []
    created_count: int = 0
    updated_count: int = 0
    skipped_count: int = 0
    ready_to_send_count: int = 0


# ── Activity Log ──────────────────────────────────────────────────────────────

class ActivityLogCreate(BaseModel):
    prospect_id: str
    action: str
    result: str
    details: Optional[str] = None


class ActivityLogResponse(BaseModel):
    id: str
    prospect_id: Optional[str] = None
    action: Optional[str] = None
    result: Optional[str] = None
    details: Optional[str] = None
    created_at: Optional[datetime] = None
    prospect_name: Optional[str] = None
    prospect_company: Optional[str] = None


# ── LinkedIn Profiles ─────────────────────────────────────────────────────────

class LinkedInProfileCreate(BaseModel):
    profile_key: str
    display_name: str


class LinkedInProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    enabled: Optional[bool] = None
    session_active: Optional[bool] = None
    daily_sent: Optional[int] = None
    last_active: Optional[str] = None
    runtime_mode: Optional[str] = None
    proxy_settings: Optional[dict] = None
    session_status: Optional[str] = None
    local_state: Optional[str] = None
    last_job_result: Optional[dict] = None


# ── Dashboard Stats ───────────────────────────────────────────────────────────

class ProfileStats(BaseModel):
    profile_key: str
    daily_sent: int = 0
    session_active: bool = False


class DashboardStats(BaseModel):
    total_prospects: int = 0
    connections_sent_today: int = 0
    connections_sent_week: int = 0
    accepted_today: int = 0
    messages_sent_today: int = 0
    replies_today: int = 0
    active_campaigns: int = 0
    reply_rate: float = 0.0
    acceptance_rate: float = 0.0
    needs_personalization: int = 0
    ready_for_message: int = 0
    pending_jobs: int = 0
    failed_jobs: int = 0
    online_agents: int = 0
    profiles: List[ProfileStats] = []


# ── Scheduler ─────────────────────────────────────────────────────────────────

class SchedulerResponse(BaseModel):
    queued: int = 0
    agents_available: int = 0
    message: Optional[str] = None


# ── Jobs ──────────────────────────────────────────────────────────────────────

class JobCreate(BaseModel):
    job_type: str
    profile_key: str = "profile_1"
    campaign_id: Optional[str] = None
    prospect_id: Optional[str] = None
    priority: int = 5
    scheduled_for: Optional[str] = None
    payload: Optional[dict] = None
    max_retries: int = 3


class JobStatusUpdate(BaseModel):
    result: Optional[dict] = None
    error_message: Optional[str] = None


class ScheduleUpdate(BaseModel):
    task_key: str
    label: str
    time: str
    enabled: bool = True
    run_on_startup: bool = False


class MessageTemplateUpsert(BaseModel):
    id: Optional[str] = None
    name: str
    subject: Optional[str] = None
    body: str = ""
    message_type: str = "initial"
    type: Optional[str] = None
    category: Optional[str] = None
    folder: Optional[str] = None
    tags: List[str] = []
    status: str = "active"
    active: bool = True
    sequence: List[dict] = []
    variables: List[str] = []
    custom_fields: dict = {}
    created_by: Optional[str] = "LinkedFlow"


# Campaign Wizard / template engine

class CampaignTemplateCreate(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    category: str = "outreach"
    status: str = "active"
    supported_actions: List[str] = []
    variables: List[str] = []
    default_config: dict = {}
    steps: List[dict] = []


class CampaignFromTemplateCreate(BaseModel):
    name: str
    template_id: str
    status: str = "draft"
    sequence_config: dict = {}
    schedule_config: dict = {}
    settings: dict = {}


class CampaignLaunchRequest(BaseModel):
    prospect_ids: Optional[List[str]] = None
    list_ids: Optional[List[str]] = None


class CampaignStatusUpdate(BaseModel):
    status: str


class CampaignProspectsUpdate(BaseModel):
    prospect_ids: List[str]


class CampaignDuplicateRequest(BaseModel):
    name: Optional[str] = None
    include_prospects: bool = False


class ProspectListCreate(BaseModel):
    name: str
    description: Optional[str] = None
    sort_order: int = 0


class ProspectListUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None


class ProspectListMembersUpdate(BaseModel):
    prospect_ids: List[str]


# ── HubSpot ───────────────────────────────────────────────────────────────────

class HubSpotSync(BaseModel):
    hubspot_api_key: str
