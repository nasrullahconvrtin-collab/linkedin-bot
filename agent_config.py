import json
import os
import re
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
    "profile_dirs": {"profile_1": str(PROFILE_DIR / "profile_1")},
    "proxy_settings": {},
    "cloud_runner": {"enabled": False, "status": "coming_soon"},
    "user_data_dir": str(PROFILE_DIR / "profile_1"),
    "auto_start": True,
    "start_with_windows": True,
    "minimized_on_launch": True,
    "minimize_to_tray": True,
    "job_polling_interval": 15,
}


def normalize_profile_key(profile_key: str | None) -> str:
    """Keep profile folder names predictable and safe."""
    raw = (profile_key or "profile_1").strip()
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", raw).strip("._-")
    return safe or "profile_1"


def profile_user_data_dir(profile_key: str | None) -> Path:
    return PROFILE_DIR / normalize_profile_key(profile_key)


def _safe_profile_path(profile_key: str | None) -> Path:
    target = profile_user_data_dir(profile_key).resolve()
    root = PROFILE_DIR.resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"Unsafe profile path: {target}") from exc
    return target


def normalize_config(config: dict) -> dict:
    if config.get("profile_key") in ("", None) and config.get("profiles") == []:
        config["profile_key"] = ""
        config["profiles"] = []
        config["profile_dirs"] = {}
        config["user_data_dir"] = ""
        return config
    active = normalize_profile_key(config.get("profile_key"))
    profiles = [normalize_profile_key(p) for p in (config.get("profiles") or []) if p]
    if active not in profiles:
        profiles.insert(0, active)
    profiles = list(dict.fromkeys(profiles))

    profile_dirs = dict(config.get("profile_dirs") or {})
    for profile in profiles:
        profile_dirs[profile] = str(profile_user_data_dir(profile))

    config["profile_key"] = active
    config["profiles"] = profiles
    config["profile_dirs"] = profile_dirs
    # Compatibility for older code/settings screens only. Browser launch code must
    # use profile_user_data_dir(profile_key), never this as a shared global folder.
    config["user_data_dir"] = profile_dirs[active]
    return config


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
    return normalize_config({**DEFAULT_CONFIG, **saved})


def save_config(config: dict):
    ensure_dirs()
    config = normalize_config(config)
    CONFIG_FILE.write_text(json.dumps(config, indent=2), encoding="utf-8")


def add_local_profile(profile_key: str, config: dict | None = None) -> dict:
    config = normalize_config(dict(config or load_config()))
    profile_key = normalize_profile_key(profile_key)
    profiles = list(config.get("profiles") or [])
    if profile_key not in profiles:
        profiles.append(profile_key)
    config["profiles"] = profiles
    config.setdefault("profile_dirs", {})[profile_key] = str(profile_user_data_dir(profile_key))
    if not config.get("profile_key"):
        config["profile_key"] = profile_key
    save_config(config)
    return load_config()


def set_active_profile(profile_key: str, config: dict | None = None) -> dict:
    config = normalize_config(dict(config or load_config()))
    profile_key = normalize_profile_key(profile_key)
    if profile_key not in config.get("profiles", []):
        config["profiles"].append(profile_key)
    config.setdefault("profile_dirs", {})[profile_key] = str(profile_user_data_dir(profile_key))
    config["profile_key"] = profile_key
    config["user_data_dir"] = str(profile_user_data_dir(profile_key))
    save_config(config)
    return load_config()


def clear_browser_profile(profile_key: str) -> str:
    ensure_dirs()
    target = _safe_profile_path(profile_key)
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    return str(target)


def remove_local_profile(profile_key: str, delete_browser_data: bool = False) -> dict:
    config = normalize_config(load_config())
    profile_key = normalize_profile_key(profile_key)
    config["profiles"] = [p for p in config.get("profiles", []) if p != profile_key]
    config.get("profile_dirs", {}).pop(profile_key, None)
    if delete_browser_data:
        clear_browser_profile(profile_key)
    if config.get("profile_key") == profile_key:
        config["profile_key"] = config["profiles"][0] if config["profiles"] else ""
    if config.get("profile_key"):
        config["user_data_dir"] = str(profile_user_data_dir(config["profile_key"]))
    else:
        config["user_data_dir"] = ""
    save_config(config)
    return load_config()


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
    profile_key = normalize_profile_key(profile_key)
    src = _safe_profile_path(profile_key)
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
    profile_key = normalize_profile_key(profile_key)
    target = _safe_profile_path(profile_key)
    if target.exists():
        backup = BACKUP_DIR / f"{profile_key}-before-restore.zip"
        export_browser_profile(profile_key, str(backup))
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "r") as zf:
        zf.extractall(target)
    return str(target)
