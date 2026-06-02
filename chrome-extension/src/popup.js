import { pairExtension } from './api.js';
import { clearConfig, extensionId, getConfig, saveConfig } from './storage.js';

const $ = (id) => document.getElementById(id);

async function render() {
  const cfg = await getConfig();
  if (!cfg.extensionId) await saveConfig({ extensionId: extensionId() });
  $('backendUrl').value = cfg.backendUrl || '';
  $('profileKey').value = cfg.profileKey || '';
  $('status').textContent = cfg.paired ? (cfg.paused ? 'Connected, paused' : 'Connected') : 'Not connected';
  $('profile').textContent = cfg.profileKey || '-';
  $('job').textContent = cfg.currentJob || 'None';
  $('sync').textContent = cfg.lastSync ? new Date(cfg.lastSync).toLocaleTimeString() : 'Never';
  $('error').textContent = cfg.lastError || 'None';
  $('pause').textContent = cfg.paused ? 'Resume Automation' : 'Pause Automation';
}

$('connect').addEventListener('click', async () => {
  const cfg = await getConfig();
  const backendUrl = $('backendUrl').value.trim();
  const profileKey = $('profileKey').value.trim();
  await saveConfig({ backendUrl, profileKey, extensionId: cfg.extensionId || extensionId() });
  const fresh = await getConfig();
  try {
    await pairExtension({
      token: $('token').value.trim(),
      extension_id: fresh.extensionId,
      profile_key: profileKey,
      display_name: profileKey,
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

$('dashboard').addEventListener('click', () => chrome.tabs.create({ url: 'https://linkedflow-dashboard.vercel.app/settings' }));

$('clear').addEventListener('click', async () => {
  if (confirm('Clear local extension pairing/settings? Jobs and prospects stay in LinkedFlow.')) {
    await clearConfig();
    render();
  }
});

render();
