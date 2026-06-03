import { heartbeat, pendingJobs, claimJob, startJob, completeJob, failJob } from './api.js';
import { getConfig, saveConfig, extensionId } from './storage.js';

const EXT_VERSION = '0.1.0';

// ── Dedicated automation tab ──────────────────────────────────────────────────
// We keep ONE hidden tab that the extension owns entirely.
// The user's LinkedIn tab is NEVER navigated or touched.
let automationTabId = null;

async function getAutomationTab(url) {
  // Check if our dedicated tab is still alive
  if (automationTabId !== null) {
    try {
      const tab = await chrome.tabs.get(automationTabId);
      if (tab && !tab.url?.startsWith(url || 'https://www.linkedin.com')) {
        await chrome.tabs.update(automationTabId, { url: url || 'https://www.linkedin.com/feed/' });
      } else if (tab && url && !tab.url?.startsWith(url)) {
        await chrome.tabs.update(automationTabId, { url });
      }
      return tab;
    } catch {
      // Tab was closed — clear the id and create a new one
      automationTabId = null;
    }
  }
  // Create a new background tab
  const tab = await chrome.tabs.create({
    url: url || 'https://www.linkedin.com/feed/',
    active: false,   // ← never steals focus from the user
    pinned: false,
  });
  automationTabId = tab.id;
  return tab;
}

async function navigateAutomationTab(url) {
  const tab = await getAutomationTab(url);
  if (!tab.url?.startsWith(url)) {
    await chrome.tabs.update(tab.id, { url });
  }
  return tab;
}

async function waitForTab(tabId) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return true;
    } catch { return false; }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function contentAction(url, type, payload = {}) {
  const tab = await navigateAutomationTab(url);
  const ready = await waitForTab(tab.id);
  if (!ready) return { status: 'error', message: 'Tab did not load in time' };
  // Small extra delay so LinkedIn React finishes rendering
  await new Promise(r => setTimeout(r, 1200));
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...payload });
  } catch {
    // Content script not yet injected — inject it then retry
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content-linkedin.js'] });
    await new Promise(r => setTimeout(r, 400));
    return await chrome.tabs.sendMessage(tab.id, { type, ...payload });
  }
}

// ── Alarm setup ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const cfg = await getConfig();
  if (!cfg.extensionId) await saveConfig({ extensionId: extensionId() });
  chrome.alarms.create('linkedflow_tick', { periodInMinutes: 1 });
});

chrome.alarms.get('linkedflow_tick', (alarm) => {
  if (!alarm) chrome.alarms.create('linkedflow_tick', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'linkedflow_tick') tick();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'sync_now') {
    tick().then(sendResponse).catch(err => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }
  if (msg?.type === 'close_automation_tab') {
    if (automationTabId !== null) {
      chrome.tabs.remove(automationTabId).catch(() => {});
      automationTabId = null;
    }
    sendResponse({ ok: true });
    return true;
  }
});

// ── Heartbeat ─────────────────────────────────────────────────────────────────
// Uses the automation tab — never touches the user's LinkedIn tab.

async function heartbeatOnce(cfg) {
  const state = await contentAction('https://www.linkedin.com/feed/', 'account_state');
  await heartbeat({
    profile_key: cfg.profileKey,
    extension_id: cfg.extensionId,
    display_name: state.displayName || cfg.displayName || cfg.profileKey,
    current_url: state.currentUrl,
    session_active: state.loginStatus === 'logged_in',
    linkedin_login_status: state.loginStatus,
    extension_status: cfg.paused ? 'paused' : 'online',
    extension_version: EXT_VERSION,
    automation_paused: Boolean(cfg.paused),
  });
  await saveConfig({ displayName: state.displayName || cfg.displayName, lastSync: new Date().toISOString(), lastError: '' });
  return state;
}

// ── Job execution ─────────────────────────────────────────────────────────────

function taskFromJob(job) {
  const payload = job.payload || {};
  if (job.job_type === 'send_connections') {
    return { type: 'send_connection', reportType: 'send_connection', url: payload.linkedin_url, note: payload.note || '' };
  }
  if (job.job_type === 'check_messageability') {
    return { type: 'check_messageability', reportType: 'check_messageability', url: payload.linkedin_url, note: payload.note || '', fallback: payload.fallback || 'invitation' };
  }
  if (job.job_type === 'send_messages' || job.job_type === 'send_followups') {
    return { type: 'send_prepared_message', reportType: 'send_message', url: payload.linkedin_url, message: payload.message || '', message_type: payload.message_type || 'initial' };
  }
  if (job.job_type === 'send_prepared_message') {
    return { type: 'send_prepared_message', reportType: 'send_prepared_message', url: payload.linkedin_url, message: payload.message || '', message_type: payload.message_type || 'initial' };
  }
  if (job.job_type === 'send_prepared_inmail') {
    return { type: 'send_prepared_inmail', reportType: 'send_prepared_inmail', url: payload.linkedin_url, subject: payload.subject || '', message: payload.message || '', message_type: 'inmail' };
  }
  if (job.job_type === 'visit_profile') {
    return { type: 'visit_profile', reportType: 'visit_profile', url: payload.linkedin_url };
  }
  return { type: job.job_type, reportType: job.job_type, url: payload.linkedin_url };
}

async function runJob(job, cfg) {
  const task = taskFromJob(job);
  await saveConfig({ currentJob: `${job.job_type} ${job.id}` });
  await claimJob(job.id, cfg.profileKey);
  await startJob(job.id);
  let result;
  if (task.type === 'visit_profile') {
    await navigateAutomationTab(task.url);
    await waitForTab(automationTabId);
    result = { status: 'completed', message: 'Profile visited' };
  } else {
    result = await contentAction(task.url, task.type, task);
    if (task.type === 'check_messageability' && result.status === 'not_messageable' && task.fallback === 'invitation') {
      result = await contentAction(task.url, 'send_connection', { note: task.note || '' });
      result.status = result.status === 'sent' ? 'invitation_sent' : result.status;
    }
  }
  const final = {
    task_type: task.reportType || task.type,
    status: result.status || 'failed_with_reason',
    message: result.message || '',
    prospect_id: job.prospect_id,
    message_type: task.message_type,
  };
  if (['error', 'failed_with_reason', 'session_expired', 'restricted', 'limit_reached', 'cannot_connect'].includes(final.status)) {
    await failJob(job.id, final.message || final.status, final);
  } else {
    await completeJob(job.id, final);
  }
  await saveConfig({ currentJob: '', lastSync: new Date().toISOString(), lastError: '' });
}

// ── Main tick ─────────────────────────────────────────────────────────────────

export async function tick() {
  const cfg = await getConfig();
  if (!cfg.paired || !cfg.profileKey || cfg.paused) return { ok: true, skipped: true };
  try {
    await heartbeatOnce(cfg);
    const data = await pendingJobs(cfg.profileKey);
    const job = (data.jobs || [])[0];
    if (job) await runJob(job, cfg);
    return { ok: true, jobs: data.jobs?.length || 0 };
  } catch (err) {
    await saveConfig({ lastError: String(err.message || err), currentJob: '' });
    return { ok: false, error: String(err.message || err) };
  }
}
