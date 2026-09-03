import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://mjwganpjawthnowemabt.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDczMTUsImV4cCI6MjEwMTg4MzMxNX0.OwKeHoH2DH-jS7-_XRf6Vkx4bNZPKgbL9WOr5oSd27c';
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY || '6SlhX8Ii.R7wP5y2dLTREmrXKCTpnoEg3clwHKT9wZtIc++MRAkg=';
const UNIPILE_BASE_URL = process.env.UNIPILE_BASE_URL || 'https://api20.unipile.com:15032/api/v1';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { disabled: true }
});

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

function getProfileDateStr(dateOrIso, timezone) {
  const tz = timezone || 'UTC';
  try {
    const d = dateOrIso ? new Date(dateOrIso) : new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return formatter.format(d);
  } catch (e) {
    return (dateOrIso ? new Date(dateOrIso) : new Date()).toISOString().split('T')[0];
  }
}

async function runCloudFlow() {
  const { data: campaigns, error: campErr } = await supabase.from('campaigns').select('*').eq('status', 'running');
  if (campErr) {
    console.error(`[${new Date().toISOString()}] Error fetching running campaigns:`, campErr.message);
    return;
  }

  if (!campaigns || campaigns.length === 0) {
    return;
  }

  for (const campaign of campaigns) {
    const orgId = campaign.organization_id;
    const { data: profs } = await supabase.from('profiles').select('settings, unipile_account_id').eq('profile_key', campaign.profile_key || 'profile_1');
    const profile = profs?.[0];
    const accountId = profile?.unipile_account_id;
    if (!accountId) continue;

    const settings = profile?.settings || {};
    const profileTz = settings.timezone || 'UTC';
    const profileTodayStr = getProfileDateStr(null, profileTz);

    // 1. LinkedIn Provider Cooldown Check
    if (settings.provider_limit_cooldown_until && Date.now() < settings.provider_limit_cooldown_until) {
      const hoursLeft = Math.ceil((settings.provider_limit_cooldown_until - Date.now()) / (1000 * 60 * 60));
      console.log(`[Railway 24/7 Daemon] ⏸️ Skipping campaign "${campaign.name}" - LinkedIn provider limit cooldown active (${hoursLeft}h remaining).`);
      continue;
    }

    // 2. Profile Timezone Working Hours & Weekend Check
    if (settings.enable_working_hours) {
      const nowInTz = new Date(new Date().toLocaleString('en-US', { timeZone: profileTz }));
      const dayOfWeek = nowInTz.getDay(); // 0 = Sun, 6 = Sat
      if (settings.skip_weekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
        console.log(`[Railway 24/7 Daemon] ⏸️ Skipping campaign "${campaign.name}" - Weekend in profile timezone (${profileTz}).`);
        continue;
      }

      const startParts = (settings.start_time || '09:00').split(':');
      const endParts = (settings.end_time || '18:00').split(':');
      const startMin = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1] || '0', 10);
      const endMin = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1] || '0', 10);
      const currentMin = nowInTz.getHours() * 60 + nowInTz.getMinutes();

      if (currentMin < startMin || currentMin >= endMin) {
        console.log(`[Railway 24/7 Daemon] ⏸️ Skipping campaign "${campaign.name}" - Outside working hours (${settings.start_time} - ${settings.end_time}) in ${profileTz}.`);
        continue;
      }
    }

    const dailyConnectionLimit = Number(settings.daily_connection_limit || 20);
    const globalDailyLimit = Number(settings.global_daily_limit || 40);

    // Calculate today's executed actions count in profile timezone
    let todayActionsTotal = 0;
    let todayConnectionsTotal = 0;
    try {
      let query = supabase.from('prospects').select('custom_variables');
      if (orgId) query = query.eq('organization_id', orgId);
      const { data: allProspects } = await query;
      (allProspects || []).forEach(p => {
        const history = p.custom_variables?.history || [];
        history.forEach(h => {
          if (h.executed_at && getProfileDateStr(h.executed_at, profileTz) === profileTodayStr) {
            todayActionsTotal += 1;
            if (h.node_type === 'send_invitation' && h.status === 'success') todayConnectionsTotal += 1;
          }
        });
      });
    } catch (e) {}

    if (todayConnectionsTotal >= dailyConnectionLimit) {
      console.log(`[Railway 24/7 Daemon] 🎯 Goal Reached: Sent target ${todayConnectionsTotal}/${dailyConnectionLimit} connections for profile today in ${profileTz}.`);
      continue;
    }

    if (todayActionsTotal >= globalDailyLimit) {
      console.log(`[Railway 24/7 Daemon] 🎯 Global Limit Reached: Executed ${todayActionsTotal}/${globalDailyLimit} actions for profile today in ${profileTz}.`);
      continue;
    }

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

    // Fetch prospects enrolled in this campaign via campaign_enrollments or campaign_id
    const { data: enrollments } = await supabase.from('campaign_enrollments').select('prospect_id').eq('campaign_id', campaign.id);
    const enrolledIds = (enrollments || []).map(e => e.prospect_id).filter(Boolean);

    let prospectQuery = supabase.from('prospects').select('*');
    if (enrolledIds.length > 0) {
      prospectQuery = prospectQuery.or(`campaign_id.eq.${campaign.id},id.in.(${enrolledIds.join(',')})`);
    } else {
      prospectQuery = prospectQuery.eq('campaign_id', campaign.id);
    }
    const { data: prospects } = await prospectQuery;
    if (!prospects || prospects.length === 0) continue;

    for (const prospect of prospects) {
      if (todayConnectionsTotal >= dailyConnectionLimit) {
        console.log(`[Railway 24/7 Daemon] 🎯 Goal Reached: Sent daily target of ${todayConnectionsTotal}/${dailyConnectionLimit} connections today for ${campaign.name}!`);
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

      // ── Step 1: Visit profile if needed ─────────────────────────────────────
      if (nodeType === 'visit_profile') {
        const pubId = extractPublicId(prospect.linkedin_url);
        console.log(`[Railway 24/7 Daemon] Visiting profile for ${prospect.name || prospect.id}...`);
        const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accountId}`);
        const providerId = (ok && data) ? (data.provider_id || data.id) : prospect.provider_id;
        prospect.provider_id = providerId || prospect.provider_id;

        const nowIso = new Date().toISOString();
        cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'visit_profile', node_label: 'Visit Profile', executed_at: nowIso, status: 'success' }];
        cv.visited_at = nowIso;

        if (nextEdge) {
          currentNodeId = nextEdge.target;
          currentNode = nodesMap.get(currentNodeId);
          nodeType = currentNode?.data?.nodeType || currentNode?.type;
          nodeConfig = currentNode?.data?.config || {};
          edges = sourceEdgesMap.get(currentNode?.id) || [];
          nextEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default') || edges[0];
          cv.current_node_id = currentNodeId;
        }

        await supabase.from('prospects').update({ provider_id: prospect.provider_id, custom_variables: cv }).eq('id', prospect.id);
      }

      // ── Step 2: Delay Check ─────────────────────────────────────────────────
      if (nodeType === 'wait') {
        const days = Number(nodeConfig.days || 0);
        const nextSched = cv.next_scheduled_at;
        const nowMs = Date.now();

        if (days > 0 && nextSched) {
          if (nowMs < new Date(nextSched).getTime()) continue;
        } else if (days > 0 && !nextSched) {
          const nextScheduledAt = new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();
          cv.next_scheduled_at = nextScheduledAt;
          await supabase.from('prospects').update({ custom_variables: cv }).eq('id', prospect.id);
          continue;
        }

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

      // ── Step 3: Send Invitation ─────────────────────────────────────────────
      if (nodeType === 'send_invitation') {
        let providerId = prospect.provider_id;
        if (!providerId) {
          const pubId = extractPublicId(prospect.linkedin_url);
          const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accountId}`);
          if (ok && data) providerId = data.provider_id || data.id;
        }

        if (!providerId) {
          console.warn(`[Railway 24/7 Daemon] Could not resolve providerId for ${prospect.first_name || ''} ${prospect.last_name || ''}. Marking Needs Attention.`);
          cv.provider_resolution_failed = true;
          await supabase.from('prospects').update({ status: 'Needs Attention', custom_variables: cv }).eq('id', prospect.id);
          continue;
        }

        const hasNoteToggle = nodeConfig.add_note || nodeConfig.include_note || nodeConfig.send_note;
        const noteText = hasNoteToggle ? (nodeConfig.note || '').replace(/\{\{\s*first_name\s*\}\}/gi, prospect.first_name || '') : '';

        console.log(`[Railway 24/7 Daemon] Dispatched Connection Invite #${todayConnectionsTotal + 1} to ${prospect.first_name || ''} ${prospect.last_name || ''}...`);
        const res = await unipileFetch('/users/invite', {
          method: 'POST',
          body: JSON.stringify({ account_id: accountId, provider_id: providerId, message: noteText })
        });

        const nowIso = new Date().toISOString();

        if (res.ok) {
          todayActionsTotal += 1;
          todayConnectionsTotal += 1;
          console.log(`[Railway 24/7 Daemon] ✅ Connection Invite #${todayConnectionsTotal} SENT to ${prospect.first_name || ''} ${prospect.last_name || ''}`);
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
          console.warn(`[Railway 24/7 Daemon] ⚠️ Invite failed for ${prospect.first_name || ''} ${prospect.last_name || ''}:`, res.data?.detail || res.data?.title || res.status);
          const errStr = String(res.data?.detail || res.data?.title || res.status);
          const isAlreadyInvited = errStr.toLowerCase().includes('already') || errStr.toLowerCase().includes('recently') || res.data?.type === 'errors/already_invited_recently';

          if (isAlreadyInvited) {
            console.log(`[Railway 24/7 Daemon] Prospect ${prospect.first_name || ''} ${prospect.last_name || ''} was already invited recently. Marking Connection Request Sent.`);
            todayConnectionsTotal += 1;
            cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'send_invitation', node_label: 'Connection Request Sent (Existing)', executed_at: nowIso, status: 'success' }];
            if (nextEdge) cv.current_node_id = nextEdge.target;

            await supabase.from('prospects').update({
              status: 'Connection Request Sent',
              connection_status: 'invitation_sent',
              connection_sent_date: nowIso,
              provider_id: providerId,
              custom_variables: cv
            }).eq('id', prospect.id);
          } else {
            cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'send_invitation', node_label: 'Connection Request Failed', executed_at: nowIso, status: 'failed', error: errStr }];
            await supabase.from('prospects').update({ custom_variables: cv }).eq('id', prospect.id);

            if (errStr.toLowerCase().includes('provider limit') || errStr.toLowerCase().includes('rate limit') || errStr.includes('429')) {
              console.warn(`[Railway 24/7 Daemon] 🛑 LinkedIn Provider/Rate Limit hit for "${campaign.name}". Entering 12-hour cooldown.`);
              const cooldownUntil = Date.now() + 12 * 60 * 60 * 1000;
              const updatedSettings = { ...settings, provider_limit_cooldown_until: cooldownUntil };
              await supabase.from('profiles').update({ settings: updatedSettings }).eq('profile_key', campaign.profile_key);
              break;
            }
          }
        }
      }
    }
  }
}

// ── Continuous 24/7 Daemon Loop ───────────────────────────────────────────────
const LOOP_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 60000); // 60 seconds default

console.log(`[Railway 24/7 Daemon] Initializing 24/7 Cloud Automation Engine (Polling every ${LOOP_INTERVAL_MS / 1000}s)...`);

async function daemonLoop() {
  while (true) {
    try {
      await runCloudFlow();
    } catch (err) {
      console.error(`[Railway 24/7 Daemon] Unexpected error in execution cycle:`, err);
    }
    await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL_MS));
  }
}

daemonLoop();
