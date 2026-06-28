import { heartbeat, pendingJobs, claimJob, startJob, completeJob, failJob } from './api.js';
import { getConfig, saveConfig, extensionId } from './storage.js';

const EXT_VERSION = '0.1.0';
const STORAGE_TAB_KEY  = 'lf_auto_tab_id';
const STORAGE_WIN_KEY  = 'lf_auto_win_id';

// ── Desktop notifications ──────────────────────────────────────────────────────
// Deduped per "kind" so a stuck job or a network blip doesn't spam a
// notification every tick - only fires again once the kind clears or a
// cooldown passes.
const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000; // 30 min
let lastNotifiedAt = {};

// Inline data-URI icon - the extension ships no icon assets, and a data URL
// avoids adding a binary file just for notifications.create()'s required iconUrl.
const NOTIFY_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGNITvtIEmIY1TCq4eOw1QAAbKy6EKII1UQAAAAASUVORK5CYII=';

function notify(kind, title, message) {
  const now = Date.now();
  if (lastNotifiedAt[kind] && now - lastNotifiedAt[kind] < NOTIFY_COOLDOWN_MS) return;
  lastNotifiedAt[kind] = now;
  try {
    chrome.notifications.create(`linkedflow_${kind}_${now}`, {
      type: 'basic',
      iconUrl: NOTIFY_ICON,
      title,
      message,
      priority: 2,
    });
  } catch (err) {
    console.error('notify failed', err);
  }
}

function clearNotifyCooldown(kind) {
  delete lastNotifiedAt[kind];
}

// ── Dedicated invisible automation window + tab ───────────────────────────────
// We create ONE minimized Chrome window that never appears in the user's
// main window tab bar. The service worker may restart (MV3), so we persist
// the tab/window IDs in chrome.storage.local and reuse them across restarts.

async function getSavedIds() {
  const data = await chrome.storage.local.get([STORAGE_TAB_KEY, STORAGE_WIN_KEY]);
  return { tabId: data[STORAGE_TAB_KEY] || null, winId: data[STORAGE_WIN_KEY] || null };
}

async function saveIds(tabId, winId) {
  await chrome.storage.local.set({ [STORAGE_TAB_KEY]: tabId, [STORAGE_WIN_KEY]: winId });
}

async function clearIds() {
  await chrome.storage.local.remove([STORAGE_TAB_KEY, STORAGE_WIN_KEY]);
}

async function isTabAlive(tabId) {
  if (!tabId) return false;
  try { await chrome.tabs.get(tabId); return true; } catch { return false; }
}

async function getAutomationTab(targetUrl) {
  const { tabId, winId } = await getSavedIds();

  // Reuse existing tab if still alive
  if (await isTabAlive(tabId)) {
    const tab = await chrome.tabs.get(tabId);
    const dest = targetUrl || 'https://www.linkedin.com/feed/';
    if (!tab.url?.startsWith(dest)) {
      await chrome.tabs.update(tabId, { url: dest });
    }
    return await chrome.tabs.get(tabId);
  }

  // Create a new minimized window — tabs inside are invisible in the main Chrome window
  const dest = targetUrl || 'https://www.linkedin.com/feed/';
  const win = await chrome.windows.create({
    url: dest,
    state: 'minimized',   // ← window is minimized, not visible in taskbar during use
    focused: false,
    type: 'normal',
  });
  const newTab = win.tabs[0];
  await saveIds(newTab.id, win.id);
  return newTab;
}

async function navigateAutomationTab(url) {
  const tab = await getAutomationTab(url);
  const dest = url || 'https://www.linkedin.com/feed/';
  // Always navigate to ensure a clean page state for each action
  await chrome.tabs.update(tab.id, { url: dest });
  return await chrome.tabs.get(tab.id);
}

async function waitForTab(tabId) {
  for (let i = 0; i < 60; i++) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === 'complete') return true;
    } catch { return false; }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function contentActionOnce(url, type, payload = {}) {
  const tab = await navigateAutomationTab(url);
  const ready = await waitForTab(tab.id);
  if (!ready) return null; // page timeout - caller decides whether to retry
  // Wait for LinkedIn React to finish rendering
  await new Promise(r => setTimeout(r, 1500));
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...payload });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content-linkedin.js'] });
    await new Promise(r => setTimeout(r, 500));
    return await chrome.tabs.sendMessage(tab.id, { type, ...payload });
  }
}

