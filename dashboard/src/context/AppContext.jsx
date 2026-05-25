import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  getStats, getCampaigns, getProfiles, getProspects,
  runConnections, checkAcceptances, runMessages, runFollowups,
  getSchedules,
} from '../services/api';
import wsService from '../services/websocket';

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
  const [wsConnected,   setWsConnected]   = useState(false);
  const [unreadReplies, setUnreadReplies] = useState(0);

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

  // Initial data load + polling
  useEffect(() => {
    fetchStats(); fetchCampaigns(); fetchProfiles(); fetchReplies();
    const s = setInterval(fetchStats,   60_000);
    const r = setInterval(fetchReplies, 30_000);
    return () => { clearInterval(s); clearInterval(r); };
  }, []);

  // WebSocket
  useEffect(() => {
    wsService.connect();
    const unsub = wsService.onMessage((msg) => {
      if (msg.type === 'connection_status') setWsConnected(msg.connected);
      if (msg.type === 'replied')           { setUnreadReplies(p => p + 1); fetchStats(); }
      if (msg.type === 'result' || msg.type === 'accepted') fetchStats();
    });
    return () => { unsub(); wsService.disconnect(); };
  }, []);

  // Auto-start overdue tasks when dashboard loads
  useEffect(() => {
    checkStartupTasks();
  }, []);

  return (
    <Ctx.Provider value={{
      stats, campaigns, profiles, wsConnected, unreadReplies,
      fetchStats, fetchCampaigns, fetchProfiles,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useApp = () => useContext(Ctx);
