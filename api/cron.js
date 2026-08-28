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
  log("Vercel Cron Runner started...");

  try {
    const campaigns = await sbFetch("campaigns?status=eq.running");
    log(`Found ${campaigns.length} running campaigns.`);

    const profiles = await sbFetch("profiles?select=*");
    const profileMap = new Map((profiles || []).map(p => [p.profile_key, p]));

    for (const c of campaigns || []) {
      const profile = profileMap.get(c.profile_key);
      if (!profile || !profile.unipile_account_id) {
        log(`Skipping campaign ${c.name}: profile/unipile account missing.`);
        continue;
      }

      const accId = profile.unipile_account_id;
      log(`Processing Campaign '${c.name}' for account '${profile.display_name}' (${accId})`);

      const prospects = await sbFetch(`prospects?campaign_id=eq.${c.id}`);
      const now = new Date();
      const nowIso = now.toISOString();

      const dueForInvite = [];
      const readyForVisit = [];

      for (const p of prospects || []) {
        const st = p.status || "Not Contacted";
        const cv = p.custom_variables || {};
        const nextSched = cv.next_scheduled_at;

        if (["Connection Request Sent", "Connection Sent", "Failed"].includes(st)) continue;

        if (nextSched) {
          if (now >= new Date(nextSched)) dueForInvite.push(p);
        } else {
          readyForVisit.push(p);
        }
      }

      log(`Campaign '${c.name}': ${dueForInvite.length} due for invite, ${readyForVisit.length} ready for visit.`);

      // 1. Process Due Invites (batch size 2)
      for (const p of dueForInvite.slice(0, 2)) {
        const pName = p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
        let providerId = p.provider_id;

        if (!providerId) {
          const pubId = extractPublicId(p.linkedin_url);
          const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accId}`);
          if (ok && data) providerId = data.provider_id || data.id;
        }

        if (!providerId) continue;

        log(`Sending connection invite to ${pName} (${providerId})...`);
        const { ok, data } = await unipileFetch("/users/invite", {
          method: "POST",
          body: JSON.stringify({ account_id: accId, provider_id: providerId, message: "" })
        });

        const cv = p.custom_variables || {};
        if (ok) {
          log(`SUCCESS: Invite sent to ${pName}`);
          cv.next_scheduled_at = null;
          cv.history = [...(cv.history || []), { node_type: "send_invitation", node_label: "Connection Request Sent", status: "success", executed_at: nowIso }];
          await sbFetch(`prospects?id=eq.${p.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: "Connection Request Sent",
              connection_status: "invitation_sent",
              connection_sent_date: nowIso,
              custom_variables: cv
            })
          });
        } else {
          log(`FAILED invite for ${pName}: ${data?.detail || "Invite failed"}`);
          cv.history = [...(cv.history || []), { node_type: "send_invitation", node_label: "Connection Request Sent", status: "failed", error: data?.detail || "Invite failed", executed_at: nowIso }];
          await sbFetch(`prospects?id=eq.${p.id}`, {
            method: "PATCH",
            body: JSON.stringify({ custom_variables: cv })
          });
        }
      }

      // 2. Process Initial Profile Visits (batch size 2)
      for (const p of readyForVisit.slice(0, 2)) {
        const pName = p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
        const pubId = extractPublicId(p.linkedin_url);
        log(`Visiting profile for ${pName} (${pubId})...`);

        const { ok, data } = await unipileFetch(`/users/${encodeURIComponent(pubId)}?account_id=${accId}`);
        const providerId = (ok && data) ? (data.provider_id || data.id) : null;

        const nextSched = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
        const cv = p.custom_variables || {};
        cv.current_node_id = "node_1787872256293_2";
        cv.next_scheduled_at = nextSched;
        cv.history = [...(cv.history || []), 
          { node_type: "visit_profile", node_label: "Visit Profile", status: "success", executed_at: nowIso },
          { node_type: "wait", node_label": "Wait 1 Day", status: "waiting", next_scheduled_at: nextSched, executed_at: nowIso }
        ];

        await sbFetch(`prospects?id=eq.${p.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "Not Contacted",
            provider_id: providerId || p.provider_id,
            custom_variables: cv
          })
        });
        log(`Visited profile for ${pName} -> Scheduled connection invite for ${nextSched}`);
      }
    }

    if (res && res.status) {
      return res.status(200).json({ success: true, timestamp: new Date().toISOString(), logs });
    }
  } catch (err) {
    log(`Cron execution error: ${err.message}`);
    if (res && res.status) {
      return res.status(500).json({ success: false, error: err.message, logs });
    }
  }
}
