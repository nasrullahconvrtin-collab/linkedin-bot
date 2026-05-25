import os
from config import SESSION_DIR


def get_session_file(profile_key: str) -> str:
    os.makedirs(SESSION_DIR, exist_ok=True)
    return os.path.join(SESSION_DIR, f"{profile_key}.json")


def session_exists(profile_key: str) -> bool:
    return os.path.exists(get_session_file(profile_key))


async def load_session(browser, profile_key: str):
    """Return a browser context for the given profile, prompting login if needed."""
    session_file = get_session_file(profile_key)

    if os.path.exists(session_file):
        print(f"[session] Loading session for {profile_key}")
        context = await browser.new_context(storage_state=session_file)
    else:
        print(f"[session] No session for {profile_key} — please log in...")
        context = await browser.new_context()
        page = await context.new_page()
        await page.goto("https://www.linkedin.com/login", timeout=30000)
        print("Log in manually. You have 5 minutes...")
        await page.wait_for_url("**/feed/**", timeout=300000)
        await context.storage_state(path=session_file)
        print(f"[session] Session saved for {profile_key}")

    return context


async def save_session(context, profile_key: str):
    session_file = get_session_file(profile_key)
    await context.storage_state(path=session_file)
    print(f"[session] Session saved for {profile_key}")


def delete_session(profile_key: str):
    session_file = get_session_file(profile_key)
    if os.path.exists(session_file):
        os.remove(session_file)
        print(f"[session] Deleted session for {profile_key}")
