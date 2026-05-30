import importlib
import os
import sys
import types


os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

fake_supabase = types.ModuleType("supabase")
fake_supabase.Client = object
fake_supabase.create_client = lambda *_args, **_kwargs: object()
sys.modules.setdefault("supabase", fake_supabase)

database = importlib.import_module("database")


def test_already_connected_with_initial_message_becomes_ready_and_queues_once(monkeypatch):
    prospect = {
        "id": "prospect-1",
        "status": "",
        "initial_message": "Hi Maryam, good to connect.",
        "linkedin_url": "https://www.linkedin.com/in/example/",
        "assigned_account": "profile_1",
        "campaign_id": None,
        "message_sent_date": None,
    }
    updates = []
    logs = []

    monkeypatch.setattr(database, "db_get_prospect", lambda prospect_id: (prospect.copy(), []))

    def fake_update(prospect_id, data):
        updates.append(data)
        updated = prospect.copy()
        updated.update(data)
        return updated

    monkeypatch.setattr(database, "db_update_prospect", fake_update)
    monkeypatch.setattr(database, "db_get_profile", lambda profile_key: {"enabled": True, "daily_sent": 0})
    monkeypatch.setattr(database, "db_has_active_job_for_prospect", lambda job_type, prospect_id: False)
    monkeypatch.setattr(database, "db_create_job", lambda data: {"id": "job-1", **data})
    monkeypatch.setattr(database, "db_log_activity", lambda *args: logs.append(args))
    monkeypatch.setattr(database, "db_upsert_profile_connection_state", lambda *args, **kwargs: {"connection_status": "connected"})

    result = database.db_mark_prospect_connected("prospect-1", "Already connected")

    assert result["status"] == "Ready to Send"
    assert result["queued_job"]["job_type"] == "send_messages"
    assert result["queued_job"]["payload"]["message_type"] == "initial"
    assert updates[0]["status"] == "Ready to Send"
    assert any(entry[1] == "queue_initial_message" for entry in logs)


def test_already_connected_without_initial_message_needs_personalization(monkeypatch):
    prospect = {
        "id": "prospect-1",
        "status": "",
        "initial_message": "",
        "linkedin_url": "https://www.linkedin.com/in/example/",
        "assigned_account": "profile_1",
        "campaign_id": None,
        "message_sent_date": None,
    }
    jobs = []

    monkeypatch.setattr(database, "db_get_prospect", lambda prospect_id: (prospect.copy(), []))
    monkeypatch.setattr(database, "db_update_prospect", lambda prospect_id, data: {**prospect, **data})
    monkeypatch.setattr(database, "db_create_job", lambda data: jobs.append(data))
    monkeypatch.setattr(database, "db_log_activity", lambda *args: None)
    monkeypatch.setattr(database, "db_upsert_profile_connection_state", lambda *args, **kwargs: {"connection_status": "connected"})

    result = database.db_mark_prospect_connected("prospect-1", "Already connected")

    assert result["status"] == "Needs Personalization"
    assert result["queued_job"] is None
    assert jobs == []
