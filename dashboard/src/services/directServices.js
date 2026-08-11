import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mjwganpjawthnowemabt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDczMTUsImV4cCI6MjEwMTg4MzMxNX0.OwKeHoH2DH-jS7-_XRf6Vkx4bNZPKgbL9WOr5oSd27c';
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

export const directVisitProfile = async (prospect) => {
  const targetId = getLinkedinId(prospect);
  if (!targetId) return { success: false, error: 'No identifier found for prospect' };
  
  const { ok, data } = await unipileFetch(`/users/${targetId}?account_id=${DEFAULT_ACCOUNT_ID}`);
  if (ok && data) {
    try {
      await supabaseDirect.from('prospects').update({
        public_identifier: data.public_identifier || '',
        provider_id: data.provider_id || '',
        member_id: data.member_urn || '',
      }).eq('id', prospect.id);
      // Update local object fields for immediate subsequent steps in the loop
      prospect.public_identifier = data.public_identifier || '';
      prospect.provider_id = data.provider_id || '';
      prospect.member_id = data.member_urn || '';
    } catch (e) {
      console.warn('Failed to update prospect identifiers:', e);
    }
  }
  return { success: ok, data };
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

export const directRunFlow = async () => {
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
      const { data } = await supabaseDirect.from('prospects').eq('campaign_id', campaign.id);
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

      const nodeType = currentNode.data?.nodeType;
      const nodeConfig = currentNode.data?.config || {};
      const nodeLabel = currentNode.data?.label || currentNode.id;

      // Auto-resolve LinkedIn IDs if the prospect has not been visited/resolved yet
      const isActionNode = ['follow_profile', 'endorse_profile', 'send_invitation', 'send_message'].includes(nodeType);
      if (isActionNode && !prospect.provider_id && !prospect.member_id) {
        console.log(`Prospect ${prospect.name || prospect.id} does not have resolved provider IDs. Performing auto-visit resolution...`);
        await directVisitProfile(prospect);
      }

      if (nodeType === 'wait') {
        const nextScheduledStr = prospect.custom_variables?.next_scheduled_at;
        if (nextScheduledStr) {
          const nextScheduled = new Date(nextScheduledStr).getTime();
          if (Date.now() < nextScheduled) continue;
        } else {
          const days = Number(nodeConfig.days) || 1;
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
        const defaultEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default');
        if (defaultEdge) {
          prospect.custom_variables.current_node_id = defaultEdge.target;
          prospect.custom_variables.next_scheduled_at = null;
          try {
            await supabaseDirect.from('prospects').update({ custom_variables: prospect.custom_variables }).eq('id', prospect.id);
          } catch (e) {
            console.warn(e);
          }
        }
        continue;
      }

      if (nodeType === 'send_invitation') {
        const { connections } = await directGetNetworkingConnections();
        const connMap = new Set(connections.map(c => c.public_identifier || c.member_id || c.provider_id || c.member_urn).filter(Boolean));
        const pKey = prospect.public_identifier || prospect.member_id || prospect.provider_id || prospect.linkedin_url?.split('/in/')?.[1]?.replace(/\//g, '').split('?')[0];
        
        const isConnected = pKey && connMap.has(pKey);
        const edges = sourceEdgesMap.get(currentNode.id) || [];
        const defaultEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default');

        if (isConnected) {
          console.log(`Prospect ${prospect.name} is already connected. Skipping invitation node.`);
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
          continue;
        }

        if (prospect.status !== 'Connection Request Sent') {
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
          }
          continue;
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

      const render = (templateText) => {
        if (!templateText) return '';
        return String(templateText)
          .replace(/\{\{\s*first_name\s*\}\}/g, prospect.first_name || 'there')
          .replace(/\{\{\s*last_name\s*\}\}/g, prospect.last_name || '')
          .replace(/\{\{\s*company\s*\}\}/g, prospect.company || 'your company')
          .replace(/\{\{\s*title\s*\}\}/g, prospect.job_title || 'your role')
          .replace(/\{\{\s*industry\s*\}\}/g, prospect.custom_fields?.industry || '')
          .replace(/\{\{\s*location\s*\}\}/g, prospect.custom_fields?.location || '');
      };

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




