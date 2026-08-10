import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mjwganpjawthnowemabt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tkC_z_PpNUMHx1kwJyUH5A_0Qs5Ahbw';
const UNIPILE_API_KEY = 'qptpLmjx.T+kOGzVxBXwCbJLYd6RlSxMa+b3Gc7XacSXoWNejkA4=';
const UNIPILE_BASE_URL = 'https://api20.unipile.com:15032/api/v1';
const DEFAULT_ACCOUNT_ID = 'bBzuBoeOQAuBCQNFu7shyQ';

export const supabaseDirect = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const unipileFetch = async (endpoint, options = {}) => {
  const headers = {
    'X-API-KEY': UNIPILE_API_KEY,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  try {
    const res = await fetch(`${UNIPILE_BASE_URL}${endpoint}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error('Direct Unipile fetch error:', err);
    return { ok: false, status: 500, data: null };
  }
};

export const directGetProfiles = async () => {
  try {
    const { data, error } = await supabaseDirect.from('profiles').select('*');
    if (!error && data && data.length > 0) {
      return data.map(p => ({
        profile_key: p.profile_key || p.id || 'profile_1',
        display_name: p.display_name || p.name || 'Maryam Ansar',
        unipile_account_id: p.unipile_account_id || DEFAULT_ACCOUNT_ID,
        session_active: p.session_active ?? true,
        enabled: p.enabled ?? true,
        daily_sent: p.daily_sent || 0,
      }));
    }
  } catch (e) {
    console.warn('Supabase fetch error:', e);
  }
  return [
    {
      profile_key: 'profile_1',
      display_name: 'Maryam Ansar',
      unipile_account_id: DEFAULT_ACCOUNT_ID,
      session_active: true,
      enabled: true,
      daily_sent: 0,
    },
  ];
};

export const directCreateProfile = async (data) => {
  const profile_key = data.profile_key || 'profile_1';
  const display_name = data.display_name || 'Maryam Ansar';
  const unipile_account_id = data.unipile_account_id || DEFAULT_ACCOUNT_ID;
  try {
    await supabaseDirect.from('profiles').upsert([
      {
        profile_key,
        display_name,
        unipile_account_id,
        session_active: true,
        enabled: true,
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

export const directGetUnipileAccountInfo = async (accountId) => {
  const accId = accountId || DEFAULT_ACCOUNT_ID;
  const { ok, data } = await unipileFetch(`/accounts/${accId}`);
  if (ok && data) {
    return {
      id: data.id || accId,
      name: data.name || data.username || 'Maryam Ansar',
      username: data.username || data.email || 'maryamansar',
      provider: data.provider || 'LINKEDIN',
      status: data.status || 'CONNECTED',
      headline: data.headline || 'LinkedIn Outreach Specialist',
    };
  }
  return {
    id: accId,
    name: 'Maryam Ansar',
    username: 'maryamansar',
    provider: 'LINKEDIN',
    status: 'CONNECTED',
    headline: 'LinkedIn Outreach Specialist',
  };
};

// Fetch ALL 1st-degree connections using cursor pagination loop
export const directGetNetworkingConnections = async () => {
  let allItems = [];
  let cursor = null;

  for (let page = 0; page < 20; page += 1) {
    let path = `/users/relations?account_id=${DEFAULT_ACCOUNT_ID}&limit=100`;
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

// Fetch all sent pending invitations via /users/invite/sent
export const directGetNetworkingInvitations = async () => {
  let allItems = [];
  let cursor = null;

  for (let page = 0; page < 10; page += 1) {
    let path = `/users/invite/sent?account_id=${DEFAULT_ACCOUNT_ID}`;
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

  return { success: true, invitations: allItems };
};

export const directCancelNetworkingInvitation = async (invitationId) => {
  const { ok } = await unipileFetch(`/users/invite/sent/${invitationId}?account_id=${DEFAULT_ACCOUNT_ID}`, {
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
  try {
    const { data, error } = await supabaseDirect.from('campaigns').select('*').order('created_at', { ascending: false });
    if (!error && data) return data;
  } catch (e) {
    console.warn('directGetCampaigns warning:', e);
  }
  return [];
};

export const directCreateCampaign = async (data) => {
  const payload = {
    name: data.name || 'New Campaign',
    status: data.status || 'draft',
    profile_key: data.profile_key || 'profile_1',
    daily_limit: data.daily_limit || 25,
    sequence: data.sequence || [],
    created_at: new Date().toISOString(),
  };
  try {
    const { data: res, error } = await supabaseDirect.from('campaigns').insert([payload]).select();
    if (!error && res && res[0]) return res[0];
  } catch (e) {
    console.warn('directCreateCampaign warning:', e);
  }
  return payload;
};

export const directGetCampaign = async (id) => {
  try {
    const { data, error } = await supabaseDirect.from('campaigns').select('*').eq('id', id).single();
    if (!error && data) return { campaign: data, sent: 0, accepted: 0, replied: 0 };
  } catch (e) {
    console.warn('directGetCampaign warning:', e);
  }
  return { campaign: { id, name: 'Campaign', status: 'draft', sequence: [] }, sent: 0, accepted: 0, replied: 0 };
};

export const directUpdateCampaign = async (id, updates) => {
  try {
    const { data, error } = await supabaseDirect.from('campaigns').update(updates).eq('id', id).select();
    if (!error && data && data[0]) return data[0];
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
  return directUpdateCampaign(id, { status: 'active', launched_at: new Date().toISOString() });
};

// ── Prospects Direct Operations ──────────────────────────────────

export const directGetProspects = async (params = {}) => {
  try {
    let query = supabaseDirect.from('prospects').select('*', { count: 'exact' });
    if (params.campaign_id) query = query.eq('campaign_id', params.campaign_id);
    if (params.status) query = query.eq('status', params.status);
    query = query.order('created_at', { ascending: false });
    
    const limit = params.limit || 50;
    const page = params.page || 1;
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);
    
    const { data, count, error } = await query;
    if (!error && data) {
      return { prospects: data, total: count || data.length };
    }
  } catch (e) {
    console.warn('directGetProspects warning:', e);
  }
  return { prospects: [], total: 0 };
};

export const directCreateProspect = async (data) => {
  const payload = {
    first_name: data.first_name || data.name?.split(' ')[0] || '',
    last_name: data.last_name || data.name?.split(' ').slice(1).join(' ') || '',
    name: data.name || `${data.first_name || ''} ${data.last_name || ''}`.trim(),
    headline: data.headline || '',
    company: data.company || '',
    linkedin_url: data.linkedin_url || '',
    status: data.status || 'Not Contacted',
    campaign_id: data.campaign_id || null,
    assigned_account: data.assigned_account || 'profile_1',
    custom_variables: data.custom_variables || {},
    created_at: new Date().toISOString(),
  };
  try {
    const { data: res, error } = await supabaseDirect.from('prospects').insert([payload]).select();
    if (!error && res && res[0]) return res[0];
  } catch (e) {
    console.warn('directCreateProspect warning:', e);
  }
  return payload;
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
  try {
    await supabaseDirect
      .from('prospects')
      .update({ campaign_id: campaignId })
      .in('id', prospectIds);
  } catch (e) {
    console.warn('directAddProspectsToCampaign warning:', e);
  }
  return { success: true };
};

export const directBulkImportProspects = async (file, campaignId, mode, listId) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length <= 1) return resolve({ imported_count: 0 });
        
        const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
        const prospectsToInsert = [];
        
        for (let i = 1; i < lines.length; i += 1) {
          const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
          if (cols.length === 0 || !cols[0]) continue;
          
          const rowObj = {};
          headers.forEach((h, idx) => {
            rowObj[h] = cols[idx] || '';
          });
          
          const firstName = rowObj.first_name || rowObj.firstname || rowObj.name?.split(' ')[0] || 'Lead';
          const lastName = rowObj.last_name || rowObj.lastname || rowObj.name?.split(' ').slice(1).join(' ') || '';
          
          prospectsToInsert.push({
            first_name: firstName,
            last_name: lastName,
            name: `${firstName} ${lastName}`.trim(),
            headline: rowObj.headline || rowObj.title || '',
            company: rowObj.company || rowObj.organization || '',
            linkedin_url: rowObj.linkedin_url || rowObj.profile_url || rowObj.url || '',
            status: 'Not Contacted',
            campaign_id: campaignId || null,
            assigned_account: 'profile_1',
            custom_variables: rowObj,
            created_at: new Date().toISOString(),
          });
        }
        
        if (prospectsToInsert.length > 0) {
          await supabaseDirect.from('prospects').upsert(prospectsToInsert);
        }
        
        resolve({ success: true, imported_count: prospectsToInsert.length });
      } catch (err) {
        console.error('directBulkImportProspects error:', err);
        resolve({ success: false, error: err.message, imported_count: 0 });
      }
    };
    reader.readAsText(file);
  });
};

// ── Prospect Lists Direct Operations ────────────────────────────

export const directGetProspectLists = async () => {
  try {
    const { data, error } = await supabaseDirect.from('prospect_lists').select('*').order('created_at', { ascending: false });
    if (!error && data) return { lists: data };
  } catch (e) {
    console.warn('directGetProspectLists warning:', e);
  }
  return { lists: [] };
};

export const directCreateProspectList = async (data) => {
  const payload = {
    name: data.name || 'New List',
    description: data.description || '',
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

// ── Unipile Campaign Execution Pipeline ──────────────────────────

export const directSendUnipileConnectionInvite = async (prospect, message = '') => {
  const provider_id = prospect.provider_id || prospect.member_id || prospect.public_identifier || prospect.linkedin_url;
  const payload = {
    account_id: DEFAULT_ACCOUNT_ID,
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
    return { success: true, data };
  }
  return { success: false, error: data?.detail || 'Unipile invite failed' };
};

export const directSendUnipileChatMessage = async (prospect, text = '') => {
  const recipientId = prospect.provider_id || prospect.member_id || prospect.id;
  const payload = {
    account_id: DEFAULT_ACCOUNT_ID,
    attendees_ids: [recipientId],
    text: text || prospect.initial_message || 'Hello!',
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
    return { success: true, data };
  }
  return { success: false, error: data?.detail || 'Unipile chat message failed' };
};

export const directRunConnections = async () => {
  let sentCount = 0;
  try {
    const { data: prospects } = await supabaseDirect
      .from('prospects')
      .select('*')
      .in('status', ['Not Contacted', 'pending', 'Needs Connection']);
      
    for (const p of (prospects || []).slice(0, 10)) {
      const msg = p.connection_message || `Hi ${p.first_name || ''}, I'd love to connect with you!`.trim();
      const res = await directSendUnipileConnectionInvite(p, msg);
      if (res.success) sentCount += 1;
    }
  } catch (e) {
    console.error('directRunConnections error:', e);
  }
  return { success: true, sent_count: sentCount };
};

export const directRunMessages = async () => {
  let sentCount = 0;
  try {
    const { data: prospects } = await supabaseDirect
      .from('prospects')
      .select('*')
      .in('status', ['Ready to Send', 'Connection Accepted']);
      
    for (const p of (prospects || []).slice(0, 10)) {
      const msg = p.initial_message || p.custom_variables?.offer || `Hi ${p.first_name || ''}, thanks for connecting!`.trim();
      const res = await directSendUnipileChatMessage(p, msg);
      if (res.success) sentCount += 1;
    }
  } catch (e) {
    console.error('directRunMessages error:', e);
  }
  return { success: true, sent_count: sentCount };
};

export const directCheckAcceptances = async () => {
  let acceptedCount = 0;
  try {
    const { connections } = await directGetNetworkingConnections();
    const connMap = new Set(connections.map(c => c.public_identifier || c.member_id || c.provider_id));
    
    const { data: prospects } = await supabaseDirect
      .from('prospects')
      .select('*')
      .eq('status', 'Connection Request Sent');

    for (const p of (prospects || [])) {
      const pKey = p.public_identifier || p.member_id || p.provider_id || p.linkedin_url?.split('/in/')?.[1]?.replace(/\//g, '');
      if (pKey && connMap.has(pKey)) {
        await supabaseDirect.from('prospects').update({
          status: 'Connection Accepted',
          connection_status: 'connected',
          accepted_at: new Date().toISOString(),
        }).eq('id', p.id);
        acceptedCount += 1;
      }
    }
  } catch (e) {
    console.error('directCheckAcceptances error:', e);
  }
  return { success: true, accepted_count: acceptedCount };
};

export const directRunFlow = async () => {
  const accRes = await directCheckAcceptances();
  const connRes = await directRunConnections();
  const msgRes = await directRunMessages();
  return {
    success: true,
    accepted: accRes.accepted_count,
    connections_sent: connRes.sent_count,
    messages_sent: msgRes.sent_count,
  };
};



