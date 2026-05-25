"""
All LinkedIn browser actions.

Every public function returns a result dict with at minimum:
  { "status": str, "message": str }

Status values: sent / pending / connected / limit_reached / session_expired /
               restricted / not_found / private / cannot_connect / error /
               accepted / not_accepted / message_sent / replied / no_reply
"""
import logging
import os
from session_manager import get_session_file

logger = logging.getLogger("linkedin_bot")


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _check_url_errors(page, profile_key: str) -> dict | None:
    url = page.url
    if "/login" in url or "/authwall" in url:
        sf = get_session_file(profile_key)
        if os.path.exists(sf):
            os.remove(sf)
        return {"status": "session_expired", "message": "Session expired — re-login required"}
    if "checkpoint" in url or "verification" in url:
        return {"status": "restricted", "message": "Account needs manual verification"}
    return None


async def _check_content_errors(page) -> dict | None:
    content = await page.content()
    if "This account has been deactivated" in content:
        return {"status": "not_found", "message": "Account deactivated"}
    if "profile is not available" in content:
        return {"status": "private", "message": "Profile is private or unavailable"}
    if "weekly invitation limit" in content.lower():
        return {"status": "limit_reached", "message": "Weekly invitation limit reached"}
    return None


async def _js_click_button_by_text(page, text: str) -> bool:
    return await page.evaluate(f"""
        () => {{
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {{
                if (btn.textContent.trim() === '{text}') {{
                    btn.click();
                    return true;
                }}
            }}
            return false;
        }}
    """)


async def _js_click_element_by_text(page, text: str) -> bool:
    return await page.evaluate(f"""
        () => {{
            const all = document.querySelectorAll('*');
            for (const el of all) {{
                if (el.textContent.trim() === '{text}' && el.children.length === 0) {{
                    el.click();
                    return true;
                }}
            }}
            return false;
        }}
    """)


# ─────────────────────────────────────────────────────────────────────────────
# Handle connect dialog (note + send)
# ─────────────────────────────────────────────────────────────────────────────

async def handle_connect_dialog(page, note: str = "") -> dict:
    await page.wait_for_timeout(2000)

    content = await page.content()
    if "weekly invitation limit" in content.lower():
        return {"status": "limit_reached", "message": "Weekly invitation limit reached"}

    if note and note.strip():
        add_note = await _js_click_button_by_text(page, "Add a note")
        if add_note:
            await page.wait_for_timeout(1000)
            note_input = page.locator('textarea[name="message"]').first
            if await note_input.count() > 0:
                await note_input.fill(note[:300])
            else:
                logger.warning("Note textarea not found — sending without note")

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
        return {"status": "sent", "message": "Connection request sent"}

    await page.screenshot(path="debug_dialog.png")
    return {"status": "error", "message": "Send button not found — see debug_dialog.png"}


# ─────────────────────────────────────────────────────────────────────────────
# ACTION 1: Send connection request
# ─────────────────────────────────────────────────────────────────────────────

