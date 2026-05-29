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
export const deleteCampaign    = (id)       => api.delete(`/campaigns/${id}`);
export const getCampaignTemplates = (params) => api.get('/campaign-templates', { params });
export const getCampaignTemplate  = (id)     => api.get(`/campaign-templates/${id}`);
export const createCampaignFromTemplate = (data) => api.post('/campaigns/from-template', data);
export const launchCampaign    = (id, data) => api.post(`/campaigns/${id}/launch`, data || {});
export const updateCampaignStatus = (id, data) => api.put(`/campaigns/${id}/status`, data);
export const getCampaignSequence = (id) => api.get(`/campaigns/${id}/sequence`);
export const getCampaignVariables = () => api.get('/campaign-variables');
export const getProspectLists = () => api.get('/prospect-lists');
export const createProspectList = (data) => api.post('/prospect-lists', data);
export const addProspectsToList = (id, prospect_ids) => api.post(`/prospect-lists/${id}/members`, { prospect_ids });

// ── Prospects ────────────────────────────────────────────────
export const getProspects      = (params)   => api.get('/prospects', { params });
export const createProspect    = (data)     => api.post('/prospects', data);
export const getProspect       = (id)       => api.get(`/prospects/${id}`);
export const updateProspect    = (id, data) => api.put(`/prospects/${id}`, data);
export const deleteProspect    = (id)       => api.delete(`/prospects/${id}`);
export const getNeedsPersonalization = (params) => api.get('/needs-personalization', { params });
export const bulkImportProspects = (file, campaignId, mode = 'create_or_update') => {
  const fd = new FormData();
  fd.append('file', file);
  if (campaignId) fd.append('campaign_id', campaignId);
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
export const createProfile     = (data)     => api.post('/profiles', data);
export const updateProfile     = (key, data)=> api.put(`/profiles/${key}`, data);

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
export const getMessages       = ()         => api.get('/messages');
export const saveMessage       = (data)     => api.post('/messages', data);

// ── HubSpot ──────────────────────────────────────────────────
export const syncHubSpot       = (id, data) => api.post(`/hubspot/sync/${id}`, data);

export default api;
