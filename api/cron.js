const ENV_URL = process.env.VITE_SUPABASE_URL;
const ENV_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const isCronIntegri = (process.env.VERCEL_GIT_REPO_SLUG && process.env.VERCEL_GIT_REPO_SLUG.includes('integri')) ||
                      (process.env.VERCEL_PROJECT_PRODUCTION_URL && process.env.VERCEL_PROJECT_PRODUCTION_URL.includes('integri')) ||
                      (process.env.VERCEL_URL && process.env.VERCEL_URL.includes('integri')) ||
                      (ENV_URL && ENV_URL.includes('mhzvxnbnaytirrgiwsnv'));

const SUPABASE_URL = isCronIntegri
  ? (ENV_URL || 'https://mhzvxnbnaytirrgiwsnv.supabase.co')
  : (ENV_URL || 'https://mjwganpjawthnowemabt.supabase.co');

const SUPABASE_KEY = isCronIntegri
  ? (ENV_KEY || 'sb_publishable_gn93SdRFAAvpnH6faute9g_n8DiwZ_j')
  : (ENV_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDczMTUsImV4cCI6MjEwMTg4MzMxNX0.OwKeHoH2DH-jS7-_XRf6Vkx4bNZPKgbL9WOr5oSd27c');

const UNIPILE_API_KEY = process.env.VITE_UNIPILE_API_KEY || "vpftWHjq.lC9ACICdkDlLNupo90avQybHg2UjAtAkMssKHxsEw9o=";
const UNIPILE_URL = "https://api63.unipile.com:19339/api/v1";

const sbHeaders = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json"
};

const unipileHeaders = {
  "X-API-KEY": UNIPILE_API_KEY,
  "Content-Type": "application/json"
};

async function sbFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, { ...options, headers: { ...sbHeaders, ...(options.headers || {}) } });
  return res.json().catch(() => []);
}

