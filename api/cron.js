const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://mjwganpjawthnowemabt.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDczMTUsImV4cCI6MjEwMTg4MzMxNX0.OwKeHoH2DH-jS7-_XRf6Vkx4bNZPKgbL9WOr5oSd27c";
const UNIPILE_API_KEY = process.env.VITE_UNIPILE_API_KEY || "6SlhX8Ii.R7wP5y2dLTREmrXKCTpnoEg3clwHKT9wZtIc++MRAkg=";
const UNIPILE_URL = "https://api20.unipile.com:15032/api/v1";

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

export default async function handler(req, res) {
  const logs = [];
  const log = (msg) => logs.push(`[${new Date().toISOString()}] ${msg}`);
  log("Vercel Goal-Oriented Cron Runner started...");

  try {
    const campaigns = await sbFetch("campaigns?status=eq.running");
    log(`Found ${campaigns.length} running campaigns.`);

    const profiles = await sbFetch("profiles?select=*");
    const profileMap = new Map((profiles || []).map(p => [p.profile_key, p]));

    const dailyConnectionLimit = 15;
    let totalSentToday = 0;

    for (const c of campaigns || []) {
      if (totalSentToday >= dailyConnectionLimit) break;

      const profile = profileMap.get(c.profile_key);
      if (!profile || !profile.unipile_account_id) continue;

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

      for (const p of prospects || []) {
        if (totalSentToday >= dailyConnectionLimit) break;
        const st = p.status || "Not Contacted";
        if (["Connection Request Sent", "Connection Sent", "Completed", "Failed", "Replied"].includes(st)) continue;

        const cv = p.custom_variables || {};
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
          if (ok) {
            totalSentToday += 1;
            log(`SUCCESS: Connection invite sent to ${pName}!`);
            cv.history = [...(cv.history || []), { node_type: "send_invitation", node_label: "Connection Request Sent", status: "success", executed_at: nowIso }];
            if (nextEdge) cv.current_node_id = nextEdge.target;

            await sbFetch(`prospects?id=eq.${p.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                status: "Connection Request Sent",
                connection_status: "invitation_sent",
                connection_sent_date: nowIso,
                provider_id: providerId,
                custom_variables: cv
              })
            });
          } else {
            log(`FAILED invite for ${pName}: ${data?.detail || "Invite failed"}`);
            cv.history = [...(cv.history || []), { node_type: "send_invitation", node_label: "Connection Request Failed", status: "failed", error: data?.detail || "Invite failed", executed_at: nowIso }];
            await sbFetch(`prospects?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ custom_variables: cv }) });
          }
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
