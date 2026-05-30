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
    monkeypatch.setattr(database, "db_get_active_enrollments_for_prospect", lambda prospect_id: [])
    monkeypatch.setattr(database, "db_get_queue_campaign_id_for_prospect", lambda prospect: None)
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
    monkeypatch.setattr(database, "db_get_active_enrollments_for_prospect", lambda prospect_id: [])
    monkeypatch.setattr(database, "db_log_activity", lambda *args: None)
    monkeypatch.setattr(database, "db_upsert_profile_connection_state", lambda *args, **kwargs: {"connection_status": "connected"})

    result = database.db_mark_prospect_connected("prospect-1", "Already connected")

    assert result["status"] == "Needs Personalization"
    assert result["queued_job"] is None
    assert jobs == []


def test_ready_prospect_with_stale_campaign_queues_against_running_enrollment(monkeypatch):
    prospect = {
        "id": "prospect-1",
        "status": "Ready to Send",
        "initial_message": "Hey",
        "linkedin_url": "https://www.linkedin.com/in/example/",
        "assigned_account": "profile_1",
        "campaign_id": "archived-campaign",
        "message_sent_date": None,
    }
    enrollment = {
        "campaign_id": "running-campaign",
        "prospect_id": "prospect-1",
        "current_step_order": 1,
        "accepted_at": None,
        "connected_at": None,
    }
    logs = []

    class FakeTable:
        def update(self, *_args, **_kwargs):
            return self

        def eq(self, *_args, **_kwargs):
            return self

        def execute(self):
            return types.SimpleNamespace(data=[])

    class FakeSupabase:
        def table(self, *_args, **_kwargs):
            return FakeTable()

    monkeypatch.setattr(database, "supabase", FakeSupabase())
    monkeypatch.setattr(database, "db_get_running_enrollments_for_prospect", lambda prospect_id: [enrollment])
    monkeypatch.setattr(database, "db_upsert_profile_connection_state", lambda *args, **kwargs: {"connection_status": "connected"})
    monkeypatch.setattr(database, "db_get_initial_message_step_order", lambda campaign_id: 3)
    monkeypatch.setattr(database, "db_queue_next_campaign_step", lambda campaign_id, prospect_id, after_step_order: {
        "id": "message-job-1",
        "job_type": "send_messages",
        "campaign_id": campaign_id,
        "prospect_id": prospect_id,
        "payload": {"campaign_step_order": after_step_order + 1, "message_type": "initial"},
    })
    monkeypatch.setattr(database, "db_log_activity", lambda *args: logs.append(args))

    job = database.db_queue_ready_prospect_initial_message(prospect, reason="test")

    assert job["job_type"] == "send_messages"
    assert job["campaign_id"] == "running-campaign"
    assert job["payload"]["campaign_step_order"] == 3
    assert any(entry[1] == "queue_initial_message" for entry in logs)
