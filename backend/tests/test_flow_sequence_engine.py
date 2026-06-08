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
    """Minimal stand-in for supabase.table(...).update(...).eq(...).eq(...).execute()."""
    def __init__(self, sink, name):
        self._sink = sink
        self._name = name
        self._payload = None

    def update(self, payload):
        self._payload = payload
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def execute(self):
        self._sink.append((self._name, self._payload))
        return types.SimpleNamespace(data=[])


class _FakeSupabase:
    def __init__(self):
        self.writes = []

    def table(self, name):
        return _FakeTable(self.writes, name)


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

    database.db_apply_completed_flow_job(job, {"status": "still_not_accepted"})

    # Routes into the "completed" terminal node (an inline node) rather than
    # queuing another agent job — and must NOT land on the `msg` node.
    assert all(j["payload"].get("flow_node_id") != "msg" for j in jobs)
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
