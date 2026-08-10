"""
Exercises the Visual Flow Builder graph-walking engine (db_queue_next_flow_step /
db_apply_completed_flow_job / _flow_next_node) against graphs shaped exactly like
what SequenceFlowBuilder.jsx + the new sequenceTemplates.js gallery produce:
nodes with `data.nodeType` / `data.config`, and edges with a human-readable
`label` (e.g. "✅ Accepted") plus the *machine-readable* branch selector in
`data.condition` (e.g. "accepted").

This guards against the label/condition mix-up: edge.label is just display text
for the canvas — the engine must branch on edge.data.condition.
"""
import importlib
import os
import sys
import types
from datetime import datetime, timezone


os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

fake_supabase = types.ModuleType("supabase")
fake_supabase.Client = object
fake_supabase.create_client = lambda *_args, **_kwargs: object()
sys.modules.setdefault("supabase", fake_supabase)

database = importlib.import_module("database")


def _node(node_id, node_type, label, config=None):
    return {"id": node_id, "type": "flowNode", "position": {"x": 0, "y": 0},
            "data": {"nodeType": node_type, "label": label, "config": config or {}}}


def _edge(source, target, condition, display_label):
    """Mirrors mkEdge() in dashboard/src/data/sequenceTemplates.js and
    updateEdgeCondition() in SequenceFlowBuilder.jsx: `label` is cosmetic,
    `data.condition` is what the engine must branch on."""
    return {"id": f"e_{source}_{target}_{condition}", "source": source, "target": target,
            "label": display_label, "data": {"condition": condition}}


class _FakeTable:
    """Minimal stand-in for the chains the engine uses:
      .update(...).eq(...).eq(...).execute()
      .select(...).eq(...).eq(...).limit(...).execute()
    For `campaign_enrollments`, selects/updates are backed by an in-memory dict
    on the fake supabase client so _get_flow_state/_update_flow_state (used by
    the acceptance/reply polling loop) can round-trip `flow_state` realistically."""
    def __init__(self, db, name):
        self._db = db
        self._name = name
        self._mode = None
        self._payload = None
        self._filters = {}

    def select(self, _cols):
        self._mode = "select"
        return self

    def update(self, payload):
        self._mode = "update"
        self._payload = payload
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def limit(self, _n):
        return self

    def execute(self):
        self._db.writes.append((self._name, self._mode, self._payload, dict(self._filters)))
        if self._name == "campaign_enrollments":
            key = (self._filters.get("campaign_id"), self._filters.get("prospect_id"))
            if self._mode == "update":
                row = self._db.enrollments.setdefault(key, {})
                row.update(self._payload or {})
                return types.SimpleNamespace(data=[dict(row)])
            if self._mode == "select":
                row = self._db.enrollments.get(key)
                return types.SimpleNamespace(data=[dict(row)] if row else [])
        return types.SimpleNamespace(data=[])


class _FakeSupabase:
    def __init__(self):
        self.writes = []
        self.enrollments = {}

    def table(self, name):
        return _FakeTable(self, name)


# ─── _flow_next_node: must branch on data.condition, never on the cosmetic label ──

def test_flow_next_node_branches_on_condition_not_label():
    """Two edges deliberately have *swapped* labels vs conditions — if the engine
    matched on `label` (the bug we're guarding against) it would pick the wrong
    target every time."""
    nodes = [
        _node("start", "check_messageability", "Check Messageability"),
        _node("a", "send_inmail", "Send InMail"),
        _node("b", "send_message", "Send Message"),
        _node("c", "send_invitation", "Send Connection Request"),
    ]
    edges = [
        # label text intentionally does NOT match its own condition value
        _edge("start", "a", "inmail_available", "zzz-not-the-condition-string"),
        _edge("start", "b", "message_available", "zzz-not-the-condition-string-either"),
        _edge("start", "c", "not_messageable", "Not messageable"),
    ]
    by_id = {n["id"]: n for n in nodes}

    assert database._flow_next_node(edges, by_id, "start", "inmail_available")["id"] == "a"
    assert database._flow_next_node(edges, by_id, "start", "message_available")["id"] == "b"
    assert database._flow_next_node(edges, by_id, "start", "not_messageable")["id"] == "c"


