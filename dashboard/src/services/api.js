import axios from 'axios';

// Strip BOM (U+FEFF) that Windows UTF-8 env files can inject into the value
const _raw = import.meta.env.VITE_API_URL || '';
const BASE = _raw.replace(/^﻿/, '').trim()
  || 'https://linkedin-bot-backend-production.up.railway.app';

const api = axios.create({
  baseURL: BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (r) => r.data,
  (err) => {
    const msg = err.response?.data?.detail || err.message || 'Request failed';
    return Promise.reject(new Error(msg));
  }
);

// ── Campaigns ────────────────────────────────────────────────
export const getCampaigns      = ()         => api.get('/campaigns');
export const createCampaign    = (data)     => api.post('/campaigns', data);
export const getCampaign       = (id)       => api.get(`/campaigns/${id}`);
export const updateCampaign    = (id, data) => api.put(`/campaigns/${id}`, data);
export const deleteCampaign    = (id)       => api.delete(`/campaigns/${id}`);
export const duplicateCampaign = (id, data) => api.post(`/campaigns/${id}/duplicate`, data || {});
export const getCampaignTemplates = (params) => api.get('/campaign-templates', { params });
export const getCampaignTemplate  = (id)     => api.get(`/campaign-templates/${id}`);
export const createCampaignFromTemplate = (data) => api.post('/campaigns/from-template', data);
export const launchCampaign    = (id, data) => api.post(`/campaigns/${id}/launch`, data || {});
export const addProspectsToCampaign = (id, prospect_ids) => api.post(`/campaigns/${id}/prospects`, { prospect_ids });
export const removeProspectsFromCampaign = (id, prospect_ids) => api.delete(`/campaigns/${id}/prospects`, { data: { prospect_ids } });
export const updateCampaignStatus = (id, data) => api.put(`/campaigns/${id}/status`, data);
export const getCampaignSequence = (id) => api.get(`/campaigns/${id}/sequence`);
export const getCampaignVariables = () => api.get('/campaign-variables');
export const getProspectLists = () => api.get('/prospect-lists');
export const createProspectList = (data) => api.post('/prospect-lists', data);
export const updateProspectList = (id, data) => api.put(`/prospect-lists/${id}`, data);
export const deleteProspectList = (id) => api.delete(`/prospect-lists/${id}`);
export const getProspectListMembers = (id, params) => api.get(`/prospect-lists/${id}/prospects`, { params });
export const addProspectsToList = (id, prospect_ids) => api.post(`/prospect-lists/${id}/members`, { prospect_ids });
export const removeProspectsFromList = (id, prospect_ids) => api.delete(`/prospect-lists/${id}/members`, { data: { prospect_ids } });

// ── Prospects ────────────────────────────────────────────────
export const getProspects      = (params)   => api.get('/prospects', { params });
export const createProspect    = (data)     => api.post('/prospects', data);
export const getProspect       = (id)       => api.get(`/prospects/${id}`);
export const updateProspect    = (id, data) => api.put(`/prospects/${id}`, data);
export const deleteProspect    = (id)       => api.delete(`/prospects/${id}`);
export const getNeedsPersonalization = (params) => api.get('/needs-personalization', { params });
export const getInmailReady = (params) => api.get('/inmail-ready', { params });
export const getMessageReady = (params) => api.get('/message-ready', { params });
export const getReadyForMessage = (params) => api.get('/ready-for-message', { params });
export const bulkImportProspects = (file, campaignId, mode = 'create_or_update', listId = null) => {
  const fd = new FormData();
  fd.append('file', file);
  if (campaignId) fd.append('campaign_id', campaignId);
  if (listId) fd.append('list_id', listId);
  return api.post('/prospects/bulk', fd, {
    params: { mode },
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

// ── Activity Log ─────────────────────────────────────────────
export const getActivityLog    = (params)   => api.get('/activity-log', { params });
export const logActivity       = (data)     => api.post('/activity-log', data);

// ── Profiles ─────────────────────────────────────────────────
export const getProfiles       = ()         => api.get('/profiles');
export const getProfile        = (key)      => api.get(`/profiles/${key}`);
export const createProfile     = (data)     => api.post('/profiles', data);
export const updateProfile     = (key, data)=> api.put(`/profiles/${key}`, data);
export const deleteProfile     = (key, options = {}) => api.delete(`/profiles/${key}`, { params: options });

// Chrome Extension executor
export const createExtensionPairToken = (profile_key = null) =>
  api.post('/extension/pair-token', profile_key ? { profile_key } : {});
export const getExtensionPendingJobs = (profile_key, limit = 5) =>
  api.get('/extension/jobs/pending', { params: { profile_key, limit } });

// ── Stats ────────────────────────────────────────────────────
export const getStats          = ()         => api.get('/stats');
export const getCampaignStats  = (id)       => api.get(`/stats/campaign/${id}`);

// ── Jobs ─────────────────────────────────────────────────────
export const getJobs           = (params)   => api.get('/jobs', { params });
export const getPendingJobs    = (profile_key) => api.get('/jobs/pending', { params: { profile_key } });
export const createJob         = (data)     => api.post('/jobs', data);
export const claimJob          = (id, profile_key) => api.post(`/jobs/${id}/claim`, null, { params: { profile_key } });
export const startJob          = (id)       => api.post(`/jobs/${id}/start`);
export const completeJob       = (id, data) => api.post(`/jobs/${id}/complete`, data || {});
export const failJob           = (id, data) => api.post(`/jobs/${id}/fail`, data || {});
export const cancelJob         = (id)       => api.post(`/jobs/${id}/cancel`);

// ── Scheduler ────────────────────────────────────────────────
export const runConnections    = ()         => api.post('/scheduler/run-connections');
export const checkAcceptances  = ()         => api.post('/scheduler/check-acceptances');
export const runMessages       = ()         => api.post('/scheduler/run-messages');
export const runFollowups      = ()         => api.post('/scheduler/run-followups');
export const getSchedules      = ()         => api.get('/schedules');
export const updateSchedules   = (rows)     => api.put('/schedules', rows);
export const getMessages       = (params)   => api.get('/messages', { params });
export const getMessage        = (id)       => api.get(`/messages/${id}`);
export const saveMessage       = (data)     => api.post('/messages', data);
export const updateMessageTemplate = (id, data) => api.put(`/messages/${id}`, data);
export const duplicateMessage  = (id)       => api.post(`/messages/${id}/duplicate`);
export const archiveMessage    = (id)       => api.post(`/messages/${id}/archive`);
export const deleteMessage     = (id)       => api.delete(`/messages/${id}`);

// ── HubSpot ──────────────────────────────────────────────────
export const syncHubSpot       = (id, data) => api.post(`/hubspot/sync/${id}`, data);

export default api;
