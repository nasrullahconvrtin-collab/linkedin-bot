import { useState, useEffect } from 'react';
import {
  Globe, Loader2, Check, Shield, Clock, Bell, Save, Copy,
  ToggleLeft, ToggleRight, Play, Activity,
  Moon, Sun, Palette, KeyRound, Puzzle, Download,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { useApp } from '../context/AppContext';
import {
  getStats, runConnections, checkAcceptances, runMessages, runFollowups,
  getSchedules, updateSchedules, createExtensionPairToken,
} from '../services/api';

// Strip BOM that Windows UTF-8 can inject into env vars
const _rawApiUrl = import.meta.env.VITE_API_URL || '';
const API_URL = _rawApiUrl.replace(/^﻿/, '').trim()
  || 'https://linkedin-bot-backend-production.up.railway.app';

// ── Default schedule ─────────────────────────────────────────────────────────
const SCHEDULE_DEFAULTS = [
  { key: 'conn', label: 'Send connections',  time: '09:00', enabled: true, runOnStartup: false },
  { key: 'acc',  label: 'Check acceptances', time: '12:00', enabled: true, runOnStartup: false },
  { key: 'msg',  label: 'Send messages',     time: '14:00', enabled: true, runOnStartup: false },
  { key: 'fu',   label: 'Send follow-ups',   time: '10:00', enabled: true, runOnStartup: false },
];

const LS_KEY_LIMITS   = 'lf_limits';
const LS_AUTORUN      = 'lf_autorun';

// Task runner map — mirrors AppContext
const TASK_FNS = {
  conn: runConnections,
  acc:  checkAcceptances,
  msg:  runMessages,
  fu:   runFollowups,
};

function getAutorunRecord() {
  try { return JSON.parse(localStorage.getItem(LS_AUTORUN) || '{}'); } catch { return {}; }
}

function loadSchedule() {
  return SCHEDULE_DEFAULTS.map(s => ({ ...s }));
}

function loadLimits() {
  try {
    const raw = localStorage.getItem(LS_KEY_LIMITS);
    return raw ? JSON.parse(raw) : { connLimit: 25, connMin: 3, connMax: 7, msgMin: 5, msgMax: 10 };
  } catch {
    return { connLimit: 25, connMin: 3, connMax: 7, msgMin: 5, msgMax: 10 };
  }
}

// "14:30" → "02:30 PM"
function to12h(time24) {
  const [hh, mm] = time24.split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const h = hh % 12 || 12;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${period}`;
}

function Section({ title, icon: Icon, children }) {
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
      <div className="flex items-center gap-2 mb-5">
        <Icon size={18} className="text-[#6366f1]" />
        <h2 className="text-white font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function Settings() {
  const { profiles, theme, setTheme } = useApp();
  const [testing,  setTesting]  = useState(false);
  const [tested,   setTested]   = useState(null);
  const [pairProfile, setPairProfile] = useState('');
  const [pairToken, setPairToken] = useState(null);
  const [pairing, setPairing] = useState(false);

  // Sending limits — persisted to localStorage
  const initLimits = loadLimits();
  const [connLimit, setConnLimit] = useState(initLimits.connLimit);
  const [connMin,   setConnMin]   = useState(initLimits.connMin);
  const [connMax,   setConnMax]   = useState(initLimits.connMax);
  const [msgMin,    setMsgMin]    = useState(initLimits.msgMin);
  const [msgMax,    setMsgMax]    = useState(initLimits.msgMax);
  const [limitsSaved, setLimitsSaved] = useState(false);

  // Schedule — persisted to Supabase through the backend
  const [schedule, setSchedule] = useState(loadSchedule);
  const [scheduleSaved, setScheduleSaved] = useState(false);

  useEffect(() => {
    getSchedules()
      .then(data => {
        const cloudRows = data?.schedules || [];
        if (!cloudRows.length) return;
        const byKey = Object.fromEntries(cloudRows.map(row => [row.task_key, row]));
        setSchedule(SCHEDULE_DEFAULTS.map(def => {
          const row = byKey[def.key];
          return row ? {
            ...def,
            label: row.label || def.label,
            time: row.time || def.time,
            enabled: row.enabled,
            runOnStartup: row.run_on_startup,
          } : { ...def };
        }));
      })
      .catch(() => toast.error('Could not load cloud schedule'));
  }, []);

  // Password
  const [oldPw,  setOldPw]  = useState('');
  const [newPw,  setNewPw]  = useState('');
  const [confPw, setConfPw] = useState('');

  // Scheduler status
  const [autorun, setAutorun] = useState(() => getAutorunRecord());
  const [running, setRunning] = useState({});

  // ── Scheduler status helpers ───────────────────────────────────────────────

  const today = new Date().toISOString().slice(0, 10);
  const tasksToday = autorun.date === today ? (autorun.tasks || {}) : {};

  const runTask = async (taskKey, label) => {
    setRunning(prev => ({ ...prev, [taskKey]: true }));
    const record   = getAutorunRecord();
    const recToday = record.date === today ? (record.tasks || {}) : {};
    const ranToday = record.date === today ? (record.ran   || []) : [];
    const stamp    = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    try {
      const res    = await TASK_FNS[taskKey]?.();
      const detail = res?.message || `${res?.queued ?? 0} queued`;
      toast.success(`✅ ${label}: ${detail}`);
      const newTasks  = { ...recToday, [taskKey]: { ranAt: stamp, result: detail, status: 'ok', auto: false } };
      const newRecord = { date: today, ran: ranToday.includes(taskKey) ? ranToday : [...ranToday, taskKey], tasks: newTasks };
      localStorage.setItem(LS_AUTORUN, JSON.stringify(newRecord));
      setAutorun(newRecord);
    } catch (err) {
      const msg = err?.message || 'Request failed';
      toast.error(`Failed: ${label}`);
      const newTasks  = { ...recToday, [taskKey]: { ranAt: stamp, result: msg, status: 'error', auto: false } };
      const newRecord = { date: today, ran: ranToday, tasks: newTasks };
      localStorage.setItem(LS_AUTORUN, JSON.stringify(newRecord));
      setAutorun(newRecord);
    } finally {
      setRunning(prev => ({ ...prev, [taskKey]: false }));
    }
  };

  // ── Schedule helpers ───────────────────────────────────────────────────────

  const updateScheduleRow = (key, field, value) => {
    setSchedule(prev =>
      prev.map(s => s.key === key ? { ...s, [field]: value } : s)
    );
    setScheduleSaved(false);
  };

  const saveSchedule = async () => {
    await updateSchedules(schedule.map(s => ({
      task_key: s.key,
      label: s.label,
      time: s.time,
      enabled: s.enabled,
      run_on_startup: s.runOnStartup,
    })));
    setScheduleSaved(true);
    toast.success('Cloud schedule saved');
  };

  const saveLimits = () => {
    localStorage.setItem(LS_KEY_LIMITS, JSON.stringify(
      { connLimit, connMin, connMax, msgMin, msgMax }
    ));
    setLimitsSaved(true);
    toast.success('Limits saved');
  };

  const testConnection = async () => {
    setTesting(true); setTested(null);
    try {
      await getStats();
      setTested('ok');
      toast.success('Connection successful!');
    } catch {
      setTested('fail');
      toast.error('Connection failed');
    } finally {
      setTesting(false);
    }
  };

  const generateExtensionToken = async () => {
    setPairing(true);
    try {
      const res = await createExtensionPairToken(pairProfile || null);
      setPairToken(res);
      toast.success('Extension pairing token created');
    } catch (err) {
      toast.error(err.message || 'Could not create pairing token');
    } finally {
      setPairing(false);
    }
  };

  const copyPairToken = () => {
    const token = pairToken?.token;
    if (!token) return;
    navigator.clipboard.writeText(token)
      .then(() => toast.success('Pairing token copied'))
      .catch(() => toast.error('Copy failed'));
  };

  const changePw = (e) => {
    e.preventDefault();
    const stored   = localStorage.getItem('lf_pw_override');
    const envPw    = (import.meta.env.VITE_APP_PASSWORD || '').replace(/^﻿/, '').trim();
    const current  = stored || envPw;
    if (!current) { toast.error('Dashboard password is not configured'); return; }
    if (oldPw !== current) { toast.error('Current password is incorrect'); return; }
    if (newPw !== confPw)  { toast.error('New passwords do not match'); return; }
    if (newPw.length < 6)  { toast.error('Password must be at least 6 characters'); return; }
    localStorage.setItem('lf_pw_override', newPw);
    toast.success('Password updated');
    setOldPw(''); setNewPw(''); setConfPw('');
  };

  // Generate Task Scheduler / cron command text
  const buildCommands = () => {
    const enabled = schedule.filter(s => s.enabled);
    if (!enabled.length) return '# No tasks enabled';

    const cron = enabled.map(s => {
      const [hh, mm] = s.time.split(':');
      return `${mm} ${parseInt(hh)} * * 1-5  # ${s.label} - LinkedFlow now schedules jobs in the cloud backend`;
    }).join('\n');

    const tasks = enabled.map(s => {
      return `Use the cloud scheduler for "${s.label}" at ${s.time}. Keep Chrome with the LinkedFlow Extension running so it can pull queued jobs.`;
    }).join('\n');

    return `# LinkedFlow cloud scheduler\n${tasks}\n\n# Cron note\n${cron}`;
  };

  const copyCommands = () => {
    navigator.clipboard.writeText(buildCommands())
      .then(() => toast.success('Commands copied to clipboard'))
      .catch(() => toast.error('Copy failed — see below'));
  };

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-white text-2xl font-bold">Settings</h1>
        <p className="text-[#6b7280] text-sm mt-1">Configure your LinkedFlow dashboard</p>
      </div>

      <div className="max-w-2xl space-y-4">

        {/* API Config */}
        <Section title="API Configuration" icon={Globe}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Backend URL</label>
              <div className="flex gap-2">
                <input
                  readOnly value={API_URL}
                  className="flex-1 bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-sm text-[#6b7280] font-mono focus:outline-none"
                />
                <button
                  onClick={testConnection}
                  disabled={testing}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                    tested === 'ok'   ? 'bg-green-500/10 border-green-500/20 text-green-400' :
                    tested === 'fail' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                    'bg-[#111111] border-[#2a2a2a] text-[#9ca3af] hover:text-white'
                  } disabled:opacity-50`}
                >
                  {testing
                    ? <Loader2 size={14} className="animate-spin" />
                    : tested === 'ok' ? <Check size={14} /> : <Globe size={14} />
                  }
                  {tested === 'ok' ? 'Connected' : tested === 'fail' ? 'Failed' : 'Test'}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#6b7280] bg-[#111111] rounded-lg px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
              Deployed on Railway · Supabase database
            </div>
          </div>
        </Section>

        {/* Appearance */}
        <Section title="Appearance" icon={Palette}>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'dark', label: 'Dark', description: 'Focused workspace for daily outreach', icon: Moon },
              { key: 'light', label: 'Light', description: 'Cleaner bright mode for daylight work', icon: Sun },
            ].map(option => {
              const Icon = option.icon;
              const active = theme === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTheme(option.key)}
                  className={`theme-option text-left rounded-xl border p-4 transition-all ${
                    active
                      ? 'border-[#6366f1] bg-[#6366f1]/10 shadow-lg shadow-indigo-500/10'
                      : 'border-[#2a2a2a] bg-[#111111] hover:border-[#6366f1]/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-[#6366f1]">
                      <Icon size={18} />
                    </div>
                    {active && <Check size={16} className="text-[#6366f1]" />}
                  </div>
                  <p className="text-white font-semibold text-sm">{option.label}</p>
                  <p className="text-[#6b7280] text-xs mt-1 leading-5">{option.description}</p>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Chrome Extension Executor */}
        <Section title="Chrome Extension Executor" icon={Puzzle}>
          <div className="space-y-4">
            <div className="rounded-xl border border-[#2a2a2a] bg-[#111111] p-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] flex items-center justify-center shrink-0 text-[#818cf8]">
                  <Puzzle size={22} />
                </div>
                <div>
                  <h3 className="text-white font-semibold">Use Chrome as the executor</h3>
                  <p className="text-[#9ca3af] text-sm mt-2 leading-5">
                    The extension pulls backend queue jobs using the LinkedIn session already logged into Chrome.
                    Campaigns, templates, ready queues, InMail workflow, and statuses stay unchanged.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Pair with profile</label>
              <select
                value={pairProfile}
                onChange={e => setPairProfile(e.target.value)}
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              >
                <option value="">Let extension create/select profile</option>
                {profiles.map(p => (
                  <option key={p.profile_key} value={p.profile_key}>
                    {p.display_name || p.profile_key} - {p.profile_key}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={generateExtensionToken}
                disabled={pairing}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white text-sm font-medium disabled:opacity-50"
              >
                {pairing ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                Generate Pairing Token
              </button>
              {pairToken?.expires_at && (
                <span className="text-xs text-[#6b7280]">
                  Expires {new Date(pairToken.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>

            {pairToken?.token && (
              <div className="rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-xs text-[#6b7280]">Paste this token into the LinkedFlow Chrome Extension popup</p>
                  <button
                    onClick={copyPairToken}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white text-xs"
                  >
                    <Copy size={12} /> Copy
                  </button>
                </div>
                <code className="block text-sm text-white font-mono break-all">{pairToken.token}</code>
              </div>
            )}

            <div className="flex items-center gap-3">
              <a
                href="/downloads/LinkedFlow-Chrome-Extension.zip"
                download="LinkedFlow-Chrome-Extension.zip"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#111111] border border-[#2a2a2a] hover:border-[#6366f1]/50 text-[#9ca3af] hover:text-white text-sm font-medium transition-all"
              >
                <Download size={15} />
                Download Chrome Extension ZIP
              </a>
            </div>

            <div className="rounded-xl border border-[#2a2a2a] bg-[#111111] p-4 text-sm text-[#9ca3af] leading-6">
              <p className="text-white font-medium mb-2">Setup steps</p>
              <ol className="list-decimal ml-5 space-y-1">
                <li>Download the ZIP above, unzip it to a folder on your computer.</li>
                <li>Open Chrome → <span className="font-mono text-[#c7d2fe]">chrome://extensions</span> → enable <span className="font-mono text-[#c7d2fe]">Developer mode</span> → click <span className="font-mono text-[#c7d2fe]">Load unpacked</span> → select the unzipped folder.</li>
                <li>Generate a pairing token here and paste it into the extension popup.</li>
                <li>Set the LinkedIn profile run mode to <span className="text-white">Chrome Extension</span>.</li>
                <li>Keep LinkedIn open/logged in. The extension will heartbeat and pull pending jobs.</li>
              </ol>
            </div>
          </div>
        </Section>

        {/* Sending Limits */}
        <Section title="Sending Limits" icon={Clock}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">
                Daily connection limit per profile
              </label>
              <div className="flex items-center gap-3">
                <input type="number" min={1} max={50} value={connLimit}
                  onChange={e => { setConnLimit(+e.target.value); setLimitsSaved(false); }}
                  className="w-24 bg-[#111111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm text-center focus:outline-none focus:border-[#6366f1]"
                />
                <span className="text-[#6b7280] text-sm">connections / day</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Min delay between connections', val: connMin, set: setConnMin },
                { label: 'Max delay between connections', val: connMax, set: setConnMax },
                { label: 'Min delay between messages',    val: msgMin,  set: setMsgMin  },
                { label: 'Max delay between messages',    val: msgMax,  set: setMsgMax  },
              ].map(f => (
                <div key={f.label}>
                  <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">{f.label}</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} max={60} value={f.val}
                      onChange={e => { f.set(+e.target.value); setLimitsSaved(false); }}
                      className="w-20 bg-[#111111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm text-center focus:outline-none focus:border-[#6366f1]"
                    />
                    <span className="text-[#6b7280] text-sm">min</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-[#6b7280]">
                Saved locally · queue creation is controlled by the cloud scheduler
              </p>
              <button
                onClick={saveLimits}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                  limitsSaved
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'bg-[#6366f1] text-white hover:bg-[#4f46e5]'
                }`}
              >
                {limitsSaved ? <Check size={12} /> : <Save size={12} />}
                {limitsSaved ? 'Saved' : 'Save Limits'}
              </button>
            </div>
          </div>
        </Section>

        {/* Scheduler Status */}
        <Section title="Scheduler Status" icon={Activity}>
          <div className="space-y-2.5">
            {schedule.map(s => {
              const task      = tasksToday[s.key];
              const isRunning = !!running[s.key];

              let badge, badgeClass;
              if (!s.enabled) {
                badge      = 'Disabled';
                badgeClass = 'text-[#4b5563] bg-[#111111] border-[#2a2a2a]';
              } else if (task?.status === 'error') {
                badge      = '● Failed';
                badgeClass = 'text-red-400 bg-red-500/10 border-red-500/20';
              } else if (task?.status === 'ok') {
                badge      = '● Ran today';
                badgeClass = 'text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/20';
              } else {
                badge      = '● Scheduled';
                badgeClass = 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20';
              }

              return (
                <div key={s.key}
                  className="flex items-center gap-3 py-3 px-4 bg-[#111111] rounded-xl border border-[#2a2a2a]"
                >
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-white text-sm font-medium">{s.label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${badgeClass}`}>{badge}</span>
                      {task?.auto && (
                        <span className="text-xs text-[#818cf8]" title="Started automatically at login">⚡ auto</span>
                      )}
                    </div>
                    <p className="text-xs text-[#6b7280]">
                      {task
                        ? `Last run ${task.ranAt} — ${task.result}`
                        : s.enabled
                          ? `Scheduled for ${to12h(s.time)}`
                          : 'Not scheduled'
                      }
                    </p>
                  </div>

                  {/* Run Now button */}
                  <button
                    onClick={() => runTask(s.key, s.label)}
                    disabled={isRunning || !s.enabled}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                      transition-all border shrink-0
                      ${!s.enabled
                        ? 'opacity-30 cursor-not-allowed border-[#2a2a2a] text-[#4b5563] bg-transparent'
                        : isRunning
                          ? 'border-[#6366f1]/40 text-[#818cf8] bg-[#6366f1]/10 cursor-default'
                          : 'border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:border-[#3a3a3a] bg-[#0d0d0d] cursor-pointer'
                      }`}
                  >
                    {isRunning
                      ? <Loader2 size={11} className="animate-spin" />
                      : <Play size={11} />
                    }
                    {isRunning ? 'Running…' : 'Run now'}
                  </button>
                </div>
              );
            })}

            <p className="text-xs text-[#4b5563] px-1 pt-0.5">
              Status resets at midnight · Auto-triggered tasks show ⚡
            </p>
          </div>
        </Section>

        {/* Schedule — fully editable */}
        <Section title="Schedule" icon={Bell}>
          <div className="space-y-3">

            {/* Column headers */}
            <div className="flex items-center gap-3 px-4 pb-1">
              <div className="w-6 shrink-0" />
              <span className="flex-1 text-xs text-[#4b5563] font-medium">Task</span>
              <span className="text-xs text-[#4b5563] font-medium w-[100px] text-center">Time</span>
              <span className="text-xs text-[#4b5563] font-medium w-[72px] text-center"
                    title="Run this task automatically if its scheduled time has already passed when you open the dashboard (e.g. you turned the laptop on late)">
                Auto-start ⓘ
              </span>
            </div>

            {/* Time pickers */}
            {schedule.map(s => (
              <div key={s.key}
                className={`flex items-center gap-3 py-3 px-4 rounded-xl border transition-all ${
                  s.enabled
                    ? 'bg-[#111111] border-[#2a2a2a]'
                    : 'bg-[#0d0d0d] border-[#1e1e1e] opacity-50'
                }`}
              >
                {/* Enable/disable toggle */}
                <button
                  onClick={() => updateScheduleRow(s.key, 'enabled', !s.enabled)}
                  className="shrink-0 text-[#6b7280] hover:text-white transition-colors"
                  title={s.enabled ? 'Disable task' : 'Enable task'}
                >
                  {s.enabled
                    ? <ToggleRight size={22} className="text-[#6366f1]" />
                    : <ToggleLeft  size={22} />
                  }
                </button>

                {/* Label */}
                <span className={`flex-1 text-sm font-medium ${s.enabled ? 'text-white' : 'text-[#4b5563]'}`}>
                  {s.label}
                </span>

                {/* Time picker */}
                <div className="flex items-center gap-2 shrink-0 w-[100px] justify-end">
                  <input
                    type="time"
                    value={s.time}
                    disabled={!s.enabled}
                    onChange={e => updateScheduleRow(s.key, 'time', e.target.value)}
                    className={`bg-[#1a1a1a] border rounded-lg px-2 py-1.5 text-xs font-mono w-full
                      focus:outline-none transition-colors
                      ${s.enabled
                        ? 'border-[#2a2a2a] text-white focus:border-[#6366f1] cursor-pointer'
                        : 'border-[#1e1e1e] text-[#4b5563] cursor-not-allowed'
                      }`}
                    style={{ colorScheme: 'dark' }}
                  />
                </div>

                {/* Auto-start pill */}
                <div className="shrink-0 w-[72px] flex justify-center">
                  <button
                    disabled={!s.enabled}
                    onClick={() => updateScheduleRow(s.key, 'runOnStartup', !s.runOnStartup)}
                    title={
                      !s.enabled
                        ? 'Enable the task first'
                        : s.runOnStartup
                          ? 'Auto-start ON — will run if missed when laptop starts'
                          : 'Auto-start OFF — click to enable'
                    }
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold
                      transition-all border
                      ${!s.enabled
                        ? 'opacity-30 cursor-not-allowed bg-transparent border-[#2a2a2a] text-[#4b5563]'
                        : s.runOnStartup
                          ? 'bg-[#6366f1]/20 border-[#6366f1]/40 text-[#818cf8] cursor-pointer'
                          : 'bg-transparent border-[#2a2a2a] text-[#4b5563] hover:border-[#4b5563] hover:text-[#6b7280] cursor-pointer'
                      }`}
                  >
                    ⚡ {s.runOnStartup ? 'On' : 'Off'}
                  </button>
                </div>
              </div>
            ))}

            {/* Auto-start explanation */}
            <div className="flex items-start gap-2 px-1 pt-1">
              <span className="text-[#6366f1] text-sm">⚡</span>
              <p className="text-xs text-[#6b7280] leading-5">
                <span className="text-[#9ca3af] font-medium">Auto-start if missed</span>
                {' '}— when you open the dashboard and the scheduled time has already
                passed today, that task starts automatically. Useful if you come in late or
                turn your laptop on after the scheduled hour.
              </p>
            </div>

            {/* Save + copy row */}
            <div className="flex items-center justify-between pt-2 gap-3">
              <button
                onClick={copyCommands}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium border border-[#2a2a2a] bg-[#111111] text-[#9ca3af] hover:text-white hover:border-[#3a3a3a] transition-all"
              >
                <Copy size={12} /> Copy scheduler commands
              </button>
              <button
                onClick={saveSchedule}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                  scheduleSaved
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'bg-[#6366f1] text-white hover:bg-[#4f46e5]'
                }`}
              >
                {scheduleSaved ? <Check size={12} /> : <Save size={12} />}
                {scheduleSaved ? 'Saved' : 'Save Schedule'}
              </button>
            </div>

            {/* Generated commands preview */}
            <div className="mt-1">
              <p className="text-xs text-[#6b7280] mb-2">
                Optional local machine commands (cloud schedule remains source of truth):
              </p>
              <pre className="bg-[#0d0d0d] border border-[#1e1e1e] rounded-xl px-4 py-3 text-xs text-[#6b7280] font-mono overflow-x-auto whitespace-pre-wrap leading-5">
                {buildCommands()}
              </pre>
            </div>
          </div>
        </Section>

        {/* Password */}
        <Section title="Change Password" icon={Shield}>
          <form onSubmit={changePw} className="space-y-3">
            {[
              { label: 'Current password',     val: oldPw,  set: setOldPw  },
              { label: 'New password',          val: newPw,  set: setNewPw  },
              { label: 'Confirm new password',  val: confPw, set: setConfPw },
            ].map(f => (
              <div key={f.label}>
                <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">{f.label}</label>
                <input type="password" value={f.val} onChange={e => f.set(e.target.value)}
                  className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                />
              </div>
            ))}
            <button type="submit" disabled={!oldPw || !newPw || !confPw}
              className="px-5 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
              Update Password
            </button>
          </form>
        </Section>

      </div>
    </Layout>
  );
}