def test_flow_next_node_falls_back_to_default_then_first_edge():
    nodes = [_node("start", "wait", "Wait"), _node("d", "send_message", "Default target"),
             _node("x", "completed", "Other target")]
    by_id = {n["id"]: n for n in nodes}
    edges = [_edge("start", "x", "accepted", "✅ Accepted"), _edge("start", "d", "default", "Continue")]

    # Asking for a condition with no matching edge falls back to the 'default' edge
    assert database._flow_next_node(edges, by_id, "start", "replied")["id"] == "d"
    # Exact match wins
    assert database._flow_next_node(edges, by_id, "start", "accepted")["id"] == "x"


# ─── End-to-end: check_messageability → 3-way branch picks the right target ──────

def _patch_common(monkeypatch, campaign, prospect_box, fake_db, jobs):
    monkeypatch.setattr(database, "db_get_campaign", lambda cid: (campaign, None))
    monkeypatch.setattr(database, "db_get_prospect", lambda pid: (prospect_box["prospect"].copy(), []))

    def fake_update_prospect(pid, data):
        prospect_box["prospect"].update(data)
        return prospect_box["prospect"].copy()

    monkeypatch.setattr(database, "db_update_prospect", fake_update_prospect)
    monkeypatch.setattr(database, "db_has_active_job_for_prospect", lambda jt, pid: False)
    monkeypatch.setattr(database, "db_log_activity", lambda *a, **k: None)
    monkeypatch.setattr(database, "db_mark_prospect_connected",
                        lambda *a, **k: {"status": "Ready to Send", "queued_job": None})
    monkeypatch.setattr(database, "db_mark_invitation_sent", lambda *a, **k: None)
    monkeypatch.setattr(database, "supabase", fake_db)

    def fake_create_job(data):
        job = {"id": f"job-{len(jobs) + 1}", **data}
        jobs.append(job)
        return job

    monkeypatch.setattr(database, "db_create_job", fake_create_job)


def _inmail_first_flow():
    """Trimmed-down version of the 'InMail-first with fallbacks' template:
    Visit Profile -> Check Messageability -> {InMail | Message | Connection}."""
    nodes = [
        _node("visit", "visit_profile", "Visit Profile"),
        _node("check", "check_messageability", "Check Messageability", {"fallback": "invitation"}),
        _node("inmail", "send_inmail", "Send InMail", {"subject": "Hi {{first_name}}", "message": "InMail body"}),
        _node("msg", "send_message", "Send Message", {"message": "Hi {{first_name}}, message body"}),
        _node("connect", "send_invitation", "Send Connection Request", {"add_note": False}),
    ]
    edges = [
        _edge("visit", "check", "default", "Continue"),
        _edge("check", "inmail", "inmail_available", "InMail available"),
        _edge("check", "msg", "message_available", "Message available"),
        _edge("check", "connect", "not_messageable", "Not messageable"),
    ]
    return {"nodes": nodes, "edges": edges}


