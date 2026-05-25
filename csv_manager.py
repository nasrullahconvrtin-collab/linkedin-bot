import csv
import os
from datetime import date, timedelta
from config import (
    PROSPECTS_CSV, ALL_COLUMNS,
    COL_LINKEDIN_URL, COL_STATUS, COL_NEXT_STEPS, COL_ASSIGNED_ACCOUNT,
    STATUS_EMPTY, STATUS_CONNECTION_SENT, STATUS_READY_TO_SEND,
    STATUS_INITIAL_MESSAGE_SENT, STATUS_FOLLOWING_UP,
)


def _normalize(row: dict) -> dict:
    """Ensure every expected column exists, adding empty strings for missing ones."""
    for col in ALL_COLUMNS:
        if col not in row:
            row[col] = ""
    return row


def read_prospects() -> list[dict]:
    if not os.path.exists(PROSPECTS_CSV):
        return []
    with open(PROSPECTS_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return [_normalize(dict(row)) for row in reader]


def save_prospects(prospects: list[dict]):
    with open(PROSPECTS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=ALL_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(prospects)


def update_prospect(prospects: list[dict], linkedin_url: str, updates: dict) -> bool:
    """Update one row in-memory and immediately persist to disk. Returns True on match."""
    url = linkedin_url.strip().rstrip("/")
    for row in prospects:
        row_url = row.get(COL_LINKEDIN_URL, "").strip().rstrip("/")
        if row_url == url:
            row.update(updates)
            save_prospects(prospects)
            return True
    return False


# ── Filters ───────────────────────────────────────────────────────────────────

def get_pending_connections(prospects: list[dict]) -> list[dict]:
    """Rows with empty Status — ready for first contact."""
    return [r for r in prospects if r.get(COL_STATUS, "").strip() == STATUS_EMPTY]


def get_sent_connections(prospects: list[dict]) -> list[dict]:
    """Rows where Status = 'Connection Request Sent' — check for acceptance."""
    return [r for r in prospects if r.get(COL_STATUS, "").strip() == STATUS_CONNECTION_SENT]


def get_ready_to_send(prospects: list[dict]) -> list[dict]:
    """Rows where Status = 'Ready to Send' — initial message ready to go."""
    return [r for r in prospects if r.get(COL_STATUS, "").strip() == STATUS_READY_TO_SEND]


def get_followups_due(prospects: list[dict]) -> list[dict]:
    """Rows where Next Steps contains today's date string."""
    today_str = date.today().strftime("%Y-%m-%d")
    return [
        r for r in prospects
        if today_str in r.get(COL_NEXT_STEPS, "")
    ]


def get_active_prospects(prospects: list[dict]) -> list[dict]:
    """Rows where Status is Initial Message Sent or Following Up."""
    active = {STATUS_INITIAL_MESSAGE_SENT, STATUS_FOLLOWING_UP}
    return [r for r in prospects if r.get(COL_STATUS, "").strip() in active]


def group_by_account(prospects: list[dict]) -> dict[str, list[dict]]:
    """Group prospect rows by their Assigned Account value."""
    groups: dict[str, list[dict]] = {}
    for row in prospects:
        acct = row.get(COL_ASSIGNED_ACCOUNT, "profile_1").strip() or "profile_1"
        groups.setdefault(acct, []).append(row)
    return groups


# ── Date helpers ──────────────────────────────────────────────────────────────

def add_working_days(start_date: date, days: int) -> date:
    current = start_date
    added = 0
    while added < days:
        current += timedelta(days=1)
        if current.weekday() < 5:   # Mon–Fri
            added += 1
    return current
