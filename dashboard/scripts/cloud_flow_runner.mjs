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

function extractPublicId(url) {
  if (!url) return '';
  const match = String(url).match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (match) return match[1];
  return String(url).replace(/^https?:\/\//, '').replace('www.linkedin.com/in/', '').replace(/\/$/, '').trim();
}

async function runCloudFlow() {
  console.log(`[${new Date().toISOString()}] Starting Goal-Oriented Cloud Flow Runner cycle...`);

  const globalDailyLimit = 40;
  const dailyConnectionLimit = 15;
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
  } catch (e) {}

  if (todayConnectionsTotal >= dailyConnectionLimit) {
    console.log(`Daily connection target already reached for today (${todayConnectionsTotal}/${dailyConnectionLimit}). Cycle complete.`);
    return;
  }

  const { data: campaigns } = await supabase.from('campaigns').select('*').eq('status', 'running');
  if (!campaigns || campaigns.length === 0) {
    console.log('No running campaigns found.');
    return;
  }

  for (const campaign of campaigns) {
    if (todayConnectionsTotal >= dailyConnectionLimit) break;

    const flowSequence = campaign.sequence_config?.flow_sequence;
    if (!flowSequence || !Array.isArray(flowSequence.nodes) || flowSequence.nodes.length === 0) continue;

    const nodesMap = new Map(flowSequence.nodes.map(n => [n.id, n]));
    const sourceEdgesMap = new Map();
    for (const edge of flowSequence.edges || []) {
      if (!sourceEdgesMap.has(edge.source)) sourceEdgesMap.set(edge.source, []);
      sourceEdgesMap.get(edge.source).push(edge);
    }

    const incomingTargets = new Set((flowSequence.edges || []).map(e => e.target));
    const startNode = flowSequence.nodes.find(n => !incomingTargets.has(n.id)) || flowSequence.nodes[0];
    if (!startNode) continue;

    const { data: profs } = await supabase.from('profiles').select('unipile_account_id').eq('profile_key', campaign.profile_key || 'profile_1');
    const accountId = profs?.[0]?.unipile_account_id;
    if (!accountId) continue;

    const { data: prospects } = await supabase.from('prospects').select('*').eq('campaign_id', campaign.id);
    if (!prospects || prospects.length === 0) continue;

    // Process prospects one-by-one focusing directly on today's connection request goal
    for (const prospect of prospects) {
      if (todayConnectionsTotal >= dailyConnectionLimit) {
        console.log(`🎯 Goal Reached: Sent daily target of ${todayConnectionsTotal}/${dailyConnectionLimit} connection requests today!`);
        break;
      }
      if (['Completed', 'Failed', 'Replied', 'Connection Request Sent'].includes(prospect.status)) continue;
      if (prospect.connection_status === 'invitation_sent' || prospect.connection_status === 'connected') continue;

      const cv = prospect.custom_variables || {};
      let currentNodeId = cv.current_node_id || startNode.id;
      let currentNode = nodesMap.get(currentNodeId);

      if (!currentNode) {
        currentNodeId = startNode.id;
        currentNode = nodesMap.get(currentNodeId);
        if (!currentNode) continue;
      }

      let nodeType = currentNode.data?.nodeType || currentNode.type;
      let nodeConfig = currentNode.data?.config || {};
      let edges = sourceEdgesMap.get(currentNode.id) || [];
      let nextEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default') || edges[0];

      // ── Step 1: VISIT PROFILE (if current node is visit_profile) ────────
      if (nodeType === 'visit_profile') {
        const pubId = extractPublicId(prospect.linkedin_url);
        console.log(`[Goal Engine] Visiting profile for ${prospect.name || prospect.id}...`);
        const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accountId}`);

        todayActionsTotal += 1;
        const providerId = (ok && data) ? (data.provider_id || data.id) : prospect.provider_id;
        const nowIso = new Date().toISOString();

        cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'visit_profile', node_label: 'Visit Profile', executed_at: nowIso, status: 'success' }];
        prospect.provider_id = providerId || prospect.provider_id;

        if (nextEdge) {
          currentNodeId = nextEdge.target;
          currentNode = nodesMap.get(currentNodeId);
          nodeType = currentNode?.data?.nodeType || currentNode?.type;
          nodeConfig = currentNode?.data?.config || {};
          edges = sourceEdgesMap.get(currentNode?.id) || [];
          nextEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default') || edges[0];
          cv.current_node_id = currentNodeId;
        }

        await supabase.from('prospects').update({
          provider_id: prospect.provider_id,
          custom_variables: cv
        }).eq('id', prospect.id);
      }

      // ── Step 2: CHECK WAIT / DELAY ──────────────────────────────────────
      if (nodeType === 'wait') {
        const days = Number(nodeConfig.days || 0);
        const nextScheduledStr = cv.next_scheduled_at;
        const nowMs = Date.now();

        if (days > 0 && nextScheduledStr) {
          if (nowMs < new Date(nextScheduledStr).getTime()) {
            // Still in delay window for this prospect
            continue;
          }
        } else if (days > 0 && !nextScheduledStr) {
          // Initialize delay window
          const nextScheduledAt = new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();
          cv.next_scheduled_at = nextScheduledAt;
          await supabase.from('prospects').update({ custom_variables: cv }).eq('id', prospect.id);
          continue;
        }

        // Delay elapsed (or 0 days): advance to next node
        if (nextEdge) {
          currentNodeId = nextEdge.target;
          currentNode = nodesMap.get(currentNodeId);
          nodeType = currentNode?.data?.nodeType || currentNode?.type;
          nodeConfig = currentNode?.data?.config || {};
          edges = sourceEdgesMap.get(currentNode?.id) || [];
          nextEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default') || edges[0];
          cv.current_node_id = currentNodeId;
          cv.next_scheduled_at = null;
          await supabase.from('prospects').update({ custom_variables: cv }).eq('id', prospect.id);
        }
      }

      // ── Step 3: SEND INVITATION (Achieving Today's Goal Immediately) ─────
      if (nodeType === 'send_invitation') {
        let providerId = prospect.provider_id;
        if (!providerId) {
          const pubId = extractPublicId(prospect.linkedin_url);
          const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accountId}`);
          if (ok && data) providerId = data.provider_id || data.id;
        }

        if (!providerId) continue;

        const hasNoteToggle = nodeConfig.add_note || nodeConfig.include_note || nodeConfig.send_note;
        const noteText = hasNoteToggle ? (nodeConfig.note || '').replace(/\{\{\s*first_name\s*\}\}/gi, prospect.first_name || '') : '';

        console.log(`[Goal Engine] Dispatched Connection Invite #${todayConnectionsTotal + 1} to ${prospect.name || prospect.id}...`);
        const res = await unipileFetch('/users/invite', {
          method: 'POST',
          body: JSON.stringify({ account_id: accountId, provider_id: providerId, message: noteText })
        });

        todayActionsTotal += 1;
        todayConnectionsTotal += 1;
        const nowIso = new Date().toISOString();

        if (res.ok) {
          console.log(`[Goal Engine] ✅ Connection Invite #${todayConnectionsTotal} SENT to ${prospect.name}`);
          cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'send_invitation', node_label: 'Connection Request Sent', executed_at: nowIso, status: 'success' }];
          cv.invitation_sent_at = nowIso;
          if (nextEdge) cv.current_node_id = nextEdge.target;

          await supabase.from('prospects').update({
            status: 'Connection Request Sent',
            connection_status: 'invitation_sent',
            connection_sent_date: nowIso,
            provider_id: providerId,
            custom_variables: cv
          }).eq('id', prospect.id);
        } else {
          console.warn(`[Goal Engine] ⚠️ Invite failed for ${prospect.name}:`, res.data?.detail || res.status);
          const errStr = String(res.data?.detail || res.status);
          cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'send_invitation', node_label: 'Connection Request Failed', executed_at: nowIso, status: 'failed', error: errStr }];
          await supabase.from('prospects').update({ custom_variables: cv }).eq('id', prospect.id);

          if (errStr.toLowerCase().includes('provider limit') || errStr.toLowerCase().includes('rate limit') || errStr.includes('429')) {
            console.warn('[CIRCUIT BREAKER] Halting execution due to rate limit.');
            return;
          }
        }
      }
    }
  }

  console.log(`[${new Date().toISOString()}] Goal-Oriented Flow Runner cycle complete. Total invites sent today: ${todayConnectionsTotal}/${dailyConnectionLimit}`);
}

runCloudFlow();
