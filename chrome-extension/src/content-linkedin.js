if (window.__linkedflowContentLoaded) return;
window.__linkedflowContentLoaded = true;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
  window.scrollTo(0, 0);
  await sleep(700);
}

async function detectMessageability() {
  await ensureTop();
  if (isLoginRequired()) return { status: 'session_expired', message: 'LinkedIn login required' };
  if (hasNormalMessage()) return { status: 'normal_message_available', message: 'Normal LinkedIn message is available' };
  if (hasPendingInvite()) return { status: 'pending', message: 'Connection request is already pending' };

  if (clickButtonByText('Message')) {
    await sleep(1200);
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
    const textarea = document.querySelector('textarea[name="message"]');
    if (textarea) {
      textarea.value = note.slice(0, 300);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
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
  // Scroll a bit so LinkedIn registers a genuine profile view
  window.scrollBy(0, 400);
  await sleep(900);
  window.scrollBy(0, -200);
  await sleep(400);
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
  // Look at the most recent messages in the open conversation panel
  const bubbles = Array.from(document.querySelectorAll('.msg-s-event-listitem, [class*="message-list-item"], li[class*="msg"]'));
  if (!bubbles.length) return { status: 'no_reply', message: 'No conversation found yet' };

  const last = bubbles[bubbles.length - 1];
  const lastText = textOf(last);
  // Heuristic: if the most recent bubble is NOT attributed to "You", treat it as a reply
  const fromMe = /\byou\b/i.test(textOf(last.querySelector('.msg-s-event-listitem__name, [class*="from"]')) || '') ||
    /\bYou\b/.test(lastText.slice(0, 12));
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
