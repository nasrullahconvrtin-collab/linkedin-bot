import json
import os
import threading
import tkinter as tk
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path
from tkinter import messagebox, ttk

from agent_config import (
    AGENT_HOME,
    CONFIG_FILE,
    LOG_DIR,
    PROFILE_DIR,
    clear_browser_profile,
    is_paused,
    load_config,
    profile_user_data_dir,
    read_state,
    save_config,
    set_active_profile,
    set_paused,
)


DASHBOARD_URL = "https://linkedflow-dashboard.vercel.app"
BG = "#0a0a0a"
SURFACE = "#111111"
CARD = "#1a1a1a"
BORDER = "#2a2a2a"
PRIMARY = "#6366f1"
TEXT = "#ffffff"
TEXT_2 = "#9ca3af"
MUTED = "#6b7280"
SUCCESS = "#22c55e"
WARNING = "#f59e0b"
ERROR = "#ef4444"
GUI_LOG = LOG_DIR / "gui.log"


def log_gui(message):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with GUI_LOG.open("a", encoding="utf-8") as f:
        f.write(f"{datetime.now().isoformat()} {message.rstrip()}\n")


class AgentApi:
    def __init__(self, backend_url: str):
        self.backend_url = backend_url.rstrip("/")

    def request(self, method: str, path: str, body: dict | None = None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{self.backend_url}{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}


def fmt_time(value):
    if not value:
        return "Never"
    try:
        clean = str(value).replace("Z", "+00:00")
        return datetime.fromisoformat(clean).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(value)


class ControlPanel:
    def __init__(self, tray_app):
        log_gui("Starting LinkedFlow Agent control panel")
        self.tray_app = tray_app
        self.config = load_config()
        self.api = AgentApi(self.config.get("backend_url", ""))
        self.profiles = []
        self.jobs = []
        self.health = {}
        self.active_page = "Overview"
        self.root = tk.Tk()
        self.root.title("LinkedFlow Agent")
        self.root.geometry("1120x720")
        self.root.minsize(980, 640)
        self.root.configure(bg=BG)
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        log_gui("Tk root created")

        self.style = ttk.Style()
        self.style.theme_use("clam")
        self.style.configure("Treeview", background=CARD, foreground=TEXT, fieldbackground=CARD, bordercolor=BORDER, rowheight=28)
        self.style.configure("Treeview.Heading", background=SURFACE, foreground=TEXT, bordercolor=BORDER)

        self.status_vars = {
            "agent": tk.StringVar(value="Offline"),
            "backend": tk.StringVar(value="Checking"),
            "profile": tk.StringVar(value=self.config.get("profile_key", "profile_1")),
        }
        self.content = None
        self.build_shell()
        self.refresh_all()
        log_gui("Control panel initialized")

    def build_shell(self):
        top = tk.Frame(self.root, bg=SURFACE, height=54, highlightbackground=BORDER, highlightthickness=1)
        top.pack(side="top", fill="x")
        tk.Label(top, text="LinkedFlow Agent", bg=SURFACE, fg=TEXT, font=("Segoe UI", 14, "bold")).pack(side="left", padx=18)
        self.top_status = tk.Label(
            top,
            textvariable=tk.StringVar(),
            bg=SURFACE,
            fg=TEXT_2,
            font=("Segoe UI", 10),
        )
        self.top_status.pack(side="left", padx=8)

        body = tk.Frame(self.root, bg=BG)
        body.pack(fill="both", expand=True)
        nav = tk.Frame(body, bg=SURFACE, width=210, highlightbackground=BORDER, highlightthickness=1)
        nav.pack(side="left", fill="y")
        nav.pack_propagate(False)

        for name in ["Overview", "Accounts", "Activity", "Settings", "Logs", "Runtime Options"]:
            btn = tk.Button(
                nav,
                text=name,
                anchor="w",
                command=lambda n=name: self.show_page(n),
                bg=SURFACE,
                fg=TEXT_2,
                activebackground=CARD,
                activeforeground=TEXT,
                relief="flat",
                font=("Segoe UI", 10, "bold"),
                padx=18,
                pady=12,
            )
            btn.pack(fill="x", padx=8, pady=2)

        self.content = tk.Frame(body, bg=BG)
        self.content.pack(side="left", fill="both", expand=True)
        self.show_page("Overview")

    def show(self):
        log_gui("Showing control panel")
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def run(self):
        self.root.mainloop()

    def on_close(self):
        if load_config().get("minimize_to_tray", True):
            self.root.withdraw()
            return
        self.tray_app.exit()

    def destroy_content(self):
        for child in self.content.winfo_children():
            child.destroy()

    def show_page(self, page):
        self.active_page = page
        self.destroy_content()
        getattr(self, f"page_{page.lower().replace(' ', '_')}")()

    def card(self, parent, title, value, color=TEXT):
        frame = tk.Frame(parent, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        tk.Label(frame, text=title, bg=CARD, fg=MUTED, font=("Segoe UI", 9)).pack(anchor="w", padx=14, pady=(12, 2))
        tk.Label(frame, text=value, bg=CARD, fg=color, font=("Segoe UI", 18, "bold")).pack(anchor="w", padx=14, pady=(0, 12))
        return frame

    def button(self, parent, text, command, disabled=False):
        return tk.Button(
            parent,
            text=text,
            command=command,
            state="disabled" if disabled else "normal",
            bg=PRIMARY if not disabled else BORDER,
            fg=TEXT if not disabled else MUTED,
            activebackground="#4f46e5",
            activeforeground=TEXT,
            relief="flat",
            padx=14,
            pady=8,
            font=("Segoe UI", 9, "bold"),
        )

    def update_top_status(self):
        state = read_state()
        connected = bool(state.get("connected")) or bool(self.health.get("agents_connected"))
        backend = "Backend OK" if self.health.get("status") == "ok" else "Backend offline"
        profile = self.config.get("profile_key", "profile_1")
        text = f"· {'Connected' if connected else 'Offline'} · {backend} · {profile}"
        self.top_status.configure(text=text, fg=SUCCESS if connected else ERROR)

    def refresh_all(self):
        def load():
            config = load_config()
            api = AgentApi(config.get("backend_url", ""))
            profiles, jobs, health = [], [], {}
            try:
                profiles = api.request("GET", "/profiles")
            except Exception:
                pass
            try:
                jobs = api.request("GET", "/jobs?limit=100").get("jobs", [])
            except Exception:
                pass
            try:
                health = api.request("GET", "/health")
            except Exception:
                pass
            self.root.after(0, lambda: self.apply_data(config, profiles, jobs, health))

        threading.Thread(target=load, daemon=True).start()

    def apply_data(self, config, profiles, jobs, health):
        self.config = config
        self.api = AgentApi(config.get("backend_url", ""))
        self.profiles = profiles or []
        self.jobs = jobs or []
        self.health = health or {}
        self.update_top_status()
        self.show_page(self.active_page)
        self.root.after(30000, self.refresh_all)

    def page_overview(self):
        state = read_state()
        connected = bool(state.get("connected")) or bool(self.health.get("agents_connected"))
        pending = len([j for j in self.jobs if j.get("status") in ("pending", "retrying")])
        running = len([j for j in self.jobs if j.get("status") in ("claimed", "running")])
        failed = len([j for j in self.jobs if j.get("status") == "failed"])
        current = state.get("current_job_type") or "None"

        grid = tk.Frame(self.content, bg=BG)
        grid.pack(fill="x", padx=22, pady=22)
        values = [
            ("Agent status", "Connected" if connected else "Offline", SUCCESS if connected else ERROR),
            ("Backend", "Connected" if self.health.get("status") == "ok" else "Offline", SUCCESS if self.health.get("status") == "ok" else ERROR),
            ("Active profile", self.config.get("profile_key", "profile_1"), TEXT),
            ("Last heartbeat", fmt_time(state.get("last_heartbeat") or state.get("last_connected")), TEXT),
            ("Pending jobs", str(pending), WARNING if pending else TEXT),
            ("Running jobs", str(running), PRIMARY if running else TEXT),
            ("Failed jobs", str(failed), ERROR if failed else TEXT),
            ("Current task", current, TEXT),
        ]
        for idx, item in enumerate(values):
            c = self.card(grid, *item)
            c.grid(row=idx // 4, column=idx % 4, sticky="ew", padx=6, pady=6)
            grid.grid_columnconfigure(idx % 4, weight=1)

        actions = tk.Frame(self.content, bg=BG)
        actions.pack(anchor="w", padx=22, pady=8)
        for text, command in [
            ("Start Agent", self.tray_app.start_agent),
            ("Stop Agent", self.tray_app.stop_agent),
            ("Open Dashboard", self.tray_app.open_dashboard),
            ("Open Logs", self.tray_app.open_logs),
            ("Refresh", self.refresh_all),
        ]:
            self.button(actions, text, command).pack(side="left", padx=6)

    def page_accounts(self):
        header = tk.Frame(self.content, bg=BG)
        header.pack(fill="x", padx=22, pady=(22, 10))
        tk.Label(header, text="LinkedIn Accounts", bg=BG, fg=TEXT, font=("Segoe UI", 16, "bold")).pack(side="left")
        self.button(header, "Refresh Status", self.refresh_all).pack(side="right")

        cols = ("profile", "display", "online", "login", "activity", "job", "folder")
        tree = ttk.Treeview(self.content, columns=cols, show="headings", height=12)
        headings = {
            "profile": "profile_key",
            "display": "Display name",
            "online": "Online",
            "login": "Login",
            "activity": "Last activity",
            "job": "Current job",
            "folder": "Profile folder",
        }
        widths = {"profile": 110, "display": 150, "online": 80, "login": 110, "activity": 140, "job": 130, "folder": 310}
        for col in cols:
            tree.heading(col, text=headings[col])
            tree.column(col, width=widths[col], anchor="w")
        tree.pack(fill="both", expand=True, padx=22, pady=8)

        state = read_state()
        configured = set(self.config.get("profiles") or [self.config.get("profile_key", "profile_1")])
        backend_profiles = {p.get("profile_key"): p for p in self.profiles}
        for profile_key in sorted(configured | set(backend_profiles)):
            p = backend_profiles.get(profile_key, {})
            folder = str(profile_user_data_dir(profile_key))
            current_job = next((j.get("job_type") for j in self.jobs if j.get("profile_key") == profile_key and j.get("status") in ("claimed", "running")), "None")
            login = "Login required" if state.get("state") == "Needs LinkedIn Login" and profile_key == self.config.get("profile_key") else "Unknown"
            if Path(folder).exists():
                login = "Stored locally" if login == "Unknown" else login
            tree.insert("", "end", values=(
                profile_key,
                p.get("display_name") or profile_key,
                "Online" if p.get("session_active") else "Offline",
                login,
                fmt_time(p.get("last_active")),
                current_job,
                folder,
            ))

        actions = tk.Frame(self.content, bg=BG)
        actions.pack(anchor="w", padx=22, pady=12)
        self.button(actions, "Open Browser", self.tray_app.start_agent).pack(side="left", padx=6)
        self.button(actions, "Test Login", lambda: messagebox.showinfo("LinkedFlow Agent", read_state().get("state", "Unknown"))).pack(side="left", padx=6)
        self.button(actions, "Open Profile Folder", lambda: self.open_selected_profile_folder(tree)).pack(side="left", padx=6)
        self.button(actions, "Clear Session", lambda: self.clear_selected_profile_session(tree)).pack(side="left", padx=6)
        self.button(actions, "Reset Account", lambda: self.reset_selected_profile(tree)).pack(side="left", padx=6)
        self.button(actions, "Add LinkedIn Account", lambda: messagebox.showinfo("Coming soon", "Add account setup will be added next. Add profiles in the web dashboard for now.")).pack(side="left", padx=6)
        self.button(actions, "Remove/Disable Account", lambda: messagebox.showinfo("Coming soon", "Account disable/remove is managed in the dashboard for now.")).pack(side="left", padx=6)

    def selected_profile_key(self, tree):
        selected = tree.selection()
        if not selected:
            messagebox.showwarning("LinkedFlow Agent", "Select a LinkedIn account first.")
            return None
        return tree.item(selected[0], "values")[0]

    def open_selected_profile_folder(self, tree):
        profile_key = self.selected_profile_key(tree)
        if not profile_key:
            return
        folder = profile_user_data_dir(profile_key)
        folder.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(str(folder))
        else:
            webbrowser.open(str(folder))

    def clear_selected_profile_session(self, tree):
        profile_key = self.selected_profile_key(tree)
        if not profile_key:
            return
        if not messagebox.askyesno(
            "Clear LinkedIn session",
            f"Delete local browser cookies/session for {profile_key}? This only affects this profile folder and LinkedIn will require login again.",
        ):
            return
        if profile_key == self.config.get("profile_key") and self.tray_app.is_running():
            self.tray_app.stop_agent()
        clear_browser_profile(profile_key)
        messagebox.showinfo("LinkedFlow Agent", f"Cleared local session for {profile_key}.")
        self.refresh_all()

    def reset_selected_profile(self, tree):
        profile_key = self.selected_profile_key(tree)
        if not profile_key:
            return
        if not messagebox.askyesno(
            "Reset LinkedIn account",
            f"Reset {profile_key}? The local browser profile will be cleared and this account will require LinkedIn login again.",
        ):
            return
        if profile_key == self.config.get("profile_key") and self.tray_app.is_running():
            self.tray_app.stop_agent()
        clear_browser_profile(profile_key)
        messagebox.showinfo("LinkedFlow Agent", f"Reset complete for {profile_key}.")
        self.refresh_all()

    def page_activity(self):
        header = tk.Frame(self.content, bg=BG)
        header.pack(fill="x", padx=22, pady=(22, 10))
        tk.Label(header, text="Activity / Jobs", bg=BG, fg=TEXT, font=("Segoe UI", 16, "bold")).pack(side="left")
        self.button(header, "Refresh", self.refresh_all).pack(side="right")

        cols = ("type", "prospect", "campaign", "profile", "status", "scheduled", "started", "completed", "result")
        tree = ttk.Treeview(self.content, columns=cols, show="headings", height=16)
        for col in cols:
            tree.heading(col, text=col.replace("_", " ").title())
            tree.column(col, width=120 if col != "result" else 220, anchor="w")
        tree.pack(fill="both", expand=True, padx=22, pady=8)
        for job in self.jobs:
            result = job.get("error_message") or (job.get("result") or {}).get("message") or job.get("status")
            tree.insert("", "end", iid=job.get("id"), values=(
                job.get("job_type"),
                job.get("prospect_id") or "",
                job.get("campaign_id") or "",
                job.get("profile_key") or "",
                job.get("status") or "",
                fmt_time(job.get("scheduled_for")),
                fmt_time(job.get("started_at")),
                fmt_time(job.get("completed_at")),
                str(result)[:160],
            ))

        actions = tk.Frame(self.content, bg=BG)
        actions.pack(anchor="w", padx=22, pady=12)
        self.button(actions, "Retry Failed Job", lambda: self.retry_selected_job(tree)).pack(side="left", padx=6)
        self.button(actions, "Cancel Pending Job", lambda: self.cancel_selected_job(tree)).pack(side="left", padx=6)
        self.button(actions, "Refresh", self.refresh_all).pack(side="left", padx=6)

    def selected_job(self, tree):
        selected = tree.selection()
        if not selected:
            messagebox.showwarning("LinkedFlow Agent", "Select a job first.")
            return None
        job_id = selected[0]
        return next((j for j in self.jobs if j.get("id") == job_id), None)

    def retry_selected_job(self, tree):
        job = self.selected_job(tree)
        if not job:
            return
        if job.get("status") != "failed":
            messagebox.showinfo("LinkedFlow Agent", "Only failed jobs can be retried from here.")
            return
        payload = {
            "job_type": job.get("job_type"),
            "profile_key": job.get("profile_key") or self.config.get("profile_key", "profile_1"),
            "campaign_id": job.get("campaign_id"),
            "prospect_id": job.get("prospect_id"),
            "priority": job.get("priority") or 5,
            "payload": job.get("payload") or {},
            "max_retries": job.get("max_retries") or 3,
        }
        try:
            self.api.request("POST", "/jobs", payload)
            messagebox.showinfo("LinkedFlow Agent", "Retry job queued.")
            self.refresh_all()
        except Exception as exc:
            messagebox.showerror("LinkedFlow Agent", str(exc))

    def cancel_selected_job(self, tree):
        job = self.selected_job(tree)
        if not job:
            return
        if job.get("status") not in ("pending", "retrying"):
            messagebox.showinfo("LinkedFlow Agent", "Only pending/retrying jobs can be cancelled safely.")
            return
        try:
            self.api.request("POST", f"/jobs/{job.get('id')}/cancel")
            messagebox.showinfo("LinkedFlow Agent", "Job cancelled.")
            self.refresh_all()
        except Exception as exc:
            messagebox.showerror("LinkedFlow Agent", str(exc))

    def page_settings(self):
        frame = tk.Frame(self.content, bg=BG)
        frame.pack(fill="both", expand=True, padx=22, pady=22)
        tk.Label(frame, text="Settings", bg=BG, fg=TEXT, font=("Segoe UI", 16, "bold")).pack(anchor="w")
        fields = {}
        rows = [
            ("Active profile key", "profile_key"),
            ("Profile display name", "display_name"),
            ("Backend URL", "backend_url"),
            ("Agent token / API key", "agent_token"),
            ("Job polling interval", "job_polling_interval"),
            ("Logs folder", "logs_folder"),
            ("Browser profile directory", "browser_dir"),
        ]
        values = {
            "backend_url": self.config.get("backend_url", ""),
            "profile_key": self.config.get("profile_key", "profile_1"),
            "display_name": self.config.get("display_name", self.config.get("profile_key", "profile_1")),
            "agent_token": self.config.get("agent_token", ""),
            "job_polling_interval": str(self.config.get("job_polling_interval", 15)),
            "logs_folder": str(LOG_DIR),
            "browser_dir": str(PROFILE_DIR),
        }
        for label, key in rows:
            row = tk.Frame(frame, bg=BG)
            row.pack(fill="x", pady=8)
            tk.Label(row, text=label, bg=BG, fg=TEXT_2, width=24, anchor="w").pack(side="left")
            entry = tk.Entry(row, bg=CARD, fg=TEXT, insertbackground=TEXT, relief="flat", highlightbackground=BORDER, highlightthickness=1)
            entry.insert(0, values[key])
            entry.pack(side="left", fill="x", expand=True, ipady=8)
            fields[key] = entry

        checks = {}
        for label, key in [
            ("Start with Windows", "start_with_windows"),
            ("Run in background / minimize to tray", "minimize_to_tray"),
        ]:
            var = tk.BooleanVar(value=bool(self.config.get(key, True)))
            tk.Checkbutton(frame, text=label, variable=var, bg=BG, fg=TEXT_2, selectcolor=CARD, activebackground=BG, activeforeground=TEXT).pack(anchor="w", pady=4)
            checks[key] = var

        def save():
            config = load_config()
            config = set_active_profile(fields["profile_key"].get().strip() or "profile_1", config)
            config["display_name"] = fields["display_name"].get().strip() or config["profile_key"]
            config["backend_url"] = fields["backend_url"].get().strip()
            config["agent_token"] = fields["agent_token"].get().strip()
            try:
                config["job_polling_interval"] = max(5, int(fields["job_polling_interval"].get().strip()))
            except ValueError:
                config["job_polling_interval"] = 15
            for key, var in checks.items():
                config[key] = bool(var.get())
            save_config(config)
            self.config = config
            try:
                self.api.request("PUT", f"/profiles/{config['profile_key']}", {
                    "display_name": config["display_name"],
                    "enabled": True,
                })
            except Exception:
                try:
                    self.api.request("POST", "/profiles", {
                        "profile_key": config["profile_key"],
                        "display_name": config["display_name"],
                    })
                except Exception as exc:
                    messagebox.showwarning("LinkedFlow Agent", f"Local settings saved, but dashboard profile sync failed: {exc}")
            messagebox.showinfo("LinkedFlow Agent", "Settings saved. Restart the agent worker for polling changes.")
            self.refresh_all()

        actions = tk.Frame(frame, bg=BG)
        actions.pack(anchor="w", pady=14)
        self.button(actions, "Save Settings", save).pack(side="left", padx=6)
        self.button(actions, "Check for Updates", lambda: messagebox.showinfo("LinkedFlow Agent", "Update checking is coming soon.")).pack(side="left", padx=6)

    def page_logs(self):
        frame = tk.Frame(self.content, bg=BG)
        frame.pack(fill="both", expand=True, padx=22, pady=22)
        top = tk.Frame(frame, bg=BG)
        top.pack(fill="x")
        tk.Label(top, text="Logs", bg=BG, fg=TEXT, font=("Segoe UI", 16, "bold")).pack(side="left")
        self.button(top, "Open Logs Folder", self.tray_app.open_logs).pack(side="right", padx=6)
        text = tk.Text(frame, bg=CARD, fg=TEXT_2, insertbackground=TEXT, relief="flat", highlightbackground=BORDER, highlightthickness=1, wrap="word")
        text.pack(fill="both", expand=True, pady=12)
        lines = self.latest_logs()
        for line in lines:
            tag = "error" if any(word in line.lower() for word in ["error", "failed", "exception"]) else "normal"
            text.insert("end", line, tag)
        text.tag_config("error", foreground=ERROR)
        text.tag_config("normal", foreground=TEXT_2)
        self.button(frame, "Copy Logs", lambda: self.copy_logs(text)).pack(anchor="w")

    def latest_logs(self):
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        files = sorted(LOG_DIR.glob("agent.log*"), key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)
        if not files:
            return ["No logs found.\n"]
        try:
            return files[0].read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)[-300:]
        except Exception as exc:
            return [f"Could not read logs: {exc}\n"]

    def copy_logs(self, text):
        self.root.clipboard_clear()
        self.root.clipboard_append(text.get("1.0", "end"))
        messagebox.showinfo("LinkedFlow Agent", "Logs copied.")

    def page_runtime_options(self):
        frame = tk.Frame(self.content, bg=BG)
        frame.pack(fill="both", expand=True, padx=22, pady=22)
        tk.Label(frame, text="Runtime Options", bg=BG, fg=TEXT, font=("Segoe UI", 16, "bold")).pack(anchor="w", pady=(0, 14))
        for title, body in [
            ("Proxy Settings", "Coming Soon. Future per-account proxy configuration will live here."),
            ("Run on Cloud", "Coming Soon. Future Windows VPS/cloud runner setup will live here."),
            ("Cloud Browser", "Coming Soon. Future hosted browser/session options will live here."),
        ]:
            card = tk.Frame(frame, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
            card.pack(fill="x", pady=8)
            tk.Label(card, text=title, bg=CARD, fg=TEXT, font=("Segoe UI", 13, "bold")).pack(anchor="w", padx=16, pady=(14, 4))
            tk.Label(card, text=body, bg=CARD, fg=TEXT_2, font=("Segoe UI", 10), wraplength=760, justify="left").pack(anchor="w", padx=16)
            self.button(card, "Coming Soon", lambda: None, disabled=True).pack(anchor="w", padx=16, pady=14)
