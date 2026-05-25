import os
from pathlib import Path

# ── Backend WebSocket ─────────────────────────────────────────────────────────
WS_BASE_URL = "wss://linkedin-bot-backend-production.up.railway.app/ws/agent"

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
AGENT_HOME    = Path(os.environ.get("LINKEDFLOW_AGENT_HOME", Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "LinkedFlowAgent"))
SESSION_DIR   = os.path.join(BASE_DIR, "sessions")
PROSPECTS_CSV = os.path.join(BASE_DIR, "prospects.csv")
RESULTS_CSV   = os.path.join(BASE_DIR, "results.csv")
LOG_FILE      = str(AGENT_HOME / "logs" / "agent.log")

# ── Limits & delays ───────────────────────────────────────────────────────────
DAILY_LIMIT            = 25
DELAY_MIN_CONNECTION   = 180   # seconds
DELAY_MAX_CONNECTION   = 420
DELAY_MIN_MESSAGE      = 300
DELAY_MAX_MESSAGE      = 600

# ── Status values (exact, case-sensitive) ─────────────────────────────────────
STATUS_EMPTY                  = ""
STATUS_CONNECTION_SENT        = "Connection Request Sent"
STATUS_CONNECTION_ACCEPTED    = "Connection Accepted"
STATUS_READY_TO_SEND          = "Ready to Send"
STATUS_INITIAL_MESSAGE_SENT   = "Initial Message Sent"
STATUS_FOLLOWING_UP           = "Following Up"
STATUS_NO_RESPONSE            = "No Response"
STATUS_REPLIED                = "Replied"

# ── CSV column names (exact, case-sensitive) ──────────────────────────────────
COL_FIRST_NAME          = "firstName"
COL_LAST_NAME           = "lastName"
COL_OCCUPATION          = "occupation"
COL_JOB_TITLE           = "job_title"
COL_LOCATION            = "location"
COL_LINKEDIN_EMAIL      = "linkedinEmail"
COL_PHONE               = "phoneNumbers"
COL_LINKEDIN_URL        = "linkedinUrl"
COL_COMPANY             = "Company"
COL_COMPANY_LI_URL      = "company_linkedinUrl"
COL_COMPANY_WEBSITE     = "company_website"
COL_CAMPAIGN            = "Campaign/List"
COL_ASSIGNED_ACCOUNT    = "Assigned Account"
COL_STATUS              = "Status"
COL_NEXT_STEPS          = "Next Steps"
COL_WHY_ICP             = "Why This ICP"
COL_PAIN_POINTS         = "Company Pain Points"
COL_GROWTH_GOALS        = "Growth Goals"
COL_LI_DATA_EXTRACTED   = "LinkedIn Profile Data Extracted"
COL_TAILORED_OFFER      = "Our Tailored Offer for Them"
COL_INMAIL_SUBJECT      = "InMail Subject"
COL_INMAIL_MESSAGE      = "InMail Message"
COL_INITIAL_MESSAGE     = "Initial Message"
COL_FOLLOWUP_1          = "Follow-up 1"
COL_FOLLOWUP_2          = "Follow-up 2"
COL_FOLLOWUP_3          = "Follow-up 3"
COL_FOLLOWUP_4          = "Follow-up 4"
COL_PROCESSING_STATUS   = "Processing Status"
COL_PROCESSED_DATE      = "Processed Date"
COL_NOTES               = "Notes"
COL_HUBSPOT_DEAL_ID     = "HubSpot Deal ID"
COL_PUSHED_TO_HUBSPOT   = "Pushed to HubSpot"
COL_HUBSPOT_PUSH_DATE   = "HubSpot Push Date"
COL_CONNECTION_SENT_DATE = "Connection Sent Date"
COL_MESSAGE_SENT_DATE   = "Message Sent Date"
COL_REPLY_DATE          = "Reply Date"
COL_REPLY_TYPE          = "Reply Type"

# ── All columns in order (used when creating/writing CSV) ────────────────────
ALL_COLUMNS = [
    COL_FIRST_NAME, COL_LAST_NAME, COL_OCCUPATION, COL_JOB_TITLE,
    COL_LOCATION, COL_LINKEDIN_EMAIL, COL_PHONE, COL_LINKEDIN_URL,
    COL_COMPANY, COL_COMPANY_LI_URL, COL_COMPANY_WEBSITE, COL_CAMPAIGN,
    COL_ASSIGNED_ACCOUNT, COL_STATUS, COL_NEXT_STEPS, COL_WHY_ICP,
    COL_PAIN_POINTS, COL_GROWTH_GOALS, COL_LI_DATA_EXTRACTED,
    COL_TAILORED_OFFER, COL_INMAIL_SUBJECT, COL_INMAIL_MESSAGE,
    COL_INITIAL_MESSAGE, COL_FOLLOWUP_1, COL_FOLLOWUP_2, COL_FOLLOWUP_3,
    COL_FOLLOWUP_4, COL_PROCESSING_STATUS, COL_PROCESSED_DATE, COL_NOTES,
    COL_HUBSPOT_DEAL_ID, COL_PUSHED_TO_HUBSPOT, COL_HUBSPOT_PUSH_DATE,
    COL_CONNECTION_SENT_DATE, COL_MESSAGE_SENT_DATE, COL_REPLY_DATE,
    COL_REPLY_TYPE,
]