def test_check_messageability_normal_message_branch_queues_send_message_job(monkeypatch):
    campaign = {"id": "camp-1", "status": "running", "profile_key": "profile_1",
                "sequence_config": {"flow_sequence": _inmail_first_flow()}}
    prospect_box = {"prospect": {"id": "prospect-1", "status": "", "linkedin_url": "https://www.linkedin.com/in/example/",
                                 "assigned_account": "profile_1", "campaign_id": "camp-1", "first_name": "Maryam"}}
    jobs = []
    fake_db = _FakeSupabase()
    _patch_common(monkeypatch, campaign, prospect_box, fake_db, jobs)

    job = {"id": "job-check", "prospect_id": "prospect-1", "campaign_id": "camp-1",
           "profile_key": "profile_1",
           "payload": {"flow_node_id": "check", "flow_node_type": "check_messageability"}}

    database.db_apply_completed_flow_job(job, {"status": "normal_message_available"})

    # Exactly one new job queued, and it must be the `send_message` node — NOT
    # the first-declared edge (inmail) which a label-matching bug would pick.
    queued = [j for j in jobs if j["payload"].get("flow_node_id") not in ("check",)]
    assert len(queued) == 1
    assert queued[0]["payload"]["flow_node_id"] == "msg"
    assert queued[0]["payload"]["flow_node_type"] == "send_message"
    assert queued[0]["job_type"] == "send_messages"


def test_check_messageability_inmail_branch_queues_send_inmail_job(monkeypatch):
    campaign = {"id": "camp-1", "status": "running", "profile_key": "profile_1",
                "sequence_config": {"flow_sequence": _inmail_first_flow()}}
    prospect_box = {"prospect": {"id": "prospect-1", "status": "", "linkedin_url": "https://www.linkedin.com/in/example/",
                                 "assigned_account": "profile_1", "campaign_id": "camp-1", "first_name": "Maryam"}}
    jobs = []
    fake_db = _FakeSupabase()
    _patch_common(monkeypatch, campaign, prospect_box, fake_db, jobs)

    job = {"id": "job-check", "prospect_id": "prospect-1", "campaign_id": "camp-1",
           "profile_key": "profile_1",
           "payload": {"flow_node_id": "check", "flow_node_type": "check_messageability"}}

    database.db_apply_completed_flow_job(job, {"status": "inmail_available"})

    queued = [j for j in jobs if j["payload"].get("flow_node_id") not in ("check",)]
    assert len(queued) == 1
    assert queued[0]["payload"]["flow_node_id"] == "inmail"
    assert queued[0]["job_type"] == "send_inmail"


def test_check_messageability_not_messageable_falls_back_to_connection_request(monkeypatch):
    campaign = {"id": "camp-1", "status": "running", "profile_key": "profile_1",
                "sequence_config": {"flow_sequence": _inmail_first_flow()}}
    prospect_box = {"prospect": {"id": "prospect-1", "status": "", "linkedin_url": "https://www.linkedin.com/in/example/",
                                 "assigned_account": "profile_1", "campaign_id": "camp-1", "first_name": "Maryam"}}
    jobs = []
    fake_db = _FakeSupabase()
    _patch_common(monkeypatch, campaign, prospect_box, fake_db, jobs)

    job = {"id": "job-check", "prospect_id": "prospect-1", "campaign_id": "camp-1",
           "profile_key": "profile_1",
           "payload": {"flow_node_id": "check", "flow_node_type": "check_messageability"}}

    database.db_apply_completed_flow_job(job, {"status": "not_messageable"})

    queued = [j for j in jobs if j["payload"].get("flow_node_id") not in ("check",)]
    assert len(queued) == 1
    assert queued[0]["payload"]["flow_node_id"] == "connect"
    assert queued[0]["job_type"] == "send_connections"


# ─── wait_acceptance: accepted vs still_not_accepted route to different nodes ────

def _connect_flow_with_fork():
    nodes = [
        _node("connect", "send_invitation", "Send Connection Request", {"add_note": False}),
        _node("wait_acc", "wait_acceptance", "Wait for Acceptance", {"timeout_days": 7}),
        _node("msg", "send_message", "Send Initial Message", {"message": "hi"}),
        _node("end", "completed", "No Response — End"),
    ]
    edges = [
        _edge("connect", "wait_acc", "default", "Continue"),
        _edge("wait_acc", "msg", "accepted", "✅ Accepted"),
        _edge("wait_acc", "end", "still_not_accepted", "❌ Still not accepted"),
    ]
    return {"nodes": nodes, "edges": edges}


