"""
LinkedFlow Windows tray app.

Run:
    py agent_tray.py

For packaging later:
    pyinstaller --noconsole --onefile --name LinkedFlowAgent agent_tray.py
"""
import os
import json
import subprocess
import sys
import urllib.request
import webbrowser
from pathlib import Path

import pystray
from PIL import Image, ImageDraw

from agent_config import (
    BACKUP_DIR,
    LOG_DIR,
    export_browser_profile,
    export_config,
    read_state,
    set_paused,
    is_paused,
    load_config,
    save_config,
)


ROOT = Path(__file__).resolve().parent
DASHBOARD_URL = "https://linkedflow-dashboard.vercel.app"


class TrayApp:
    def __init__(self):
        self.proc = None
        self.config = load_config()
        self.icon = pystray.Icon(
            "LinkedFlow",
            self.make_icon("#6366f1"),
            "LinkedFlow Agent",
            self.menu(),
        )

    def make_icon(self, color):
        img = Image.new("RGB", (64, 64), "#111111")
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((10, 10, 54, 54), radius=12, fill=color)
        d.polygon([(34, 14), (20, 36), (32, 34), (28, 50), (46, 25), (34, 28)], fill="white")
        return img

    def is_running(self):
        return self.proc is not None and self.proc.poll() is None

    def start_agent(self, *_):
        if self.is_running():
            return
        profile = self.config.get("profile_key", "profile_1")
        creationflags = 0
        if os.name == "nt":
            creationflags = subprocess.CREATE_NO_WINDOW
        if getattr(sys, "frozen", False):
            cmd = [sys.executable, "--worker", "--profile", profile]
        else:
            cmd = [sys.executable, str(ROOT / "agent_app.py"), "--worker", "--profile", profile]
        self.proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            creationflags=creationflags,
        )
        self.refresh_menu()

    def stop_agent(self, *_):
        if self.is_running():
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None
        self.refresh_menu()

    def pause(self, *_):
        set_paused(True)
        self.refresh_menu()

    def resume(self, *_):
        set_paused(False)
        self.refresh_menu()

    def open_logs(self, *_):
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(str(LOG_DIR))
        else:
            webbrowser.open(str(LOG_DIR))

    def backup_config(self, *_):
        export_config()
        self.open_backups()

    def backup_browser_profile(self, *_):
        profile = self.config.get("profile_key", "profile_1")
        export_browser_profile(profile)
        self.open_backups()

    def open_backups(self, *_):
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(str(BACKUP_DIR))
        else:
            webbrowser.open(str(BACKUP_DIR))

    def open_dashboard(self, *_):
        webbrowser.open(DASHBOARD_URL)

    def status_text(self, _=None):
        state = read_state()
        app_state = state.get("state", "Offline")
        paused = "Paused" if is_paused() else "Active"
        running = "Worker running" if self.is_running() else "Worker stopped"
        return f"{app_state} · {paused} · {running}"

    def refresh_menu(self):
        self.icon.menu = self.menu()
        self.icon.update_menu()

    def notify(self, title, message):
        try:
            self.icon.notify(message, title)
        except Exception:
            pass

    def local_profiles(self):
        profiles = self.config.get("profiles") or [self.config.get("profile_key", "profile_1")]
        return sorted({p for p in profiles if p})

    def backend_profiles(self):
        try:
            url = f"{self.config.get('backend_url', '').rstrip('/')}/profiles"
            with urllib.request.urlopen(url, timeout=8) as resp:
                return json.loads(resp.read().decode("utf-8")) or []
        except Exception:
            return []

    def profile_label(self, profile_key):
        state = read_state()
        current = self.config.get("profile_key", "profile_1")
        online = state.get("connected") and profile_key == current
        marker = "online" if online else "configured"
        if profile_key == current:
            marker = f"current, {marker}"
        return f"{profile_key} ({marker})"

    def switch_profile(self, profile_key):
        if profile_key == self.config.get("profile_key"):
            return
        was_running = self.is_running()
        if was_running:
            self.stop_agent()
        self.config["profile_key"] = profile_key
        self.config["user_data_dir"] = str(Path(self.config.get("user_data_dir", "")).parent / profile_key)
        profiles = set(self.config.get("profiles") or [])
        profiles.add(profile_key)
        self.config["profiles"] = sorted(profiles)
        save_config(self.config)
        if was_running:
            self.start_agent()
        self.notify("LinkedFlow Agent", f"Switched to {profile_key}")
        self.refresh_menu()

    def add_account_placeholder(self, *_):
        self.notify("LinkedFlow Agent", "Add account setup is coming soon. Add profiles in the web dashboard for now.")

    def proxy_placeholder(self, *_):
        self.notify("LinkedFlow Agent", "Proxy settings are coming soon. No proxy was changed.")

    def cloud_placeholder(self, *_):
        self.notify("LinkedFlow Agent", "Cloud runner is coming soon. The agent is still running locally.")

    def exit(self, *_):
        self.stop_agent()
        self.icon.stop()

    def menu(self):
        account_items = [
            pystray.MenuItem(
                self.profile_label(profile_key),
                lambda *_, key=profile_key: self.switch_profile(key),
                checked=lambda *_, key=profile_key: key == self.config.get("profile_key", "profile_1"),
            )
            for profile_key in self.local_profiles()
        ]
        backend_items = [
            pystray.MenuItem(
                f"{p.get('profile_key')} - {'online' if p.get('session_active') else 'offline'}",
                None,
                enabled=False,
            )
            for p in self.backend_profiles()
            if p.get("profile_key") not in self.local_profiles()
        ]
        if backend_items:
            account_items.extend([pystray.Menu.SEPARATOR, *backend_items])
        account_items.extend([
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Add LinkedIn Account...", self.add_account_placeholder),
        ])

        return pystray.Menu(
            pystray.MenuItem(lambda _: self.status_text(), None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Accounts", pystray.Menu(*account_items)),
            pystray.MenuItem("Start Agent", self.start_agent, enabled=lambda _: not self.is_running()),
            pystray.MenuItem("Stop Agent", self.stop_agent, enabled=lambda _: self.is_running()),
            pystray.MenuItem("Pause Jobs", self.pause, enabled=lambda _: not is_paused()),
            pystray.MenuItem("Resume Jobs", self.resume, enabled=lambda _: is_paused()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Proxy Settings...", self.proxy_placeholder),
            pystray.MenuItem("Run on Cloud...", self.cloud_placeholder),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Backup Browser Profile", self.backup_browser_profile),
            pystray.MenuItem("Export Agent Config", self.backup_config),
            pystray.MenuItem("Open Backups", self.open_backups),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open Logs", self.open_logs),
            pystray.MenuItem("Open Dashboard", self.open_dashboard),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Exit", self.exit),
        )

    def run(self):
        if self.config.get("auto_start", True):
            self.start_agent()
        self.icon.run()


if __name__ == "__main__":
    TrayApp().run()
