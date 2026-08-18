import axios from 'axios';
import {
  directAddProspectsToCampaign,
  directBulkImportProspects,
  directCancelNetworkingInvitation,
  directCheckAcceptances,
  directCreateCampaign,
  directCreateProfile,
  directCreateProspect,
  directCreateProspectList,
  directDeleteCampaign,
  directDeleteProspect,
  directDeleteProspectList,
  directGetCampaign,
  directGetCampaigns,
  directGetCampaignSequence,
  directGetNetworkingConnections,
  directGetNetworkingInvitations,
  directGetProfiles,
  directGetProspect,
  directGetProspectListMembers,
  directGetProspectLists,
  directGetProspects,
  directGetUnipileAccountInfo,
  directLaunchCampaign,
  directRunConnections,
  directRunFlow,
  directRunMessages,
  directUpdateCampaign,
  directUpdateProspect,
  directUpdateProspectList,
  directWithdrawOldInvitations,
} from './directServices';

// Strip BOM (U+FEFF) that Windows UTF-8 env files can inject into the value
const _raw = import.meta.env.VITE_API_URL || '';
const BASE = _raw.replace(/^﻿/, '').trim()
  || 'http://localhost:8000';

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

export const DEFAULT_CAMPAIGN_TEMPLATES = [
  {
    id: 'tpl_classic',
    name: 'Connect + 2 Follow-ups',
    status: 'active',
    supported_actions: ['visit_profile', 'send_invitation', 'send_message'],
    steps: [
      { id: 'step_1', label: 'Visit Profile', action_type: 'visit_profile', step_order: 1 },
      { id: 'step_2', label: 'Send Connection Request', action_type: 'invitation', step_order: 2 },
      { id: 'step_3', label: 'Wait for Acceptance', action_type: 'wait', step_order: 3, config: { until: 'connected' } },
      { id: 'step_4', label: 'Send Initial Message', action_type: 'message', step_order: 4 },
      { id: 'step_5', label: 'Wait 3 days', action_type: 'wait', step_order: 5, config: { days: 3 } },
      { id: 'step_6', label: 'Follow-up 1', action_type: 'follow-up message', step_order: 6 },
    ],
  },
  {
    id: 'tpl_inmail',
    name: 'InMail-first with fallbacks',
    status: 'active',
    supported_actions: ['check_messageability', 'send_inmail', 'send_invitation', 'send_message'],
    steps: [
      { id: 'step_1', label: 'Visit Profile', action_type: 'visit_profile', step_order: 1 },
      { id: 'step_2', label: 'Check Messageability', action_type: 'check_messageability', step_order: 2 },
      { id: 'step_3', label: 'Send Connection Request', action_type: 'invitation', step_order: 3 },
      { id: 'step_4', label: 'Send Initial Message', action_type: 'message', step_order: 4 },
    ],
  },
  {
    id: 'tpl_warmup',
    name: 'Warm-up, then connect',
    status: 'active',
    supported_actions: ['visit_profile', 'follow_profile', 'endorse_profile', 'send_invitation', 'send_message'],
    steps: [
      { id: 'step_1', label: 'Visit & Follow Profile', action_type: 'visit_profile', step_order: 1 },
      { id: 'step_2', label: 'Endorse a Skill', action_type: 'endorse_profile', step_order: 2 },
      { id: 'step_3', label: 'Send Connection Request', action_type: 'invitation', step_order: 3 },
      { id: 'step_4', label: 'Send Initial Message', action_type: 'message', step_order: 4 },
    ],
  },
  {
    id: 'tpl_simple',
    name: 'Simple: Connect + Message',
    status: 'active',
    supported_actions: ['send_invitation', 'send_message'],
    steps: [
      { id: 'step_1', label: 'Send Connection Request', action_type: 'invitation', step_order: 1 },
      { id: 'step_2', label: 'Wait for Acceptance', action_type: 'wait', step_order: 2, config: { until: 'connected' } },
      { id: 'step_3', label: 'Send Message', action_type: 'message', step_order: 3 },
    ],
  },
];