// Page timeout → retry once, then skip with error (per corner-case spec).
async function contentAction(url, type, payload = {}) {
  let result = await contentActionOnce(url, type, payload);
  if (result === null) result = await contentActionOnce(url, type, payload);
  if (result === null) return { status: 'error', message: 'Automation tab did not load in time (after retry)' };
  return result;
}

function randomDelayMs(minMinutes, maxMinutes) {
  const minutes = minMinutes + Math.random() * (maxMinutes - minMinutes);
  return Math.round(minutes * 60000);
}

const CONNECTION_JOB_TYPES = new Set(['send_connections', 'check_messageability']);
const MESSAGE_JOB_TYPES = new Set(['send_messages', 'send_followups', 'send_prepared_message', 'send_prepared_inmail', 'send_inmail']);

async function closeAutomationWindow() {
  const { tabId, winId } = await getSavedIds();
  if (winId) { try { await chrome.windows.remove(winId); } catch {} }
  else if (tabId) { try { await chrome.tabs.remove(tabId); } catch {} }
  await clearIds();
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
    closeAutomationWindow().then(() => sendResponse({ ok: true }));
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
  await saveConfig({ displayName: state.displayName || cfg.displayName, lastSync: new Date().toISOString() });
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
  if (job.job_type === 'follow_profile') {
    return { type: 'follow_profile', reportType: 'follow_profile', url: payload.linkedin_url };
  }
  if (job.job_type === 'endorse_profile') {
    return { type: 'endorse_profile', reportType: 'endorse_profile', url: payload.linkedin_url, skill: payload.skill || '' };
  }
  if (job.job_type === 'check_reply' || job.job_type === 'wait_reply') {
    return { type: 'check_reply', reportType: 'check_reply', url: payload.linkedin_url };
  }
  if (job.job_type === 'check_connection_status' || job.job_type === 'wait_acceptance') {
    return { type: 'check_connection_status', reportType: 'check_connection_status', url: payload.linkedin_url };
  }
  if (job.job_type === 'send_inmail') {
    return { type: 'send_prepared_inmail', reportType: 'send_inmail', url: payload.linkedin_url, subject: payload.subject || '', message: payload.message || '', message_type: 'inmail' };
  }
  return { type: job.job_type, reportType: job.job_type, url: payload.linkedin_url };
}

