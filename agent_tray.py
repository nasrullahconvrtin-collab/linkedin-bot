"""
LinkedFlow Windows tray app.

Run:
    py agent_tray.py

For packaging later:
    pyinstaller --noconsole --onefile --name LinkedFlowAgent agent_tray.py
"""
import os
import subprocess
import sys
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

    def exit(self, *_):
        self.stop_agent()
        self.icon.stop()

    def menu(self):
        return pystray.Menu(
            pystray.MenuItem(lambda _: self.status_text(), None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Start Agent", self.start_agent, enabled=lambda _: not self.is_running()),
            pystray.MenuItem("Stop Agent", self.stop_agent, enabled=lambda _: self.is_running()),
            pystray.MenuItem("Pause Jobs", self.pause, enabled=lambda _: not is_paused()),
            pystray.MenuItem("Resume Jobs", self.resume, enabled=lambda _: is_paused()),
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
