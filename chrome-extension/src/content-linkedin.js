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
  if (hasNormalMessage()) return { status: 'connected', message: 'Already connected' };
  if (hasPendingInvite()) return { status: 'pending', message: 'Connection request already pending' };

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

async function sendPreparedMessage(message) {
  await ensureTop();
  if (!message) return { status: 'failed_with_reason', message: 'Message text is empty' };
  if (isLoginRequired()) return { status: 'session_expired', message: 'LinkedIn login required' };
  if (!clickButtonByText('Message')) {
    return { status: 'failed_with_reason', message: 'Message button not found' };
  }
  await sleep(1500);
  const box = document.querySelector('div[role="textbox"], [contenteditable="true"]');
  if (!box) return { status: 'failed_with_reason', message: 'Message input not found' };
  box.focus();
  document.execCommand('insertText', false, message);
  box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
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
  body.focus();
  document.execCommand('insertText', false, message);
  await sleep(800);
  const send = Array.from(document.querySelectorAll('button')).find(btn => textOf(btn) === 'Send' || /send/i.test(btn.getAttribute('aria-label') || ''));
  if (!send) return { status: 'failed_with_reason', message: 'InMail send button not found' };
  send.click();
  return { status: 'inmail_sent', message: 'InMail sent successfully' };
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  (async () => {
    if (request.type === 'account_state') return detectAccount();
    if (request.type === 'check_messageability') return detectMessageability();
    if (request.type === 'send_connection') return sendConnection(request.note || '');
    if (request.type === 'send_prepared_message') return sendPreparedMessage(request.message || '');
    if (request.type === 'send_prepared_inmail') return sendPreparedInmail(request.subject || '', request.message || '');
    return { status: 'failed_with_reason', message: `Unknown content action: ${request.type}` };
  })().then(sendResponse).catch(err => sendResponse({ status: 'failed_with_reason', message: String(err.message || err) }));
  return true;
});
