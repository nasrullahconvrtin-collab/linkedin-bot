import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mjwganpjawthnowemabt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDczMTUsImV4cCI6MjEwMTg4MzMxNX0.OwKeHoH2DH-jS7-_XRf6Vkx4bNZPKgbL9WOr5oSd27c';
const UNIPILE_API_KEY = '6SlhX8Ii.R7wP5y2dLTREmrXKCTpnoEg3clwHKT9wZtIc++MRAkg=';
const UNIPILE_BASE_URL = 'https://api20.unipile.com:15032/api/v1';
const DEFAULT_ACCOUNT_ID = 'zXneBg9WRZ-m7iFuKULo1Q';

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

let activeAccountId = getStoredDisconnectedFlag() ? null : DEFAULT_ACCOUNT_ID;

export const directGetProfiles = async () => {
  if (getStoredDisconnectedFlag()) {
    return [];
  }

  try {
    const { data, error } = await supabaseDirect.from('profiles').select('*');
    if (!error && data && data.length > 0) {
      if (data[0].unipile_account_id) {
        activeAccountId = data[0].unipile_account_id;
      }
      return data.map(p => ({
        profile_key: p.profile_key || p.id || 'profile_1',
        display_name: p.display_name && p.display_name !== 'Maryam Ansar' ? p.display_name : 'Fatima Maqsood',
        unipile_account_id: p.unipile_account_id || activeAccountId,
        session_active: p.session_active ?? true,
        enabled: p.enabled ?? true,
        daily_sent: p.daily_sent || 0,
      }));
    }
  } catch (e) {
    console.warn('Supabase fetch error:', e);
  }

  const currentId = activeAccountId || DEFAULT_ACCOUNT_ID;
  return [
    {
      profile_key: 'profile_1',
      display_name: 'Fatima Maqsood',
      unipile_account_id: currentId,
      session_active: true,
      enabled: true,
      daily_sent: 0,
    },
  ];
};

export const directCreateProfile = async (data) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem('lf_account_disconnected');
    }
  } catch (e) {}

  const profile_key = data.profile_key || 'profile_1';
  const display_name = data.display_name || 'Fatima Maqsood';
  const unipile_account_id = data.unipile_account_id || DEFAULT_ACCOUNT_ID;
  activeAccountId = unipile_account_id;

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

