import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

let savedTheme = 'dark';
try {
  savedTheme = localStorage.getItem('lf_theme') === 'light' ? 'light' : 'dark';
} catch (e) {}
document.documentElement.dataset.theme = savedTheme;
document.documentElement.style.colorScheme = savedTheme;

// ─── Pre-render isolation guard ───────────────────────────────────────────────
// MUST complete before React mounts. Queries THIS deployment's Supabase to
// validate localStorage keys set by a different deployment (cross-contamination).
async function sanitizeLocalStorage() {
  try {
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) return;

    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    };

    // 1. Validate lf_selected_account_id
    const storedAccId = localStorage.getItem('lf_selected_account_id');
    const profilesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=unipile_account_id`,
      { headers }
    );
    const profiles = await profilesRes.json().catch(() => []);
    const validIds = new Set((Array.isArray(profiles) ? profiles : [])
      .map(p => p.unipile_account_id).filter(Boolean));

    if (storedAccId && !validIds.has(storedAccId)) {
      console.warn('[INIT] Stale account ID cleared:', storedAccId);
      localStorage.removeItem('lf_selected_account_id');
      localStorage.removeItem('lf_active_account_id');
    }

    // 2. Validate lf_user_account organization_id
    const storedUser = localStorage.getItem('lf_user_account');
    if (storedUser) {
      const userObj = JSON.parse(storedUser);
      const storedOrgId = userObj?.organization_id;
      if (storedOrgId) {
        const campRes = await fetch(
          `${SUPABASE_URL}/rest/v1/campaigns?organization_id=eq.${storedOrgId}&select=id&limit=1`,
          { headers }
        );
        const camps = await campRes.json().catch(() => []);
        if (!Array.isArray(camps) || camps.length === 0) {
          // Stale org — get the real one from this DB
          const anyRes = await fetch(
            `${SUPABASE_URL}/rest/v1/campaigns?select=organization_id&limit=1`,
            { headers }
          );
          const any = await anyRes.json().catch(() => []);
          if (Array.isArray(any) && any[0]?.organization_id) {
            console.warn('[INIT] Stale org corrected:', storedOrgId, '→', any[0].organization_id);
            userObj.organization_id = any[0].organization_id;
            localStorage.setItem('lf_user_account', JSON.stringify(userObj));
          }
        }
      }
    }
  } catch (e) {
    console.warn('[INIT] localStorage sanitize error (non-fatal):', e);
  }
}

// Block React from mounting until sanitization is done
sanitizeLocalStorage().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
// ─────────────────────────────────────────────────────────────────────────────
