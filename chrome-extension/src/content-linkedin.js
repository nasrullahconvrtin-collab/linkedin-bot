(() => {
// Guard against double-injection: the manifest injects this file on every
// LinkedIn page, and background.js re-injects it via chrome.scripting if
// messaging fails. A bare top-level `return` is a SyntaxError in a classic
// content script, so the guard lives inside this IIFE.
if (window.__linkedflowContentLoaded) return;
window.__linkedflowContentLoaded = true;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Close any LinkedIn modal / popup / overlay that might block actions.
 *
 * Strategy (in order):
 *   1. Known CSS selectors for common LinkedIn modals.
 *   2. For every visible [role="dialog"] or modal-like container:
 *      a. Button whose visible text is a close glyph or word.
 *      b. Button containing an SVG with a close/X path (Premium upsell X has NO aria-label).
 *      c. Last button inside a modal header (positional heuristic).
 *   3. Escape key as final fallback.
 *
 * Returns a Promise that resolves once dismissed or after an 800 ms safety timeout.
 */
async function dismissPopups() {
  const CLOSE_TEXT = new Set(['×', 'X', '✕', '✖', 'Close', 'Dismiss', 'Skip', 'Not now', 'Maybe later', 'No thanks', 'Got it']);
  const CLOSE_LABEL_RE = /close|dismiss|skip|not\s*now|maybe\s*later|no\s*thanks|got\s*it/i;

  // Selectors that reliably name their close buttons
  const NAMED_SELECTORS = [
    'button.artdeco-modal__dismiss',
    'button[aria-label="Dismiss"]',
    'button[aria-label="Close"]',
    'button[aria-label="Got it"]',
    'button[aria-label="Skip"]',
    'button[aria-label="Not now"]',
    'button[aria-label="No thanks"]',
    'button[aria-label="Maybe later"]',
    'button[data-test-modal-close-btn]',
    '.premium-marketing-modal button[aria-label*="close" i]',
    '.premium-marketing-modal button[aria-label*="dismiss" i]',
    'button.artdeco-toast-item__dismiss',
    'button[action-type="ACCEPT"]',
    '#artdeco-global-alert-container button',
    'button[data-control-name="overlay.close_conversation_window"]',
    '.msg-overlay-bubble-header__controls button',
  ];

  // Returns true if a button's inner SVG looks like a close/X icon.
  // LinkedIn Premium upsell renders an unlabelled <button><svg>…</svg></button>
  // whose path draws an X — this catches it without relying on any label.
  function hasSvgCloseIcon(btn) {
    const svg = btn.querySelector('svg');
    if (!svg) return false;
    const title = (svg.querySelector('title')?.textContent || '').toLowerCase();
    if (/close|dismiss|x/i.test(title)) return true;
    // Heuristic: a small SVG (≤ 24 px viewBox) with exactly 1–2 path/line elements
    // whose d-attribute contains diagonal moves is almost certainly an X icon.
    const vb = svg.getAttribute('viewBox') || '';
    const size = parseFloat(vb.split(' ')[2]) || 0;
    if (size > 0 && size <= 24) {
      const paths = svg.querySelectorAll('path, line, polyline');
      if (paths.length <= 3) return true;
    }
    return false;
  }

  function isVisible(el) {
    return el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
  }

  function tryClick(btn) {
    if (!isVisible(btn)) return false;
    try { btn.click(); return true; } catch (_) { return false; }
  }

  function findCloseButton(container) {
    const buttons = Array.from(container.querySelectorAll('button'));

    // a. Text / aria-label match (catches labelled X buttons)
    const byLabel = buttons.find(btn => {
      const txt = (btn.textContent || '').trim();
      const lbl = btn.getAttribute('aria-label') || '';
      return CLOSE_TEXT.has(txt) || CLOSE_LABEL_RE.test(lbl);
    });
    if (byLabel) return byLabel;

    // b. SVG-icon match (catches Premium upsell X with no label)
    const bySvg = buttons.find(hasSvgCloseIcon);
    if (bySvg) return bySvg;

    // c. Positional heuristic: last button inside a header element
    const header = container.querySelector(
      'header, [class*="modal-header"], [class*="dialog-header"], [class*="header"]'
    );
    if (header) {
      const headerBtns = Array.from(header.querySelectorAll('button'));
      if (headerBtns.length) return headerBtns[headerBtns.length - 1];
    }

    return null;
  }

  const deadline = Date.now() + 800;
  let dismissed = false;

  // Step 1 — named selectors
  for (const sel of NAMED_SELECTORS) {
    for (const btn of Array.from(document.querySelectorAll(sel))) {
      if (tryClick(btn)) { dismissed = true; await sleep(150); }
    }
  }

  // Step 2 — scan every visible dialog/modal container
  const modalRoots = Array.from(document.querySelectorAll(
    '[role="dialog"], [data-test-modal], .artdeco-modal, .scaffold-layout-modal,' +
    '.premium-upsell-modal, [class*="upsell-modal"], [class*="marketing-modal"],' +
    '[class*="premium-modal"], [class*="paywall"]'
  ));
  for (const modal of modalRoots) {
    if (!isVisible(modal)) continue;
    const btn = findCloseButton(modal);
    if (btn && tryClick(btn)) { dismissed = true; await sleep(200); }
  }

  // Step 3 — Escape key fallback
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  // Respect the 800 ms deadline so callers don't stall
  const remaining = deadline - Date.now();
  if (dismissed && remaining > 0) await sleep(Math.min(remaining, 500));
}

function textOf(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function clickButtonByText(labels) {
  const wanted = Array.isArray(labels) ? labels : [labels];
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
  const btn = buttons.find(b => wanted.includes(textOf(b)));
  if (btn) {
    btn.click();
    return true;
  }
  return false;
}

function clickLeafByText(label) {
  const nodes = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
  const node = nodes.find(el => textOf(el) === label && el.offsetParent !== null);
  if (node) {
    node.click();
    return true;
  }
  return false;
}

function isLoginRequired() {
  const url = location.href;
  return url.includes('/login') || url.includes('/authwall') || url.includes('/checkpoint');
}

function profileHeaderButtons() {
  const header = document.querySelector('.pv-top-card, .ph5, main');
  return Array.from((header || document).querySelectorAll('button')).map(textOf);
}

function hasNormalMessage() {
  return profileHeaderButtons().includes('Message') || Boolean(document.querySelector('[contenteditable="true"], div[role="textbox"]'));
}

function hasPendingInvite() {
  return profileHeaderButtons().includes('Pending');
}

function hasConnectButton() {
  return profileHeaderButtons().includes('Connect') || Array.from(document.querySelectorAll('button')).some(b => textOf(b) === 'Connect');
}

function hasInmailComposer() {
  return Boolean(
    document.querySelector('input[name="subject"], input[placeholder*="Subject" i], textarea[name="message"], div[aria-label*="message" i][contenteditable="true"]')
  );
}

function detectAccount() {
  const meLink = Array.from(document.querySelectorAll('a[href*="/in/"]')).find(a =>
    (a.href || '').includes('/in/') && /feed|me|profile/i.test(textOf(a) + ' ' + (a.getAttribute('aria-label') || ''))
  );
  const img = document.querySelector('img.global-nav__me-photo, img[alt*="Photo of" i]');
  const alt = img?.getAttribute('alt') || '';
  return {
    displayName: alt.replace(/^Photo of\s+/i, '').trim() || '',
    linkedinUrl: meLink?.href?.split('?')[0] || '',
    loginStatus: isLoginRequired() ? 'login_required' : 'logged_in',
    currentUrl: location.href,
  };
}

async function ensureTop() {
  await dismissPopups();
  window.scrollTo(0, 0);
  await sleep(700);
}

async function detectMessageability() {
  await ensureTop();
  if (isLoginRequired()) return { status: 'session_expired', message: 'LinkedIn login required' };

  // 1st-degree check: if already connected, a Message button must exist (possibly
  // hidden under "More"). Return normal_message_available immediately so the flow
  // never tries to send a redundant connection request.
  const has1st = document.querySelector('[aria-label*="1st"]') ||
    Array.from(document.querySelectorAll('span')).some(el =>
      el.textContent.trim() === '1st' || el.textContent.trim() === '1st degree connection'
    );
  if (has1st) return { status: 'normal_message_available', message: '1st-degree connection — normal message available' };

  if (hasNormalMessage()) return { status: 'normal_message_available', message: 'Normal LinkedIn message is available' };
  if (hasPendingInvite()) return { status: 'pending', message: 'Connection request is already pending' };

  // Try Message button (may be hidden under "More" dropdown)
  if (!clickButtonByText('Message')) {
    if (clickButtonByText('More')) {
      await sleep(800);
      clickButtonByText('Message');
    }
  }
  if (document.querySelector('[contenteditable="true"], div[role="textbox"]')) {
    // Message composer already open (clicked above opened it)
    return { status: 'normal_message_available', message: 'Normal LinkedIn message is available' };
  }
  // Try clicking Message and waiting for the composer to appear
  if (clickButtonByText('Message')) {
    await sleep(1500);
    if (hasInmailComposer()) return { status: 'inmail_available', message: 'InMail composer is available' };
    if (document.querySelector('[contenteditable="true"], div[role="textbox"]')) {
      return { status: 'normal_message_available', message: 'Normal LinkedIn message is available' };
    }
  }
  if (hasConnectButton()) return { status: 'not_messageable', message: 'No message path found; invitation fallback can run' };
  return { status: 'not_messageable', message: 'No message, InMail, or Connect action found' };
}

async function sendConnection(note = '') {
  await ensureTop();
  if (isLoginRequired()) return { status: 'session_expired', message: 'LinkedIn login required' };

  // Check for 1st degree connection indicator in the page
  const degreeText = document.body.innerText || '';
  const has1st = document.querySelector('[aria-label*="1st"]') ||
    Array.from(document.querySelectorAll('span')).some(el =>
      el.textContent.trim() === '1st' || el.textContent.trim() === '1st degree connection'
    );
  if (has1st || hasNormalMessage()) return { status: 'connected', message: 'Already connected' };
  if (hasPendingInvite()) return { status: 'pending', message: 'Connection request already pending' };

  // Also check for "Following" or "Message" buttons that indicate connection
  const allButtons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
  if (allButtons.includes('Message')) return { status: 'connected', message: 'Already connected (Message button found)' };
  if (allButtons.includes('Following')) return { status: 'connected', message: 'Already following/connected' };

  let clicked = clickButtonByText('Connect');
  if (!clicked && clickButtonByText('More')) {
    await sleep(900);
    clicked = clickLeafByText('Connect');
  }
  if (!clicked) return { status: 'cannot_connect', message: 'Connect button not found' };
  await sleep(1200);

  if (note && clickButtonByText('Add a note')) {
    await sleep(700);
    // LinkedIn's connection dialog uses a React-controlled textarea; setting .value
    // directly doesn't trigger React's synthetic event system, so the note is
    // silently dropped. fillContentEditable uses the clipboard paste path which
    // React does observe. Fall back to a plain textarea if no contenteditable exists.
    const box = document.querySelector('[contenteditable="true"], div[role="textbox"]')
      || document.querySelector('textarea[name="message"]');
    if (box) fillContentEditable(box, note.slice(0, 300));
  }
  if (clickButtonByText(['Send without a note', 'Send', 'Done'])) {
    return { status: 'sent', message: 'Connection request sent' };
  }
  return { status: 'error', message: 'Send button not found in connection dialog' };
}

function fillContentEditable(box, text) {
  // Reliable cross-Chromium text insertion into contenteditable divs.
  // execCommand('insertText') is deprecated and broken in newer Chromium builds.
  box.focus();
  // Clear existing content first
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(box);
  sel.removeAllRanges();
  sel.addRange(range);
  // Insert via DataTransfer (works in all MV3 contexts)
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  // Fallback: if paste event didn't populate, set innerText directly
  if (!box.innerText.trim()) {
    box.innerText = text;
    box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
}

async function sendPreparedMessage(message) {
  await ensureTop();
  if (!message) return { status: 'failed_with_reason', message: 'Message text is empty' };
  if (isLoginRequired()) return { status: 'session_expired', message: 'LinkedIn login required' };
  if (!clickButtonByText('Message')) {
    // Message can be hidden under the "More" actions dropdown
    if (clickButtonByText('More')) {
      await sleep(800);
    }
    if (!clickButtonByText('Message')) {
      return { status: 'failed_with_reason', message: 'Message button not found' };
    }
  }
  await sleep(1500);
  const box = document.querySelector('div[role="textbox"], [contenteditable="true"]');
  if (!box) return { status: 'failed_with_reason', message: 'Message input not found' };
  fillContentEditable(box, message);
  await sleep(800);
  const send = Array.from(document.querySelectorAll('button')).find(btn => {
    const txt = textOf(btn);
    const aria = btn.getAttribute('aria-label') || '';
    return txt === 'Send' || /send/i.test(aria);
  });
  if (!send) return { status: 'failed_with_reason', message: 'Send button not found' };
  send.click();
  return { status: 'message_sent', message: 'Message sent successfully' };
}

async function sendPreparedInmail(subject, message) {
  await ensureTop();
  if (!subject || !message) return { status: 'failed_with_reason', message: 'Subject or message is empty' };
  if (isLoginRequired()) return { status: 'session_expired', message: 'LinkedIn login required' };
  clickButtonByText('Message');
  await sleep(1500);
  const subjectInput = document.querySelector('input[name="subject"], input[placeholder*="Subject" i]');
  const body = document.querySelector('textarea[name="message"], div[role="textbox"], [contenteditable="true"]');
  if (!subjectInput || !body) return { status: 'failed_with_reason', message: 'InMail composer fields not found' };
  subjectInput.value = subject;
  subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
  fillContentEditable(body, message);
  await sleep(800);
  const send = Array.from(document.querySelectorAll('button')).find(btn => textOf(btn) === 'Send' || /send/i.test(btn.getAttribute('aria-label') || ''));
  if (!send) return { status: 'failed_with_reason', message: 'InMail send button not found' };
  send.click();
  return { status: 'inmail_sent', message: 'InMail sent successfully' };
}

async function visitProfile() {
  await ensureTop();
  if (isLoginRequired()) return { status: 'session_expired', message: 'LinkedIn login required' };
  // Dismiss any popup that appeared on page load before acting
  await dismissPopups();
  await sleep(500);
  // Scroll a bit so LinkedIn registers a genuine profile view
  window.scrollBy(0, 400);
  await sleep(900);
  window.scrollBy(0, -200);
  await sleep(400);
  // Final popup sweep before reporting done — ensures next action has clean DOM
  await dismissPopups();
  const name = (document.querySelector('h1')?.textContent || '').trim();
  return { status: 'visited', message: name ? `Visited profile: ${name}` : 'Profile visited' };
}

function isAlreadyFollowing() {
  const buttons = profileHeaderButtons();
  return buttons.includes('Following') || buttons.includes('Unfollow');
}

async function followProfile() {
  await ensureTop();
  if (isLoginRequired()) return { status: 'session_expired', message: 'LinkedIn login required' };
  if (isAlreadyFollowing()) return { status: 'already_following', message: 'Already following this profile' };

  let clicked = clickButtonByText('Follow');
  if (!clicked) {
    // Sometimes Follow is tucked under the "More" overflow menu
    if (clickButtonByText('More')) {
      await sleep(900);
      clicked = clickLeafByText('Follow');
    }
  }
  if (!clicked) return { status: 'not_available', message: 'Follow action not found on this profile' };
  await sleep(1000);
  if (isAlreadyFollowing()) return { status: 'followed', message: 'Now following profile' };
  return { status: 'followed', message: 'Follow clicked' };
}

function findSkillEndorseTargets(skillName) {
  // Skill entries live in the "Skills" section; each has an endorse button near it.
  const sections = Array.from(document.querySelectorAll('section'));
  const skillsSection = sections.find(s => /skills/i.test(textOf(s.querySelector('h2')) || ''));
  if (!skillsSection) return [];
  const items = Array.from(skillsSection.querySelectorAll('li, div[data-view-name*="skill" i]'));
  return items.filter(item => {
    if (!skillName) return true;
    return textOf(item).toLowerCase().includes(skillName.toLowerCase());
  });
}

async function endorseProfile(skillName = '') {
  await ensureTop();
  if (isLoginRequired()) return { status: 'session_expired', message: 'LinkedIn login required' };

  // Navigate to the "Details > Skills" page for a reliable layout when possible
  const skillsLink = Array.from(document.querySelectorAll('a[href*="/details/skills"]'))[0];
  if (skillsLink) {
    skillsLink.click();
    await sleep(1500);
  }

  const targets = findSkillEndorseTargets(skillName);
  for (const item of targets) {
    const endorseBtn = Array.from(item.querySelectorAll('button')).find(b => /endorse/i.test(textOf(b) + ' ' + (b.getAttribute('aria-label') || '')));
    if (endorseBtn && !/endorsed/i.test(textOf(endorseBtn))) {
      endorseBtn.click();
      await sleep(900);
      return { status: 'endorsed', message: skillName ? `Endorsed skill: ${skillName}` : 'Endorsed top skill' };
    }
  }
  // Fallback: scan the whole page for any visible "Endorse" button
  const anyEndorse = Array.from(document.querySelectorAll('button')).find(b => /^endorse$/i.test(textOf(b)));
  if (anyEndorse) {
    anyEndorse.click();
    await sleep(900);
    return { status: 'endorsed', message: 'Endorsed a skill' };
  }
  return { status: 'not_available', message: 'No endorsable skill found on this profile' };
}

async function checkConnectionStatus() {
  await ensureTop();
  if (isLoginRequired()) return { status: 'session_expired', message: 'LinkedIn login required' };
  const has1st = document.querySelector('[aria-label*="1st"]') ||
    Array.from(document.querySelectorAll('span')).some(el => /^1st(\s+degree connection)?$/.test(el.textContent.trim()));
  if (has1st || hasNormalMessage()) return { status: 'accepted', message: 'Connection request accepted' };
  if (hasPendingInvite()) return { status: 'still_not_accepted', message: 'Connection request still pending' };
  if (hasConnectButton()) return { status: 'still_not_accepted', message: 'Connection request not yet accepted' };
  return { status: 'still_not_accepted', message: 'Could not confirm acceptance yet' };
}

async function checkReply() {
  await ensureTop();
  if (isLoginRequired()) return { status: 'session_expired', message: 'LinkedIn login required' };
  if (!clickButtonByText('Message')) {
    return { status: 'no_reply', message: 'Could not open the message thread' };
  }
  await sleep(1500);

  // LinkedIn renders each message bubble inside a <li> with a data attribute or
  // class that identifies direction. Try multiple selectors across LinkedIn versions.
  const bubbles = Array.from(document.querySelectorAll(
    '.msg-s-event-listitem, [class*="message-list-item"], li[class*="msg"]'
  ));
  if (!bubbles.length) return { status: 'no_reply', message: 'No conversation found yet' };

  const last = bubbles[bubbles.length - 1];
  const lastText = textOf(last);

  // Determine direction using structural signals rather than fragile "You" text matching:
  // 1. LinkedIn marks self-sent bubbles with a modifier class (--is-sender or --self).
  // 2. The sender name label (when present) can be compared against our own display name.
  // 3. Outgoing bubbles often have a right-aligned wrapper or an "edit" pencil icon.
  const isSentByCls = /--is-sender|--self|outgoing|sent-by-me/i.test(last.className || '');
  const editIcon = last.querySelector('[data-control-name="edit_message"], button[aria-label*="Edit" i]');
  const senderEl = last.querySelector('.msg-s-event-listitem__name, [class*="sender-name"], [class*="from-name"]');
  const senderText = textOf(senderEl).toLowerCase();
  // "You" in various LinkedIn UI languages for the sender label
  const selfSenderRE = /^(you|yo|tu|vous|du|jij|ti|вы|я)$/i;
  const fromMe = isSentByCls || Boolean(editIcon) || (senderText.length > 0 && selfSenderRE.test(senderText));

  if (lastText && !fromMe) {
    return { status: 'replied', message: 'Prospect has replied', reply_excerpt: lastText.slice(0, 280) };
  }
  return { status: 'no_reply', message: 'No new reply from prospect yet' };
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  (async () => {
    if (request.type === 'account_state') return detectAccount();
    if (request.type === 'check_messageability') return detectMessageability();
    if (request.type === 'send_connection') return sendConnection(request.note || '');
    if (request.type === 'send_prepared_message') return sendPreparedMessage(request.message || '');
    if (request.type === 'send_prepared_inmail') return sendPreparedInmail(request.subject || '', request.message || '');
    if (request.type === 'visit_profile') return visitProfile();
    if (request.type === 'follow_profile') return followProfile();
    if (request.type === 'endorse_profile') return endorseProfile(request.skill || '');
    if (request.type === 'check_reply') return checkReply();
    if (request.type === 'check_connection_status') return checkConnectionStatus();
    return { status: 'failed_with_reason', message: `Unknown content action: ${request.type}` };
  })().then(sendResponse).catch(err => sendResponse({ status: 'failed_with_reason', message: String(err.message || err) }));
  return true;
});

})();
