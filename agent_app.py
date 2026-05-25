import argparse
import asyncio
import ctypes
import os
import sys
from pathlib import Path

_MUTEX_HANDLE = None


def _app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def configure_bundled_playwright() -> None:
    """Prefer Chromium bundled with the installed agent over user cache."""
    candidates = [
        _app_dir() / "bundled_browsers" / "ms-playwright",
    ]
    for path in candidates:
        if path.exists():
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(path)
            break


def acquire_single_instance(name: str) -> bool:
    """Return False when this tray/worker instance is already running."""
    global _MUTEX_HANDLE
    if os.name != "nt":
        return True
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    handle = kernel32.CreateMutexW(None, False, name)
    if not handle:
        return True
    _MUTEX_HANDLE = handle
    return ctypes.get_last_error() != 183


def main():
    configure_bundled_playwright()

    parser = argparse.ArgumentParser(description="LinkedFlow Agent")
    parser.add_argument("--worker", action="store_true", help="Run background worker instead of tray UI")
    parser.add_argument("--profile", default=None, help="LinkedIn profile key")
    parser.add_argument("--export-config", nargs="?", const="", help="Export local agent config JSON")
    parser.add_argument("--export-browser-backup", nargs="?", const="", help="Export local browser profile backup ZIP")
    parser.add_argument("--restore-browser-backup", help="Restore local browser profile backup ZIP")
    args = parser.parse_args()
    profile = args.profile or "profile_1"

    if args.export_config is not None:
        from agent_config import export_config

        print(export_config(args.export_config or None))
        return

    if args.export_browser_backup is not None:
        from agent_config import export_browser_profile

        print(export_browser_profile(profile, args.export_browser_backup or None))
        return

    if args.restore_browser_backup:
        from agent_config import restore_browser_profile

        print(restore_browser_profile(profile, args.restore_browser_backup))
        return

    if args.worker:
        if not acquire_single_instance(f"Global\\LinkedFlowAgentWorker_{profile}"):
            return
        from agent_listener import LinkedFlowAgent

        asyncio.run(LinkedFlowAgent(args.profile).run())
    else:
        if not acquire_single_instance("Global\\LinkedFlowAgentTray"):
            return
        from agent_tray import TrayApp

        TrayApp().run()


if __name__ == "__main__":
    main()
