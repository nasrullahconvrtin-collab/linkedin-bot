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

function renderTemplate(templateText, prospect) {
  if (!templateText) return "";
  let text = String(templateText);
  const matches = text.match(/\{\{\s*([a-zA-Z0-9_\-\s]+)\s*\}\}/g) || [];
  for (const m of matches) {
    const varName = m.replace(/\{\{\s*|\s*\}\}/g, "").trim();
    const norm = (v) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normVar = norm(varName);
    let resolvedValue = "";
    if (normVar === "firstname" || normVar === "first_name") {
      resolvedValue = prospect.first_name || prospect.custom_variables?.first_name || (prospect.name ? prospect.name.split(" ")[0] : "");
    } else if (normVar === "lastname" || normVar === "last_name") {
      resolvedValue = prospect.last_name || prospect.custom_variables?.last_name || (prospect.name ? prospect.name.split(" ").slice(1).join(" ") : "");
    } else if (normVar === "company") {
      resolvedValue = prospect.company || prospect.custom_variables?.company || "";
    } else if (normVar === "title" || normVar === "jobtitle") {
      resolvedValue = prospect.job_title || prospect.custom_variables?.job_title || prospect.custom_variables?.title || "";
    } else {
      resolvedValue = prospect[varName] || prospect.custom_variables?.[varName] || "";
    }
    text = text.replace(m, resolvedValue || "");
  }
  return text;
}

export default async function handler(req, res) {
  const logs = [];
  const log = (msg) => logs.push(`[${new Date().toISOString()}] ${msg}`);
  log("Vercel Goal-Oriented Cron Runner started...");

  try {
    const campaigns = await sbFetch("campaigns?status=eq.running");
    log(`Found ${campaigns.length} running campaigns.`);

    const profiles = await sbFetch("profiles?select=*");
    const profileMap = new Map((profiles || []).map(p => [p.profile_key, p]));

    let totalSentToday = 0;
    for (const c of campaigns || []) {
      const profile = profileMap.get(c.profile_key);
      if (!profile || !profile.unipile_account_id) continue;

      const dailyConnectionLimit = Number(profile.settings?.daily_connection_limit || 15);
      if (totalSentToday >= dailyConnectionLimit) break;

      const accId = profile.unipile_account_id;
      log(`Processing Campaign '${c.name}' for account '${profile.display_name}' (${accId})`);

      const flowSequence = c.sequence_config?.flow_sequence;
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

      for (const p of prospects || []) {
        const st = p.status || "Not Contacted";
        const cv = p.custom_variables || {};

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

        if (["Connection Request Sent", "Connection Sent", "Completed", "Failed", "Replied"].includes(p.status)) continue;

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

        // 1. Visit profile if needed
        if (nodeType === 'visit_profile') {
          const pubId = extractPublicId(p.linkedin_url);
          log(`Visiting profile for ${p.name || p.id}...`);
          const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accId}`);
          const providerId = (ok && data) ? (data.provider_id || data.id) : p.provider_id;
          p.provider_id = providerId || p.provider_id;

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

          await sbFetch(`prospects?id=eq.${p.id}`, {
            method: "PATCH",
            body: JSON.stringify({ provider_id: p.provider_id, custom_variables: cv })
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
          if (totalSentToday >= dailyConnectionLimit) continue;

          let providerId = p.provider_id;
          if (!providerId) {
            const pubId = extractPublicId(p.linkedin_url);
            const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accId}`);
            if (ok && data) providerId = data.provider_id || data.id;
          }

          if (!providerId) continue;

          const pName = p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
          log(`Sending connection invite to ${pName}...`);
          const { ok, data } = await unipileFetch("/users/invite", {
            method: "POST",
            body: JSON.stringify({ account_id: accId, provider_id: providerId, message: "" })
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
                            errStr.toLowerCase().includes("blocked");

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

            const patchBody = { custom_variables: cv };
            if (isFatal) {
              patchBody.status = "Needs Review";
            }
            await sbFetch(`prospects?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify(patchBody) });
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
                cv.history = [
                  ...(cv.history || []),
                  {
                    node_id: currentNode.id,
                    node_type: "send_message",
                    node_label: currentNode.data?.label || "Send Message",
                    status: "failed",
                    error: data?.detail || "Send message failed",
                    executed_at: nowIso
                  }
                ];
                await sbFetch(`prospects?id=eq.${p.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ custom_variables: cv })
                });
              }
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
