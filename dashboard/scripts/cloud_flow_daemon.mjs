import http from 'http';
import { createClient } from '@supabase/supabase-js';

const PORT = process.env.PORT;
if (PORT) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'cloud-flow-daemon', timestamp: new Date().toISOString() }));
  });
  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[Railway 24/7 Daemon] HTTP Health check server listening on port ${PORT}`);
  });
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://mjwganpjawthnowemabt.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDczMTUsImV4cCI6MjEwMTg4MzMxNX0.OwKeHoH2DH-jS7-_XRf6Vkx4bNZPKgbL9WOr5oSd27c';
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY || 'vpftWHjq.lC9ACICdkDlLNupo90avQybHg2UjAtAkMssKHxsEw9o=';
const UNIPILE_BASE_URL = process.env.UNIPILE_BASE_URL || 'https://api63.unipile.com:19339/api/v1';

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

  const contactedRecipientsThisCycle = new Set();

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

    const dailyConnectionLimit = Number(settings.daily_connection_limit || 25);
    const dailyMessageLimit = Number(settings.daily_message_limit || 140);
    const dailyVisitLimit = Number(settings.daily_visit_limit || 30);
    const configuredGlobalLimit = Number(settings.global_daily_limit || 0);
    const sumOfLimits = dailyConnectionLimit + dailyMessageLimit + dailyVisitLimit;
    const globalDailyLimit = configuredGlobalLimit > 0 ? Math.max(configuredGlobalLimit, sumOfLimits) : sumOfLimits;

    // Calculate today's executed actions count per action type in profile timezone
    let todayActionsTotal = 0;
    let todayConnectionsTotal = 0;
    let todayMessagesTotal = 0;
    let todayVisitsTotal = 0;
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
            if ((h.node_type === 'send_message' || h.node_type === 'send_voice_message') && h.status === 'success') todayMessagesTotal += 1;
            if (h.node_type === 'visit_profile' && h.status === 'success') todayVisitsTotal += 1;
          }
        });
      });
    } catch (e) {}

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

    // Pre-fetch 1st-degree relations to detect accepted connection requests
    const { ok: relOk, data: relData } = await unipileFetch(`/users/relations?account_id=${accountId}&limit=100`);
    const relations = (relOk && relData && (relData.items || relData.relations)) || [];
    const relSlugs = new Set();
    const relMemberIds = new Set();
    const relNames = new Map();
    relations.forEach(r => {
      if (r.public_identifier) relSlugs.add(r.public_identifier.toLowerCase().trim());
      const pubUrlSlug = extractPublicId(r.public_profile_url);
      if (pubUrlSlug) relSlugs.add(pubUrlSlug.toLowerCase().trim());
      if (r.member_id) relMemberIds.add(r.member_id);
      const fullName = `${r.first_name || ''} ${r.last_name || ''}`.toLowerCase().trim();
      if (fullName) relNames.set(fullName, r);
    });

    // Pre-fetch recent messages from Unipile to detect inbound prospect replies
    const { ok: msgOk, data: msgData } = await unipileFetch(`/messages?account_id=${accountId}&limit=200`);
    const recentMsgs = (msgOk && msgData && msgData.items) || [];
    const inboundBySender = new Map();
    recentMsgs.forEach(m => {
      if (m.is_sender === 0 && m.sender_id) {
        if (!inboundBySender.has(m.sender_id) || (m.timestamp || '') > (inboundBySender.get(m.sender_id).timestamp || '')) {
          inboundBySender.set(m.sender_id, m);
        }
      }
    });

    for (const prospect of prospects) {
      const cv = prospect.custom_variables || {};

      // ── 0. INBOUND REPLY RECONCILIATION ──
      const pProviderId = prospect.provider_id || prospect.member_id;
      const inboundMsg = pProviderId ? inboundBySender.get(pProviderId) : null;
      if (inboundMsg) {
        const outreachDate = prospect.message_sent_date || prospect.connection_sent_date || prospect.created_at;
        const msgTime = inboundMsg.timestamp || '';
        if (!outreachDate || msgTime > outreachDate) {
          const replyText = inboundMsg.text || 'Inbound reply';
          if (prospect.status !== 'Replied' || cv.reply_date !== msgTime) {
            console.log(`[Railway 24/7 Daemon] Inbound reply detected from ${prospect.name || prospect.id}: "${replyText.slice(0, 60)}"`);
            prospect.status = 'Replied';
            cv.reply_date = msgTime;
            cv.last_message = replyText;
            const hist = cv.history || [];
            if (!hist.some(h => h.node_type === 'reply_detected' && h.executed_at === msgTime)) {
              hist.push({
                node_type: 'reply_detected',
                node_label: 'Prospect Replied',
                status: 'replied',
                reply_text: replyText,
                executed_at: msgTime
              });
            }
            cv.history = hist;

            await supabase.from('prospects').update({
              status: 'Replied',
              custom_variables: cv
            }).eq('id', prospect.id);

            await supabase.from('campaign_enrollments').update({
              status: 'replied',
              updated_at: new Date().toISOString()
            }).eq('prospect_id', prospect.id);
          }
          continue; // Prospect replied! Immediately stop further sequence progression
        }
      }

      // ── 0b. ACCEPTANCE RECONCILIATION ──
      const isPendingInvite = prospect.status === 'Connection Request Sent' || prospect.status === 'Connection Sent' || prospect.connection_status === 'invitation_sent';
      const pPubId = extractPublicId(prospect.linkedin_url);
      const pName = (prospect.name || `${prospect.first_name || ''} ${prospect.last_name || ''}`).toLowerCase().trim();
      const isAccepted = (pPubId && relSlugs.has(pPubId.toLowerCase().trim())) ||
                         (prospect.member_id && relMemberIds.has(prospect.member_id)) ||
                         (pName && relNames.has(pName));

      if (isPendingInvite && isAccepted) {
        const relObj = pName && relNames.get(pName);
        const acceptedAt = relObj?.created_at ? new Date(relObj.created_at).toISOString() : new Date().toISOString();
        console.log(`[Railway 24/7 Daemon] 🤝 Connection acceptance detected for ${prospect.name || prospect.id}! Transitioning to Connection Accepted.`);
        prospect.status = 'Connection Accepted';
        prospect.connection_status = 'connected';
        prospect.accepted_at = acceptedAt;

        const hist = cv.history || [];
        if (!hist.some(h => (h.node_type || '').includes('accept'))) {
          hist.push({
            node_type: 'connection_accepted',
            node_label: 'Connection Accepted',
            status: 'success',
            executed_at: acceptedAt
          });
        }
        cv.history = hist;
        cv.accepted_at = acceptedAt;

        let cNodeId = cv.current_node_id || startNode.id;
        let cEdges = sourceEdgesMap.get(cNodeId) || [];
        let cNextEdge = cEdges.find(e => !e.data?.condition || e.data.condition === 'default') || cEdges[0];
        if (cNextEdge?.target) {
          cv.current_node_id = cNextEdge.target;
        }

        await supabase.from('prospects').update({
          status: 'Connection Accepted',
          connection_status: 'connected',
          accepted_at: acceptedAt,
          custom_variables: cv
        }).eq('id', prospect.id);

        await supabase.from('campaign_enrollments').update({
          status: 'connected',
          updated_at: new Date().toISOString()
        }).eq('prospect_id', prospect.id);
      } else if (isPendingInvite && !isAccepted) {
        continue; // Still waiting for prospect to accept invitation
      }

      if (['Completed', 'Failed', 'Replied', 'Needs Review', 'Needs Attention'].includes(prospect.status) || cv.reply_date) continue;

      const cleanUrl = (prospect.linkedin_url || '').toLowerCase().replace(/\/$/, '').trim();
      const pubId = extractPublicId(prospect.linkedin_url)?.toLowerCase();
      const recipientKey = prospect.provider_id || prospect.member_id || pubId || cleanUrl;

      if (recipientKey && contactedRecipientsThisCycle.has(recipientKey)) {
        console.log(`[Railway 24/7 Daemon] 🛡️ Deduplication Guard: Already processed action for ${prospect.name || recipientKey} in this cycle. Skipping duplicate prospect.`);
        continue;
      }

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

      // ── Idempotency Check: Fast-forward past already executed action nodes ──
      let isAlreadyDone = (cv.history || []).some(h => h.node_id === currentNode.id && h.status === 'success');
      while (isAlreadyDone) {
        if (!nextEdge) {
          console.log(`[Railway 24/7 Daemon] Node ${currentNode.id} was already executed and sequence is finished for ${prospect.name || prospect.id}. Marking Completed.`);
          await supabase.from('prospects').update({ status: 'Completed', custom_variables: cv }).eq('id', prospect.id);
          break;
        }
        console.log(`[Railway 24/7 Daemon] Node ${currentNode.id} (${nodeType}) already succeeded for ${prospect.name || prospect.id}. Fast-forwarding to ${nextEdge.target}.`);
        currentNodeId = nextEdge.target;
        currentNode = nodesMap.get(currentNodeId);
        if (!currentNode) break;
        nodeType = currentNode.data?.nodeType || currentNode.type;
        nodeConfig = currentNode.data?.config || {};
        edges = sourceEdgesMap.get(currentNode.id) || [];
        nextEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default') || edges[0];
        cv.current_node_id = currentNodeId;
        await supabase.from('prospects').update({ custom_variables: cv }).eq('id', prospect.id);
        isAlreadyDone = (cv.history || []).some(h => h.node_id === currentNode.id && h.status === 'success');
      }
      if (!currentNode || isAlreadyDone) continue;

      // ── Step 1: Visit profile if needed ─────────────────────────────────────
      if (nodeType === 'visit_profile') {
        const pubId = extractPublicId(prospect.linkedin_url);
        if (todayVisitsTotal >= dailyVisitLimit && prospect.provider_id) {
          console.log(`[Railway 24/7 Daemon] Visit limit reached (${todayVisitsTotal}/${dailyVisitLimit}). Advancing node for ${prospect.name || prospect.id} as provider_id is already present.`);
          if (nextEdge) {
            currentNodeId = nextEdge.target;
            currentNode = nodesMap.get(currentNodeId);
            nodeType = currentNode?.data?.nodeType || currentNode?.type;
            nodeConfig = currentNode?.data?.config || {};
            edges = sourceEdgesMap.get(currentNode?.id) || [];
            nextEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default') || edges[0];
            cv.current_node_id = currentNodeId;
            await supabase.from('prospects').update({ custom_variables: cv }).eq('id', prospect.id);
          }
        } else if (todayVisitsTotal >= dailyVisitLimit && !prospect.provider_id) {
          console.log(`[Railway 24/7 Daemon] Resolving provider_id for ${prospect.name || prospect.id}...`);
          const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accountId}`);
          const providerId = (ok && data) ? (data.provider_id || data.id) : prospect.provider_id;
          if (providerId) {
            prospect.provider_id = providerId;
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
          } else {
            console.log(`[Railway 24/7 Daemon] 🎯 Visit limit reached (${todayVisitsTotal}/${dailyVisitLimit}) and provider_id unresolved. Deferring.`);
            continue;
          }
        } else {
          console.log(`[Railway 24/7 Daemon] Visiting profile for ${prospect.name || prospect.id}...`);
          const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accountId}`);
          const providerId = (ok && data) ? (data.provider_id || data.id) : prospect.provider_id;
          prospect.provider_id = providerId || prospect.provider_id;

          const nowIso = new Date().toISOString();
          cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'visit_profile', node_label: 'Visit Profile', executed_at: nowIso, status: 'success' }];
          cv.visited_at = nowIso;
          todayVisitsTotal += 1;
          todayActionsTotal += 1;

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
        const isAlreadyConnected = prospect.connection_status === 'connected' ||
          prospect.status === 'Connection Accepted' ||
          (pPubId && relSlugs.has(pPubId.toLowerCase().trim())) ||
          (prospect.member_id && relMemberIds.has(prospect.member_id));

        if (isAlreadyConnected) {
          console.log(`[Railway 24/7 Daemon] Prospect ${prospect.name || prospect.id} is already connected. Advancing past invite step.`);
          prospect.connection_status = 'connected';
          if (nextEdge) {
            currentNodeId = nextEdge.target;
            currentNode = nodesMap.get(currentNodeId);
            nodeType = currentNode?.data?.nodeType || currentNode?.type;
            nodeConfig = currentNode?.data?.config || {};
            edges = sourceEdgesMap.get(currentNode?.id) || [];
            nextEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default') || edges[0];
            cv.current_node_id = currentNodeId;
            await supabase.from('prospects').update({ connection_status: 'connected', custom_variables: cv }).eq('id', prospect.id);
          }
        } else if (todayConnectionsTotal >= dailyConnectionLimit) {
          console.log(`[Railway 24/7 Daemon] 🎯 Connection Limit Reached: Sent daily target of ${todayConnectionsTotal}/${dailyConnectionLimit} connections. Skipping invite for ${prospect.name || prospect.id}.`);
          continue;
        } else {
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

          if (recipientKey) contactedRecipientsThisCycle.add(recipientKey);
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
            const patchBody = { custom_variables: cv };
            const isFatal = errStr.toLowerCase().includes('cannot') ||
                            errStr.toLowerCase().includes('restricted') ||
                            errStr.toLowerCase().includes('not allowed') ||
                            errStr.toLowerCase().includes('recipient id is valid') ||
                            errStr.toLowerCase().includes('requires a subscription') ||
                            errStr.toLowerCase().includes('locked');
            const nodeFailures = (cv.history || []).filter(h => h.node_id === currentNode.id && h.status === 'failed').length;

            if (isFatal || nodeFailures >= 2) {
              console.warn(`[Railway 24/7 Daemon] 🛑 Halting invite retries for ${prospect.name || prospect.id} (Fatal/repeated error: ${errStr}). Marking 'Needs Review'.`);
              patchBody.status = 'Needs Review';
              patchBody.custom_variables = { ...cv, delivery_failed: true, delivery_error: errStr };
            }
            await supabase.from('prospects').update(patchBody).eq('id', prospect.id);

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

      // ── Step 4: Send Message ─────────────────────────────────────────────
      if (nodeType === 'send_message') {
        if (todayMessagesTotal >= dailyMessageLimit) {
          console.log(`[Railway 24/7 Daemon] 🎯 Message Limit Reached: Sent daily target of ${todayMessagesTotal}/${dailyMessageLimit} messages. Skipping message for ${prospect.name || prospect.id}.`);
          continue;
        }

        let recipientId = prospect.provider_id || prospect.member_id;
        if (!recipientId) {
          const pubId = extractPublicId(prospect.linkedin_url);
          if (pubId) {
            const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accountId}`);
            if (ok && data) recipientId = data.provider_id || data.id;
          }
        }

        if (recipientId) {
          const rawMsg = nodeConfig.message || '';
          const msgText = (rawMsg || '').replace(/\{\{\s*first_name\s*\}\}/gi, prospect.first_name || '').trim();
          if (msgText) {
            console.log(`[Railway 24/7 Daemon] Sending message to ${prospect.first_name || ''} ${prospect.last_name || ''}...`);
            const res = await unipileFetch('/chats', {
              method: 'POST',
              body: JSON.stringify({
                account_id: accountId,
                attendees_ids: [recipientId],
                text: msgText
              })
            });

            const nowIso = new Date().toISOString();
            if (res.ok) {
              todayActionsTotal += 1;
              todayMessagesTotal += 1;
              console.log(`[Railway 24/7 Daemon] ✅ Message SENT to ${prospect.first_name || ''} ${prospect.last_name || ''}`);
              cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'send_message', node_label: currentNode.data?.label || 'Send Message', executed_at: nowIso, status: 'success' }];
              cv.last_sent_node_id = currentNode.id;
              cv.message_sent_at = nowIso;
              cv.last_action_at = nowIso;
              if (nextEdge) cv.current_node_id = nextEdge.target;

              const isFollowUp = (currentNode.data?.label || '').toLowerCase().includes('follow') || rawMsg.toLowerCase().includes('follow');
              if (recipientKey) contactedRecipientsThisCycle.add(recipientKey);
              await supabase.from('prospects').update({
                status: isFollowUp ? 'Following Up' : 'Initial Message Sent',
                message_sent_date: nowIso,
                custom_variables: cv
              }).eq('id', prospect.id);
            } else {
              console.warn(`[Railway 24/7 Daemon] ⚠️ Message failed for ${prospect.first_name || ''}:`, res.data?.detail || res.status);
              const errMsg = String(res.data?.detail || res.data?.message || res.status || 'Failed');
              cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'send_message', node_label: currentNode.data?.label || 'Send Message', executed_at: nowIso, status: 'failed', error: errMsg }];

              const isFatal = errMsg.toLowerCase().includes('cannot send messages to the recipient') ||
                              errMsg.toLowerCase().includes('requires a subscription') ||
                              errMsg.toLowerCase().includes('cannot be invited') ||
                              errMsg.toLowerCase().includes('not allowed') ||
                              errMsg.toLowerCase().includes('blocked') ||
                              errMsg.toLowerCase().includes('restricted') ||
                              errMsg.toLowerCase().includes('recipient id is valid') ||
                              errMsg.toLowerCase().includes('locked');
              const nodeFailures = (cv.history || []).filter(h => h.node_id === currentNode.id && h.status === 'failed').length;

              if (isFatal || nodeFailures >= 2) {
                console.warn(`[Railway 24/7 Daemon] 🛑 Halting retries for ${prospect.name || prospect.id} (Fatal/repeated error: ${errMsg}). Marking 'Needs Review'.`);
                await supabase.from('prospects').update({
                  status: 'Needs Review',
                  custom_variables: { ...cv, delivery_failed: true, delivery_error: errMsg }
                }).eq('id', prospect.id);
              } else {
                await supabase.from('prospects').update({ custom_variables: cv }).eq('id', prospect.id);
              }
            }
          }
        }
      }

      // ── Step 5: Send Voice Message (Native LinkedIn Voice Note) ──────────
      if (nodeType === 'send_voice_message') {
        if (todayMessagesTotal >= dailyMessageLimit) {
          console.log(`[Railway 24/7 Daemon] 🎯 Message/Voice Limit Reached: Sent daily target of ${todayMessagesTotal}/${dailyMessageLimit} messages/voice notes. Skipping voice note for ${prospect.name || prospect.id}.`);
          continue;
        }

        let recipientId = prospect.provider_id || prospect.member_id;
        if (!recipientId) {
          const pubId = extractPublicId(prospect.linkedin_url);
          if (pubId) {
            const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accountId}`);
            if (ok && data) recipientId = data.provider_id || data.id;
          }
        }

        if (recipientId && nodeConfig.voice_url) {
          try {
            let audioBlob = null;
            if (nodeConfig.voice_url.startsWith('data:audio/')) {
              const commaIdx = nodeConfig.voice_url.indexOf(',');
              const base64Str = commaIdx !== -1 ? nodeConfig.voice_url.slice(commaIdx + 1) : nodeConfig.voice_url;
              const buffer = Buffer.from(base64Str, 'base64');
              audioBlob = new Blob([buffer], { type: 'audio/mp4' });
            } else if (nodeConfig.voice_url.startsWith('http://') || nodeConfig.voice_url.startsWith('https://')) {
              const aRes = await fetch(nodeConfig.voice_url);
              audioBlob = await aRes.blob();
            }

            if (audioBlob) {
              console.log(`[Railway 24/7 Daemon] Sending voice note to ${prospect.first_name || ''} ${prospect.last_name || ''}...`);
              const formData = new FormData();
              formData.append('account_id', accountId);
              formData.append('attendees_ids', recipientId);
              const voiceFileName = nodeConfig.voice_file_name && nodeConfig.voice_file_name.endsWith('.m4a')
                ? nodeConfig.voice_file_name
                : 'voice_note.m4a';
              formData.append('voice_message', audioBlob, voiceFileName);

              if (nodeConfig.companion_text) {
                const compText = (nodeConfig.companion_text || '').replace(/\{\{\s*first_name\s*\}\}/gi, prospect.first_name || '').trim();
                if (compText) formData.append('text', compText);
              }

              const vRes = await fetch(`${UNIPILE_BASE_URL}/chats`, {
                method: 'POST',
                headers: { 'X-API-KEY': UNIPILE_API_KEY },
                body: formData
              });
              const ok = vRes.ok;
              const vData = await vRes.json().catch(() => ({}));

              const nowIso = new Date().toISOString();
              if (ok) {
                todayActionsTotal += 1;
                todayMessagesTotal += 1;
                console.log(`[Railway 24/7 Daemon] ✅ Voice note SENT to ${prospect.first_name || ''} ${prospect.last_name || ''}`);
                cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'send_voice_message', node_label: currentNode.data?.label || 'Send Voice Note', executed_at: nowIso, status: 'success' }];
                cv.last_sent_node_id = currentNode.id;
                cv.message_sent_at = nowIso;
                cv.last_action_at = nowIso;
                if (nextEdge) cv.current_node_id = nextEdge.target;

                if (recipientKey) contactedRecipientsThisCycle.add(recipientKey);
                await supabase.from('prospects').update({
                  status: 'Initial Message Sent',
                  message_sent_date: nowIso,
                  custom_variables: cv
                }).eq('id', prospect.id);
              } else {
                console.warn(`[Railway 24/7 Daemon] ⚠️ Voice note failed for ${prospect.first_name || ''}:`, vData?.detail || vRes.status);
                const errMsg = String(vData?.detail || vData?.message || vRes.status || 'Failed');
                cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'send_voice_message', node_label: currentNode.data?.label || 'Send Voice Note', executed_at: nowIso, status: 'failed', error: errMsg }];

                const isFatal = errMsg.toLowerCase().includes('cannot send') ||
                                errMsg.toLowerCase().includes('requires a subscription') ||
                                errMsg.toLowerCase().includes('not allowed') ||
                                errMsg.toLowerCase().includes('blocked') ||
                                errMsg.toLowerCase().includes('restricted') ||
                                errMsg.toLowerCase().includes('recipient id is valid') ||
                                errMsg.toLowerCase().includes('locked');
                const nodeFailures = (cv.history || []).filter(h => h.node_id === currentNode.id && h.status === 'failed').length;

                if (isFatal || nodeFailures >= 2) {
                  console.warn(`[Railway 24/7 Daemon] 🛑 Halting retries for ${prospect.name || prospect.id} (Fatal/repeated error: ${errMsg}). Marking 'Needs Review'.`);
                  await supabase.from('prospects').update({
                    status: 'Needs Review',
                    custom_variables: { ...cv, delivery_failed: true, delivery_error: errMsg }
                  }).eq('id', prospect.id);
                } else {
                  await supabase.from('prospects').update({ custom_variables: cv }).eq('id', prospect.id);
                }
              }
            }
          } catch (err) {
            console.error(`[Railway 24/7 Daemon] Error dispatching voice note:`, err);
          }
        }
      }

      // ── Step 6: Completed Node ───────────────────────────────────────────
      if (nodeType === 'completed') {
        await supabase.from('prospects').update({ status: 'Completed', custom_variables: cv }).eq('id', prospect.id);
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