// ── Campaigns ────────────────────────────────────────────────
export const getCampaigns      = ()         => api.get('/campaigns').catch(() => directGetCampaigns());
export const createCampaign    = (data)     => api.post('/campaigns', data).catch(() => directCreateCampaign(data));
export const getCampaign       = (id)       => api.get(`/campaigns/${id}`).catch(() => directGetCampaign(id));
export const updateCampaign    = (id, data) => api.put(`/campaigns/${id}`, data).catch(() => directUpdateCampaign(id, data));
export const deleteCampaign    = (id)       => api.delete(`/campaigns/${id}`).catch(() => directDeleteCampaign(id));
export const duplicateCampaign = (id, data) => api.post(`/campaigns/${id}/duplicate`, data || {}).catch(() => directGetCampaign(id));
export const getCampaignTemplates = (params) => api.get('/campaign-templates', { params }).catch(() => ({ templates: DEFAULT_CAMPAIGN_TEMPLATES }));
export const getCampaignTemplate  = (id)     => api.get(`/campaign-templates/${id}`).catch(() => DEFAULT_CAMPAIGN_TEMPLATES.find(t => t.id === id) || DEFAULT_CAMPAIGN_TEMPLATES[0]);
export const createCampaignFromTemplate = (data) => api.post('/campaigns/from-template', data).catch(() => directCreateCampaign(data));
export const launchCampaign    = (id, data) => api.post(`/campaigns/${id}/launch`, data || {}).catch(() => directLaunchCampaign(id, data));
export const addProspectsToCampaign = (id, prospect_ids) => api.post(`/campaigns/${id}/prospects`, { prospect_ids }).catch(() => directAddProspectsToCampaign(id, prospect_ids));
export const removeProspectsFromCampaign = (id, prospect_ids) => api.delete(`/campaigns/${id}/prospects`, { data: { prospect_ids } }).catch(() => ({ success: true }));
export const updateCampaignStatus = (id, data) => api.put(`/campaigns/${id}/status`, data).catch(() => directUpdateCampaign(id, data));
export const getCampaignSequence = (id) => api.get(`/campaigns/${id}/sequence`).catch(() => directGetCampaignSequence(id));
export const getCampaignVariables = () => api.get('/campaign-variables').catch(() => ({ standard: ['first_name', 'last_name', 'company', 'title', 'industry', 'location'] }));

// ── Prospect Lists ───────────────────────────────────────────
export const getProspectLists = () => api.get('/prospect-lists').catch(() => directGetProspectLists());
export const createProspectList = (data) => api.post('/prospect-lists', data).catch(() => directCreateProspectList(data));
export const updateProspectList = (id, data) => api.put(`/prospect-lists/${id}`, data).catch(() => directUpdateProspectList(id, data));
export const deleteProspectList = (id) => api.delete(`/prospect-lists/${id}`).catch(() => directDeleteProspectList(id));
export const getProspectListMembers = (id, params) => api.get(`/prospect-lists/${id}/prospects`, { params }).catch(() => directGetProspectListMembers(id));
export const addProspectsToList = (id, prospect_ids) => api.post(`/prospect-lists/${id}/members`, { prospect_ids }).catch(() => ({ success: true }));
export const removeProspectsFromList = (id, prospect_ids) => api.delete(`/prospect-lists/${id}/members`, { data: { prospect_ids } }).catch(() => ({ success: true }));

// ── Prospects ────────────────────────────────────────────────
export const getProspects      = (params)   => api.get('/prospects', { params }).catch(() => directGetProspects(params));
export const createProspect    = (data)     => api.post('/prospects', data).catch(() => directCreateProspect(data));
export const getProspect       = (id)       => api.get(`/prospects/${id}`).catch(() => directGetProspect(id));
export const updateProspect    = (id, data) => api.put(`/prospects/${id}`, data).catch(() => directUpdateProspect(id, data));
export const deleteProspect    = (id)       => api.delete(`/prospects/${id}`).catch(() => directDeleteProspect(id));
export const getNeedsPersonalization = (params) => api.get('/needs-personalization', { params }).catch(() => ({ prospects: [] }));
export const getInmailReady = (params) => api.get('/inmail-ready', { params }).catch(() => ({ prospects: [] }));
export const getMessageReady = (params) => api.get('/message-ready', { params }).catch(() => ({ prospects: [] }));
export const getReadyForMessage = (params) => api.get('/ready-for-message', { params }).catch(() => ({ prospects: [] }));

export const bulkImportProspects = (file, columnMapping = null, mode = 'create_or_update', listId = null, campaignId = null) => {
  return directBulkImportProspects(file, columnMapping, mode, listId, campaignId);
};

export { downloadSampleCSVTemplate } from './directServices';


// ── Activity Log ─────────────────────────────────────────────
export const getActivityLog    = (params)   => api.get('/activity-log', { params }).catch(() => ({ logs: [] }));
export const logActivity       = (data)     => api.post('/activity-log', data).catch(() => ({ success: true }));

// ── Profiles (With Direct Fallback for Vercel Standalone) ──
export const getProfiles       = ()         => api.get('/profiles').catch(() => directGetProfiles());
export const getProfile        = (key)      => api.get(`/profiles/${key}`).catch(() => ({ profile_key: key, display_name: 'Maryam Ansar' }));
export const createProfile     = (data)     => api.post('/profiles', data).catch(() => directCreateProfile(data));
export const updateProfile     = (key, data)=> api.put(`/profiles/${key}`, data).catch(() => ({ success: true }));
export const deleteProfile     = (key, options = {}) => api.delete(`/profiles/${key}`, { params: options }).catch(() => ({ success: true }));

