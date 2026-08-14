import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  getStats, getCampaigns, getProfiles, getProspects, getJobs,
  runConnections, checkAcceptances, runMessages, runFollowups,
  getSchedules, runFlow,
} from '../services/api';
import { directGetAppSettings } from '../services/directServices';

// A profile that hasn't heartbeated in this long is treated as stale/offline
// even if extension_status still says "online" (e.g. crashed mid-tick).
const HEARTBEAT_STALE_MS = 3 * 60 * 1000;

const Ctx = createContext(null);

// ── Scheduler API map ─────────────────────────────────────────────────────────
const TASK_FNS = {
  conn: runConnections,
  acc:  checkAcceptances,
  msg:  runMessages,
  fu:   runFollowups,
};

// ── Auto-start: run overdue tasks once per day on dashboard load ──────────────
const LS_AUTORUN = 'lf_autorun'; // { date: "YYYY-MM-DD", ran: ["conn","acc"] }

function getAutorunRecord() {
  try { return JSON.parse(localStorage.getItem(LS_AUTORUN) || '{}'); } catch { return {}; }
}

async function checkStartupTasks() {
  const today = new Date().toISOString().slice(0, 10);
  const record = getAutorunRecord();

  // Reset daily — support both old (ran[]) and new (tasks{}) formats
  const ranToday   = record.date === today ? (record.ran   || []) : [];
  const tasksToday = record.date === today ? (record.tasks || {}) : {};

  let schedule;
  try {
    const data = await getSchedules();
    schedule = (data?.schedules || []).map(row => ({
      key: row.task_key,
      label: row.label,
      time: row.time,
      enabled: row.enabled,
      runOnStartup: row.run_on_startup,
    }));
  } catch { return; }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const toRun = schedule.filter(s => {
    if (!s.enabled || !s.runOnStartup)   return false; // not flagged
    if (ranToday.includes(s.key))         return false; // already ran today
    const [hh, mm] = (s.time || '00:00').split(':').map(Number);
    return nowMinutes > hh * 60 + mm;                  // time has passed
  });

  if (!toRun.length) return;

  // Small delay — let the backend connection settle first
  await new Promise(r => setTimeout(r, 2000));

  const newlyRan    = [...ranToday];
  const newTasks    = { ...tasksToday };

  const stamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  for (const task of toRun) {
    try {
      const res    = await TASK_FNS[task.key]?.();
      const detail = res?.message || `${res?.queued ?? 0} queued`;
      toast.success(`⚡ Auto-started: ${task.label}\n${detail}`, { duration: 5000 });
      newlyRan.push(task.key);
      newTasks[task.key] = { ranAt: stamp(), result: detail, status: 'ok', auto: true };
    } catch {
      toast.error(`⚡ Auto-start failed: ${task.label}`);
      newTasks[task.key] = { ranAt: stamp(), result: 'Failed to start', status: 'error', auto: true };
    }
  }

  localStorage.setItem(LS_AUTORUN, JSON.stringify({ date: today, ran: newlyRan, tasks: newTasks }));
}

// ── Context ───────────────────────────────────────────────────────────────────
export function AppProvider({ children }) {
  const [stats,         setStats]         = useState(null);
  const [campaigns,     setCampaigns]     = useState([]);
  const [profiles,      setProfiles]      = useState([]);
  const [unreadReplies, setUnreadReplies] = useState(0);
  const [recentFailedJobs, setRecentFailedJobs] = useState([]);
  const [theme,         setThemeState]     = useState(() => localStorage.getItem('lf_theme') || 'dark');

  const setTheme = useCallback((nextTheme) => {
    const safeTheme = nextTheme === 'light' ? 'light' : 'dark';
    localStorage.setItem('lf_theme', safeTheme);
    setThemeState(safeTheme);
  }, []);

  const fetchStats = useCallback(async () => {
    try { setStats(await getStats()); } catch {}
  }, []);

  const fetchCampaigns = useCallback(async () => {
    try { setCampaigns(await getCampaigns()); } catch {}
  }, []);

  const fetchProfiles = useCallback(async () => {
    try { setProfiles(await getProfiles()); } catch {}
  }, []);

  const fetchReplies = useCallback(async () => {
    try {
      const d = await getProspects({ status: 'Replied', limit: 1 });
      setUnreadReplies(d.total || 0);
    } catch {}
  }, []);

  const fetchFailedJobs = useCallback(async () => {
    try {
      const d = await getJobs({ status: 'failed', limit: 10 });
      const since = Date.now() - 24 * 60 * 60 * 1000;
      setRecentFailedJobs((d.jobs || []).filter(j => new Date(j.failed_at || j.updated_at).getTime() > since));
    } catch {}
  }, []);

  // Initial data load + polling
  useEffect(() => {
    fetchStats(); fetchCampaigns(); fetchProfiles(); fetchReplies(); fetchFailedJobs();
    runFlow().catch(err => console.warn('Background runFlow error:', err));
    const s = setInterval(fetchStats,   60_000);
    const p = setInterval(fetchProfiles, 30_000);
    const r = setInterval(fetchReplies, 30_000);
    const f = setInterval(fetchFailedJobs, 60_000);
    
    let fl;
    directGetAppSettings().then(settings => {
      const intervalMs = settings?.runner_interval_ms || 60_000;
      fl = setInterval(() => {
        runFlow().catch(err => console.warn('Background runFlow error:', err));
      }, intervalMs);
    }).catch(() => {
      fl = setInterval(() => {
        runFlow().catch(err => console.warn('Background runFlow error:', err));
      }, 60_000);
    });

    return () => {
      clearInterval(s);
      clearInterval(p);
      clearInterval(r);
      clearInterval(f);
      if (fl) clearInterval(fl);
    };
  }, []);

  // Auto-start overdue tasks when dashboard loads
  useEffect(() => {
    checkStartupTasks();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const executorConnected = profiles.some(p => p.session_active);

  const staleProfiles = profiles.filter(p => {
    if (p.enabled === false) return false;
    if (!p.last_extension_heartbeat) return true;
    return Date.now() - new Date(p.last_extension_heartbeat).getTime() > HEARTBEAT_STALE_MS;
  });

  const alerts = [
    ...staleProfiles.map(p => ({
      id: `stale-${p.profile_key}`,
      severity: 'error',
      message: `${p.display_name || p.profile_key} hasn't checked in - extension may be offline, logged out, or stuck.`,
    })),
    ...recentFailedJobs.map(j => ({
      id: `failed-${j.id}`,
      severity: 'warning',
      message: `${j.job_type} permanently failed after ${j.retry_count} retries: ${j.error_message || 'unknown error'}`,
    })),
  ];

  return (
    <Ctx.Provider value={{
      stats, campaigns, profiles, wsConnected: executorConnected, unreadReplies, theme, setTheme,
      alerts, recentFailedJobs,
      fetchStats, fetchCampaigns, fetchProfiles,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useApp = () => useContext(Ctx);
