import { pairExtension } from './api.js';
import { clearConfig, extensionId, getConfig, saveConfig } from './storage.js';

const $ = (id) => document.getElementById(id);

async function render() {
  const cfg = await getConfig();
  if (!cfg.extensionId) await saveConfig({ extensionId: extensionId() });
  // Backend URL has a built-in default (DEFAULTS.backendUrl) — most users never
  // need to see or touch it, so it lives behind "Advanced" and is only shown
  // here for self-hosters who override it.
  $('backendUrl').value = cfg.backendUrl || '';
  $('status').textContent = cfg.paired ? (cfg.paused ? 'Connected, paused' : 'Connected') : 'Not connected';
  $('profile').textContent = cfg.displayName || cfg.profileKey || '-';
  $('job').textContent = cfg.currentJob || 'None';
  $('sync').textContent = cfg.lastSync ? new Date(cfg.lastSync).toLocaleTimeString() : 'Never';
  $('error').textContent = cfg.lastError || 'None';
  $('pause').textContent = cfg.paused ? 'Resume Automation' : 'Pause Automation';
  // Once paired, the one-field connect card is no longer needed — collapse it
  // out of the way so returning users land straight on their status.
  const connectCard = $('connectCard');
  if (connectCard) connectCard.style.display = cfg.paired ? 'none' : '';
}

$('connect').addEventListener('click', async () => {
  const cfg = await getConfig();
  const token = $('token').value.trim();
  if (!token) {
    await saveConfig({ lastError: 'Paste the pairing code from LinkedFlow → Settings first' });
    return render();
  }
  // Only persist a custom backend URL if the user actually opened "Advanced"
  // and changed it — otherwise keep the built-in default from DEFAULTS.
  const backendUrlInput = $('backendUrl').value.trim();
  const updates = { extensionId: cfg.extensionId || extensionId() };
  if (backendUrlInput) updates.backendUrl = backendUrlInput;
  await saveConfig(updates);
  const fresh = await getConfig();
  try {
    // No profile_key sent: the pairing code already carries (or auto-creates)
    // the right profile server-side, so the user never has to invent one.
    await pairExtension({
      token,
      extension_id: fresh.extensionId,
      extension_version: '0.1.0',
      linkedin_login_status: 'unknown',
    });
    $('token').value = '';
  } catch (err) {
    await saveConfig({ lastError: String(err.message || err) });
  }
  render();
});

$('syncNow').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'sync_now' });
  if (!res?.ok) await saveConfig({ lastError: res?.error || 'Sync failed' });
  render();
});

$('pause').addEventListener('click', async () => {
  const cfg = await getConfig();
  await saveConfig({ paused: !cfg.paused });
  render();
});

$('closeTab').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'close_automation_tab' });
  render();
});

$('dashboard').addEventListener('click', () => chrome.tabs.create({ url: 'https://linkedflow-dashboard.vercel.app/settings' }));

$('clear').addEventListener('click', async () => {
  if (confirm('Clear local extension pairing/settings? Jobs and prospects stay in LinkedFlow.')) {
    await clearConfig();
    render();
  }
});

render();
