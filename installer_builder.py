"""
Build-time helper that creates the installer payload folder.
"""
from pathlib import Path
import shutil
import zipfile


ROOT = Path(r"D:\linkedin-bot")
PAYLOAD = ROOT / "installer_payload"


def main():
    if PAYLOAD.exists():
        shutil.rmtree(PAYLOAD)
    PAYLOAD.mkdir(parents=True)

    app_dir = ROOT / "dist" / "LinkedFlowAgent"
    if not app_dir.exists():
        raise FileNotFoundError("dist/LinkedFlowAgent is missing. Run package_agent.ps1 first.")
    staging = PAYLOAD / "app"
    shutil.copytree(app_dir, staging)

    docs = ["AGENT_SERVICE_SETUP.md", "CLOUD_SOURCE_OF_TRUTH.md", "requirements.txt"]
    for rel in docs:
        src = ROOT / rel
        if src.exists():
            shutil.copy2(src, staging / Path(rel).name)

    zip_path = PAYLOAD / "app_payload.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in staging.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(staging))
    shutil.rmtree(staging)

    (PAYLOAD / "README.txt").write_text(
        "LinkedFlow Agent installer payload.\n"
        "Run LinkedFlow-Agent-Setup.exe to install into Program Files.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
