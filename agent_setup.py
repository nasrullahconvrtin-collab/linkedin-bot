"""
First-run setup wizard for LinkedFlow Agent.

Run:
    py agent_setup.py
"""
from agent_config import DEFAULT_CONFIG, load_config, save_config, ensure_dirs


def ask(label, current):
    value = input(f"{label} [{current}]: ").strip()
    return value or current


def main():
    ensure_dirs()
    config = load_config()
    print("\nLinkedFlow Agent setup")
    print("----------------------")
    config["backend_url"] = ask("Backend URL", config.get("backend_url") or DEFAULT_CONFIG["backend_url"])
    config["ws_base_url"] = ask("WebSocket base URL", config.get("ws_base_url") or DEFAULT_CONFIG["ws_base_url"])
    config["profile_key"] = ask("Profile key", config.get("profile_key") or "profile_1")
    default_profile = f"D:\\LinkedFlowAgent\\profiles\\{config['profile_key']}"
    config["user_data_dir"] = ask("Isolated browser profile folder", config.get("user_data_dir") or default_profile)
    config["auto_start"] = ask("Auto-start on Windows login? (true/false)", str(config.get("auto_start", True))).lower() == "true"
    config["minimized_on_launch"] = ask("Start browser minimized? (true/false)", str(config.get("minimized_on_launch", True))).lower() == "true"
    save_config(config)
    print(f"\nSaved config to D:\\LinkedFlowAgent\\config.json")
    print("Next: run `py agent_listener.py` or `py agent_tray.py`.")


if __name__ == "__main__":
    main()
