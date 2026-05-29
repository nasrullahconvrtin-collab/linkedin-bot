r"""
LinkedFlow Agent installer.

This script is packaged with PyInstaller into LinkedFlow-Agent-Setup.exe.
It installs LinkedFlowAgent.exe into C:\Program Files\LinkedFlow Agent,
creates Start Menu/Desktop shortcuts, and registers Windows login auto-start.
"""
import ctypes
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path


APP_NAME = "LinkedFlow Agent"
INSTALL_DIR = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / APP_NAME
START_MENU_DIR = Path(os.environ["APPDATA"]) / r"Microsoft\Windows\Start Menu\Programs\LinkedFlow"
DESKTOP = Path(os.environ["USERPROFILE"]) / "Desktop"
TASK_NAME = "LinkedFlow Agent"
LOG_FILE = Path(os.environ.get("TEMP", r"C:\Windows\Temp")) / "LinkedFlowAgentInstaller.log"


def log(message: str) -> None:
    with LOG_FILE.open("a", encoding="utf-8") as fh:
        fh.write(message + "\n")


def resource_path(name: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / name


def ps_quote(value: Path | str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def elevate_if_needed():
    if is_admin():
        return
    raise PermissionError("Installer must be run as administrator")


def create_shortcut(shortcut_path: Path, target: Path, working_dir: Path):
    if not target.exists():
        log(f"Shortcut skipped, target does not exist: {target}")
        return False
    ps = f"""
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut({ps_quote(shortcut_path)})
$Shortcut.TargetPath = {ps_quote(target)}
$Shortcut.WorkingDirectory = {ps_quote(working_dir)}
$Shortcut.IconLocation = {ps_quote(str(target) + ',0')}
$Shortcut.Save()
"""
    result = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.stdout:
        log(f"Shortcut stdout ({shortcut_path}): {result.stdout.strip()}")
    if result.stderr:
        log(f"Shortcut stderr ({shortcut_path}): {result.stderr.strip()}")
    if result.returncode != 0:
        log(f"Shortcut failed ({shortcut_path}) returncode={result.returncode}")
        return False
    log(f"Shortcut created: {shortcut_path}")
    return True


def register_startup(exe: Path):
    if not exe.exists():
        log(f"Startup registration skipped, target does not exist: {exe}")
        return False
    result = subprocess.run([
        "schtasks", "/Create",
        "/TN", TASK_NAME,
        "/TR", f'"{exe}"',
        "/SC", "ONLOGON",
        "/RL", "LIMITED",
        "/F",
    ], capture_output=True, text=True, check=False)
    if result.stdout:
        log(f"Startup stdout: {result.stdout.strip()}")
    if result.stderr:
        log(f"Startup stderr: {result.stderr.strip()}")
    if result.returncode != 0:
        log(f"Startup registration failed returncode={result.returncode}")
        return False
    log("Windows login auto-start registered.")
    return True


def main():
    try:
        log("LinkedFlow Agent installer started")
        log(f"Executable: {sys.executable}")
        log(f"Admin: {is_admin()}")
        elevate_if_needed()
        INSTALL_DIR.mkdir(parents=True, exist_ok=True)
        START_MENU_DIR.mkdir(parents=True, exist_ok=True)

        payload = resource_path("app_payload.zip")
        log(f"Payload: {payload}")
        if not payload.exists():
            raise FileNotFoundError("app_payload.zip missing from installer payload")

        if INSTALL_DIR.exists():
            shutil.rmtree(INSTALL_DIR)
        INSTALL_DIR.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(payload, "r") as zf:
            zf.extractall(INSTALL_DIR)

        exe_dst = INSTALL_DIR / "LinkedFlowAgent.exe"
        browsers_dst = INSTALL_DIR / "bundled_browsers" / "ms-playwright"
        if not exe_dst.exists():
            raise FileNotFoundError(f"Installed EXE missing: {exe_dst}")
        if not browsers_dst.exists():
            raise FileNotFoundError(f"Bundled Playwright browsers missing: {browsers_dst}")

        start_shortcut = create_shortcut(START_MENU_DIR / "LinkedFlow Agent.lnk", exe_dst, INSTALL_DIR)
        desktop_shortcut = create_shortcut(DESKTOP / "LinkedFlow Agent.lnk", exe_dst, INSTALL_DIR)
        startup = register_startup(exe_dst)

        log(f"Installed LinkedFlow Agent to {INSTALL_DIR}")
        log(f"Start Menu shortcut ok: {start_shortcut}")
        log(f"Desktop shortcut ok: {desktop_shortcut}")
        log(f"Windows login auto-start ok: {startup}")
    except Exception as exc:
        log(f"ERROR: {exc!r}")
        try:
            ctypes.windll.user32.MessageBoxW(None, str(exc), "LinkedFlow Agent Installer", 0x10)
        except Exception:
            pass
        raise


if __name__ == "__main__":
    main()
