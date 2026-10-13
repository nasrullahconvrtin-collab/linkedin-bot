import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://mjwganpjawthnowemabt.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDczMTUsImV4cCI6MjEwMTg4MzMxNX0.OwKeHoH2DH-jS7-_XRf6Vkx4bNZPKgbL9WOr5oSd27c';
const UNIPILE_API_KEY = 'vpftWHjq.lC9ACICdkDlLNupo90avQybHg2UjAtAkMssKHxsEw9o=';
const UNIPILE_BASE_URL = 'https://api63.unipile.com:19339/api/v1';

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

async function runCloudFlow() {
  console.log(`[${new Date().toISOString()}] Starting Goal-Oriented Cloud Flow Runner cycle...`);

  const todayDateStr = new Date().toISOString().split('T')[0];

  const { data: campaigns } = await supabase.from('campaigns').select('*').eq('status', 'running');
  if (!campaigns || campaigns.length === 0) {
    console.log('No running campaigns found.');
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
    const dailyConnectionLimit = Number(settings.daily_connection_limit || 25);
    const dailyMessageLimit = Number(settings.daily_message_limit || 140);
    const dailyVisitLimit = Number(settings.daily_visit_limit || 30);
    const configuredGlobalLimit = Number(settings.global_daily_limit || 0);
    const sumOfLimits = dailyConnectionLimit + dailyMessageLimit + dailyVisitLimit;
    const globalDailyLimit = configuredGlobalLimit > 0 ? Math.max(configuredGlobalLimit, sumOfLimits) : sumOfLimits;

    // Calculate today's executed actions count across all prospects for this organization
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
          if (h.executed_at && h.executed_at.startsWith(todayDateStr)) {
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

    const { data: prospects } = await supabase.from('prospects').select('*').eq('campaign_id', campaign.id);

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

    // Process prospects one-by-one focusing directly on today's goals
    for (const prospect of prospects || []) {
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
            console.log(`[Reply Engine] Inbound reply detected from ${prospect.name || prospect.id}: "${replyText.slice(0, 60)}"`);
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
        console.log(`[Runner] 🤝 Connection acceptance detected for ${prospect.name || prospect.id}! Transitioning to Connection Accepted.`);
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
        console.log(`[Runner] 🛡️ Deduplication Guard: Already processed action for ${prospect.name || recipientKey} in this cycle. Skipping duplicate prospect.`);
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
          console.log(`[Runner] Node ${currentNode.id} was already executed and sequence is finished for ${prospect.name || prospect.id}. Marking Completed.`);
          await supabase.from('prospects').update({ status: 'Completed', custom_variables: cv }).eq('id', prospect.id);
          break;
        }
        console.log(`[Runner] Node ${currentNode.id} (${nodeType}) already succeeded for ${prospect.name || prospect.id}. Fast-forwarding to ${nextEdge.target}.`);
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
        const isAlreadyConnected = prospect.connection_status === 'connected' ||
          prospect.status === 'Connection Accepted' ||
          (pPubId && relSlugs.has(pPubId.toLowerCase().trim())) ||
          (prospect.member_id && relMemberIds.has(prospect.member_id));

        if (isAlreadyConnected) {
          console.log(`[Runner] Prospect ${prospect.name || prospect.id} is already connected. Advancing past invite step.`);
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
          console.log(`[Runner] 🎯 Connection Limit Reached: Sent daily target of ${todayConnectionsTotal}/${dailyConnectionLimit} connections. Skipping invite for ${prospect.name || prospect.id}.`);
          continue;
        } else {
        let providerId = prospect.provider_id;
        if (!providerId) {
          const pubId = extractPublicId(prospect.linkedin_url);
          const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accountId}`);
          if (ok && data) providerId = data.provider_id || data.id;
        }

        if (!providerId) {
          console.warn(`[Goal Engine] Could not resolve providerId for ${prospect.name || prospect.id}. Marking Needs Review.`);
          cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'send_invitation', node_label: 'Profile Not Found', executed_at: new Date().toISOString(), status: 'failed', error: 'Invalid LinkedIn URL or profile locked' }];
          await supabase.from('prospects').update({ status: 'Needs Review', custom_variables: cv }).eq('id', prospect.id);
          continue;
        }

        const hasNoteToggle = nodeConfig.add_note || nodeConfig.include_note || nodeConfig.send_note;
        const noteText = hasNoteToggle ? (nodeConfig.note || '').replace(/\{\{\s*first_name\s*\}\}/gi, prospect.first_name || '') : '';

        console.log(`[Goal Engine] Dispatched Connection Invite #${todayConnectionsTotal + 1} to ${prospect.name || prospect.id}...`);
        const res = await unipileFetch('/users/invite', {
          method: 'POST',
          body: JSON.stringify({ account_id: accountId, provider_id: providerId, message: noteText })
        });

        const nowIso = new Date().toISOString();

        if (res.ok) {
          todayActionsTotal += 1;
          todayConnectionsTotal += 1;
          console.log(`[Goal Engine] ✅ Connection Invite #${todayConnectionsTotal} SENT to ${prospect.name}`);
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
          console.warn(`[Goal Engine] ⚠️ Invite failed for ${prospect.name}:`, res.data?.detail || res.status);
          const errStr = String(res.data?.detail || res.status);
          const isAlreadyInvited = errStr.toLowerCase().includes('already') || errStr.toLowerCase().includes('recently') || res.data?.type === 'errors/already_invited_recently';

          if (isAlreadyInvited) {
            console.log(`[Goal Engine] Prospect ${prospect.name} was already invited recently. Marking Connection Request Sent.`);
            todayConnectionsTotal += 1;
            cv.history = [...(cv.history || []), { node_id: currentNode.id, node_type: 'send_invitation', node_label: 'Connection Request Sent', executed_at: nowIso, status: 'success' }];
            if (nextEdge) cv.current_node_id = nextEdge.target;

            await supabase.from('prospects').update({
              status: 'Connection Request Sent',
              connection_status: 'invitation_sent',
              connection_sent_date: prospect.connection_sent_date || nowIso,
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
              console.warn(`[Runner] 🛑 Halting invite retries for ${prospect.name || prospect.id} (Fatal/repeated error: ${errStr}). Marking 'Needs Review'.`);
              patchBody.status = 'Needs Review';
              patchBody.custom_variables = { ...cv, delivery_failed: true, delivery_error: errStr };
            }
            await supabase.from('prospects').update(patchBody).eq('id', prospect.id);

            if (errStr.toLowerCase().includes('provider limit') || errStr.toLowerCase().includes('rate limit') || errStr.includes('429')) {
              console.warn('[CIRCUIT BREAKER] Halting execution due to rate limit.');
              return;
            }
          }
        }
        }
      }

      // ── Step 4: Send Message ─────────────────────────────────────────────
      if (nodeType === 'send_message') {
        if (todayMessagesTotal >= dailyMessageLimit) {
          console.log(`[Runner] 🎯 Message Limit Reached: Sent daily target of ${todayMessagesTotal}/${dailyMessageLimit} messages. Skipping message for ${prospect.name || prospect.id}.`);
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
            console.log(`[Runner] Sending message to ${prospect.first_name || ''} ${prospect.last_name || ''}...`);
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
              console.log(`[Runner] ✅ Message SENT to ${prospect.first_name || ''} ${prospect.last_name || ''}`);
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
              console.warn(`[Runner] ⚠️ Message failed for ${prospect.first_name || ''}:`, res.data?.detail || res.status);
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
                console.warn(`[Runner] 🛑 Halting retries for ${prospect.name || prospect.id} (Fatal/repeated error: ${errMsg}). Marking 'Needs Review'.`);
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
          console.log(`[Runner] 🎯 Message/Voice Limit Reached: Sent daily target of ${todayMessagesTotal}/${dailyMessageLimit} messages/voice notes. Skipping voice note for ${prospect.name || prospect.id}.`);
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
              console.log(`[Runner] Sending voice note to ${prospect.first_name || ''} ${prospect.last_name || ''}...`);
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
                console.log(`[Runner] ✅ Voice note SENT to ${prospect.first_name || ''} ${prospect.last_name || ''}`);
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
                console.warn(`[Runner] ⚠️ Voice note failed for ${prospect.first_name || ''}:`, vData?.detail || vRes.status);
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
                  console.warn(`[Runner] 🛑 Halting retries for ${prospect.name || prospect.id} (Fatal/repeated error: ${errMsg}). Marking 'Needs Review'.`);
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
            console.error(`[Runner] Error dispatching voice note:`, err);
          }
        }
      }

      // ── Step 6: Completed Node ───────────────────────────────────────────
      if (nodeType === 'completed') {
        await supabase.from('prospects').update({ status: 'Completed', custom_variables: cv }).eq('id', prospect.id);
      }
    }
  }

  console.log(`[${new Date().toISOString()}] Goal-Oriented Flow Runner cycle complete.`);
}

runCloudFlow();