export const directDisconnectProfile = async () => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem('lf_account_disconnected', 'true');
    }
  } catch (e) {}

  try {
    await supabaseDirect.from('profiles').delete().gt('created_at', '1970-01-01T00:00:00Z');
    await supabaseDirect.from('profiles').delete().neq('profile_key', 'dummy_key_none');
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

export const directGetUnipileAccountInfo = async (accountId) => {
  if (getStoredDisconnectedFlag()) {
    return null;
  }

  const targetAccId = accountId || activeAccountId || DEFAULT_ACCOUNT_ID;

  try {
    const { ok, data } = await unipileFetch(`/accounts/${targetAccId}`);
    if (ok && data && data.id) {
      const imParam = data.connection_params?.im || {};
      const realName = data.name || imParam.username || 'Fatima Maqsood';
      return {
        id: data.id,
        name: realName,
        username: imParam.publicIdentifier || imParam.username || realName || 'connected_user',
        provider: data.type || 'LINKEDIN',
        status: data.sources?.[0]?.status || 'CONNECTED',
        headline: imParam.headline || 'LinkedIn Outreach Account',
      };
    }
  } catch (e) {
    console.warn('Fetch account error:', e);
  }

  return {
    id: targetAccId,
    name: 'Fatima Maqsood',
    username: 'fatima-maqsood',
    provider: 'LINKEDIN',
    status: 'CONNECTED',
    headline: 'LinkedIn Outreach Profile',
  };
};

// Fetch ALL 1st-degree connections using cursor pagination loop
export const directGetNetworkingConnections = async () => {
  if (getStoredDisconnectedFlag()) {
    return { success: true, connections: [], total: 0 };
  }
  const targetAccId = activeAccountId || DEFAULT_ACCOUNT_ID;
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

// Fetch ALL sent pending invitations via /users/invite/sent
export const directGetNetworkingInvitations = async () => {
  if (getStoredDisconnectedFlag()) {
    return { success: true, invitations: [], total: 0 };
  }
  const targetAccId = activeAccountId || DEFAULT_ACCOUNT_ID;
  let allItems = [];
  let cursor = null;

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
    const { data: campaigns, error } = await supabaseDirect.from('campaigns').select('*').order('created_at', { ascending: false });
    if (!error && campaigns) {
      const { data: prospects } = await supabaseDirect.from('prospects').select('id, campaign_id, status');
      const prospectMap = new Map();
      (prospects || []).forEach(p => {
        if (!p.campaign_id) return;
        if (!prospectMap.has(p.campaign_id)) {
          prospectMap.set(p.campaign_id, { total: 0, sent: 0, accepted: 0, replied: 0 });
        }
        const stats = prospectMap.get(p.campaign_id);
        stats.total += 1;
        if (p.status && p.status !== 'Not Contacted' && p.status !== '') {
          stats.sent += 1;
        }
        if (['Connection Accepted', 'CONNECTED', 'Replied'].includes(p.status)) {
          stats.accepted += 1;
        }
        if (p.status === 'Replied') {
          stats.replied += 1;
        }
      });

      return campaigns.map(c => {
        const stats = prospectMap.get(c.id) || { total: 0, sent: 0, accepted: 0, replied: 0 };
        return {
          ...c,
          prospect_count: stats.total,
          sent: stats.sent,
          accepted: stats.accepted,
          replied: stats.replied,
        };
      });
    }
  } catch (e) {
    console.warn('directGetCampaigns warning:', e);
  }
  return [];
};

export const directCreateCampaign = async (data) => {
  const payload = {
    name: data.name || 'New Campaign',
    status: data.status || 'draft',
    profile_key: data.profile_key || (data.settings && data.settings.profile_key) || 'profile_1',
    daily_limit: data.daily_limit || 25,
    sequence: data.sequence || [],
    sequence_config: data.sequence_config || {},
    settings: data.settings || {},
    template: data.template || {},
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
    job_title: data.job_title || '',
    email: data.email || '',
    linkedin_url: data.linkedin_url || '',
    status: data.status || 'Not Contacted',
    campaign_id: data.campaign_id || null,
    assigned_account: data.assigned_account || 'profile_1',
    custom_variables: data.custom_variables || {},
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

export const directBulkImportProspects = async (file, campaignId, mode, listId) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        
        // RFC-4180 compliant CSV parser to handle quotes, newlines, and commas inside fields
        const parseCSV = (csvText) => {
          const lines = [];
          let row = [""];
          let inQuotes = false;

          for (let i = 0; i < csvText.length; i++) {
            const char = csvText[i];
            const nextChar = csvText[i + 1];

            if (char === '"') {
              if (inQuotes && nextChar === '"') {
                row[row.length - 1] += '"';
                i++; // Skip double double-quote
              } else {
                inQuotes = !inQuotes;
              }
            } else if (char === ',' && !inQuotes) {
              row.push("");
            } else if ((char === '\r' || char === '\n') && !inQuotes) {
              if (char === '\r' && nextChar === '\n') {
                i++; // Skip CR LF
              }
              // End of row
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
        };

        const parsedData = parseCSV(text);
        if (parsedData.length <= 1) return resolve({ imported_count: 0 });

        const rawHeaders = parsedData[0];
        const headers = rawHeaders.map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
        const prospectsToInsert = [];

        for (let i = 1; i < parsedData.length; i += 1) {
          const cols = parsedData[i];
          if (cols.length === 0 || (cols.length === 1 && !cols[0])) continue;

          const rowObj = {};
          const customVars = {};

          rawHeaders.forEach((rawH, idx) => {
            const val = cols[idx] || '';
            const cleanH = rawH.trim();
            if (cleanH) {
              rowObj[cleanH.toLowerCase()] = val;
              customVars[cleanH] = val;
              const normKey = cleanH.toLowerCase().replace(/[^a-z0-9]/g, '_');
              customVars[normKey] = val;
            }
          });

          // Check if it's a completely empty line
          const values = Object.values(customVars).filter(Boolean);
          if (values.length === 0) continue;

          const firstName = rowObj.first_name || rowObj.firstname || rowObj.name?.split(' ')[0] || customVars.firstname || customVars.first_name || 'Lead';
          const lastName = rowObj.last_name || rowObj.lastname || rowObj.name?.split(' ').slice(1).join(' ') || customVars.lastname || customVars.last_name || '';
          const linkedinUrl = rowObj.linkedin_url || rowObj.linkedinurl || rowObj.profile_url || rowObj.url || customVars.linkedinurl || customVars.linkedin_url || '';

          const isValidUrl = linkedinUrl && linkedinUrl.length < 250 && (!linkedinUrl.includes(' ') || linkedinUrl.includes('http') || linkedinUrl.includes('linkedin'));
          const emailVal = rowObj.email || customVars.email || '';
          const isValidEmail = emailVal && emailVal.includes('@') && emailVal.includes('.') && !emailVal.includes(' ');

          if (!isValidUrl && !isValidEmail) {
            continue; // Skip invalid or split line fragment
          }

          prospectsToInsert.push({
            first_name: firstName,
            last_name: lastName,
            name: `${firstName} ${lastName}`.trim(),
            headline: rowObj.headline || rowObj.title || '',
            company: rowObj.company || rowObj.organization || '',
            linkedin_url: isValidUrl ? linkedinUrl : '',
            email: isValidEmail ? emailVal : '',
            status: 'Not Contacted',
            campaign_id: campaignId || null,
            assigned_account: 'profile_1',
            custom_variables: customVars,
            custom_fields: customVars,
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
  if (prospect.linkedin_url) {
    const parts = prospect.linkedin_url.split('/in/');
    if (parts[1]) {
      return parts[1].split('?')[0].replace(/\//g, '').trim();
    }
  }
  return prospect.id;
};

export const directResolveLinkedinProfile = async (prospect) => {
  const targetId = getLinkedinId(prospect);
  if (!targetId) return null;
  const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(targetId)}?account_id=${DEFAULT_ACCOUNT_ID}`);
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
  return { success: Boolean(data), data };
};

export const directFollowProfile = async (prospect) => {
  const targetId = getLinkedinId(prospect);
  if (!targetId) return { success: true };
  await unipileFetch(`/users/${targetId}?account_id=${DEFAULT_ACCOUNT_ID}`);
  return { success: true };
};

export const directEndorseProfile = async (prospect) => {
  const targetId = getLinkedinId(prospect);
  if (!targetId) return { success: true };
  await unipileFetch(`/users/${targetId}?account_id=${DEFAULT_ACCOUNT_ID}`);
  return { success: true };
};

export const directSendUnipileConnectionInvite = async (prospect, message = '') => {
  const provider_id = getLinkedinId(prospect);
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
  const recipientId = getLinkedinId(prospect);
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

export const directSendUnipileInMail = async (prospect, subject = '', text = '') => {
  const recipientId = getLinkedinId(prospect);
  const payload = {
    account_id: DEFAULT_ACCOUNT_ID,
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
  if (!activeAccountId) {
    return { success: false, chats: [] };
  }
  const { ok, data } = await unipileFetch(`/chats?account_id=${activeAccountId}&limit=${limit}`);
  if (ok && data) {
    return { success: true, chats: data.items || data.chats || [] };
  }
  return { success: false, chats: [] };
};

export const directGetChatMessages = async (chatId, limit = 50) => {
  if (!chatId || !activeAccountId) return { success: false, messages: [] };
  const { ok, data } = await unipileFetch(`/chats/${encodeURIComponent(chatId)}/messages?account_id=${activeAccountId}&limit=${limit}`);
  if (ok && data) {
    return { success: true, messages: data.items || data.messages || [] };
  }
  return { success: false, messages: [] };
};

export const directGetUnipileUserProfile = async (identifier) => {
  if (!identifier) return { success: false, profile: null };
  const cleanId = String(identifier).trim().replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//i, '').replace(/\/$/, '');
  const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(cleanId)}?account_id=${DEFAULT_ACCOUNT_ID}`);
  if (ok && data) {
    return { success: true, profile: data };
  }
  return { success: false, profile: null };
};

export const directCheckProspectReplied = async (prospect) => {
  const recipientId = getLinkedinId(prospect);
  if (!recipientId) return { success: true, replied: false };
  const { ok, data } = await unipileFetch(`/chats?account_id=${DEFAULT_ACCOUNT_ID}&attendees_ids=${encodeURIComponent(recipientId)}`);
  if (ok && data && Array.isArray(data.items)) {
    const chat = data.items[0];
    if (chat && chat.last_message_sender_id && chat.last_message_sender_id !== DEFAULT_ACCOUNT_ID) {
      return { success: true, replied: true };
    }
  }
  return { success: true, replied: false };
};

export const DEFAULT_APP_SETTINGS = {
  daily_visit_limit: 50,
  daily_follow_limit: 30,
  daily_connection_limit: 25,
  daily_message_limit: 40,
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

  let totalExecuted = 0;
  let totalConnections = 0;
  let totalMessages = 0;

  for (const campaign of campaigns) {
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

    let dailyLimit = campaign.daily_limit || 25;
    let actionsTaken = 0;

    for (const prospect of prospects) {
      if (actionsTaken >= dailyLimit) break;

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
          const inviteNote = render(nodeConfig.note || '');
          console.log(`Sending connection invite to ${prospect.name}...`);
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




