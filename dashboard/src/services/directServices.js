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