def test_wait_acceptance_accepted_routes_to_message_node(monkeypatch):
    campaign = {"id": "camp-2", "status": "running", "profile_key": "profile_1",
                "sequence_config": {"flow_sequence": _connect_flow_with_fork()}}
    prospect_box = {"prospect": {"id": "prospect-2", "status": "", "linkedin_url": "https://www.linkedin.com/in/example2/",
                                 "assigned_account": "profile_1", "campaign_id": "camp-2", "first_name": "Sara"}}
    jobs = []
    fake_db = _FakeSupabase()
    _patch_common(monkeypatch, campaign, prospect_box, fake_db, jobs)

    job = {"id": "job-wait", "prospect_id": "prospect-2", "campaign_id": "camp-2",
           "profile_key": "profile_1",
           "payload": {"flow_node_id": "wait_acc", "flow_node_type": "wait_acceptance"}}

    database.db_apply_completed_flow_job(job, {"status": "accepted"})

    queued = [j for j in jobs if j["payload"].get("flow_node_id") not in ("wait_acc",)]
    assert len(queued) == 1
    assert queued[0]["payload"]["flow_node_id"] == "msg"
    assert queued[0]["job_type"] == "send_messages"


def test_wait_acceptance_still_not_accepted_routes_to_end_node_and_terminates(monkeypatch):
    """Once the monitoring window has run its course (the prospect never
    accepted across many periodic checks), 'still_not_accepted' must finally
    route into the "completed" terminal node and end the sequence — and must
    NOT land on the `msg` node (the 'accepted' branch)."""
    campaign = {"id": "camp-2", "status": "running", "profile_key": "profile_1",
                "sequence_config": {"flow_sequence": _connect_flow_with_fork()}}
    prospect_box = {"prospect": {"id": "prospect-2", "status": "", "linkedin_url": "https://www.linkedin.com/in/example2/",
                                 "assigned_account": "profile_1", "campaign_id": "camp-2", "first_name": "Sara"}}
    jobs = []
    fake_db = _FakeSupabase()
    _patch_common(monkeypatch, campaign, prospect_box, fake_db, jobs)
    # Simulate a monitoring window that started long enough ago to have
    # exceeded this node's max-wait (legacy `timeout_days: 7` -> ~21 days).
    fake_db.enrollments[("camp-2", "prospect-2")] = {
        "flow_state": {"wait_monitor": {"node_id": "wait_acc",
                                         "started_at": "2026-04-01T00:00:00+00:00",
                                         "checks": 21}},
    }

    job = {"id": "job-wait", "prospect_id": "prospect-2", "campaign_id": "camp-2",
           "profile_key": "profile_1",
           "payload": {"flow_node_id": "wait_acc", "flow_node_type": "wait_acceptance"}}

    database.db_apply_completed_flow_job(job, {"status": "still_not_accepted"})

    # Routes into the "completed" terminal node (an inline node) rather than
    # queuing another agent job — and must NOT land on the `msg` node.
    assert all(j["payload"].get("flow_node_id") != "msg" for j in jobs)
    assert all(j["payload"].get("flow_node_id") != "wait_acc" for j in jobs)
    assert prospect_box["prospect"]["status"] == "Completed"


# ─── Converging branches: multiple openers funnel into ONE shared follow-up ──
# chain (the "build the follow-ups once, reuse them everywhere" pattern from
# the redesigned 'inmail_first_fallback' template — verifies the graph-walker
# treats a node with multiple INCOMING edges exactly like any other node, no
# matter which upstream branch a prospect arrives from.

