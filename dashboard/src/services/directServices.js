import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://mjwganpjawthnowemabt.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDczMTUsImV4cCI6MjEwMTg4MzMxNX0.OwKeHoH2DH-jS7-_XRf6Vkx4bNZPKgbL9WOr5oSd27c';
const UNIPILE_API_KEY = '6SlhX8Ii.R7wP5y2dLTREmrXKCTpnoEg3clwHKT9wZtIc++MRAkg=';
const UNIPILE_BASE_URL = 'https://api20.unipile.com:15032/api/v1';

export const supabaseDirect = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const getUnipileBaseUrl = () => {
  if (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')) {
    return '/api/unipile';
  }
  return UNIPILE_BASE_URL;
};

export const unipileFetch = async (endpoint, options = {}) => {
  const headers = {
    'X-API-KEY': UNIPILE_API_KEY,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  try {
    const primaryUrl = `${getUnipileBaseUrl()}${endpoint}`;
    let res = await fetch(primaryUrl, { ...options, headers });
    
    if (!res.ok && primaryUrl.startsWith('/api/unipile')) {
      const fallbackUrl = `${UNIPILE_BASE_URL}${endpoint}`;
      res = await fetch(fallbackUrl, { ...options, headers });
    }

    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error('Direct Unipile fetch error:', err);
    try {
      const fallbackUrl = `${UNIPILE_BASE_URL}${endpoint}`;
      const res = await fetch(fallbackUrl, { ...options, headers });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, status: 500, data: null };
    }
  }
};

export const getStoredDisconnectedFlag = () => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem('lf_account_disconnected') === 'true';
    }
  } catch (e) {}
  return false;
};

export const getActiveUserAccount = () => {
  try {
    const str = localStorage.getItem('lf_user_account');
    if (str) return JSON.parse(str);

    if (typeof window !== 'undefined' && window.localStorage && localStorage.getItem('lf_auth') === '1') {
      const isSuper = localStorage.getItem('lf_is_superadmin') === '1';
      const userObj = {
        id: isSuper ? 'usr_superadmin' : `usr_${Date.now()}`,
        email: isSuper ? 'nasrullah.freelancer@gmail.com' : 'user@linkedflow.com',
        display_name: isSuper ? 'Muhammad Nasrullah' : 'Member User',
        organization_id: isSuper ? '00000000-0000-0000-0000-000000000001' : '00000000-0000-0000-0000-000000000002',
        role: isSuper ? 'superadmin' : 'member'
      };
      localStorage.setItem('lf_user_account', JSON.stringify(userObj));
      return userObj;
    }
  } catch (e) {}
  return null;
};

export const isSuperAdminUser = () => {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  
  const isSuperFlag = localStorage.getItem('lf_is_superadmin') === '1';
  if (!isSuperFlag) return false;

  const userAcc = getActiveUserAccount();
  if (userAcc) {
    const email = (userAcc.email || '').toLowerCase();
    const role = (userAcc.role || '').toLowerCase();
    if (email === 'nasrullah.freelancer@gmail.com' || email === 'nasrullah.freelancer@gmail.con' || role === 'superadmin') {
      return true;
    }
    // Purge stale super admin flag — this is a normal member account
    localStorage.removeItem('lf_is_superadmin');
    return false;
  }

  // No user account found — cannot confirm super admin, purge the stale flag
  localStorage.removeItem('lf_is_superadmin');
  return false;
};

