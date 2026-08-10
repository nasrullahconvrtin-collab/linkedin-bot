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