def _converging_flow():
    """Two completely different openers (InMail vs. a direct message) both
    point at the very same `wait1` -> `followup` chain — built once, reused
    by both branches, instead of being duplicated per branch."""
    nodes = [
        _node("check", "check_messageability", "Check Messageability", {"fallback": "invitation"}),
        _node("inmail", "send_inmail", "Send InMail", {"subject": "Hi", "message": "InMail body"}),
        _node("direct", "send_message", "Send Message", {"message": "Direct message body"}),
        _node("wait1", "wait", "Wait 3 days", {"days": 3}),
        _node("stop1", "stop_if_replied", "Stop if Replied"),
        _node("followup", "send_message", "Follow-up 1", {"message": "Following up — {{first_name}}"}),
        _node("done", "completed", "Completed"),
    ]
    edges = [
        _edge("check", "inmail", "inmail_available", "InMail available"),
        _edge("check", "direct", "message_available", "Message available"),
        # ── convergence: both openers funnel into the SAME shared chain ──
        _edge("inmail", "wait1", "sent", "Sent"),
        _edge("direct", "wait1", "sent", "Sent"),
        _edge("wait1", "stop1", "default", "Continue"),
        _edge("stop1", "followup", "default", "Continue"),
        _edge("followup", "done", "default", "Continue"),
    ]
    return {"nodes": nodes, "edges": edges}


def test_converging_branches_both_funnel_into_shared_followup_chain(monkeypatch):
    """Whether the prospect was reached via InMail or a direct message, completing
    that opener must land them on the *same* shared `wait1` step — proving a
    template author can build the follow-up chain once and have every branch
    reuse it, rather than duplicating it per branch."""
    campaign = {"id": "camp-3", "status": "running", "profile_key": "profile_1",
                "sequence_config": {"flow_sequence": _converging_flow()}}
    jobs = []
    fake_db = _FakeSupabase()

    for opener_node_id, opener_node_type, status in (
        ("inmail", "send_inmail", "inmail_sent"),
        ("direct", "send_message", "message_sent"),
    ):
        prospect_box = {"prospect": {"id": f"prospect-{opener_node_id}", "status": "",
                                     "linkedin_url": "https://www.linkedin.com/in/example/",
                                     "assigned_account": "profile_1", "campaign_id": "camp-3",
                                     "first_name": "Maryam"}}
        jobs.clear()
        _patch_common(monkeypatch, campaign, prospect_box, fake_db, jobs)

        job = {"id": f"job-{opener_node_id}", "prospect_id": prospect_box["prospect"]["id"],
               "campaign_id": "camp-3", "profile_key": "profile_1",
               "payload": {"flow_node_id": opener_node_id, "flow_node_type": opener_node_type}}

        database.db_apply_completed_flow_job(job, {"status": status})

        # Both openers must converge on the very same `wait1` node — the
        # shared chain — never on a per-branch duplicate.
        queued = [j for j in jobs if j["payload"].get("flow_node_id") not in (opener_node_id,)]
        assert len(queued) == 1, f"expected exactly one queued step after {opener_node_id}, got {queued}"
        # `wait` is an inline node (no agent job) — the walker resolves it
        # immediately and queues the job for the node *after* it: `followup`,
        # reached via the shared `stop1` gate. That's the proof of convergence:
        # both openers end up driving the identical downstream chain.
        assert queued[0]["payload"]["flow_node_id"] == "followup"
        assert queued[0]["job_type"] == "send_messages"


# ─── Periodic acceptance / reply monitoring ─────────────────────────────────
# "Wait for Acceptance" / "Wait for InMail Reply" must POLL on a cadence
# (check_frequency_hours) up to a max-wait window (max_wait_days) — not wait a
# fixed delay and check exactly once. While "still pending" and inside the
# window, the engine re-queues another check on the SAME node (bookkeeping in
# campaign_enrollments.flow_state.wait_monitor); once the window elapses, the
# "still_not_accepted"/"no_reply" branch finally fires.

