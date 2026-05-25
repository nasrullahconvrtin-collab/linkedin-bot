import asyncio
import os
from playwright.async_api import async_playwright

LINKEDIN_URL = "https://www.linkedin.com/in/goodness-chioma-armstrong-76b464242/"
SESSION_FILE = "linkedin_session.json"
NOTE         = ""

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=["--start-maximized"]
        )

        if os.path.exists(SESSION_FILE):
            print("✅ Session found — loading...")
            context = await browser.new_context(storage_state=SESSION_FILE)
        else:
            print("⚠️  No session — please log in...")
            context = await browser.new_context()
            page    = await context.new_page()
            await page.goto("https://www.linkedin.com/login", timeout=30000)
            print("Log in. You have 5 minutes...")
            await page.wait_for_url("**/feed/**", timeout=300000)
            await context.storage_state(path=SESSION_FILE)
            print("✅ Session saved!")

        page   = await context.new_page()
        result = await send_connection_request(page, LINKEDIN_URL, NOTE)

        print("\n" + "="*50)
        print(f"  RESULT: {result['status'].upper()}")
        print(f"  {result['message']}")
        print("="*50)

        await page.wait_for_timeout(3000)
        await browser.close()


async def send_connection_request(page, linkedin_url, note=""):
    print(f"\nOpening: {linkedin_url}")

    try:
        response = await page.goto(linkedin_url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(4000)
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(1000)

        # Session expired
        if "/login" in page.url or "/authwall" in page.url:
            if os.path.exists(SESSION_FILE):
                os.remove(SESSION_FILE)
            return {"status": "session_expired", "message": "Session expired — run again to re-login"}

        # Restricted
        if "checkpoint" in page.url or "verification" in page.url:
            return {"status": "restricted", "message": "Account needs verification — log in manually"}

        # 404
        if response and response.status == 404:
            return {"status": "not_found", "message": "Profile does not exist"}

        content = await page.content()

        if "This account has been deactivated" in content:
            return {"status": "not_found", "message": "Account deactivated"}

        if "profile is not available" in content:
            return {"status": "private", "message": "Profile is private or unavailable"}

        if "weekly invitation limit" in content.lower():
            return {"status": "limit_reached", "message": "Weekly limit reached — try next week"}

        # Already pending
        pending = await page.evaluate("""
            () => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    if (btn.textContent.trim() === 'Pending') return true;
                }
                return false;
            }
        """)
        if pending:
            return {"status": "pending", "message": "Request already sent and pending"}

        # Already connected
        connected = await page.evaluate("""
            () => {
                const sections = document.querySelectorAll('.pv-top-card, .ph5');
                for (const section of sections) {
                    const btns = section.querySelectorAll('button');
                    for (const btn of btns) {
                        if (btn.textContent.trim() === 'Message') return true;
                    }
                }
                return false;
            }
        """)
        if connected:
            return {"status": "connected", "message": "Already connected"}

        # Method 1: Direct Connect button
        print("Trying direct Connect button...")
        direct = await page.evaluate("""
            () => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    if (btn.textContent.trim() === 'Connect') {
                        btn.click();
                        return true;
                    }
                }
                return false;
            }
        """)

        if direct:
            print("✅ Clicked direct Connect")
            await page.wait_for_timeout(2000)
            return await handle_dialog(page, note)

        # Method 2: More dropdown
        print("Trying More dropdown...")
        more = await page.evaluate("""
            () => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    if (btn.textContent.trim() === 'More') {
                        btn.click();
                        return true;
                    }
                }
                return false;
            }
        """)

        if more:
            await page.wait_for_timeout(2000)
            connect_in_dropdown = await page.evaluate("""
                () => {
                    const all = document.querySelectorAll('*');
                    for (const el of all) {
                        if (el.textContent.trim() === 'Connect' && el.children.length === 0) {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                }
            """)

            if connect_in_dropdown:
                print("✅ Clicked Connect in dropdown")
                await page.wait_for_timeout(2000)
                return await handle_dialog(page, note)

        return {"status": "cannot_connect", "message": "No Connect button found"}

    except Exception as e:
        err = str(e)
        if "Timeout" in err:
            return {"status": "error", "message": "Page timed out — try again"}
        return {"status": "error", "message": err[:200]}


async def handle_dialog(page, note=""):
    await page.wait_for_timeout(2000)

    content = await page.content()
    if "weekly invitation limit" in content.lower():
        return {"status": "limit_reached", "message": "Weekly limit reached"}

    if note and note.strip():
        add_note = await page.evaluate("""
            () => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    if (btn.textContent.trim() === 'Add a note') {
                        btn.click();
                        return true;
                    }
                }
                return false;
            }
        """)
        if add_note:
            await page.wait_for_timeout(1000)
            note_input = page.locator('textarea[name="message"]').first
            if await note_input.count() > 0:
                await note_input.fill(note[:300])

    sent = await page.evaluate("""
        () => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const txt = btn.textContent.trim();
                if (txt === 'Send without a note' || txt === 'Send' || txt === 'Done') {
                    btn.click();
                    return txt;
                }
            }
            return null;
        }
    """)

    if sent:
        return {"status": "sent", "message": f"Connection request sent"}

    await page.screenshot(path="debug_dialog.png")
    return {"status": "error", "message": "Send button not found — check debug_dialog.png"}


asyncio.run(main())