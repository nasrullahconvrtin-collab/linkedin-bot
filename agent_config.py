import json
import os
import shutil
import zipfile
from pathlib import Path


def _default_agent_home() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local) / "LinkedFlowAgent"
    return Path.home() / "AppData" / "Local" / "LinkedFlowAgent"


AGENT_HOME = Path(os.environ.get("LINKEDFLOW_AGENT_HOME", str(_default_agent_home())))
CONFIG_FILE = AGENT_HOME / "config.json"
STATE_FILE = AGENT_HOME / "state.json"
PAUSE_FILE = AGENT_HOME / "paused.flag"
LOG_DIR = AGENT_HOME / "logs"
PROFILE_DIR = AGENT_HOME / "profiles"
BACKUP_DIR = AGENT_HOME / "backups"

DEFAULT_CONFIG = {
    "backend_url": "https://linkedin-bot-backend-production.up.railway.app",
    "ws_base_url": "wss://linkedin-bot-backend-production.up.railway.app/ws/agent",
    "profile_key": "profile_1",
    "profiles": ["profile_1"],
    "proxy_settings": {},
    "cloud_runner": {"enabled": False, "status": "coming_soon"},
    "user_data_dir": str(PROFILE_DIR / "profile_1"),
    "auto_start": True,
    "start_with_windows": True,
    "minimized_on_launch": True,
    "minimize_to_tray": True,
    "job_polling_interval": 15,
}


def ensure_dirs():
    AGENT_HOME.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def load_config() -> dict:
    ensure_dirs()
    if not CONFIG_FILE.exists():
        save_config(DEFAULT_CONFIG)
        return dict(DEFAULT_CONFIG)
    try:
        saved = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        saved = {}
    config = {**DEFAULT_CONFIG, **saved}
    if not config.get("profiles"):
        config["profiles"] = [config.get("profile_key", "profile_1")]
    if not config.get("user_data_dir"):
        config["user_data_dir"] = str(PROFILE_DIR / config.get("profile_key", "profile_1"))
    return config


def save_config(config: dict):
    ensure_dirs()
    CONFIG_FILE.write_text(json.dumps(config, indent=2), encoding="utf-8")


def write_state(**updates):
    ensure_dirs()
    state = read_state()
    state.update(updates)
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def read_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def set_paused(paused: bool):
    ensure_dirs()
    if paused:
        PAUSE_FILE.write_text("paused", encoding="utf-8")
    elif PAUSE_FILE.exists():
        PAUSE_FILE.unlink()
    write_state(paused=paused)


def is_paused() -> bool:
    return PAUSE_FILE.exists()


def export_config(dest: str | None = None) -> str:
    ensure_dirs()
    target = Path(dest) if dest else BACKUP_DIR / "linkedflow-agent-config.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    if CONFIG_FILE.exists():
        shutil.copy2(CONFIG_FILE, target)
    else:
        target.write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding="utf-8")
    return str(target)


def export_browser_profile(profile_key: str = "profile_1", dest: str | None = None) -> str:
    ensure_dirs()
    src = PROFILE_DIR / profile_key
    if not src.exists():
        raise FileNotFoundError(f"Browser profile does not exist: {src}")
    target = Path(dest) if dest else BACKUP_DIR / f"{profile_key}-browser-profile.zip"
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in src.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(src))
    return str(target)


def restore_browser_profile(profile_key: str, archive: str) -> str:
    ensure_dirs()
    target = PROFILE_DIR / profile_key
    if target.exists():
        backup = BACKUP_DIR / f"{profile_key}-before-restore.zip"
        export_browser_profile(profile_key, str(backup))
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "r") as zf:
        zf.extractall(target)
    return str(target)