def test_wait_acceptance_still_pending_within_window_requeues_another_check(monkeypatch):
    campaign = {"id": "camp-4", "status": "running", "profile_key": "profile_1",
                "sequence_config": {"flow_sequence": _connect_flow_with_fork()}}
    prospect_box = {"prospect": {"id": "prospect-4", "status": "", "linkedin_url": "https://www.linkedin.com/in/example4/",
                                 "assigned_account": "profile_1", "campaign_id": "camp-4", "first_name": "Iman"}}
    jobs = []
    fake_db = _FakeSupabase()
    _patch_common(monkeypatch, campaign, prospect_box, fake_db, jobs)
    # Pretend we entered the wait node ~2 days ago — well inside the (default)
    # 30-day max-wait window for a node with no explicit config.
    two_days_ago = (datetime.now(timezone.utc) - database.timedelta(days=2)).isoformat()
    fake_db.enrollments[("camp-4", "prospect-4")] = {
        "flow_state": {"wait_monitor": {"node_id": "wait_acc",
                                         "started_at": two_days_ago,
                                         "checks": 1}},
    }

    job = {"id": "job-wait", "prospect_id": "prospect-4", "campaign_id": "camp-4",
           "profile_key": "profile_1",
           "payload": {"flow_node_id": "wait_acc", "flow_node_type": "wait_acceptance"}}

    database.db_apply_completed_flow_job(job, {"status": "still_not_accepted"})

    # Must NOT advance to the "end" terminal node yet — another check on the
    # SAME wait_acc node should be queued instead.
    assert all(j["payload"].get("flow_node_id") != "end" for j in jobs)
    requeued = [j for j in jobs if j["payload"].get("flow_node_id") == "wait_acc"]
    assert len(requeued) == 1
    assert requeued[0]["job_type"] == "check_connection_status"
    # Bookkeeping must persist across the loop: started_at preserved, counter incremented.
    monitor = fake_db.enrollments[("camp-4", "prospect-4")]["flow_state"]["wait_monitor"]
    assert monitor["node_id"] == "wait_acc"
    assert monitor["started_at"] == two_days_ago
    assert monitor["checks"] == 2
    assert monitor["last_status"] == "still_not_accepted"
    # The prospect must stay in-flight, not be marked Completed.
    assert prospect_box["prospect"]["status"] != "Completed"


def test_wait_acceptance_still_pending_after_max_wait_finally_routes_to_end(monkeypatch):
    campaign = {"id": "camp-5", "status": "running", "profile_key": "profile_1",
                "sequence_config": {"flow_sequence": _connect_flow_with_fork()}}
    prospect_box = {"prospect": {"id": "prospect-5", "status": "", "linkedin_url": "https://www.linkedin.com/in/example5/",
                                 "assigned_account": "profile_1", "campaign_id": "camp-5", "first_name": "Iman"}}
    jobs = []
    fake_db = _FakeSupabase()
    _patch_common(monkeypatch, campaign, prospect_box, fake_db, jobs)
    # Pretend monitoring started 90 days ago — way past the default 30-day max wait.
    fake_db.enrollments[("camp-5", "prospect-5")] = {
        "flow_state": {"wait_monitor": {"node_id": "wait_acc",
                                         "started_at": "2026-03-10T00:00:00+00:00",
                                         "checks": 30}},
    }

    job = {"id": "job-wait", "prospect_id": "prospect-5", "campaign_id": "camp-5",
           "profile_key": "profile_1",
           "payload": {"flow_node_id": "wait_acc", "flow_node_type": "wait_acceptance"}}

    database.db_apply_completed_flow_job(job, {"status": "still_not_accepted"})

    # No further check_connection_status job — the window has expired, so the
    # engine must fall through to normal edge routing (-> "end", terminal).
    assert all(j["payload"].get("flow_node_id") != "wait_acc" for j in jobs)
    assert prospect_box["prospect"]["status"] == "Completed"
    # The monitor bookkeeping must be cleared once the prospect leaves the node.
    assert fake_db.enrollments[("camp-5", "prospect-5")]["flow_state"].get("wait_monitor") is None


