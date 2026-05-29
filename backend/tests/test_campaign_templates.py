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


def test_render_message_template_uses_standard_and_custom_fields():
    prospect = {
        "first_name": "Maryam",
        "last_name": "Ansar",
        "company": "Acme",
        "job_title": "Founder",
        "location": "Lahore",
        "custom_fields": {
            "favorite_sport": "cricket",
            "recent_post": "your hiring update",
        },
    }

    rendered = database.db_render_message_template(
        "Hi {{first_name}}, saw {{recent_post}} at {{company}}. Also, {{favorite_sport}}!",
        prospect,
    )

    assert rendered == "Hi Maryam, saw your hiring update at Acme. Also, cricket!"


def test_extract_variables_returns_unique_sorted_names():
    assert database.db_extract_variables("{{b}} {{a}} {{ b }}") == ["a", "b"]