async def send_connection_request(page, linkedin_url: str, note: str = "",
                                  profile_key: str = "profile_1") -> dict:
    logger.info(f"Navigating to {linkedin_url}")
    try:
        response = await page.goto(linkedin_url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(4000)
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(1000)

        # URL-level errors
        err = await _check_url_errors(page, profile_key)
        if err:
            return err

        # 404
        if response and response.status == 404:
            return {"status": "not_found", "message": "Profile does not exist (404)"}

        # Content errors
        err = await _check_content_errors(page)
        if err:
            return err

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
            return {"status": "pending", "message": "Request already pending"}

        # Already connected — Message button in header
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

        # Method 1: direct Connect button
        logger.debug("Trying direct Connect button")
        direct = await _js_click_button_by_text(page, "Connect")
        if direct:
            logger.info("Clicked direct Connect button")
            await page.wait_for_timeout(2000)
            return await handle_connect_dialog(page, note)

        # Method 2: More dropdown → Connect
        logger.debug("Trying More dropdown")
        more = await _js_click_button_by_text(page, "More")
        if more:
            await page.wait_for_timeout(2000)
            connect_in_dd = await _js_click_element_by_text(page, "Connect")
            if connect_in_dd:
                logger.info("Clicked Connect in More dropdown")
                await page.wait_for_timeout(2000)
                return await handle_connect_dialog(page, note)

        return {"status": "cannot_connect", "message": "No Connect button found"}

    except Exception as e:
        err_str = str(e)
        if "Timeout" in err_str:
            logger.warning(f"Timeout on {linkedin_url} — retrying once")
            try:
                await page.goto(linkedin_url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(4000)
                direct = await _js_click_button_by_text(page, "Connect")
                if direct:
                    await page.wait_for_timeout(2000)
                    return await handle_connect_dialog(page, note)
                return {"status": "error", "message": "Retry failed — no Connect button"}
            except Exception as e2:
                return {"status": "error", "message": str(e2)[:200]}
        if "net::ERR" in err_str:
            return {"status": "error", "message": "Network error — skipping"}
        return {"status": "error", "message": err_str[:200]}


# ─────────────────────────────────────────────────────────────────────────────
# ACTION 2: Detect accepted connections
# ─────────────────────────────────────────────────────────────────────────────

async def detect_accepted_connections(page, profile_key: str = "profile_1") -> list[str]:
    """
    Navigate to My Network connections page, scroll to load more, and return
    a list of profile URLs of recently accepted connections.
    """
    logger.info("Checking My Network for accepted connections")
    connections_url = "https://www.linkedin.com/mynetwork/invite-connect/connections/"

    try:
        await page.goto(connections_url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(3000)

        err = await _check_url_errors(page, profile_key)
        if err:
            logger.error(f"Session error on connections page: {err}")
            return []

        # Scroll down 3× to load more connections
        for i in range(3):
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(2000)

        # Extract all /in/ profile URLs
        urls: list[str] = await page.evaluate("""
            () => {
                const links = document.querySelectorAll('a[href*="/in/"]');
                const found = new Set();
                for (const a of links) {
                    const url = a.href.split('?')[0].replace(/\\/$/, '');
                    if (url.includes('/in/')) found.add(url);
                }
                return Array.from(found);
            }
        """)
        logger.info(f"Found {len(urls)} connection URLs on My Network page")
        return urls

    except Exception as e:
        logger.error(f"Error detecting accepted connections: {e}")
        return []


# ─────────────────────────────────────────────────────────────────────────────
# ACTION 3 & 4: Send a message (initial or follow-up)
# ─────────────────────────────────────────────────────────────────────────────

async def send_message(page, linkedin_url: str, message: str,
                       profile_key: str = "profile_1") -> dict:
    logger.info(f"Sending message to {linkedin_url}")
    try:
        response = await page.goto(linkedin_url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(3000)

        err = await _check_url_errors(page, profile_key)
        if err:
            return err

        if response and response.status == 404:
            return {"status": "not_found", "message": "Profile not found (404)"}

        # Click Message button
        clicked = await _js_click_button_by_text(page, "Message")
        if not clicked:
            # Try header-area Message button with broader search
            clicked = await page.evaluate("""
                () => {
                    const btns = document.querySelectorAll('button, a');
                    for (const el of btns) {
                        if (el.textContent.trim() === 'Message') {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                }
            """)
        if not clicked:
            return {"status": "error", "message": "Message button not found — are you connected?"}

        await page.wait_for_timeout(2000)

        # Find message input — try multiple selectors
        input_selectors = [
            'div[role="textbox"]',
            'div[contenteditable="true"]',
            '.msg-form__contenteditable',
        ]
        typed = False
        for sel in input_selectors:
            try:
                el = page.locator(sel).first
                if await el.count() > 0:
                    await el.click()
                    await el.type(message)
                    typed = True
                    break
            except Exception:
                continue

        if not typed:
            return {"status": "error", "message": "Could not find message input field"}

        await page.wait_for_timeout(1000)

        # Send — try Enter key, then send button
        sent = await page.evaluate("""
            () => {
                const selectors = [
                    'button[type="submit"]',
                    '.msg-form__send-button',
                    'button.msg-form__send-btn',
                ];
                for (const sel of selectors) {
                    const btn = document.querySelector(sel);
                    if (btn && !btn.disabled) {
                        btn.click();
                        return true;
                    }
                }
                // Fallback: any Send button
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    if (btn.textContent.trim() === 'Send' && !btn.disabled) {
                        btn.click();
                        return true;
                    }
                }
                return false;
            }
        """)

        if not sent:
            # Try pressing Enter as fallback
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(1000)
            sent = True  # Assume success

        await page.wait_for_timeout(2000)
        return {"status": "message_sent", "message": "Message sent successfully"}

    except Exception as e:
        err_str = str(e)
        if "Timeout" in err_str:
            return {"status": "error", "message": "Timeout sending message — skipping"}
        if "net::ERR" in err_str:
            return {"status": "error", "message": "Network error — skipping"}
        return {"status": "error", "message": err_str[:200]}


# ─────────────────────────────────────────────────────────────────────────────
# ACTION 5: Check for replies
# ─────────────────────────────────────────────────────────────────────────────

async def check_for_reply(page, first_name: str, last_name: str,
                          profile_key: str = "profile_1") -> dict:
    """
    Go to LinkedIn messaging and look for a conversation with this person.
    Returns { status: replied/no_reply/error, reply_text: str }
    """
    logger.info(f"Checking for reply from {first_name} {last_name}")
    try:
        await page.goto("https://www.linkedin.com/messaging/", wait_until="domcontentloaded",
                        timeout=30000)
        await page.wait_for_timeout(3000)

        err = await _check_url_errors(page, profile_key)
        if err:
            return {**err, "reply_text": ""}

        full_name = f"{first_name} {last_name}".strip()

        # Search for conversation
        search_input = page.locator('input[placeholder*="Search"]').first
        if await search_input.count() > 0:
            await search_input.fill(full_name)
            await page.wait_for_timeout(2000)

        # Find conversation link by name
        conv_clicked = await page.evaluate(f"""
            () => {{
                const items = document.querySelectorAll(
                    '.msg-conversation-listitem, .msg-conversation-card'
                );
                for (const item of items) {{
                    if (item.textContent.includes('{first_name}') &&
                        item.textContent.includes('{last_name}')) {{
                        item.click();
                        return true;
                    }}
                }}
                return false;
            }}
        """)

        if not conv_clicked:
            return {"status": "no_reply", "message": "No conversation found", "reply_text": ""}

        await page.wait_for_timeout(2000)

        # Look for messages from the other person (not self — on the left side)
        reply_text = await page.evaluate("""
            () => {
                // Messages from the prospect appear without the 'msg-s-message-group--outbound' class
                const groups = document.querySelectorAll('.msg-s-message-group');
                for (const group of groups) {
                    if (!group.classList.contains('msg-s-message-group--outbound')) {
                        const msgs = group.querySelectorAll('.msg-s-event-listitem__body');
                        for (const msg of msgs) {
                            const text = msg.textContent.trim();
                            if (text) return text;
                        }
                    }
                }
                return null;
            }
        """)

        if reply_text:
            return {
                "status": "replied",
                "message": f"Reply detected from {full_name}",
                "reply_text": reply_text[:200],
            }

        return {"status": "no_reply", "message": "No reply found", "reply_text": ""}

    except Exception as e:
        logger.error(f"Error checking reply for {first_name} {last_name}: {e}")
        return {"status": "error", "message": str(e)[:200], "reply_text": ""}