export const getActiveOrganizationId = () => {
  try {
    const userAcc = getActiveUserAccount();
    if (userAcc) {
      if (userAcc.organization_id) return userAcc.organization_id;
      if (userAcc.email) return `org_${userAcc.email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    }
  } catch (e) {}
  return null;
};

let activeAccountId = null;

export const directGetProfiles = async () => {
  const isSuper = isSuperAdminUser();
  const orgId = getActiveOrganizationId();
  const userAcc = getActiveUserAccount();
  const userEmail = userAcc?.email ? userAcc.email.toLowerCase() : null;

  try {
    const { data, error } = await supabaseDirect.from('profiles').select('*');
    if (!error && data && data.length > 0) {
      // Only real LinkedIn profiles with unipile_account_id
      const realProfiles = data.filter(p => {
        if (p.profile_key?.startsWith('user_')) return false;
        if (!p.unipile_account_id) return false;

        const pOrgId = p.organization_id || p.settings?.organization_id || p.settings?.orgId;
        const pEmail = (p.user_email || p.settings?.user_email || p.settings?.email || '').toLowerCase();

        // If super admin, ONLY return superadmin profile (Muhammad Nasrullah)
        if (isSuper) {
          if (pOrgId === '00000000-0000-0000-0000-000000000001' || pEmail === 'nasrullah.freelancer@gmail.com') return true;
          return false;
        }

        // For member users, STRICTLY match their orgId or userEmail
        if (orgId && pOrgId && pOrgId === orgId) return true;
        if (userEmail && pEmail && pEmail === userEmail) return true;
        return false;
      });

      return realProfiles.map(p => ({
        profile_key: p.profile_key || p.id || `prof_${p.id}`,
        display_name: p.display_name || 'LinkedIn Profile',
        unipile_account_id: p.unipile_account_id || null,
        session_active: p.session_active ?? p.settings?.session_active ?? true,
        enabled: p.enabled ?? p.settings?.enabled ?? true,
        daily_sent: p.daily_sent || p.settings?.daily_sent || 0,
      }));
    }
  } catch (e) {
    console.warn('Supabase fetch error:', e);
  }

  // Return empty array if no profiles exist
  return [];
};


export const directCreateProfile = async (data) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem('lf_account_disconnected');
    }
  } catch (e) {}

  const userAcc = getActiveUserAccount();
  const orgId = getActiveOrganizationId();
  const profile_key = data.profile_key || `prof_${Date.now()}`;
  const display_name = data.display_name || 'LinkedIn Profile';
  const unipile_account_id = data.unipile_account_id || null;
  activeAccountId = unipile_account_id;

  const email = userAcc?.email ? userAcc.email.toLowerCase() : null;

  try {
    await supabaseDirect.from('profiles').upsert([
      {
        profile_key,
        display_name,
        unipile_account_id,
        status: 'active',
        organization_id: orgId || userAcc?.organization_id || null,
        user_email: email,
        session_active: true,
        enabled: true,
        settings: {
          organization_id: orgId || userAcc?.organization_id || null,
          user_email: email,
          session_active: true,
          enabled: true,
          ...(data.settings || {}),
        },
        updated_at: new Date().toISOString(),
      },
    ], { onConflict: 'profile_key' });
  } catch (err) {
    console.warn('Supabase upsert warning:', err);
  }
  return {
    profile_key,
    display_name,
    unipile_account_id,
    session_active: true,
    enabled: true,
  };
};

export const directDisconnectProfile = async () => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem('lf_account_disconnected', 'true');
    }
  } catch (e) {}

  const orgId = getActiveOrganizationId();
  const userAcc = getActiveUserAccount();
  const userEmail = userAcc?.email ? userAcc.email.toLowerCase() : null;

  try {
    const { data: allProfiles } = await supabaseDirect.from('profiles').select('id, profile_key, settings');
    if (allProfiles && allProfiles.length > 0) {
      for (const p of allProfiles) {
        if (p.profile_key?.startsWith('user_')) continue;
        const pOrgId = p.organization_id || p.settings?.organization_id || p.settings?.orgId;
        const pEmail = (p.user_email || p.settings?.user_email || p.settings?.email || '').toLowerCase();
        if ((orgId && pOrgId === orgId) || (userEmail && pEmail === userEmail)) {
          await supabaseDirect.from('profiles').delete().eq('id', p.id);
        }
      }
    }
  } catch (err) {
    console.warn('directDisconnectProfile error:', err);
  }

  activeAccountId = null;

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('lf_chat_sent_messages_')) {
          localStorage.removeItem(key);
        }
      });
    }
  } catch (e) {}

  return { success: true };
};

export const directGetUnipileAccountInfo = async (accountId = null) => {
  const userProfiles = await directGetProfiles();
  const targetAccId = accountId || userProfiles[0]?.unipile_account_id;
  if (!targetAccId) return null;

  try {
    const { ok, data } = await unipileFetch(`/accounts/${targetAccId}`);
    if (ok && data && data.id) {
      const imParam = data.connection_params?.im || {};
      const realName = data.name || imParam.username || userProfiles[0]?.display_name || 'LinkedIn Profile';
      return {
        id: data.id,
        name: realName,
        username: imParam.publicIdentifier || imParam.username || realName || 'connected_user',
        provider: data.type || 'LINKEDIN',
        status: data.sources?.[0]?.status || 'CONNECTED',
        headline: imParam.headline || 'LinkedIn Outreach Profile',
      };
    }
  } catch (e) {
    console.warn('Fetch account error:', e);
  }

  return null;
};

export const directGetNetworkingConnections = async () => {
  const userProfiles = await directGetProfiles();
  const targetAccId = userProfiles[0]?.unipile_account_id;
  if (!targetAccId) {
    return { success: true, connections: [], total: 0 };
  }

  let allItems = [];
  let cursor = null;

  for (let page = 0; page < 50; page += 1) {
    let path = `/users/relations?account_id=${targetAccId}&limit=100`;
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
    
    const { ok, data } = await unipileFetch(path);
    if (!ok || !data) break;
    
    const items = data.items || data.relations || (Array.isArray(data) ? data : []);
    if (items.length > 0) {
      allItems = allItems.concat(items);
    }
    
    cursor = data.cursor;
    if (!cursor || items.length === 0) break;
  }

  return {
    success: true,
    connections: allItems,
    total: allItems.length,
  };
};

export const directGetNetworkingInvitations = async () => {
  const userProfiles = await directGetProfiles();
  const targetAccId = userProfiles[0]?.unipile_account_id;
  if (!targetAccId) {
    return { success: true, invitations: [], total: 0 };
  }

  let allItems = [];
  let cursor = null;

  try {
    for (let page = 0; page < 50; page += 1) {
      let path = `/users/invite/sent?account_id=${targetAccId}&limit=100`;
      if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
      
      const { ok, data } = await unipileFetch(path);
      if (!ok || !data) break;
      
      const items = data.items || data.invitations || (Array.isArray(data) ? data : []);
      if (items.length > 0) {
        allItems = allItems.concat(items);
      }
      
      cursor = data.cursor;
      if (!cursor || items.length === 0) break;
    }
  } catch (e) {
    console.warn('Unipile fetch invitations error:', e);
  }

  return {
    success: true,
    invitations: allItems,
    total: allItems.length,
  };
};

export const directCancelNetworkingInvitation = async (invitationId) => {
  const userProfiles = await directGetProfiles();
  const targetAccId = userProfiles[0]?.unipile_account_id;
  if (!targetAccId) return { success: false };

  const { ok } = await unipileFetch(`/users/invite/sent/${invitationId}?account_id=${targetAccId}`, {
    method: 'DELETE',
  });
  return { success: ok };
};

export const directWithdrawOldInvitations = async (maxAgeDays = 90) => {
  const { invitations } = await directGetNetworkingInvitations();
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let count = 0;
  
  for (const inv of invitations || []) {
    const sentTs = inv.parsed_datetime || inv.sent_at || inv.created_at || inv.timestamp;
    const invMs = sentTs ? new Date(sentTs).getTime() : 0;
    
    if (invMs > 0 && invMs <= cutoffMs) {
      const invId = inv.id || inv.invitation_id;
      if (invId) {
        const { success } = await directCancelNetworkingInvitation(invId);
        if (success) count += 1;
      }
    }
  }
  return { success: true, withdrawn_count: count };
};

// ── Unipile & Supabase Campaign / Prospect / List Direct Operations ──

export const directGetCampaigns = async () => {
  const userAcc = getActiveUserAccount();
  const orgId = getActiveOrganizationId();
  const userEmail = userAcc?.email ? userAcc.email.toLowerCase() : null;
  const isSuper = isSuperAdminUser();

  try {
    const { data: rawCampaigns, error } = await supabaseDirect.from('campaigns').select('*').order('created_at', { ascending: false });
    if (!error && rawCampaigns) {
      const campaigns = rawCampaigns;

      const { data: prospects } = await supabaseDirect.from('prospects').select('id, campaign_id, status, connection_status, connection_sent_date, message_sent_date, custom_variables');
      const prospectMap = new Map();
      (prospects || []).forEach(p => {
        if (!p.campaign_id) return;
        if (!prospectMap.has(p.campaign_id)) {
          prospectMap.set(p.campaign_id, { total: 0, sent: 0, accepted: 0, replied: 0, completed: 0, actions_executed: 0 });
        }
        const stats = prospectMap.get(p.campaign_id);
        stats.total += 1;
        if (p.status && p.status !== 'Not Contacted' && p.status !== '') {
          stats.sent += 1;
        }
        if (['Connection Accepted', 'CONNECTED', 'Replied'].includes(p.status)) {
          stats.accepted += 1;
        }
        if (p.status?.toLowerCase() === 'replied' || p.custom_variables?.reply_date) {
          stats.replied += 1;
        }
        if (['Completed', 'Replied', 'replied', 'No Response'].includes(p.status) || p.reply_date) {
          stats.completed += 1;
        }

        let actions = 0;
        if (p.custom_variables && Array.isArray(p.custom_variables.history)) {
          actions = p.custom_variables.history.filter(h => h.status === 'success' || h.status === 'replied').length;
        } else if (p.status && p.status !== 'Not Contacted' && p.status !== '') {
          actions = 1;
        }
        stats.actions_executed += actions;
      });

      return campaigns.map(c => {
        const stats = prospectMap.get(c.id) || { total: 0, sent: 0, accepted: 0, replied: 0, completed: 0, actions_executed: 0 };
        const flowNodes = c.sequence_config?.flow_sequence?.nodes || [];
        const steps_count = flowNodes.filter(n => ['visit_profile', 'follow_profile', 'endorse_profile', 'send_invitation', 'send_message', 'wait'].includes(n.data?.nodeType)).length || c.sequence_config?.steps?.length || 0;
        
        let days_running = 0;
        flowNodes.forEach(n => {
          if (n.data?.nodeType === 'wait' && n.data?.config?.days) {
            days_running += Number(n.data.config.days);
          }
        });
        if (days_running === 0) {
          const delays = c.sequence_config?.delays || {};
          Object.values(delays).forEach(d => {
            if (d?.days) days_running += Number(d.days);
          });
        }

        let progress_sum = 0;
        const cProspects = (prospects || []).filter(p => p.campaign_id === c.id);
        cProspects.forEach(p => {
          if (p.status === 'Completed' || p.status === 'Replied') {
            progress_sum += 100;
          } else if (p.status === 'Not Contacted' || p.status === 'queued') {
            progress_sum += 0;
          } else {
            const currentStep = p.current_step || 1;
            const totalSteps = steps_count || 4;
            progress_sum += Math.min(100, Math.round((currentStep / totalSteps) * 100));
          }
        });
        const progress_percentage = stats.total > 0 ? Math.round(progress_sum / stats.total) : 0;

        return {
          ...c,
          prospect_count: stats.total,
          contacts: stats.total,
          sent: stats.sent,
          accepted: stats.accepted,
          replied: stats.replied,
          completed: stats.completed,
          actions_executed: stats.actions_executed,
          replies_count: stats.replied,
          steps_count,
          days_running,
          progress_percentage,
        };
      });
    }
  } catch (e) {
    console.warn('directGetCampaigns warning:', e);
  }
  return [];
};

export const directCreateCampaign = async (data) => {
  const userAcc = getActiveUserAccount();
  const orgId = getActiveOrganizationId();
  const email = userAcc?.email ? userAcc.email.toLowerCase() : null;

  const payload = {
    name: data.name || 'New Campaign',
    status: data.status || 'draft',
    organization_id: orgId || userAcc?.organization_id || null,
    user_email: email,
    profile_key: data.profile_key || (data.settings && data.settings.profile_key) || 'profile_1',
    daily_limit: data.daily_limit || 25,
    sequence_config: data.sequence_config || {},
    created_at: new Date().toISOString(),
  };

  try {
    const { data: res, error } = await supabaseDirect.from('campaigns').insert([payload]).select();
    if (error) console.error('directCreateCampaign error:', error);
    if (!error && res && res[0]) return res[0];
  } catch (e) {
    console.warn('directCreateCampaign warning:', e);
  }
  return { id: crypto.randomUUID(), ...payload };
};

export const directGetCampaign = async (id) => {
  try {
    const { data: campaign, error } = await supabaseDirect.from('campaigns').select('*').eq('id', id).single();
    if (!error && campaign) {
      const { data: prospects } = await supabaseDirect
        .from('prospects')
        .select('id, campaign_id, status, connection_status, connection_sent_date, message_sent_date, custom_variables')
        .eq('campaign_id', id);
      
      const rows = prospects || [];
      
      const flowNodes = campaign.sequence_config?.flow_sequence?.nodes || [];
      const steps_count = flowNodes.filter(n => ['visit_profile', 'follow_profile', 'endorse_profile', 'send_invitation', 'send_message', 'wait'].includes(n.data?.nodeType)).length || campaign.sequence_config?.steps?.length || 0;
      
      let days_running = 0;
      flowNodes.forEach(n => {
        if (n.data?.nodeType === 'wait' && n.data?.config?.days) {
          days_running += Number(n.data.config.days);
        }
      });
      if (days_running === 0) {
        const delays = campaign.sequence_config?.delays || {};
        Object.values(delays).forEach(d => {
          if (d?.days) days_running += Number(d.days);
        });
      }

      let actions_executed = 0;
      rows.forEach(p => {
        if (p.custom_variables && Array.isArray(p.custom_variables.history)) {
          actions_executed += p.custom_variables.history.filter(h => h.status === 'success' || h.status === 'replied').length;
        } else if (p.status && p.status !== 'Not Contacted' && p.status !== '') {
          actions_executed += 1;
        }
      });

      const stats = {
        total: rows.length,
        contacts: rows.length,
        sent: rows.filter(r => r.status === 'Connection Requested' || r.status === 'Connection Request Sent' || r.status === 'Sent' || r.connection_sent_date || r.connection_status === 'invitation_sent').length,
        accepted: rows.filter(r => r.status === 'Connection Accepted' || r.status === 'Accepted').length,
        already_connected: rows.filter(r => r.connection_status === 'connected').length,
        ready_for_message: rows.filter(r => r.status === 'Ready to Send').length,
        messaged: rows.filter(r => r.status === 'Initial Message Sent' || r.status === 'Message Sent' || r.message_sent_date).length,
        following_up: rows.filter(r => r.status === 'Following Up').length,
        followup_due: rows.filter(r => r.status === 'Following Up').length,
        completed: rows.filter(r => ['Replied', 'replied', 'No Response', 'Completed'].includes(r.status) || r.custom_variables?.reply_date).length,
        failed: rows.filter(r => ['Needs Attention', 'failed', 'error', 'needs_attention'].includes(r.status?.toLowerCase())).length,
        replied: rows.filter(r => r.status?.toLowerCase() === 'replied' || r.custom_variables?.reply_date).length,
        no_response: rows.filter(r => r.status === 'No Response').length,
        sequence_complete: rows.filter(r => r.status === 'Completed').length,
        needs_attention: rows.filter(r => r.status === 'Needs Attention').length,
        actions_executed,
        replies_count: rows.filter(r => r.status?.toLowerCase() === 'replied' || r.custom_variables?.reply_date).length,
        steps_count,
        days_running,
      };

      return { campaign, ...stats };
    }
  } catch (e) {
    console.warn('directGetCampaign warning:', e);
  }
  return { campaign: null, total: 0 };
};

export const directUpdateCampaign = async (id, updates) => {
  try {
    const { data, error } = await supabaseDirect.from('campaigns').update(updates).eq('id', id).select().single();
    if (!error && data) return data;
  } catch (e) {
    console.warn('directUpdateCampaign warning:', e);
  }
  return { id, ...updates };
};

export const directDeleteCampaign = async (id) => {
  try {
    await supabaseDirect.from('campaigns').delete().eq('id', id);
  } catch (e) {
    console.warn('directDeleteCampaign warning:', e);
  }
  return { success: true };
};

export const directLaunchCampaign = async (id, data = {}) => {
  const prospectIds = data.prospect_ids || [];
  if (prospectIds.length > 0) {
    await directAddProspectsToCampaign(id, prospectIds);
  }
  await directUpdateCampaign(id, { status: 'running', launched_at: new Date().toISOString() });
  const flowResult = await directRunFlow();
  return { success: true, queued: prospectIds.length, ...flowResult };
};

// ── Prospects Direct Operations ──────────────────────────────────

export const directGetProspects = async (params = {}) => {
  try {
    let query = supabaseDirect.from('prospects').select('*', { count: 'exact' });

    if (params.campaign_id) query = query.eq('campaign_id', params.campaign_id);
    if (params.status) query = query.eq('status', params.status);
    if (params.list_id) query = query.eq('list_id', params.list_id);
    query = query.order('created_at', { ascending: false });
    
    const limit = params.limit || 500;
    const offset = params.offset !== undefined ? Number(params.offset) : ((params.page || 1) - 1) * limit;
    query = query.range(offset, offset + limit - 1);
    
    const { data: rawData, count, error } = await query;
    if (!error && rawData) {
      return { prospects: rawData, total: count || rawData.length };
    }
  } catch (e) {
    console.warn('directGetProspects warning:', e);
  }
  return { prospects: [], total: 0 };
};

export const directCreateProspect = async (data) => {
  const firstName = (data.first_name || data.name?.split(' ')[0] || '').trim()
    || (data.linkedin_url ? (data.linkedin_url.split('/in/')[1] || '').split('/')[0].replace(/[-_]/g, ' ') : '')
    || 'Prospect';

  const userAcc = getActiveUserAccount();
  const orgId = getActiveOrganizationId();
  const email = userAcc?.email ? userAcc.email.toLowerCase() : null;

  const payload = {
    first_name: firstName,
    last_name: (data.last_name || data.name?.split(' ').slice(1).join(' ') || '').trim(),
    name: data.name || `${firstName} ${data.last_name || ''}`.trim(),
    company: data.company || '',
    job_title: data.job_title || data.title || '',
    email: data.email || '',
    linkedin_url: data.linkedin_url || '',
    status: data.status || 'Not Contacted',
    campaign_id: data.campaign_id || null,
    list_id: data.list_id || null,
    organization_id: orgId || userAcc?.organization_id || null,
    user_email: email,
    custom_variables: {
      ...(data.custom_variables || {}),
      organization_id: orgId || userAcc?.organization_id || null,
      user_email: email,
    },
    created_at: new Date().toISOString(),
  };
  try {
    const { data: res, error } = await supabaseDirect.from('prospects').insert([payload]).select();
    if (error) console.error('directCreateProspect error:', error);
    if (!error && res && res[0]) return res[0];
  } catch (e) {
    console.warn('directCreateProspect warning:', e);
  }
  return { id: crypto.randomUUID(), ...payload };
};

export const directGetProspect = async (id) => {
  try {
    const { data, error } = await supabaseDirect.from('prospects').select('*').eq('id', id).single();
    if (!error && data) return { prospect: data, campaign_enrollments: [] };
  } catch (e) {
    console.warn('directGetProspect warning:', e);
  }
  return { prospect: { id, name: 'Prospect' }, campaign_enrollments: [] };
};

export const directUpdateProspect = async (id, updates) => {
  try {
    const { data, error } = await supabaseDirect.from('prospects').update(updates).eq('id', id).select();
    if (!error && data && data[0]) return data[0];
  } catch (e) {
    console.warn('directUpdateProspect warning:', e);
  }
  return { id, ...updates };
};

export const directDeleteProspect = async (id) => {
  try {
    await supabaseDirect.from('prospects').delete().eq('id', id);
  } catch (e) {
    console.warn('directDeleteProspect warning:', e);
  }
  return { success: true };
};

export const directAddProspectsToCampaign = async (campaignId, prospectIds) => {
  if (!campaignId || !prospectIds || !Array.isArray(prospectIds) || prospectIds.length === 0) {
    return { success: true, added: 0 };
  }
  try {
    const validUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validIds = prospectIds.filter(id => typeof id === 'string' && validUuidPattern.test(id));
    if (validIds.length > 0) {
      const { error } = await supabaseDirect
        .from('prospects')
        .update({ campaign_id: campaignId })
        .in('id', validIds);
      if (error) console.error('directAddProspectsToCampaign error:', error);
      return { success: !error, added: validIds.length };
    }
  } catch (e) {
    console.warn('directAddProspectsToCampaign warning:', e);
  }
  return { success: true, added: 0 };
};

export const replaceTemplateVariables = (templateText, prospectData = {}) => {
  if (!templateText) return '';
  const custom = prospectData.custom_fields || prospectData.custom_variables || {};
  const allData = {
    first_name: prospectData.first_name || '',
    last_name: prospectData.last_name || '',
    name: prospectData.name || `${prospectData.first_name || ''} ${prospectData.last_name || ''}`.trim(),
    company: prospectData.company || '',
    job_title: prospectData.job_title || prospectData.headline || '',
    headline: prospectData.headline || '',
    location: prospectData.location || '',
    email: prospectData.email || '',
    linkedin_url: prospectData.linkedin_url || '',
    notes: prospectData.notes || '',
    invite_note: prospectData.invite_note || '',
    initial_message: prospectData.initial_message || '',
    followup_1: prospectData.followup_1 || '',
    followup_2: prospectData.followup_2 || '',
    followup_3: prospectData.followup_3 || '',
    followup_4: prospectData.followup_4 || '',
    followup_5: prospectData.followup_5 || '',
    inmail_subject: prospectData.inmail_subject || '',
    inmail_message: prospectData.inmail_message || '',
    ...custom,
  };

  // Replace {{var_name | fallback_text}} or {{var_name}}
  return templateText.replace(/\{\{\s*([a-zA-Z0-9_\-]+)(?:\s*\|\s*([^}]+))?\s*\}\}/g, (match, key, fallback) => {
    const val = allData[key] || allData[key.toLowerCase()];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
    return fallback ? fallback.trim() : '';
  });
};

export const directBulkImportProspects = async (file, columnMapping = null, importMode = 'create_or_update', listId = null, campaignId = null) => {
  return new Promise((resolve) => {
    if (!file) return resolve({ success: false, error: 'No file provided', imported_count: 0 });

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result || '';
        const parsedData = parseCSVText(text);

        if (parsedData.length <= 1) {
          return resolve({ success: false, error: 'CSV file is empty', imported_count: 0 });
        }

        // 1. Fetch existing prospects to build duplicate maps
        const { data: existingList } = await supabaseDirect
          .from('prospects')
          .select('id, linkedin_url, email');

        const linkedinMap = new Map();
        const emailMap = new Map();

        if (existingList) {
          existingList.forEach(p => {
            if (p.linkedin_url) {
              const cleaned = cleanLinkedinUrl(p.linkedin_url);
              if (cleaned) linkedinMap.set(cleaned, p.id);
            }
            if (p.email) {
              const cleaned = p.email.trim().toLowerCase();
              if (cleaned) emailMap.set(cleaned, p.id);
            }
          });
        }

        const validColumns = new Set([
          'id', 'first_name', 'last_name', 'name', 'company', 'job_title', 
          'email', 'linkedin_url', 'location', 'public_identifier', 'member_id', 'provider_id', 
          'status', 'connection_status', 'connection_sent_date', 'accepted_at', 'message_sent_date', 
          'custom_variables', 'campaign_id', 'list_id', 'organization_id', 'user_email', 
          'created_at', 'updated_at'
        ]);

        const rawHeaders = parsedData[0].map(h => h.trim().replace(/^["']|["']$/g, ''));
        const prospectsToInsert = [];

        const orgId = getActiveOrganizationId();
        const userAcc = getActiveUserAccount();
        const userEmail = userAcc?.email ? userAcc.email.toLowerCase() : null;

        for (let i = 1; i < parsedData.length; i += 1) {
          const cols = parsedData[i];
          if (!cols || cols.length === 0 || (cols.length === 1 && !cols[0])) continue;

          const rowData = {};
          const customVars = {};

          rawHeaders.forEach((rawH, idx) => {
            const val = (cols[idx] || '').trim();
            const mappedTarget = columnMapping?.[rawH] || autoGuessHeader(rawH);

            if (mappedTarget === 'skip') return;

            if (mappedTarget === 'custom_var') {
              const keyName = rawH.toLowerCase().replace(/[^a-z0-9]/g, '_');
              customVars[rawH] = val;
              if (keyName) customVars[keyName] = val;
            } else {
              rowData[mappedTarget] = val;
            }
          });

          customVars.organization_id = orgId || userAcc?.organization_id || null;
          customVars.user_email = userEmail;

          let rawLinkedin = rowData.linkedin_url || '';
          let cleanedUrl = cleanLinkedinUrl(rawLinkedin);
          let emailVal = (rowData.email || '').trim().toLowerCase();

          let firstName = (rowData.first_name || rowData.name?.split(' ')[0] || '').trim();
          let lastName = (rowData.last_name || rowData.name?.split(' ').slice(1).join(' ') || '').trim();

          if (!firstName && !lastName && !cleanedUrl && !emailVal) {
            continue;
          }
          if (!firstName && !lastName) {
            firstName = cleanedUrl ? (cleanedUrl.split('/in/')[1] || '').split('/')[0].replace(/[-_]/g, ' ') || 'Prospect' : 'Prospect';
          }

          let existingId = null;
          if (cleanedUrl) existingId = linkedinMap.get(cleanedUrl);
          if (!existingId && emailVal) existingId = emailMap.get(emailVal);

          if (importMode === 'create' && existingId) continue;
          if (importMode === 'update' && !existingId) continue;

          const prospectObj = {
            first_name: firstName || 'Lead',
            last_name: lastName || '',
            name: rowData.name || `${firstName} ${lastName}`.trim(),
            company: rowData.company || '',
            job_title: rowData.job_title || rowData.headline || '',
            email: emailVal || '',
            linkedin_url: cleanedUrl || rawLinkedin || '',
            location: rowData.location || '',
            status: 'Not Contacted',
            campaign_id: campaignId || null,
            list_id: listId || null,
            organization_id: orgId || userAcc?.organization_id || null,
            user_email: userEmail,
            custom_variables: customVars,
            created_at: new Date().toISOString(),
          };

          if (existingId) {
            prospectObj.id = existingId;
            delete prospectObj.status;
            delete prospectObj.created_at;
            prospectObj.updated_at = new Date().toISOString();
          }

          // Clean fields to strictly send columns that exist on the table
          const cleanedObj = {};
          Object.keys(prospectObj).forEach(key => {
            if (validColumns.has(key)) {
              cleanedObj[key] = prospectObj[key];
            } else {
              cleanedObj.custom_variables = cleanedObj.custom_variables || {};
              cleanedObj.custom_variables[key] = prospectObj[key];
            }
          });

          prospectsToInsert.push(cleanedObj);
        }

        if (prospectsToInsert.length === 0) {
          return resolve({ success: true, created_count: 0, updated_count: 0, imported_count: 0, message: 'No new prospects to import' });
        }

        // Process in chunks of 50 for max database stability & fast performance
        let createdCount = 0;
        let updatedCount = 0;
        const chunkSize = 50;

        for (let i = 0; i < prospectsToInsert.length; i += chunkSize) {
          const chunk = prospectsToInsert.slice(i, i + chunkSize);
          const { data: insertedData, error: chunkErr } = await supabaseDirect.from('prospects').upsert(chunk).select();

          if (chunkErr) {
            console.warn(`Chunk ${i / chunkSize + 1} upsert failed, retrying row-by-row...`, chunkErr.message);
            // Fallback row-by-row retry to ensure valid rows are never lost due to one bad row
            for (const singleProspect of chunk) {
              const { data: singleData, error: sErr } = await supabaseDirect.from('prospects').upsert([singleProspect]).select();
              if (!sErr && singleData && singleData[0]) {
                if (singleProspect.id) updatedCount++;
                else createdCount++;
              } else if (sErr) {
                console.error('Row import error:', sErr.message, singleProspect);
              }
            }
          } else if (insertedData) {
            insertedData.forEach(p => {
              const orig = chunk.find(x => x.id === p.id || (x.linkedin_url && x.linkedin_url === p.linkedin_url) || (x.email && x.email === p.email));
              if (orig && orig.id) updatedCount++;
              else createdCount++;
            });
          }
        }

        resolve({
          success: true,
          created_count: createdCount,
          updated_count: updatedCount,
          imported_count: createdCount + updatedCount,
          total_processed: prospectsToInsert.length
        });
      } catch (err) {
        console.error('directBulkImportProspects critical error:', err);
        resolve({ success: false, error: err.message, imported_count: 0 });
      }
    };
    reader.readAsText(file);
  });
};

function cleanLinkedinUrl(url) {
  if (!url) return '';
  let cleaned = url.trim().toLowerCase();
  if (!cleaned.includes('http://') && !cleaned.includes('https://')) {
    cleaned = 'https://' + cleaned;
  }
  return cleaned.split('?')[0].replace(/\/$/, '');
}

function parseCSVText(csvText) {
  const lines = [];
  let row = [""];
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push("");
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      lines.push(row.map(c => c.trim()));
      row = [""];
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] !== "") {
    lines.push(row.map(c => c.trim()));
  }
  return lines;
}

function autoGuessHeader(header) {
  const clean = (header || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
  if (clean.includes('first_name') || clean.includes('firstname') || clean === 'first') return 'first_name';
  if (clean.includes('last_name') || clean.includes('lastname') || clean === 'last') return 'last_name';
  if (clean === 'name' || clean === 'full_name' || clean === 'fullname') return 'name';
  if (clean.includes('linkedin') || clean.includes('profile_url') || clean === 'url') return 'linkedin_url';
  if (clean.includes('email')) return 'email';
  if (clean.includes('company') || clean.includes('organization')) return 'company';
  if (clean.includes('job') || clean.includes('title')) return 'job_title';
  if (clean.includes('headline')) return 'headline';
  if (clean.includes('location') || clean.includes('city')) return 'location';
  if (clean.includes('note')) return 'notes';
  if (clean.includes('invite') && clean.includes('note')) return 'invite_note';
  if (clean.includes('initial')) return 'initial_message';
  if (clean.includes('followup_1')) return 'followup_1';
  if (clean.includes('followup_2')) return 'followup_2';
  if (clean.includes('followup_3')) return 'followup_3';
  if (clean.includes('followup_4')) return 'followup_4';
  if (clean.includes('followup_5')) return 'followup_5';
  return 'custom_var';
}

export const downloadSampleCSVTemplate = () => {
  const headers = [
    'first_name',
    'last_name',
    'linkedin_url',
    'company',
    'job_title',
    'email',
    'initial_message',
    'follow_up_1',
    'follow_up_2',
    'follow_up_3',
    'follow_up_4',
    'follow_up_5',
    'company_pain_points',
    'growth_goals',
    'our_tailored_offer'
  ];
  
  const sampleRow = [
    'Craig',
    'Wilber',
    'https://www.linkedin.com/in/craig-wilber-0b332525',
    'Lead Service Group LLC',
    'CEO',
    'craig@leadservicegroup.com',
    '"Hi {{first_name}}, ConvrtIn\'s B2B outbound expertise addresses your lead flow needs."',
    '"The fact that you operate both as publisher and buyer across 100+ verticals is rare. Curious what the biggest gap is right now?"',
    '"We work with outbound B2B operations on building and qualifying lead sources. Figured worth mentioning as you expand."',
    '"That\'s exactly why call center operators who move fastest lock in publisher relationships early."',
    '"We built a clean verified list of qualified US-based publishers. Happy to walk you through how we structured it."',
    '"Hope the new hires ramp fast and expansion goes smoothly!"',
    'Scaling lead sourcing across verticals',
    'Building direct publisher partnerships',
    'Qualified B2B traffic sources'
  ];

  const content = `${headers.join(',')}\n${sampleRow.join(',')}`;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'linkedflow_prospects_template.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// ── Prospect Lists Direct Operations ────────────────────────────

export const directGetProspectLists = async () => {
  const isSuper = isSuperAdminUser();
  const userAcc = getActiveUserAccount();
  const orgId = getActiveOrganizationId();
  const userEmail = userAcc?.email ? userAcc.email.toLowerCase() : null;

  try {
    const { data: rawLists, error } = await supabaseDirect.from('prospect_lists').select('*').order('created_at', { ascending: false });
    if (!error && rawLists) {
      return { lists: rawLists };
    }
  } catch (e) {
    console.warn('directGetProspectLists warning:', e);
  }
  return { lists: [] };
};

export const directCreateProspectList = async (data) => {
  const userAcc = getActiveUserAccount();
  const orgId = getActiveOrganizationId();
  const email = userAcc?.email ? userAcc.email.toLowerCase() : null;

  const payload = {
    name: data.name || 'New List',
    description: data.description || '',
    organization_id: orgId || userAcc?.organization_id || null,
    user_email: email,
    created_at: new Date().toISOString(),
  };
  try {
    const { data: res, error } = await supabaseDirect.from('prospect_lists').insert([payload]).select();
    if (!error && res && res[0]) return res[0];
  } catch (e) {
    console.warn('directCreateProspectList warning:', e);
  }
  return payload;
};

export const directUpdateProspectList = async (id, updates) => {
  try {
    const { data, error } = await supabaseDirect.from('prospect_lists').update(updates).eq('id', id).select();
    if (!error && data && data[0]) return data[0];
  } catch (e) {
    console.warn('directUpdateProspectList warning:', e);
  }
  return { id, ...updates };
};

export const directDeleteProspectList = async (id) => {
  try {
    await supabaseDirect.from('prospect_lists').delete().eq('id', id);
  } catch (e) {
    console.warn('directDeleteProspectList warning:', e);
  }
  return { success: true };
};

export const directGetProspectListMembers = async (listId) => {
  try {
    const { data: members, error: mErr } = await supabaseDirect
      .from('prospect_list_members')
      .select('prospect_id')
      .eq('list_id', listId);

    if (!mErr && members && members.length > 0) {
      const pIds = members.map(m => m.prospect_id).filter(Boolean);
      const { data: prospects, error: pErr } = await supabaseDirect
        .from('prospects')
        .select('*')
        .in('id', pIds);
      if (!pErr && prospects) return { prospects };
    }
  } catch (e) {
    console.warn('directGetProspectListMembers warning:', e);
  }
  return { prospects: [] };
};

// ── Unipile Campaign Execution Pipeline ──────────────────────────

const getLinkedinId = (prospect) => {
  if (prospect.provider_id) return prospect.provider_id;
  if (prospect.public_identifier) return prospect.public_identifier;
  if (prospect.member_id) return prospect.member_id;

  const cv = prospect.custom_variables || prospect.custom_fields || {};
  const rawUrl = prospect.linkedin_url || cv.linkedin_url || cv.linkedinUrl || cv.linkedinurl || cv.url || '';

  if (rawUrl) {
    const parts = rawUrl.split('/in/');
    if (parts[1]) {
      return parts[1].split('?')[0].replace(/\//g, '').trim();
    }
    if (!rawUrl.includes('http')) return rawUrl.trim();
  }
  return null;
};

// --- HUMAN EMULATION & PACING HELPERS ---
const randomRange = (minMs, maxMs) => Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

export const humanPause = (minSeconds, maxSeconds, reason = 'Human reading pause') => {
  const ms = randomRange(minSeconds * 1000, maxSeconds * 1000);
  console.log(`🛡️ Humanization [${reason}]: Pausing for ${(ms / 1000).toFixed(1)}s...`);
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const humanTypingDelay = (textLength = 50) => {
  const estimatedSeconds = Math.min(25, Math.max(5, Math.floor(textLength / 4)));
  return humanPause(estimatedSeconds * 0.8, estimatedSeconds * 1.2, `Simulated human typing (${textLength} chars)`);
};

export const humanInterProspectDelay = () => {
  return humanPause(120, 300, 'Inter-prospect pacing jitter (2 - 5 mins)');
};

export const getAccountForProspect = async (prospect) => {
  if (!prospect) return null;
  const pOrgId = prospect?.organization_id || prospect?.custom_variables?.organization_id;
  const pEmail = (prospect?.user_email || prospect?.custom_variables?.user_email || '').toLowerCase();

  try {
    const { data: allProfiles } = await supabaseDirect.from('profiles').select('id, user_email, organization_id, unipile_account_id');
    if (allProfiles && allProfiles.length > 0) {
      const match = allProfiles.find(p => {
        if (!p.unipile_account_id) return false;
        if (pOrgId && p.organization_id === pOrgId) return true;
        if (pEmail && p.user_email && p.user_email.toLowerCase() === pEmail) return true;
        return false;
      });
      if (match?.unipile_account_id) return match.unipile_account_id;
    }
  } catch (e) {
    console.warn('getAccountForProspect error:', e);
  }

  // STRICT ISOLATION: Never default to userProfiles[0]. If no matching profile belongs to this prospect, return null.
  return null;
};

export const directResolveLinkedinProfile = async (prospect) => {
  const targetId = getLinkedinId(prospect);
  if (!targetId) return null;
  const accountId = await getAccountForProspect(prospect);
  if (!accountId) return null;
  const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(targetId)}?account_id=${accountId}`);
  if (ok && data) {
    try {
      await supabaseDirect.from('prospects').update({
        public_identifier: data.public_identifier || prospect.public_identifier || '',
        provider_id: data.provider_id || prospect.provider_id || '',
        member_id: data.member_urn || prospect.member_id || '',
      }).eq('id', prospect.id);
      if (data.public_identifier) prospect.public_identifier = data.public_identifier;
      if (data.provider_id) prospect.provider_id = data.provider_id;
      if (data.member_urn) prospect.member_id = data.member_urn;
    } catch (e) {
      console.warn('Failed to update prospect identifiers:', e);
    }
    return data;
  }
  return null;
};

export const directVisitProfile = async (prospect) => {
  const data = await directResolveLinkedinProfile(prospect);
  if (data) {
    // Simulate a real human viewing & scrolling the prospect's profile page
    await humanPause(15, 35, `Viewing profile of ${prospect.name || 'prospect'}`);
  }
  return { success: Boolean(data), data };
};

export const directFollowProfile = async (prospect) => {
  const targetId = getLinkedinId(prospect);
  if (!targetId) return { success: true };
  const accountId = await getAccountForProspect(prospect);
  if (!accountId) return { success: false, error: 'NO_CONNECTED_ACCOUNT' };
  
  await humanPause(6, 15, 'Pre-follow profile pause');
  await unipileFetch(`/users/${targetId}?account_id=${accountId}`);
  await humanPause(8, 20, 'Post-follow profile pause');
  return { success: true };
};

export const directEndorseProfile = async (prospect) => {
  const targetId = getLinkedinId(prospect);
  if (!targetId) return { success: true };
  const accountId = await getAccountForProspect(prospect);
  if (!accountId) return { success: false, error: 'NO_CONNECTED_ACCOUNT' };
  
  await humanPause(10, 25, 'Reviewing skills before endorsing');
  await unipileFetch(`/users/${targetId}?account_id=${accountId}`);
  await humanPause(8, 20, 'Post-endorse pause');
  return { success: true };
};

export const directSendUnipileConnectionInvite = async (prospect, message = '') => {
  const provider_id = getLinkedinId(prospect);
  const accountId = await getAccountForProspect(prospect);
  if (!accountId) return { success: false, error: 'NO_CONNECTED_ACCOUNT' };

  // Pre-invite human review pause
  await humanPause(12, 30, `Reviewing ${prospect.name || 'prospect'} before sending invitation`);

  if (message) {
    // Simulate human typing the invite note
    await humanTypingDelay(message.length);
  }

  const payload = {
    account_id: accountId,
    provider_id,
    message: message || '',
  };
  
  const { ok, data } = await unipileFetch('/users/invite', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (ok) {
    try {
      await supabaseDirect.from('prospects').update({
        status: 'Connection Request Sent',
        connection_status: 'invitation_sent',
        connection_sent_date: new Date().toISOString(),
      }).eq('id', prospect.id);
    } catch (e) {
      console.warn('Supabase update warning:', e);
    }
    // Post-invite human cool-off pause
    await humanPause(15, 35, 'Post-invitation cooloff');
    return { success: true, data };
  }
  return { success: false, error: data?.detail || 'Unipile invite failed' };
};

export const directSendUnipileChatMessage = async (prospect, text = '') => {
  const recipientId = getLinkedinId(prospect);
  const accountId = await getAccountForProspect(prospect);
  if (!accountId) return { success: false, error: 'NO_CONNECTED_ACCOUNT' };

  const messageText = text || prospect.initial_message || 'Hello!';

  // Pre-message human review pause & typing simulation
  await humanPause(10, 22, 'Opening chat window');
  await humanTypingDelay(messageText.length);

  const payload = {
    account_id: accountId,
    attendees_ids: [recipientId],
    text: messageText,
  };

  const { ok, data } = await unipileFetch('/chats', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (ok) {
    try {
      await supabaseDirect.from('prospects').update({
        status: 'Initial Message Sent',
        message_sent_date: new Date().toISOString(),
      }).eq('id', prospect.id);
    } catch (e) {
      console.warn('Supabase update warning:', e);
    }
    await humanPause(15, 30, 'Post-message cooloff');
    return { success: true, data };
  }

  if (ok) {
    try {
      await supabaseDirect.from('prospects').update({
        status: 'Initial Message Sent',
        message_sent_date: new Date().toISOString(),
      }).eq('id', prospect.id);
    } catch (e) {
      console.warn('Supabase update warning:', e);
    }
    return { success: true, data };
  }
  return { success: false, error: data?.detail || 'Unipile chat message failed' };
};

export const directSendUnipileInMail = async (prospect, subject = '', text = '') => {
  const recipientId = getLinkedinId(prospect);
  const userProfiles = await directGetProfiles();
  const accountId = userProfiles?.[0]?.unipile_account_id;
  if (!accountId) return { success: false, error: 'NO_CONNECTED_ACCOUNT' };

  const payload = {
    account_id: accountId,
    attendees_ids: [recipientId],
    text: text || 'Hello!',
    subject: subject || 'Introduction',
    inmail: true,
  };
  const { ok, data } = await unipileFetch('/chats', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { success: ok, data };
};

export const directGetUnipileChats = async (limit = 50) => {
  const userProfiles = await directGetProfiles();
  const accountId = userProfiles?.[0]?.unipile_account_id;
  if (!accountId) {
    return { success: false, chats: [], error: 'NO_CONNECTED_ACCOUNT' };
  }
  const { ok, data } = await unipileFetch(`/chats?account_id=${accountId}&limit=${limit}`);
  if (ok && data) {
    return { success: true, chats: data.items || data.chats || [] };
  }
  return { success: false, chats: [] };
};

export const directGetChatMessages = async (chatId, limit = 50) => {
  if (!chatId) return { success: false, messages: [] };
  const userProfiles = await directGetProfiles();
  const accountId = userProfiles?.[0]?.unipile_account_id;
  if (!accountId) return { success: false, messages: [], error: 'NO_CONNECTED_ACCOUNT' };
  const { ok, data } = await unipileFetch(`/chats/${encodeURIComponent(chatId)}/messages?account_id=${accountId}&limit=${limit}`);
  if (ok && data) {
    return { success: true, messages: data.items || data.messages || [] };
  }
  return { success: false, messages: [] };
};

export const directGetUnipileUserProfile = async (identifier) => {
  if (!identifier) return { success: false, profile: null };
  const cleanId = String(identifier).trim().replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//i, '').replace(/\/$/, '');
  const userProfiles = await directGetProfiles();
  const accountId = userProfiles?.[0]?.unipile_account_id;
  if (!accountId) return { success: false, profile: null };
  const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(cleanId)}?account_id=${accountId}`);
  if (ok && data) {
    return { success: true, profile: data };
  }
  return { success: false, profile: null };
};

export const directCheckProspectReplied = async (prospect) => {
  if (prospect.custom_variables?.reply_date && prospect.status?.toLowerCase() === 'replied') {
    return { success: true, replied: true };
  }

  const recipientId = getLinkedinId(prospect);
  if (!recipientId) return { success: true, replied: false };

  const userProfiles = await directGetProfiles();
  const accountId = userProfiles?.[0]?.unipile_account_id;
  if (!accountId) return { success: true, replied: false };

  // When did our campaign start contacting this person?
  const outreachTimestamp = new Date(
    prospect.message_sent_date ||
    prospect.custom_variables?.message_sent_at ||
    prospect.connection_sent_date ||
    prospect.created_at ||
    0
  ).getTime();

  const { ok, data } = await unipileFetch(`/chats?account_id=${accountId}&attendees_ids=${encodeURIComponent(recipientId)}`);
  if (ok && data && Array.isArray(data.items) && data.items.length > 0) {
    const chat = data.items[0];
    if (chat && chat.id) {
      // Fetch messages history
      const { ok: msgOk, data: msgData } = await unipileFetch(`/chats/${encodeURIComponent(chat.id)}/messages?account_id=${accountId}&limit=100`);
      if (msgOk && msgData && Array.isArray(msgData.items)) {
        // Find incoming message sent by the prospect AFTER our campaign message
        const firstReply = msgData.items.find(m => {
          const isFromProspect = m.is_sender === 0;
          if (!isFromProspect) return false;
          const msgTime = new Date(m.timestamp || m.created_at || 0).getTime();
          // Must have been received at least 2 seconds after our outreach was sent
          return msgTime > (outreachTimestamp + 2000);
        });

        if (firstReply) {
          const replyText = firstReply.text || firstReply.message || 'Incoming message';
          const replyDateStr = firstReply.timestamp || firstReply.created_at || new Date().toISOString();

          const cv = prospect.custom_variables || {};
          const history = cv.history || [];
          history.push({
            node_id: 'check_reply',
            node_type: 'check_reply',
            status: 'replied',
            reply_text: replyText,
            executed_at: replyDateStr
          });

          await supabaseDirect.from('prospects').update({
            status: 'Replied',
            custom_variables: {
              ...cv,
              reply_date: replyDateStr,
              last_message: replyText,
              history
            },
            updated_at: new Date().toISOString()
          }).eq('id', prospect.id);

          return { success: true, replied: true };
        }
      }
    }
  }
  return { success: true, replied: false };
};

export const DEFAULT_APP_SETTINGS = {
  daily_visit_limit: 50,
  daily_follow_limit: 30,
  daily_connection_limit: 25,
  daily_message_limit: 40,
  global_daily_limit: 40,
  enable_working_hours: true,
  start_time: '09:00',
  end_time: '18:00',
  timezone: 'Asia/Karachi',
  skip_weekends: true,
  random_jitter: true,
  auto_warmup: true,
  runner_interval_ms: 60000,
};

export const directGetAppSettings = async () => {
  try {
    const { data } = await supabaseDirect.from('profiles').select('settings').eq('profile_key', 'profile_1');
    if (data && data[0] && data[0].settings && Object.keys(data[0].settings).length > 0) {
      return { ...DEFAULT_APP_SETTINGS, ...data[0].settings };
    }
  } catch (e) {
    console.warn('Failed to load settings from Supabase:', e);
  }
  try {
    const raw = localStorage.getItem('lf_app_settings');
    if (raw) return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_APP_SETTINGS };
};

export const directSaveAppSettings = async (newSettings) => {
  const merged = { ...DEFAULT_APP_SETTINGS, ...newSettings };
  try {
    localStorage.setItem('lf_app_settings', JSON.stringify(merged));
  } catch {}
  try {
    await supabaseDirect.from('profiles').update({ settings: merged }).eq('profile_key', 'profile_1');
    await supabaseDirect.from('account_safety_settings').upsert([{
      max_daily_invites: Number(merged.daily_connection_limit || 25),
      max_daily_messages: Number(merged.daily_message_limit || 50),
      max_daily_profile_visits: Number(merged.daily_visit_limit || 80),
      jitter_delay_min_minutes: 4,
      jitter_delay_max_minutes: 12,
      working_hours_start: merged.start_time || '09:00',
      working_hours_end: merged.end_time || '18:00',
      timezone: merged.timezone || 'UTC',
      updated_at: new Date().toISOString()
    }]);
  } catch (e) {
    console.warn('Failed to save settings to Supabase:', e);
  }
  return merged;
};

export const isWithinWorkingHours = (settings) => {
  if (!settings || !settings.enable_working_hours) return { allowed: true, reason: '' };

  const tz = settings.timezone || 'UTC';
  let nowInTz;
  try {
    const dateStr = new Date().toLocaleString('en-US', { timeZone: tz });
    nowInTz = new Date(dateStr);
  } catch {
    nowInTz = new Date();
  }

  const day = nowInTz.getDay();
  if (settings.skip_weekends && (day === 0 || day === 6)) {
    return { allowed: false, reason: `Weekend safety rule active (${day === 0 ? 'Sunday' : 'Saturday'} in ${tz})` };
  }

  const currentMinutes = nowInTz.getHours() * 60 + nowInTz.getMinutes();
  const [startH, startM] = (settings.start_time || '09:00').split(':').map(Number);
  const [endH, endM] = (settings.end_time || '18:00').split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
    return {
      allowed: false,
      reason: `Outside working hours (${settings.start_time} - ${settings.end_time} in ${tz})`
    };
  }

  return { allowed: true, reason: '' };
};

export const directRunFlow = async () => {
  const appSettings = await directGetAppSettings();
  const hoursCheck = isWithinWorkingHours(appSettings);
  if (!hoursCheck.allowed) {
    console.log(`Campaign flow engine paused: ${hoursCheck.reason}`);
    return { success: true, message: hoursCheck.reason, totalExecuted: 0 };
  }

  let campaigns = [];
  try {
    const { data } = await supabaseDirect.from('campaigns').select('*').eq('status', 'running');
    campaigns = data || [];
  } catch (err) {
    console.error('Error fetching running campaigns:', err);
    return { success: false, error: err.message };
  }

  if (campaigns.length === 0) {
    return { success: true, totalExecuted: 0, message: 'No active running campaigns found.' };
  }

  // Global Account Safety Daily Limit from Settings
  const globalDailyLimit = Number(appSettings.global_daily_limit || appSettings.daily_connection_limit || 40);

  // Calculate today's executed actions count across all prospects
  const todayDateStr = new Date().toISOString().split('T')[0];
  let todayActionsTotal = 0;
  try {
    const { data: allProspects } = await supabaseDirect.from('prospects').select('custom_variables');
    (allProspects || []).forEach(p => {
      const history = p.custom_variables?.history || [];
      history.forEach(h => {
        if (h.executed_at && h.executed_at.startsWith(todayDateStr) && (h.status === 'success' || h.status === 'replied')) {
          todayActionsTotal += 1;
        }
      });
    });
  } catch (e) {
    console.warn('Error counting daily executed actions:', e);
  }

  let remainingGlobalQuota = Math.max(0, globalDailyLimit - todayActionsTotal);
  if (remainingGlobalQuota <= 0) {
    console.log(`Global account safety quota reached for today (${todayActionsTotal}/${globalDailyLimit}). Pausing execution.`);
    return { success: true, totalExecuted: 0, message: `Global daily safety limit reached (${todayActionsTotal}/${globalDailyLimit})` };
  }

  // Divide remaining quota equally across running campaigns (Round-Robin)
  const quotaPerCampaign = Math.max(1, Math.floor(remainingGlobalQuota / campaigns.length));

  let totalExecuted = 0;
  let totalConnections = 0;
  let totalMessages = 0;

  for (const campaign of campaigns) {
    if (remainingGlobalQuota <= 0) break;

    const flowSequence = campaign.sequence_config?.flow_sequence;
    if (!flowSequence || !Array.isArray(flowSequence.nodes) || flowSequence.nodes.length === 0) {
      continue;
    }

    const nodesMap = new Map(flowSequence.nodes.map(n => [n.id, n]));
    const sourceEdgesMap = new Map();
    for (const edge of flowSequence.edges || []) {
      if (!sourceEdgesMap.has(edge.source)) {
        sourceEdgesMap.set(edge.source, []);
      }
      sourceEdgesMap.get(edge.source).push(edge);
    }

    const incomingEdgeTargets = new Set((flowSequence.edges || []).map(e => e.target));
    const startNodes = flowSequence.nodes.filter(n => !incomingEdgeTargets.has(n.id));
    const startNode = startNodes[0] || flowSequence.nodes[0];

    if (!startNode) continue;

    let prospects = [];
    try {
      const { data } = await supabaseDirect.from('prospects').select('*').eq('campaign_id', campaign.id);
      prospects = data || [];
    } catch (err) {
      console.error(`Error fetching prospects for campaign ${campaign.id}:`, err);
      continue;
    }

    // Effective daily limit for this campaign in this run batch
    let effectiveLimit = Math.min(quotaPerCampaign, campaign.daily_limit || quotaPerCampaign, remainingGlobalQuota);
    let actionsTaken = 0;

    for (const prospect of prospects) {
      if (actionsTaken >= effectiveLimit || remainingGlobalQuota <= 0) break;

      if (['Completed', 'Failed', 'Replied'].includes(prospect.status)) {
        continue;
      }

      const render = (templateText) => {
        if (!templateText) return '';
        let text = String(templateText);
        
        const matches = text.match(/\{\{\s*([a-zA-Z0-9_\-\s]+)\s*\}\}/g) || [];
        for (const m of matches) {
          const varName = m.replace(/\{\{\s*|\s*\}\}/g, '').trim();
          const norm = (v) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
          const normVar = norm(varName);

          let resolvedValue = '';
          
          if (normVar === 'firstname' || normVar === 'first_name') resolvedValue = prospect.first_name || '';
          else if (normVar === 'lastname' || normVar === 'last_name') resolvedValue = prospect.last_name || '';
          else if (normVar === 'company') resolvedValue = prospect.company || '';
          else if (normVar === 'title') resolvedValue = prospect.job_title || '';
          else {
            if (prospect[varName] !== undefined) resolvedValue = prospect[varName];
            else if (prospect.custom_variables) {
              const matchKey = Object.keys(prospect.custom_variables).find(k => norm(k) === normVar);
              if (matchKey !== undefined) {
                resolvedValue = prospect.custom_variables[matchKey];
              }
            }
          }
          
          text = text.replace(m, resolvedValue !== undefined ? String(resolvedValue) : '');
        }
        
        return text;
      };

      let currentNodeId = prospect.custom_variables?.current_node_id;
      if (!currentNodeId) {
        currentNodeId = startNode.id;
        prospect.custom_variables = {
          ...(prospect.custom_variables || {}),
          current_node_id: currentNodeId,
          history: [],
        };
      }

      let currentNode = nodesMap.get(currentNodeId);
      if (!currentNode) {
        currentNodeId = startNode.id;
        currentNode = nodesMap.get(currentNodeId);
        if (!currentNode) continue;
      }

      let nodeType = currentNode.data?.nodeType;
      let nodeConfig = currentNode.data?.config || {};
      const nodeLabel = currentNode.data?.label || currentNode.id;

      // Auto-resolve LinkedIn IDs if the prospect has not been visited/resolved yet
      const isActionNode = ['follow_profile', 'endorse_profile', 'send_invitation', 'send_message'].includes(nodeType);
      if (isActionNode && !prospect.provider_id && !prospect.member_id) {
        console.log(`Prospect ${prospect.name || prospect.id} does not have resolved provider IDs. Performing auto-visit resolution...`);
        await directVisitProfile(prospect);
      }

      if (nodeType === 'wait') {
        const days = Number(nodeConfig.days) || 0;
        const nextScheduledStr = prospect.custom_variables?.next_scheduled_at;

        if (days > 0 && nextScheduledStr) {
          const nextScheduled = new Date(nextScheduledStr).getTime();
          if (Date.now() < nextScheduled) continue;
        } else if (days > 0 && !nextScheduledStr) {
          const nextScheduledAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
          prospect.custom_variables.next_scheduled_at = nextScheduledAt;
          try {
            await supabaseDirect.from('prospects').update({ custom_variables: prospect.custom_variables }).eq('id', prospect.id);
          } catch (e) {
            console.warn(e);
          }
          continue;
        }

        const edges = sourceEdgesMap.get(currentNode.id) || [];
        const defaultEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default') || edges[0];
        if (defaultEdge) {
          prospect.custom_variables.current_node_id = defaultEdge.target;
          prospect.custom_variables.next_scheduled_at = null;
          try {
            await supabaseDirect.from('prospects').update({ custom_variables: prospect.custom_variables }).eq('id', prospect.id);
          } catch (e) {
            console.warn(e);
          }

          if (nodesMap.get(defaultEdge.target)) {
            currentNodeId = defaultEdge.target;
            currentNode = nodesMap.get(currentNodeId);
            nodeType = currentNode?.data?.nodeType || currentNode?.type;
            nodeConfig = currentNode?.data?.config || {};
          } else {
            continue;
          }
        } else {
          continue;
        }
      }

      if (nodeType === 'send_invitation') {
        let isConnected = prospect.connection_status === 'connected' || prospect.status === 'Connection Accepted';
        
        if (!isConnected) {
          const userProfileData = await directResolveLinkedinProfile(prospect);
          if (userProfileData) {
            const dist = userProfileData.network_distance || userProfileData.distance;
            const isRel = userProfileData.is_relationship || userProfileData.is_connection;
            if (dist === 'FIRST_DEGREE' || dist === 'DISTANCE_1' || dist === 'FIRST' || isRel === true) {
              isConnected = true;
            }
          }
        }

        if (!isConnected) {
          const { connections } = await directGetNetworkingConnections();
          const connSet = new Set(connections.map(c => (c.public_identifier || c.provider_id || c.member_id || '').toLowerCase()).filter(Boolean));
          const pKey = (prospect.public_identifier || prospect.provider_id || prospect.linkedin_url?.split('/in/')?.[1]?.replace(/\//g, '').split('?')[0] || '').toLowerCase();
          if (pKey && connSet.has(pKey)) {
            isConnected = true;
          }
        }

        const edges = sourceEdgesMap.get(currentNode.id) || [];
        const defaultEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default') || edges[0];

        if (isConnected) {
          console.log(`Prospect ${prospect.name} is ALREADY CONNECTED! Skipping invitation node and moving to next node.`);
          prospect.status = 'Connection Accepted';
          prospect.connection_status = 'connected';
          if (defaultEdge) {
            prospect.custom_variables.current_node_id = defaultEdge.target;
            prospect.custom_variables.next_scheduled_at = null;
          }
          try {
            await supabaseDirect.from('prospects').update({
              status: 'Connection Accepted',
              connection_status: 'connected',
              accepted_at: new Date().toISOString(),
              custom_variables: prospect.custom_variables
            }).eq('id', prospect.id);
          } catch (e) {
            console.warn(e);
          }

          if (defaultEdge && nodesMap.get(defaultEdge.target)) {
            currentNodeId = defaultEdge.target;
            currentNode = nodesMap.get(currentNodeId);
            nodeType = currentNode?.type || currentNode?.data?.action_type || 'send_message';
            nodeConfig = currentNode?.data || {};
          } else {
            continue;
          }
        }

        if (!isConnected && prospect.status !== 'Connection Request Sent') {
          const hasNoteToggle = nodeConfig.add_note !== undefined ? Boolean(nodeConfig.add_note)
            : (nodeConfig.include_note !== undefined ? Boolean(nodeConfig.include_note)
            : (nodeConfig.send_note !== undefined ? Boolean(nodeConfig.send_note)
            : (nodeConfig.has_note !== undefined ? Boolean(nodeConfig.has_note) : Boolean(nodeConfig.note))));
          const inviteNote = hasNoteToggle ? render(nodeConfig.note || '') : '';
          console.log(`Sending connection invite to ${prospect.name} (hasNote=${hasNoteToggle})...`);
          const res = await directSendUnipileConnectionInvite(prospect, inviteNote);
          
          if (res.success) {
            totalConnections += 1;
            actionsTaken += 1;
            prospect.status = 'Connection Request Sent';
            prospect.connection_status = 'invitation_sent';
            prospect.custom_variables.invitation_sent_at = new Date().toISOString();
            prospect.custom_variables.last_action_at = new Date().toISOString();
            prospect.custom_variables.history = [
              ...(prospect.custom_variables.history || []),
              { node_id: currentNode.id, node_type: 'send_invitation', executed_at: new Date().toISOString(), status: 'success' }
            ];
            try {
              await supabaseDirect.from('prospects').update({
                status: 'Connection Request Sent',
                connection_status: 'invitation_sent',
                connection_sent_date: new Date().toISOString(),
                custom_variables: prospect.custom_variables
              }).eq('id', prospect.id);
            } catch (e) {
              console.warn(e);
            }
          } else {
            console.warn(`Failed to send connection invite: ${res.error}`);
            prospect.custom_variables.history = [
              ...(prospect.custom_variables.history || []),
              { node_id: currentNode.id, node_type: 'send_invitation', executed_at: new Date().toISOString(), status: 'failed', error: res.error }
            ];
            try {
              await supabaseDirect.from('prospects').update({
                custom_variables: prospect.custom_variables
              }).eq('id', prospect.id);
            } catch (e) {
              console.warn(e);
            }
          }
          continue;
        } else {
          const sentAtStr = prospect.custom_variables.invitation_sent_at || prospect.custom_variables.last_action_at || prospect.created_at;
          const waitDays = Number(nodeConfig.max_wait_days) || 14;
          const isTimedOut = Date.now() - new Date(sentAtStr).getTime() > waitDays * 24 * 60 * 60 * 1000;

          if (isTimedOut) {
            console.log(`Connection request to ${prospect.name} timed out after ${waitDays} days.`);
            prospect.status = 'Failed';
            prospect.custom_variables.history = [
              ...(prospect.custom_variables.history || []),
              { node_id: currentNode.id, node_type: 'send_invitation', executed_at: new Date().toISOString(), status: 'timeout' }
            ];
            try {
              await supabaseDirect.from('prospects').update({
                status: 'Failed',
                custom_variables: prospect.custom_variables
              }).eq('id', prospect.id);
            } catch (e) {
              console.warn(e);
            }
          } else {
            console.log(`Waiting for connection acceptance from ${prospect.name}...`);
          }
          continue;
        }
      }

      if (nodeType === 'send_message') {
        const edges = sourceEdgesMap.get(currentNode.id) || [];
        const defaultEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default');
        const wasSent = prospect.custom_variables.last_sent_node_id === currentNode.id;

        if (!wasSent) {
          const msgText = render(nodeConfig.message || '');
          console.log(`Sending message to ${prospect.name}...`);
          const res = await directSendUnipileChatMessage(prospect, msgText);

          if (res.success) {
            totalMessages += 1;
            actionsTaken += 1;
            prospect.status = 'Initial Message Sent';
            prospect.custom_variables.last_sent_node_id = currentNode.id;
            prospect.custom_variables.message_sent_at = new Date().toISOString();
            prospect.custom_variables.last_action_at = new Date().toISOString();
            prospect.custom_variables.history = [
              ...(prospect.custom_variables.history || []),
              { node_id: currentNode.id, node_type: 'send_message', executed_at: new Date().toISOString(), status: 'success' }
            ];
            try {
              await supabaseDirect.from('prospects').update({
                status: 'Initial Message Sent',
                message_sent_date: new Date().toISOString(),
                custom_variables: prospect.custom_variables
              }).eq('id', prospect.id);
            } catch (e) {
              console.warn(e);
            }
          } else {
            console.warn(`Failed to send message: ${res.error}`);
            prospect.custom_variables.history = [
              ...(prospect.custom_variables.history || []),
              { node_id: currentNode.id, node_type: 'send_message', executed_at: new Date().toISOString(), status: 'failed', error: res.error }
            ];
            try {
              await supabaseDirect.from('prospects').update({
                custom_variables: prospect.custom_variables
              }).eq('id', prospect.id);
            } catch (e) {
              console.warn(e);
            }
          }
          continue;
        } else {
          console.log(`Checking if ${prospect.name} has replied...`);
          const { replied } = await directCheckProspectReplied(prospect);

          if (replied) {
            console.log(`Prospect ${prospect.name} replied! Halting sequence.`);
            prospect.status = 'Replied';
            prospect.custom_variables.history = [
              ...(prospect.custom_variables.history || []),
              { node_id: currentNode.id, node_type: 'check_reply', executed_at: new Date().toISOString(), status: 'replied' }
            ];
            try {
              await supabaseDirect.from('prospects').update({
                status: 'Replied',
                custom_variables: prospect.custom_variables
              }).eq('id', prospect.id);
            } catch (e) {
              console.warn(e);
            }
          } else {
            console.log(`No reply from ${prospect.name} yet. Advancing to next node.`);
            if (defaultEdge) {
              prospect.custom_variables.current_node_id = defaultEdge.target;
              prospect.custom_variables.next_scheduled_at = null;
            }
            prospect.custom_variables.history = [
              ...(prospect.custom_variables.history || []),
              { node_id: currentNode.id, node_type: 'check_reply', executed_at: new Date().toISOString(), status: 'no_reply' }
            ];
            try {
              await supabaseDirect.from('prospects').update({
                custom_variables: prospect.custom_variables
              }).eq('id', prospect.id);
            } catch (e) {
              console.warn(e);
            }

            if (defaultEdge && nodesMap.get(defaultEdge.target)) {
              currentNodeId = defaultEdge.target;
              currentNode = nodesMap.get(currentNodeId);
              nodeType = currentNode?.data?.nodeType || currentNode?.type;
              nodeConfig = currentNode?.data?.config || {};
            } else {
              continue;
            }
          }
        }
      }

      if (nodeType === 'completed') {
        if (prospect.status === 'Connection Request Sent') {
          // Keep prospect in Connection Request Sent status while waiting for acceptance on LinkedIn
          continue;
        }
        prospect.status = 'Completed';
        try {
          await supabaseDirect.from('prospects').update({ status: 'Completed' }).eq('id', prospect.id);
        } catch (e) {
          console.warn(e);
        }
        continue;
      }

      if (nodeType === 'failed') {
        prospect.status = 'Failed';
        try {
          await supabaseDirect.from('prospects').update({ status: 'Failed' }).eq('id', prospect.id);
        } catch (e) {
          console.warn(e);
        }
        continue;
      }

      let success = false;
      let errorMsg = '';

      if (nodeType === 'visit_profile') {
        const res = await directVisitProfile(prospect);
        success = res.success;
        errorMsg = res.error;
      } 
      else if (nodeType === 'follow_profile') {
        const res = await directFollowProfile(prospect);
        success = res.success;
      } 
      else if (nodeType === 'endorse_profile') {
        const res = await directEndorseProfile(prospect);
        success = res.success;
      }

      if (success) {
        actionsTaken += 1;
        totalExecuted += 1;

        const historyItem = {
          node_id: currentNode.id,
          node_type: nodeType,
          node_label: nodeLabel,
          executed_at: new Date().toISOString(),
          status: 'success',
        };

        const updatedHistory = [...(prospect.custom_variables.history || []), historyItem];
        const edges = sourceEdgesMap.get(currentNode.id) || [];
        const defaultEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default');
        
        if (nodeType !== 'check_messageability' && defaultEdge) {
          prospect.custom_variables.current_node_id = defaultEdge.target;
        }

        prospect.custom_variables.last_action_at = new Date().toISOString();
        prospect.custom_variables.history = updatedHistory;

        try {
          await supabaseDirect.from('prospects').update({
            custom_variables: prospect.custom_variables,
            updated_at: new Date().toISOString(),
          }).eq('id', prospect.id);
        } catch (e) {
          console.warn(e);
        }
      } else {
        const historyItem = {
          node_id: currentNode.id,
          node_type: nodeType,
          node_label: nodeLabel,
          executed_at: new Date().toISOString(),
          status: 'failed',
          error: errorMsg,
        };
        prospect.custom_variables.history = [...(prospect.custom_variables.history || []), historyItem];
        try {
          await supabaseDirect.from('prospects').update({
            custom_variables: prospect.custom_variables,
          }).eq('id', prospect.id);
        } catch (e) {
          console.warn(e);
        }
      }
    }
  }

  return {
    success: true,
    accepted: 0,
    connections_sent: totalConnections,
    messages_sent: totalMessages,
    executed_count: totalExecuted,
  };
};

export const directCheckAcceptances = async () => directRunFlow();
export const directRunConnections = async () => directRunFlow();
export const directRunMessages = async () => directRunFlow();

const FALLBACK_TEMPLATES = [
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

export const directGetCampaignSequence = async (campaignId) => {
  try {
    const { data: campaign, error } = await supabaseDirect.from('campaigns').select('*').eq('id', campaignId).single();
    if (error || !campaign) return { template: null, enrollments: [] };

    let template = null;
    const templateId = campaign.template_id || 'tpl_classic';
    const { data: tData } = await supabaseDirect.from('campaign_templates').select('*').eq('id', templateId).single();
    if (tData) {
      template = tData;
      const { data: steps } = await supabaseDirect
        .from('campaign_template_steps')
        .select('*')
        .eq('template_id', templateId)
        .eq('is_enabled', true)
        .order('step_order');
      template.steps = steps || [];
    } else {
      const fallback = FALLBACK_TEMPLATES.find(t => t.id === templateId) || FALLBACK_TEMPLATES[0];
      template = { ...fallback };
    }

    const { data: enrollments } = await supabaseDirect
      .from('campaign_enrollments')
      .select('*, prospects(*)')
      .eq('campaign_id', campaignId)
      .order('created_at');

    const formattedEnrollments = (enrollments || []).map(e => {
      const p = e.prospects || {};
      const customVars = p.custom_variables || {};
      return {
        id: e.id,
        campaign_id: e.campaign_id,
        prospect_id: e.prospect_id,
        status: e.status || p.status || 'active',
        created_at: e.created_at,
        updated_at: e.updated_at,
        current_step_order: p.current_step || (customVars.current_node_id ? 2 : 1),
        next_step_at: customVars.next_scheduled_at || e.next_action_at || null,
        profile_key: p.assigned_account || 'profile_1',
        prospect: p
      };
    });

    return { campaign, template, enrollments: formattedEnrollments };
  } catch (e) {
    console.warn('directGetCampaignSequence error:', e);
  }
  return { template: null, enrollments: [] };
};
