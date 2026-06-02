export const DEFAULTS = {
  backendUrl: 'https://linkedin-bot-backend-production.up.railway.app',
  profileKey: '',
  extensionId: '',
  displayName: '',
  paired: false,
  paused: false,
  lastSync: '',
  lastError: '',
  currentJob: '',
};

export async function getConfig() {
  return await chrome.storage.local.get(DEFAULTS);
}

export async function saveConfig(updates) {
  await chrome.storage.local.set(updates);
  return getConfig();
}

export async function clearConfig() {
  await chrome.storage.local.clear();
  return DEFAULTS;
}

export function extensionId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