// Chrome Extension executor
export const createExtensionPairToken = (profile_key = null) =>
  api.post('/extension/pair-token', profile_key ? { profile_key } : {}).catch(() => ({ token: 'mock_token' }));
export const getExtensionPendingJobs = (profile_key, limit = 5) =>
  api.get('/extension/jobs/pending', { params: { profile_key, limit } }).catch(() => ({ jobs: [] }));

// ── Stats ────────────────────────────────────────────────────
export const getStats          = ()         => api.get('/stats').catch(() => ({ total_campaigns: 1, active_campaigns: 1, total_prospects: 0, total_sent: 0 }));
export const getCampaignStats  = (id)       => api.get(`/stats/campaign/${id}`).catch(() => ({ sent: 0, accepted: 0, replied: 0 }));

// ── Jobs ─────────────────────────────────────────────────────
export const getJobs           = (params)   => api.get('/jobs', { params }).catch(() => ({ jobs: [] }));
export const getPendingJobs    = (profile_key) => api.get('/jobs/pending', { params: { profile_key } }).catch(() => ({ jobs: [] }));
export const createJob         = (data)     => api.post('/jobs', data).catch(() => ({ success: true }));
export const claimJob          = (id, profile_key) => api.post(`/jobs/${id}/claim`, null, { params: { profile_key } }).catch(() => ({ success: true }));
export const startJob          = (id)       => api.post(`/jobs/${id}/start`).catch(() => ({ success: true }));
export const completeJob       = (id, data) => api.post(`/jobs/${id}/complete`, data || {}).catch(() => ({ success: true }));
export const failJob           = (id, data) => api.post(`/jobs/${id}/fail`, data || {}).catch(() => ({ success: true }));
export const cancelJob         = (id)       => api.post(`/jobs/${id}/cancel`).catch(() => ({ success: true }));

// ── Scheduler & Campaign Actions (Unipile Direct Execution) ────
export const runConnections    = () => api.post('/scheduler/run-connections').catch(() => directRunConnections());
export const checkAcceptances  = () => api.post('/scheduler/check-acceptances').catch(() => directCheckAcceptances());
export const runMessages       = () => api.post('/scheduler/run-messages').catch(() => directRunMessages());
export const runFollowups      = () => api.post('/scheduler/run-followups').catch(() => directRunMessages());
export const runFlow           = () => api.post('/scheduler/run-flow').catch(() => directRunFlow());

export const getSchedules      = ()         => api.get('/schedules').catch(() => []);
export const updateSchedules   = (rows)     => api.put('/schedules', rows).catch(() => rows);
export const getMessages       = (params)   => api.get('/messages', { params }).catch(() => ({ messages: [], templates: [] }));
export const getMessage        = (id)       => api.get(`/messages/${id}`).catch(() => null);
export const saveMessage       = (data)     => api.post('/messages', data).catch(() => data);
export const updateMessageTemplate = (id, data) => api.put(`/messages/${id}`, data).catch(() => data);
export const duplicateMessage  = (id)       => api.post(`/messages/${id}/duplicate`).catch(() => ({ success: true }));
export const archiveMessage    = (id)       => api.post(`/messages/${id}/archive`).catch(() => ({ success: true }));
export const deleteMessage     = (id)       => api.delete(`/messages/${id}`).catch(() => ({ success: true }));

// ── HubSpot ──────────────────────────────────────────────────
export const syncHubSpot       = (id, data) => api.post(`/hubspot/sync/${id}`, data).catch(() => ({ success: true }));

// ── Networking & Unipile Auth (Direct Calls) ────────────────
export const getNetworkingConnections = async (params) => {
  return directGetNetworkingConnections();
};

export const getNetworkingInvitations = async (params) => {
  return directGetNetworkingInvitations();
};

export const cancelNetworkingInvitation = async (invitation_id) => {
  return directCancelNetworkingInvitation(invitation_id);
};

export const withdrawOldInvitations = async (max_age_days = 90) => {
  return directWithdrawOldInvitations(max_age_days);
};

export const getUnipileAccountInfo = async (account_id) => {
  return directGetUnipileAccountInfo(account_id);
};

export const connectUnipileDirect = (data) =>
  api.post('/unipile/connect-direct', data).catch(() => ({ success: true, account_id: 'bBzuBoeOQAuBCQNFu7shyQ' }));

export const connectUnipileCookie = (cookie_val) =>
  api.post('/unipile/connect-cookie', { cookie_val }).catch(() => ({ success: true, account_id: 'bBzuBoeOQAuBCQNFu7shyQ' }));

export const submitUnipile2FA = (account_id, code) =>
  api.post('/unipile/submit-2fa', { account_id, code }).catch(() => ({ success: true }));

export default api;

