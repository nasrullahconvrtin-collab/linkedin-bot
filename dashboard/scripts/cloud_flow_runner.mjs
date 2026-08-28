import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://mjwganpjawthnowemabt.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDczMTUsImV4cCI6MjEwMTg4MzMxNX0.OwKeHoH2DH-jS7-_XRf6Vkx4bNZPKgbL9WOr5oSd27c';
const UNIPILE_API_KEY = '6SlhX8Ii.R7wP5y2dLTREmrXKCTpnoEg3clwHKT9wZtIc++MRAkg=';
const UNIPILE_BASE_URL = 'https://api20.unipile.com:15032/api/v1';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function unipileFetch(endpoint, options = {}) {
  const headers = {
    'X-API-KEY': UNIPILE_API_KEY,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  try {
    const res = await fetch(`${UNIPILE_BASE_URL}${endpoint}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 500, data: null };
  }
}

async function getAppSettings() {
  try {
    const { data } = await supabase.from('profiles').select('settings').eq('profile_key', 'profile_1');
    if (data && data[0] && data[0].settings) {
      return {
        daily_connection_limit: 15,
        daily_message_limit: 40,
        global_daily_limit: 40,
        ...data[0].settings
      };
    }
  } catch (e) {}
  return { daily_connection_limit: 15, daily_message_limit: 40, global_daily_limit: 40 };
}

function getLinkedinId(prospect) {
  if (prospect.provider_id) return prospect.provider_id;
  if (prospect.member_id) return prospect.member_id;
  if (prospect.linkedin_url) {
    const match = prospect.linkedin_url.match(/linkedin\.com\/in\/([^\/\?]+)/i);
    if (match) return match[1];
  }
  return null;
}

async function runCloudFlow() {
  console.log(`[${new Date().toISOString()}] Starting 24/7 Cloud Flow Runner cycle...`);
  
  const appSettings = await getAppSettings();
  const globalDailyLimit = Number(appSettings.global_daily_limit || 40);
  const dailyConnectionLimit = Number(appSettings.daily_connection_limit || 15);

  const todayDateStr = new Date().toISOString().split('T')[0];
  let todayActionsTotal = 0;
  let todayConnectionsTotal = 0;

  try {
    const { data: allProspects } = await supabase.from('prospects').select('custom_variables');
    (allProspects || []).forEach(p => {
      const history = p.custom_variables?.history || [];
      history.forEach(h => {
        if (h.executed_at && h.executed_at.startsWith(todayDateStr)) {
          todayActionsTotal += 1;
          if (h.node_type === 'send_invitation') todayConnectionsTotal += 1;
        }
      });
    });
  } catch (e) {
    console.warn('Error checking daily limits:', e);
  }

  if (todayActionsTotal >= globalDailyLimit) {
    console.log(`Global daily safety limit reached (${todayActionsTotal}/${globalDailyLimit}). Cycle complete.`);
    return;
  }

  const { data: campaigns, error: cErr } = await supabase.from('campaigns').select('*').eq('status', 'running');
  if (cErr || !campaigns || campaigns.length === 0) {
    console.log('No running campaigns found. Cycle complete.');
    return;
  }

  console.log(`Found ${campaigns.length} active running campaign(s). Processing...`);

  for (const campaign of campaigns) {
    const flowSequence = campaign.sequence_config?.flow_sequence;
    if (!flowSequence || !Array.isArray(flowSequence.nodes) || flowSequence.nodes.length === 0) continue;

    const nodesMap = new Map(flowSequence.nodes.map(n => [n.id, n]));
    const sourceEdgesMap = new Map();
    for (const edge of flowSequence.edges || []) {
      if (!sourceEdgesMap.has(edge.source)) sourceEdgesMap.set(edge.source, []);
      sourceEdgesMap.get(edge.source).push(edge);
    }

    const incomingEdgeTargets = new Set((flowSequence.edges || []).map(e => e.target));
    const startNode = flowSequence.nodes.find(n => !incomingEdgeTargets.has(n.id)) || flowSequence.nodes[0];
    if (!startNode) continue;

    const { data: prospects } = await supabase.from('prospects').select('*').eq('campaign_id', campaign.id);
    if (!prospects || prospects.length === 0) continue;

    for (const prospect of prospects) {
      if (todayActionsTotal >= globalDailyLimit) break;
      if (['Completed', 'Failed', 'Replied'].includes(prospect.status)) continue;

      let currentNodeId = prospect.custom_variables?.current_node_id || startNode.id;
      let currentNode = nodesMap.get(currentNodeId);
      if (!currentNode) continue;

      const nodeType = currentNode.data?.nodeType;
      const nodeConfig = currentNode.data?.config || {};

      if (nodeType === 'send_invitation') {
        if (todayConnectionsTotal >= dailyConnectionLimit) {
          console.log(`Daily connection limit reached (${todayConnectionsTotal}/${dailyConnectionLimit}). Skipping invite for ${prospect.name}`);
          continue;
        }

        if (prospect.status !== 'Connection Request Sent' && prospect.connection_status !== 'invitation_sent' && prospect.connection_status !== 'connected') {
          const recipientId = getLinkedinId(prospect);
          const { data: profs } = await supabase.from('profiles').select('unipile_account_id').eq('profile_key', campaign.profile_key || 'profile_1');
          const accountId = profs?.[0]?.unipile_account_id;

          if (!accountId || !recipientId) {
            console.log(`Missing accountId or recipientId for ${prospect.name}`);
            continue;
          }

          const hasNoteToggle = nodeConfig.add_note || nodeConfig.include_note || nodeConfig.send_note;
          const noteText = hasNoteToggle ? (nodeConfig.note || '').replace(/\{\{\s*first_name\s*\}\}/gi, prospect.first_name || '') : '';

          console.log(`[Cloud Engine] Sending connection invitation to ${prospect.name}...`);
          const res = await unipileFetch('/users/invite', {
            method: 'POST',
            body: JSON.stringify({ account_id: accountId, provider_id: recipientId, message: noteText })
          });

          todayActionsTotal += 1;
          todayConnectionsTotal += 1;

          if (res.ok) {
            console.log(`[Cloud Engine] ✅ Connection invite sent to ${prospect.name}`);
            const cv = prospect.custom_variables || {};
            cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'send_invitation', executed_at: new Date().toISOString(), status: 'success' }];
            cv.invitation_sent_at = new Date().toISOString();
            await supabase.from('prospects').update({
              status: 'Connection Request Sent',
              connection_status: 'invitation_sent',
              connection_sent_date: new Date().toISOString(),
              custom_variables: cv
            }).eq('id', prospect.id);
          } else {
            console.warn(`[Cloud Engine] ⚠️ Failed to send invite to ${prospect.name}:`, res.data?.detail || res.status);
            const errStr = String(res.data?.detail || res.status);
            const cv = prospect.custom_variables || {};
            cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'send_invitation', executed_at: new Date().toISOString(), status: 'failed', error: errStr }];
            await supabase.from('prospects').update({ custom_variables: cv }).eq('id', prospect.id);

            if (errStr.toLowerCase().includes('provider limit') || errStr.toLowerCase().includes('rate limit') || errStr.includes('429')) {
              console.warn('[CIRCUIT BREAKER] LinkedIn rate limit triggered. Halting cloud execution loop.');
              return;
            }
          }
        }
      }
    }
  }
  console.log(`[${new Date().toISOString()}] Cloud Flow Runner cycle complete.`);
}

runCloudFlow();