def test_wait_acceptance_accepted_clears_monitor_bookkeeping(monkeypatch):
    """Once accepted, flow_state.wait_monitor must be cleared so a future
    re-entry into a similar polling node starts a fresh window."""
    campaign = {"id": "camp-6", "status": "running", "profile_key": "profile_1",
                "sequence_config": {"flow_sequence": _connect_flow_with_fork()}}
    prospect_box = {"prospect": {"id": "prospect-6", "status": "", "linkedin_url": "https://www.linkedin.com/in/example6/",
                                 "assigned_account": "profile_1", "campaign_id": "camp-6", "first_name": "Iman"}}
    jobs = []
    fake_db = _FakeSupabase()
    _patch_common(monkeypatch, campaign, prospect_box, fake_db, jobs)
    fake_db.enrollments[("camp-6", "prospect-6")] = {
        "flow_state": {"wait_monitor": {"node_id": "wait_acc",
                                         "started_at": "2026-06-07T00:00:00+00:00",
                                         "checks": 1}},
    }

    job = {"id": "job-wait", "prospect_id": "prospect-6", "campaign_id": "camp-6",
           "profile_key": "profile_1",
           "payload": {"flow_node_id": "wait_acc", "flow_node_type": "wait_acceptance"}}

    database.db_apply_completed_flow_job(job, {"status": "accepted"})

    assert fake_db.enrollments[("camp-6", "prospect-6")]["flow_state"].get("wait_monitor") is None


def test_entering_wait_acceptance_schedules_first_check_on_configured_cadence(monkeypatch):
    """Entering the node (fresh, no prior monitor state) must (a) seed
    flow_state.wait_monitor and (b) schedule the FIRST check one
    check_frequency_hours interval out — not the old 'wait N days, check
    once' delay."""
    nodes = [
        _node("connect", "send_invitation", "Send Connection Request", {"add_note": False}),
        _node("wait_acc", "wait_acceptance", "Wait for Acceptance",
              {"check_frequency_hours": 12, "max_wait_days": 20}),
        _node("msg", "send_message", "Send Initial Message", {"message": "hi"}),
        _node("end", "completed", "No Response — End"),
    ]
    edges = [
        _edge("connect", "wait_acc", "default", "Continue"),
        _edge("wait_acc", "msg", "accepted", "✅ Accepted"),
        _edge("wait_acc", "end", "still_not_accepted", "❌ Still not accepted"),
    ]
    campaign = {"id": "camp-7", "status": "running", "profile_key": "profile_1",
                "sequence_config": {"flow_sequence": {"nodes": nodes, "edges": edges}}}
    prospect_box = {"prospect": {"id": "prospect-7", "status": "", "linkedin_url": "https://www.linkedin.com/in/example7/",
                                 "assigned_account": "profile_1", "campaign_id": "camp-7", "first_name": "Iman"}}
    jobs = []
    fake_db = _FakeSupabase()
    _patch_common(monkeypatch, campaign, prospect_box, fake_db, jobs)

    before = datetime.now(timezone.utc)
    database.db_queue_next_flow_step("camp-7", "prospect-7", "wait_acc", base_time=before)

    queued = [j for j in jobs if j["payload"].get("flow_node_id") == "wait_acc"]
    assert len(queued) == 1
    scheduled = datetime.fromisoformat(queued[0]["scheduled_for"])
    delta_hours = (scheduled - before).total_seconds() / 3600.0
    # Must be scheduled ~12h out (the configured cadence) — NOT 14/20 days.
    assert 11.9 <= delta_hours <= 12.1

    monitor = fake_db.enrollments[("camp-7", "prospect-7")]["flow_state"]["wait_monitor"]
    assert monitor["node_id"] == "wait_acc"
    assert monitor["checks"] == 0
