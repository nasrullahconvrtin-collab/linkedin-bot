import { getConfig, saveConfig } from './storage.js';

async function request(path, options = {}) {
  const config = await getConfig();
  const base = (config.backendUrl || '').replace(/\/$/, '');
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return await res.json();
}

export async function pairExtension(payload) {
  const data = await request('/extension/pair', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  await saveConfig({
    paired: true,
    profileKey: data.profile?.profile_key || payload.profile_key,
    displayName: data.profile?.display_name || payload.display_name || payload.profile_key,
    lastError: '',
  });
  return data;
}

export async function heartbeat(runtime) {
  return request('/extension/heartbeat', {
    method: 'POST',
    body: JSON.stringify(runtime),
  });
}

export async function pendingJobs(profileKey) {
  return request(`/extension/jobs/pending?profile_key=${encodeURIComponent(profileKey)}&limit=5`);
}

export async function claimJob(jobId, profileKey) {
  return request(`/extension/jobs/${jobId}/claim`, {
    method: 'POST',
    body: JSON.stringify({ profile_key: profileKey }),
  });
}

export async function startJob(jobId) {
  return request(`/extension/jobs/${jobId}/start`, { method: 'POST', body: '{}' });
}

export async function completeJob(jobId, result) {
  return request(`/extension/jobs/${jobId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ result }),
  });
}

export async function failJob(jobId, errorMessage, result = {}) {
  return request(`/extension/jobs/${jobId}/fail`, {
    method: 'POST',
    body: JSON.stringify({ error_message: errorMessage, result }),
  });
}