async function runJob(job, cfg) {
  const task = taskFromJob(job);
  await saveConfig({ currentJob: `${job.job_type} ${job.id}` });
  // claimJob uses a conditional UPDATE (WHERE status IN pending/retrying).
  // If another extension instance already claimed this job, the update returns
  // no rows and claimJob resolves to null — bail out to avoid double-execution.
  const claimed = await claimJob(job.id, cfg.profileKey);
  if (!claimed) {
    await saveConfig({ currentJob: '' });
    return;
  }
  await startJob(job.id);
  let result;
  {
    result = await contentAction(task.url, task.type, task);
    // Inline "auto-send invitation when not messageable" fallback — ONLY for
    // legacy template-engine jobs. Visual Flow Builder campaigns identify
    // their jobs via payload.flow_node_id and define their OWN explicit
    // 'not_messageable' branch on the canvas (e.g. routing to a dedicated
    // "Send Connection Request" node). If we fired this inline fallback for
    // flow jobs too, the backend would receive a remapped 'invitation_sent'
    // status that doesn't match any of the check-node's drawn edge conditions
    // ('inmail_available' / 'message_available' / 'not_messageable') NOR the
    // generic 'default' condition (no such edge exists on this node), causing
    // the graph-walker to fall through to the first-declared edge — sending a
    // duplicate/incorrect action (e.g. an InMail) on top of the invitation we
    // just sent here. Flow campaigns must always see the raw status so the
    // user's own drawn branch decides what happens next.
    const isFlowJob = Boolean(job.payload?.flow_node_id);
    if (task.type === 'check_messageability' && result.status === 'not_messageable' && task.fallback === 'invitation' && !isFlowJob) {
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
  // Account restricted (LinkedIn checkpoint) → stop all automation immediately.
  if (final.status === 'restricted') {
    await saveConfig({ paused: true, lastError: 'Account restricted by LinkedIn - automation paused, manual review required' });
    notify('restricted', 'LinkedFlow paused - account restricted', 'LinkedIn flagged a checkpoint. Automation stopped; review the account manually before resuming.');
  }
  if (final.status === 'session_expired') {
    notify('session_expired', 'LinkedFlow needs you to log in', 'The LinkedIn session expired - log back in on linkedin.com so automation can resume.');
  }
  if (['error', 'failed_with_reason', 'session_expired', 'restricted', 'limit_reached', 'cannot_connect', 'not_found'].includes(final.status)) {
    const failedJob = await failJob(job.id, final.message || final.status, final);
    if (failedJob?.status === 'failed') {
      notify(`job_failed_${job.id}`, 'LinkedFlow job permanently failed',
        `${job.job_type} for ${job.payload?.linkedin_url || 'a prospect'} failed after ${failedJob.retry_count} retries: ${final.message || final.status}`);
    }
  } else {
    await completeJob(job.id, final);
    // Enforce randomized spacing between sends, per job type, so the NEXT
    // tick's job-eligibility check (below) holds off even if more jobs are queued.
    if (CONNECTION_JOB_TYPES.has(job.job_type) && ['sent', 'invitation_sent'].includes(final.status)) {
      await saveConfig({ nextConnectionAllowedAt: Date.now() + randomDelayMs(3, 7) });
    }
    if (MESSAGE_JOB_TYPES.has(job.job_type) && final.status === 'message_sent') {
      await saveConfig({ nextMessageAllowedAt: Date.now() + randomDelayMs(5, 10) });
    }
  }
  await saveConfig({ currentJob: '', lastSync: new Date().toISOString(), lastError: '' });
}

// ── Main tick ─────────────────────────────────────────────────────────────────
// Heartbeat and job-processing are independent: a heartbeat failure (network
// blip, transient backend error) must NOT prevent job polling/execution from
// running, and vice versa. Previously both lived in one try/catch, so any
// heartbeat error silently skipped job processing for that entire tick.

let consecutiveHeartbeatFailures = 0;
const HEARTBEAT_FAILURE_ALERT_THRESHOLD = 3; // ~3 minutes of failures before alerting

async function tickHeartbeat(cfg) {
  try {
    await heartbeatOnce(cfg);
    if (consecutiveHeartbeatFailures >= HEARTBEAT_FAILURE_ALERT_THRESHOLD) {
      clearNotifyCooldown('heartbeat_down');
    }
    consecutiveHeartbeatFailures = 0;
    return true;
  } catch (err) {
    consecutiveHeartbeatFailures += 1;
    await saveConfig({ lastError: `heartbeat: ${String(err.message || err)}` });
    if (consecutiveHeartbeatFailures >= HEARTBEAT_FAILURE_ALERT_THRESHOLD) {
      notify('heartbeat_down', 'LinkedFlow can\'t reach the backend',
        `${consecutiveHeartbeatFailures} heartbeats in a row have failed: ${String(err.message || err)}`);
    }
    return false;
  }
}

async function tickJobs(cfg) {
  try {
    const data = await pendingJobs(cfg.profileKey);
    const jobs = data.jobs || [];
    const now = Date.now();
    const job = jobs.find(j => {
      if (CONNECTION_JOB_TYPES.has(j.job_type)) return now >= (cfg.nextConnectionAllowedAt || 0);
      if (MESSAGE_JOB_TYPES.has(j.job_type)) return now >= (cfg.nextMessageAllowedAt || 0);
      return true;
    });
    if (job) await runJob(job, cfg);
    return { ok: true, jobs: jobs.length };
  } catch (err) {
    await saveConfig({ lastError: `jobs: ${String(err.message || err)}`, currentJob: '' });
    return { ok: false, error: String(err.message || err) };
  }
}

export async function tick() {
  const cfg = await getConfig();
  if (!cfg.paired || !cfg.profileKey) return { ok: true, skipped: true };
  // Even when paused, keep heartbeating so the dashboard shows "paused" rather
  // than going stale/offline; just skip job execution.
  const heartbeatOk = await tickHeartbeat(cfg);
  if (cfg.paused) return { ok: true, skipped: true, heartbeatOk };
  const jobsResult = await tickJobs(cfg);
  return { ok: heartbeatOk && jobsResult.ok, ...jobsResult };
}