async function unipileFetch(endpoint, options = {}) {
  const url = `${UNIPILE_URL}${endpoint}`;
  const res = await fetch(url, { ...options, headers: { ...unipileHeaders, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function extractPublicId(url) {
  if (!url) return "";
  const match = String(url).match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (match) return match[1];
  return String(url).replace(/^https?:\/\//, "").replace("www.linkedin.com/in/", "").replace(/\/$/, "").trim();
}

function extractCompanyFromHeadline(headline) {
  if (!headline) return '';
  const atMatch = String(headline).match(/(?:@|at)\s+([A-Za-z0-9&.\-'\s]+?)(?:\s*(?:\(|\||-|,|\/|$))/i);
  if (atMatch && atMatch[1].trim()) return atMatch[1].trim();
  return '';
}

function renderTemplate(templateText, prospect) {
  if (!templateText) return "";
  let text = String(templateText);
  const cv = prospect.custom_variables || {};
  const cf = prospect.custom_fields || {};

  const matches = text.match(/\{\{\s*([a-zA-Z0-9_\-\s|]+)\s*\}\}/g) || [];
  for (const m of matches) {
    const rawInner = m.replace(/\{\{\s*|\s*\}\}/g, "").trim();
    let [varName, fallback] = rawInner.split('|').map(s => s.trim());
    const norm = (v) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normVar = norm(varName || '');

    let resolvedValue = "";
    if (normVar === "firstname" || normVar === "first_name") {
      resolvedValue = prospect.first_name || cv.first_name || (prospect.name ? prospect.name.split(" ")[0] : "");
    } else if (normVar === "lastname" || normVar === "last_name") {
      resolvedValue = prospect.last_name || cv.last_name || (prospect.name ? prospect.name.split(" ").slice(1).join(" ") : "");
    } else if (normVar === "company" || normVar === "companyname") {
      resolvedValue = prospect.company || cv.company || cf.company || "";
      if (!resolvedValue && (prospect.headline || cv.headline)) {
        resolvedValue = extractCompanyFromHeadline(prospect.headline || cv.headline);
      }
      if (!resolvedValue) {
        resolvedValue = fallback || "your company";
      }
    } else if (normVar === "title" || normVar === "jobtitle" || normVar === "position") {
      resolvedValue = prospect.job_title || cv.job_title || cv.title || cf.job_title || "";
      if (!resolvedValue) resolvedValue = fallback || "";
    } else if (normVar === "location" || normVar === "city") {
      resolvedValue = prospect.location || cv.location || cf.location || "";
      if (!resolvedValue) resolvedValue = fallback || "";
    } else if (normVar === "email") {
      resolvedValue = prospect.email || cv.email || cf.email || "";
      if (!resolvedValue) resolvedValue = fallback || "";
    } else {
      resolvedValue = prospect[varName] || cv[varName] || cf[varName] || fallback || "";
    }
    text = text.replace(m, resolvedValue !== undefined && resolvedValue !== null ? String(resolvedValue) : "");
  }

  if (text.includes('\\n') || text.includes('\\r')) {
    text = text.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n');
  }

  return text;
}

export default async function handler(req, res) {
  const logs = [];
  const log = (msg) => logs.push(`[${new Date().toISOString()}] ${msg}`);
  log("Vercel Goal-Oriented Cron Runner started...");

  const processedRecipientsThisRun = new Set();

  try {
    const campaigns = await sbFetch("campaigns?status=eq.running");
    log(`Found ${campaigns.length} running campaigns.`);

    const profiles = await sbFetch("profiles?select=*");
    const profileMap = new Map((profiles || []).map(p => [p.profile_key, p]));

    let totalSentToday = 0;
    for (const c of campaigns || []) {
      let profile = profileMap.get(c.profile_key);
      if (!profile && c.organization_id) {
        profile = (profiles || []).find(p => p.organization_id === c.organization_id && p.unipile_account_id);
      }
      if (!profile || !profile.unipile_account_id) continue;

      const dailyConnectionLimit = Number(profile.settings?.daily_connection_limit || 25);
      const dailyMessageLimit = Number(profile.settings?.daily_message_limit || 140);
      const flowSequence = c.sequence_config?.flow_sequence;
      if (!flowSequence || !Array.isArray(flowSequence.nodes) || flowSequence.nodes.length === 0) continue;

      const accId = profile.unipile_account_id;
      log(`Processing Campaign '${c.name}' for account '${profile.display_name}' (${accId})`);

      const nodesMap = new Map(flowSequence.nodes.map(n => [n.id, n]));
      const sourceEdgesMap = new Map();
      for (const edge of flowSequence.edges || []) {
        if (!sourceEdgesMap.has(edge.source)) sourceEdgesMap.set(edge.source, []);
        sourceEdgesMap.get(edge.source).push(edge);
      }

      const incomingTargets = new Set((flowSequence.edges || []).map(e => e.target));
      const startNode = flowSequence.nodes.find(n => !incomingTargets.has(n.id)) || flowSequence.nodes[0];
      if (!startNode) continue;

      let prospects = [];
      try {
        const enrollments = await sbFetch(`campaign_enrollments?campaign_id=eq.${c.id}&select=prospect_id`);
        const enrolledIds = (enrollments || []).map(e => e.prospect_id).filter(Boolean);
        if (enrolledIds.length > 0) {
          prospects = await sbFetch(`prospects?or=(campaign_id.eq.${c.id},id.in.(${enrolledIds.join(',')}))`);
        } else {
          prospects = await sbFetch(`prospects?campaign_id=eq.${c.id}`);
        }
      } catch (e) {
        prospects = await sbFetch(`prospects?campaign_id=eq.${c.id}`);
      }

      // Pre-fetch 1st-degree relations to check for connection acceptances
      const { ok: relOk, data: relData } = await unipileFetch(`/users/relations?account_id=${accId}&limit=100`);
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

      // Pre-fetch recent messages to detect inbound prospect replies (is_sender === 0)
      const { ok: msgOk, data: msgData } = await unipileFetch(`/messages?account_id=${accId}&limit=200`);
      const recentMsgs = (msgOk && msgData && msgData.items) || [];
      const inboundBySender = new Map();
      recentMsgs.forEach(m => {
        if (m.is_sender === 0 && m.sender_id) {
          if (!inboundBySender.has(m.sender_id) || (m.timestamp || '') > (inboundBySender.get(m.sender_id).timestamp || '')) {
            inboundBySender.set(m.sender_id, m);
          }
        }
      });

      for (const p of prospects || []) {
        const st = p.status || "Not Contacted";
        const cv = p.custom_variables || {};

        // ── 0. INBOUND REPLY RECONCILIATION ──
        const pProviderId = p.provider_id || p.member_id;
        const inboundMsg = pProviderId ? inboundBySender.get(pProviderId) : null;
        if (inboundMsg) {
          const outreachDate = p.message_sent_date || p.connection_sent_date || p.created_at;
          const msgTime = inboundMsg.timestamp || '';
          if (!outreachDate || msgTime > outreachDate) {
            const replyText = inboundMsg.text || 'Inbound reply';
            if (p.status !== 'Replied' || cv.reply_date !== msgTime) {
              log(`[Reply Engine] Inbound reply detected from ${p.name || p.id}: "${replyText.slice(0, 60)}"`);
              p.status = 'Replied';
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

              await sbFetch(`prospects?id=eq.${p.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  status: 'Replied',
                  custom_variables: cv
                })
              });

              await sbFetch(`campaign_enrollments?prospect_id=eq.${p.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  status: 'replied',
                  updated_at: new Date().toISOString()
                })
              });
            }
            continue; // Prospect replied! Immediately stop further sequence progression
          }
        }

        // Acceptance reconciliation
        if (st === 'Connection Request Sent' || st === 'Connection Sent' || p.connection_status === 'invitation_sent') {
          const pPubId = extractPublicId(p.linkedin_url);
          const pName = (p.name || `${p.first_name || ''} ${p.last_name || ''}`).toLowerCase().trim();
          const isAccepted = (pPubId && relSlugs.has(pPubId.toLowerCase().trim())) ||
                             (p.member_id && relMemberIds.has(p.member_id)) ||
                             (pName && relNames.has(pName));

          if (isAccepted) {
            const relObj = (pName && relNames.get(pName));
            const acceptedAt = relObj?.created_at ? new Date(relObj.created_at).toISOString() : new Date().toISOString();
            log(`Acceptance detected for ${p.name || p.id}! Transitioning to Connection Accepted.`);
            p.status = "Connection Accepted";
            p.connection_status = "connected";
            p.accepted_at = acceptedAt;

            const hist = cv.history || [];
            if (!hist.some(h => (h.node_type || '').includes('accept'))) {
              hist.push({
                node_type: "connection_accepted",
                node_label: "Connection Accepted",
                status: "success",
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

            await sbFetch(`prospects?id=eq.${p.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                status: "Connection Accepted",
                connection_status: "connected",
                accepted_at: acceptedAt,
                custom_variables: cv
              })
            });

            await sbFetch(`campaign_enrollments?prospect_id=eq.${p.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                status: "connected",
                updated_at: new Date().toISOString()
              })
            });
          }
        }

        if (["Connection Request Sent", "Connection Sent", "Completed", "Failed", "Replied", "Needs Review", "Needs Attention"].includes(p.status) || cv.reply_date) continue;

        const cleanUrl = (p.linkedin_url || '').toLowerCase().replace(/\/$/, '').trim();
        const pubId = extractPublicId(p.linkedin_url)?.toLowerCase();
        const recipientKey = p.provider_id || p.member_id || pubId || cleanUrl;

        if (recipientKey && processedRecipientsThisRun.has(recipientKey)) {
          log(`[Deduplication Guard] Skipping duplicate prospect ${p.name || recipientKey} - already processed in this run.`);
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
            log(`Node ${currentNode.id} was already executed and sequence is finished for ${p.name || p.id}. Marking Completed.`);
            await sbFetch(`prospects?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ status: "Completed", custom_variables: cv }) });
            break;
          }
          log(`Node ${currentNode.id} (${nodeType}) already succeeded for ${p.name || p.id}. Fast-forwarding to ${nextEdge.target}.`);
          currentNodeId = nextEdge.target;
          currentNode = nodesMap.get(currentNodeId);
          if (!currentNode) break;
          nodeType = currentNode.data?.nodeType || currentNode.type;
          nodeConfig = currentNode.data?.config || {};
          edges = sourceEdgesMap.get(currentNode.id) || [];
          nextEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default') || edges[0];
          cv.current_node_id = currentNodeId;
          await sbFetch(`prospects?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ custom_variables: cv }) });
          isAlreadyDone = (cv.history || []).some(h => h.node_id === currentNode.id && h.status === 'success');
        }
        if (!currentNode || isAlreadyDone) continue;

        // 1. Visit profile if needed
        if (nodeType === 'visit_profile') {
          const pubId = extractPublicId(p.linkedin_url);
          log(`Visiting profile for ${p.name || p.id}...`);
          const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accId}`);
          const providerId = (ok && data) ? (data.provider_id || data.id) : p.provider_id;
          p.provider_id = providerId || p.provider_id;

          if (ok && data) {
            if (data.headline && !p.headline) {
              p.headline = data.headline;
              cv.headline = data.headline;
            }
            if (!p.company && !cv.company) {
              const comp = data.company || extractCompanyFromHeadline(data.headline);
              if (comp) {
                p.company = comp;
                cv.company = comp;
              }
            }
          }

          const nowIso = new Date().toISOString();
          cv.history = [...(cv.history || []), { node_type: "visit_profile", node_label: "Visit Profile", status: "success", executed_at: nowIso }];

          if (nextEdge) {
            currentNodeId = nextEdge.target;
            currentNode = nodesMap.get(currentNodeId);
            nodeType = currentNode?.data?.nodeType || currentNode?.type;
            nodeConfig = currentNode?.data?.config || {};
            edges = sourceEdgesMap.get(currentNode?.id) || [];
            nextEdge = edges.find(e => !e.data?.condition || e.data.condition === 'default') || edges[0];
            cv.current_node_id = currentNodeId;
          }

          const patchObj = { provider_id: p.provider_id, custom_variables: cv };
          if (p.company) patchObj.company = p.company;
          if (p.headline) patchObj.headline = p.headline;
          await sbFetch(`prospects?id=eq.${p.id}`, {
            method: "PATCH",
            body: JSON.stringify(patchObj)
          });
        }

        // 2. Check Delay
        if (nodeType === 'wait') {
          const days = Number(nodeConfig.days || 0);
          const nextSched = cv.next_scheduled_at;
          const nowMs = Date.now();

          if (days > 0 && nextSched) {
            if (nowMs < new Date(nextSched).getTime()) continue;
          } else if (days > 0 && !nextSched) {
            const nextScheduledAt = new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();
            cv.next_scheduled_at = nextScheduledAt;
            await sbFetch(`prospects?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ custom_variables: cv }) });
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
            await sbFetch(`prospects?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ custom_variables: cv }) });
          }
        }

        // 3. Send Invite Immediately
        if (nodeType === 'send_invitation') {
          const cooldownUntil = profile.settings?.provider_limit_cooldown_until;
          if (cooldownUntil && new Date(cooldownUntil).getTime() > Date.now()) {
            log(`[Safety Guard] Account '${profile.display_name}' is under LinkedIn provider limit cooldown until ${cooldownUntil}. Skipping connection invites.`);
            continue;
          }

          if (totalSentToday >= dailyConnectionLimit) continue;

          let providerId = p.provider_id;
          if (!providerId) {
            const pubId = extractPublicId(p.linkedin_url);
            if (pubId) {
              const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accId}`);
              if (ok && data) providerId = data.provider_id || data.id;
            }
          }

          if (!providerId) {
            log(`Could not resolve providerId for ${pName || p.id}. Marking Needs Review.`);
            cv.history = [...(cv.history || []), { node_type: "send_invitation", node_label: "Profile Not Found", status: "failed", error: "Invalid LinkedIn URL or profile locked", executed_at: new Date().toISOString() }];
            await sbFetch(`prospects?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ status: "Needs Review", custom_variables: cv }) });
            continue;
          }

          const pName = p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
          const hasNoteToggle = nodeConfig.add_note || nodeConfig.include_note || nodeConfig.send_note;
          const noteText = hasNoteToggle ? renderTemplate(nodeConfig.note || '', p) : '';

          log(`Sending connection invite to ${pName}...`);
          const { ok, data } = await unipileFetch("/users/invite", {
            method: "POST",
            body: JSON.stringify({ account_id: accId, provider_id: providerId, message: noteText || "" })
          });

          const nowIso = new Date().toISOString();
          const errStr = String(data?.detail || data?.title || data?.message || data?.error || "");
          const isAlreadyInvited = !ok && (
            errStr.toLowerCase().includes("already") ||
            errStr.toLowerCase().includes("recently") ||
            data?.type === "errors/already_invited_recently"
          );

          if (ok || isAlreadyInvited) {
            totalSentToday += 1;
            log(`SUCCESS: Connection invite ${isAlreadyInvited ? 'already sent previously' : 'sent'} for ${pName}!`);
            cv.history = [
              ...(cv.history || []),
              {
                node_type: "send_invitation",
                node_label: "Connection Request Sent",
                status: "success",
                executed_at: nowIso,
                detail: isAlreadyInvited ? "Invitation was already pending on LinkedIn" : undefined
              }
            ];
            if (nextEdge) cv.current_node_id = nextEdge.target;

            if (recipientKey) processedRecipientsThisRun.add(recipientKey);
            await sbFetch(`prospects?id=eq.${p.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                status: "Connection Request Sent",
                connection_status: "invitation_sent",
                connection_sent_date: p.connection_sent_date || nowIso,
                provider_id: providerId,
                custom_variables: cv
              })
            });
          } else {
            log(`FAILED invite for ${pName}: ${data?.detail || "Invite failed"}`);
            const isFatal = errStr.toLowerCase().includes("cannot") ||
                            errStr.toLowerCase().includes("not allowed") ||
                            errStr.toLowerCase().includes("restricted") ||
                            errStr.toLowerCase().includes("blocked") ||
                            errStr.toLowerCase().includes("recipient id is valid") ||
                            errStr.toLowerCase().includes("requires a subscription") ||
                            errStr.toLowerCase().includes("locked");

            const isProviderLimit = errStr.toLowerCase().includes("provider limit") ||
                                    errStr.toLowerCase().includes("rate limit") ||
                                    errStr.toLowerCase().includes("too many requests");

            cv.history = [
              ...(cv.history || []),
              {
                node_type: "send_invitation",
                node_label: "Connection Request Failed",
                status: "failed",
                error: data?.detail || "Invite failed",
                executed_at: nowIso
              }
            ];

            const nodeFailures = (cv.history || []).filter(h => h.node_id === currentNode.id && h.status === 'failed').length;

            const patchBody = { custom_variables: cv };
            if (isFatal || nodeFailures >= 2) {
              log(`🛑 Halting invite retries for ${pName} (Fatal/repeated error: ${errStr}). Setting status to 'Needs Review'.`);
              patchBody.status = "Needs Review";
              patchBody.custom_variables = { ...cv, delivery_failed: true, delivery_error: errStr };
            }
            await sbFetch(`prospects?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify(patchBody) });

            if (isProviderLimit) {
              log(`[CIRCUIT BREAKER] LinkedIn provider limit reached for '${profile.display_name}'. Setting 24h cooldown.`);
              const cooldownDate = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
              const pSettings = { ...(profile.settings || {}), provider_limit_cooldown_until: cooldownDate };
              await sbFetch(`profiles?id=eq.${profile.id}`, {
                method: "PATCH",
                body: JSON.stringify({ settings: pSettings })
              });
              break;
            }
          }
        }

        // 4. Send Message (Direct chat messaging for connected prospects)
        if (nodeType === 'send_message') {
          let recipientId = p.provider_id || p.member_id;
          if (!recipientId) {
            const pubId = extractPublicId(p.linkedin_url);
            if (pubId) {
              const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accId}`);
              if (ok && data) recipientId = data.provider_id || data.id;
            }
          }

          if (recipientId) {
            const rawMsg = nodeConfig.message || '';
            const msgText = renderTemplate(rawMsg, p).trim();
            if (msgText) {
              const pName = p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
              log(`Sending message to ${pName}...`);
              const { ok, data } = await unipileFetch("/chats", {
                method: "POST",
                body: JSON.stringify({
                  account_id: accId,
                  attendees_ids: [recipientId],
                  text: msgText
                })
              });

              const nowIso = new Date().toISOString();
              if (ok) {
                log(`SUCCESS: Message sent to ${pName}!`);
                cv.history = [
                  ...(cv.history || []),
                  {
                    node_id: currentNode.id,
                    node_type: "send_message",
                    node_label: currentNode.data?.label || "Send Message",
                    status: "success",
                    executed_at: nowIso
                  }
                ];
                cv.last_sent_node_id = currentNode.id;
                cv.message_sent_at = nowIso;
                cv.last_action_at = nowIso;
                if (nextEdge) cv.current_node_id = nextEdge.target;

                const isFollowUp = (currentNode.data?.label || '').toLowerCase().includes('follow') || rawMsg.toLowerCase().includes('follow');
                if (recipientKey) processedRecipientsThisRun.add(recipientKey);
                await sbFetch(`prospects?id=eq.${p.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    status: isFollowUp ? "Following Up" : "Initial Message Sent",
                    message_sent_date: nowIso,
                    custom_variables: cv
                  })
                });
              } else {
                log(`FAILED send message to ${pName}: ${data?.detail || "Send message failed"}`);
                const errMsg = String(data?.detail || data?.message || "Send message failed");
                cv.history = [
                  ...(cv.history || []),
                  {
                    node_id: currentNode.id,
                    node_type: "send_message",
                    node_label: currentNode.data?.label || "Send Message",
                    status: "failed",
                    error: errMsg,
                    executed_at: nowIso
                  }
                ];

                const isFatal = errMsg.toLowerCase().includes("cannot send") ||
                                errMsg.toLowerCase().includes("requires a subscription") ||
                                errMsg.toLowerCase().includes("cannot be invited") ||
                                errMsg.toLowerCase().includes("not allowed") ||
                                errMsg.toLowerCase().includes("blocked") ||
                                errMsg.toLowerCase().includes("restricted") ||
                                errMsg.toLowerCase().includes("recipient id is valid") ||
                                errMsg.toLowerCase().includes("locked");
                const nodeFailures = (cv.history || []).filter(h => h.node_id === currentNode.id && h.status === 'failed').length;

                const patchBody = { custom_variables: cv };
                if (isFatal || nodeFailures >= 2) {
                  log(`🛑 Halting retries for ${pName} (Fatal/repeated error: ${errMsg}). Setting status to 'Needs Review'.`);
                  patchBody.status = "Needs Review";
                  patchBody.custom_variables = { ...cv, delivery_failed: true, delivery_error: errMsg };
                }
                await sbFetch(`prospects?id=eq.${p.id}`, {
                  method: "PATCH",
                  body: JSON.stringify(patchBody)
                });
              }
            }
          }
        }

        // 4b. Send Voice Message (Native LinkedIn Voice Note with waveform)
        if (nodeType === 'send_voice_message') {
          let recipientId = p.provider_id || p.member_id;
          if (!recipientId) {
            const pubId = extractPublicId(p.linkedin_url);
            if (pubId) {
              const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accId}`);
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
                const pName = p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
                log(`Sending voice note to ${pName}...`);

                const formData = new FormData();
                formData.append('account_id', accId);
                formData.append('attendees_ids', recipientId);
                const voiceFileName = nodeConfig.voice_file_name && nodeConfig.voice_file_name.endsWith('.m4a')
                  ? nodeConfig.voice_file_name
                  : 'voice_note.m4a';
                formData.append('voice_message', audioBlob, voiceFileName);

                if (nodeConfig.companion_text) {
                  const compText = renderTemplate(nodeConfig.companion_text, p).trim();
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
                  log(`SUCCESS: Voice note sent to ${pName}!`);
                  cv.history = [
                    ...(cv.history || []),
                    {
                      node_id: currentNode.id,
                      node_type: "send_voice_message",
                      node_label: currentNode.data?.label || "Send Voice Note",
                      status: "success",
                      executed_at: nowIso
                    }
                  ];
                  cv.last_sent_node_id = currentNode.id;
                  cv.message_sent_at = nowIso;
                  cv.last_action_at = nowIso;
                  if (nextEdge) cv.current_node_id = nextEdge.target;

                  if (recipientKey) processedRecipientsThisRun.add(recipientKey);
                  await sbFetch(`prospects?id=eq.${p.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      status: "Initial Message Sent",
                      message_sent_date: nowIso,
                      custom_variables: cv
                    })
                  });
                } else {
                  log(`FAILED send voice note to ${pName}: ${vData?.detail || "Send voice note failed"}`);
                  const errMsg = String(vData?.detail || vData?.message || "Send voice note failed");
                  cv.history = [
                    ...(cv.history || []),
                    {
                      node_id: currentNode.id,
                      node_type: "send_voice_message",
                      node_label: currentNode.data?.label || "Send Voice Note",
                      status: "failed",
                      error: errMsg,
                      executed_at: nowIso
                    }
                  ];

                  const isFatal = errMsg.toLowerCase().includes("cannot send") ||
                                  errMsg.toLowerCase().includes("requires a subscription") ||
                                  errMsg.toLowerCase().includes("not allowed") ||
                                  errMsg.toLowerCase().includes("blocked") ||
                                  errMsg.toLowerCase().includes("restricted") ||
                                  errMsg.toLowerCase().includes("recipient id is valid") ||
                                  errMsg.toLowerCase().includes("locked");
                  const nodeFailures = (cv.history || []).filter(h => h.node_id === currentNode.id && h.status === 'failed').length;

                  const patchBody = { custom_variables: cv };
                  if (isFatal || nodeFailures >= 2) {
                    log(`🛑 Halting retries for ${pName} (Fatal/repeated error: ${errMsg}). Setting status to 'Needs Review'.`);
                    patchBody.status = "Needs Review";
                    patchBody.custom_variables = { ...cv, delivery_failed: true, delivery_error: errMsg };
                  }
                  await sbFetch(`prospects?id=eq.${p.id}`, {
                    method: "PATCH",
                    body: JSON.stringify(patchBody)
                  });
                }
              }
            } catch (err) {
              log(`ERROR sending voice note: ${err.message}`);
            }
          }
        }

        // 5. Completed Node
        if (nodeType === 'completed') {
          await sbFetch(`prospects?id=eq.${p.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: "Completed",
              custom_variables: cv
            })
          });
        }
      }
    }

    // ── Safe Background Auto-Withdrawal of Stale Invitations ──
    for (const profile of profiles || []) {
      if (!profile.unipile_account_id) continue;
      const pSettings = profile.settings || {};
      if (!pSettings.auto_withdraw_stale_invitations) continue;

      const withdrawAgeDays = Number(pSettings.withdraw_age_days) || 90;
      const dailyWithdrawLimit = Number(pSettings.daily_withdraw_limit) || 15;
      const cutoffMs = Date.now() - withdrawAgeDays * 24 * 60 * 60 * 1000;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayIso = todayStart.toISOString();

      let withdrawnTodayCount = 0;
      try {
        let actLogsQuery = `activity_logs?action_type=eq.invitation_withdrawn&created_at=gte.${todayIso}&select=id`;
        if (profile.organization_id) {
          actLogsQuery += `&organization_id=eq.${profile.organization_id}`;
        }
        const todayLogs = await sbFetch(actLogsQuery);
        withdrawnTodayCount = Array.isArray(todayLogs) ? todayLogs.length : 0;
      } catch (e) {
        withdrawnTodayCount = 0;
      }

      if (withdrawnTodayCount >= dailyWithdrawLimit) {
        log(`Profile '${profile.display_name}' reached daily withdrawal cap (${withdrawnTodayCount}/${dailyWithdrawLimit}). Skipping.`);
        continue;
      }

      const { ok: invOk, data: invData } = await unipileFetch(`/users/invite/sent?account_id=${profile.unipile_account_id}&limit=50`);
      const sentInvites = (invOk && invData && (invData.items || invData.invitations)) || [];

      let staleToCancel = null;
      let oldestAgeDays = 0;
      for (const inv of sentInvites) {
        const sentTs = inv.parsed_datetime || inv.sent_at || inv.created_at || inv.date || inv.timestamp;
        const invMs = sentTs ? new Date(sentTs).getTime() : 0;
        if (invMs > 0 && invMs <= cutoffMs) {
          const ageDays = Math.floor((Date.now() - invMs) / (1000 * 60 * 60 * 24));
          if (!staleToCancel || ageDays > oldestAgeDays) {
            staleToCancel = inv;
            oldestAgeDays = ageDays;
          }
        }
      }

      if (staleToCancel) {
        const invId = staleToCancel.id || staleToCancel.invitation_id;
        const recName = staleToCancel.invited_user || staleToCancel.recipient_name || staleToCancel.name || 'LinkedIn Member';
        const recSlug = staleToCancel.public_identifier || staleToCancel.invited_user_public_id || '';
        const recUrl = staleToCancel.public_profile_url || (recSlug ? `https://www.linkedin.com/in/${recSlug}` : '');

        log(`Auto-withdrawing 1 stale invitation (${oldestAgeDays} days old) for ${recName} on account '${profile.display_name}'...`);
        const { ok: cancelOk } = await unipileFetch(`/users/invite/sent/${invId}?account_id=${profile.unipile_account_id}`, {
          method: 'DELETE',
        });

        if (cancelOk) {
          log(`Successfully withdrawn stale invitation for ${recName}.`);
          try {
            await sbFetch('activity_logs', {
              method: 'POST',
              body: JSON.stringify({
                organization_id: profile.organization_id || null,
                user_email: profile.user_email || null,
                campaign_name: 'Safe Account Hygiene',
                action_type: 'invitation_withdrawn',
                status: 'success',
                details: `Safely auto-withdrew stale invitation sent ${oldestAgeDays} days ago to ${recName}`,
                linkedin_url: recUrl || null,
                created_at: new Date().toISOString()
              })
            });
          } catch (e) {
            log(`Failed recording activity log for withdrawal: ${e.message}`);
          }
        } else {
          log(`Failed withdrawing stale invitation for ${recName}.`);
        }
      }
    }

    if (res && res.status) {
      return res.status(200).json({ success: true, timestamp: new Date().toISOString(), totalSentToday, logs });
    }
  } catch (err) {
    log(`Cron execution error: ${err.message}`);
    if (res && res.status) {
      return res.status(500).json({ success: false, error: err.message, logs });
    }
  }
}
