import { useState, useEffect } from 'react';
import {
  Clock, Shield, Save, Check, Moon, Sun, Palette,
  ToggleLeft, ToggleRight, Sliders, Calendar, Zap, Sparkles, Loader2,
  Lock, Globe, Code, Key, ExternalLink, LogOut, CheckCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { useApp } from '../context/AppContext';
import {
  directGetAppSettings,
  directSaveAppSettings,
  DEFAULT_APP_SETTINGS,
  supabaseDirect,
  directDisconnectProfile,
} from '../services/directServices';
import {
  connectUnipileCookie,
  connectUnipileDirect,
  createProfile,
  submitUnipile2FA,
} from '../services/api';

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Karachi', label: 'Asia/Karachi (PKT - UTC+5)' },
  { value: 'America/New_York', label: 'America/New_York (EST/EDT - UTC-5)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST/CDT - UTC-6)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST/PDT - UTC-8)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST - UTC+0)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST - UTC+1)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST - UTC+4)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST - UTC+5:30)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT - UTC+8)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST - UTC+10)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
];

function Section({ title, icon: Icon, description, children }) {
  return (
    <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 shadow-xl space-y-4">
      <div className="flex items-center gap-3 border-b border-[#2a2a2a] pb-4">
        <div className="w-10 h-10 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 flex items-center justify-center text-[#6366f1]">
          <Icon size={20} />
        </div>
        <div>
          <h2 className="text-white font-bold text-base">{title}</h2>
          {description && <p className="text-[#6b7280] text-xs mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function Settings() {
  const { profiles, fetchProfiles } = useApp();

  // Settings State
  const [settings, setSettings] = useState(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // LinkedIn Connection State
  const [connMethod, setConnMethod] = useState('direct'); // direct | cookie | account_id | hosted
  const [directEmail, setDirectEmail] = useState('');
  const [directPassword, setDirectPassword] = useState('');
  const [cookieVal, setCookieVal] = useState('');
  const [existingAccId, setExistingAccId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [connLoading, setConnLoading] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Password State
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confPw, setConfPw] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      const data = await directGetAppSettings();
      setSettings(data);
      setLoading(false);
    }
    load();
  }, []);

  const isConnected = profiles && profiles.length > 0;
  const activeProfile = profiles[0] || null;

  const handleChange = (field, value) => {
    setSettings(prev => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await directSaveAppSettings(settings);
      setSaved(true);
      toast.success('Settings saved and synced to database successfully!');
    } catch (err) {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Connection Handlers
  const handleConnectDirect = async (e) => {
    e.preventDefault();
    setConnLoading(true);
    try {
      const res = await connectUnipileDirect({ username: directEmail, password: directPassword });
      if (res.success) {
        toast.success(`LinkedIn account connected successfully!`);
        fetchProfiles();
      } else {
        toast.error(res.error || 'Direct connection failed');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConnLoading(false);
    }
  };

  const handleConnectCookie = async (e) => {
    e.preventDefault();
    setConnLoading(true);
    try {
      const res = await connectUnipileCookie(cookieVal);
      if (res.success) {
        toast.success('LinkedIn profile connected via session cookie!');
        fetchProfiles();
      } else {
        toast.error(res.error || 'Cookie connection failed');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConnLoading(false);
    }
  };

  const handleConnectAccountId = async (e) => {
    e.preventDefault();
    if (!existingAccId.trim()) return toast.error('Account ID is required');
    setConnLoading(true);
    try {
      await supabaseDirect.from('profiles').upsert([{
        profile_key: 'profile_1',
        display_name: displayName || 'Fatima Maqsood',
        unipile_account_id: existingAccId,
        session_active: true,
        updated_at: new Date().toISOString(),
      }]);
      await createProfile({
        profile_key: 'profile_1',
        display_name: displayName || 'Fatima Maqsood',
        unipile_account_id: existingAccId,
        session_active: true,
      });
      toast.success(`LinkedIn Account (${displayName || 'Fatima Maqsood'}) connected & saved!`);
      await fetchProfiles();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConnLoading(false);
    }
  };

  const handleDisconnectAccount = async () => {
    if (!confirm('Are you sure you want to disconnect your LinkedIn account?')) return;
    setRemoving(true);
    try {
      await directDisconnectProfile();
      toast.success('LinkedIn account disconnected');
      setExistingAccId('');
      setDisplayName('');
      await fetchProfiles();
    } catch (err) {
      toast.error('Failed to disconnect account');
    } finally {
      setRemoving(false);
    }
  };

  const changePw = (e) => {
    e.preventDefault();
    const stored = localStorage.getItem('lf_pw_override');
    const envPw = (import.meta.env.VITE_APP_PASSWORD || '').replace(/^﻿/, '').trim();
    const current = stored || envPw || 'admin123';
    if (oldPw !== current) { toast.error('Current password is incorrect'); return; }
    if (newPw !== confPw) { toast.error('New passwords do not match'); return; }
    if (newPw.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    localStorage.setItem('lf_pw_override', newPw);
    toast.success('Dashboard password updated!');
    setOldPw(''); setNewPw(''); setConfPw('');
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="animate-spin text-[#6366f1]" size={32} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Settings & LinkedIn Account Connection</h1>
          <p className="text-[#6b7280] text-sm mt-1">Connect your LinkedIn profile, set daily limits, and manage app preferences.</p>
        </div>
        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-xs rounded-xl shadow-lg transition-all disabled:opacity-50 self-start sm:self-auto"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save All Settings
        </button>
      </div>

      <div className="space-y-6">

        {/* ── LINKEDIN ACCOUNT CONNECTION SECTION ───────────────────────────── */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 shadow-xl space-y-6">
          <div className="flex items-center justify-between border-b border-[#2a2a2a] pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 flex items-center justify-center text-[#6366f1]">
                <Globe size={20} />
              </div>
              <div>
                <h2 className="text-white font-bold text-base">LinkedIn Account Connection</h2>
                <p className="text-[#6b7280] text-xs mt-0.5">Pair your LinkedIn profile using any of the 4 authentication methods below.</p>
              </div>
            </div>

            {isConnected && (
              <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Profile Connected ({activeProfile?.display_name || 'Fatima Maqsood'})
              </span>
            )}
          </div>

          {isConnected ? (
            <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="text-emerald-400" size={24} />
                <div>
                  <p className="text-white font-bold text-sm">{activeProfile?.display_name || 'Fatima Maqsood'}</p>
                  <p className="text-emerald-400/80 text-xs mt-0.5">LinkedIn Profile Connected and Ready for Automation</p>
                </div>
              </div>
              <button
                onClick={handleDisconnectAccount}
                disabled={removing}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold rounded-xl transition-all disabled:opacity-50"
              >
                {removing ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                Disconnect Account
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Connection Method Tabs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-[#111111] p-1.5 rounded-2xl border border-[#2a2a2a] max-w-2xl mx-auto">
                <button
                  onClick={() => setConnMethod('direct')}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    connMethod === 'direct' ? 'bg-[#6366f1] text-white shadow-md' : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  <Lock size={14} /> Direct Login
                </button>

                <button
                  onClick={() => setConnMethod('hosted')}
                  className={`py-2.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    connMethod === 'hosted' ? 'bg-[#6366f1] text-white shadow-md' : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  <Globe size={14} /> Hosted OAuth Page
                </button>

                <button
                  onClick={() => setConnMethod('cookie')}
                  className={`py-2.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    connMethod === 'cookie' ? 'bg-[#6366f1] text-white shadow-md' : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  <Code size={14} /> Session Cookie
                </button>

                <button
                  onClick={() => setConnMethod('account_id')}
                  className={`py-2.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    connMethod === 'account_id' ? 'bg-[#6366f1] text-white shadow-md' : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  <Key size={14} /> Account ID & Name
                </button>
              </div>

              {/* Connection Form Container */}
              <div className="max-w-md mx-auto bg-[#111111] border border-[#2a2a2a] rounded-2xl p-6 shadow-xl">
                {connMethod === 'direct' && (
                  <form onSubmit={handleConnectDirect} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">LinkedIn Email / Username</label>
                      <input
                        type="text"
                        value={directEmail}
                        onChange={e => setDirectEmail(e.target.value)}
                        placeholder="yourname@domain.com"
                        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">LinkedIn Password</label>
                      <input
                        type="password"
                        value={directPassword}
                        onChange={e => setDirectPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={connLoading || !directEmail || !directPassword}
                      className="w-full py-3 bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-xs rounded-xl transition-all disabled:opacity-50 shadow-lg shadow-indigo-500/20"
                    >
                      {connLoading ? 'Connecting...' : 'Connect LinkedIn Account'}
                    </button>
                  </form>
                )}

                {connMethod === 'hosted' && (
                  <div className="space-y-4 text-center">
                    <p className="text-[#9ca3af] text-xs leading-relaxed">
                      Click below to open the official hosted OAuth login page. Authorize your LinkedIn profile securely.
                    </p>
                    <a
                      href="https://api20.unipile.com:15032/api/v1/hosted/accounts/link"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-2 w-full py-3 bg-[#0a66c2] hover:bg-[#084e96] text-white font-bold text-xs rounded-xl transition-all shadow-lg"
                    >
                      <ExternalLink size={15} /> Open Hosted LinkedIn Login Page
                    </a>
                  </div>
                )}

                {connMethod === 'cookie' && (
                  <form onSubmit={handleConnectCookie} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">LinkedIn Session Cookie (li_at)</label>
                      <textarea
                        rows={3}
                        value={cookieVal}
                        onChange={e => setCookieVal(e.target.value)}
                        placeholder="AQEDAT..."
                        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-2 text-white text-xs font-mono focus:outline-none focus:border-[#6366f1]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={connLoading || !cookieVal.trim()}
                      className="w-full py-3 bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-xs rounded-xl transition-all disabled:opacity-50 shadow-lg shadow-indigo-500/20"
                    >
                      {connLoading ? 'Connecting...' : 'Connect via Session Cookie'}
                    </button>
                  </form>
                )}

                {connMethod === 'account_id' && (
                  <form onSubmit={handleConnectAccountId} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">Profile Display Name</label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        placeholder="Fatima Maqsood"
                        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">LinkedIn Account ID</label>
                      <input
                        type="text"
                        value={existingAccId}
                        onChange={e => setExistingAccId(e.target.value)}
                        placeholder="zXneBg9WRZ-m7iFuKULo1Q"
                        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-[#6366f1]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={connLoading || !existingAccId.trim()}
                      className="w-full py-3 bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-xs rounded-xl transition-all disabled:opacity-50 shadow-lg shadow-indigo-500/20"
                    >
                      {connLoading ? 'Saving...' : 'Save & Connect Account'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── DAILY ACTION LIMITS ───────────────────────────────────────────── */}
        <Section title="Daily Action Limits" icon={Zap} description="Set daily safety limits for outbound automation tasks.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">Daily Connection Requests</label>
              <input
                type="number"
                min={1}
                max={100}
                value={settings.daily_connection_limit}
                onChange={e => handleChange('daily_connection_limit', Number(e.target.value))}
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">Daily Messages Sent</label>
              <input
                type="number"
                min={1}
                max={200}
                value={settings.daily_message_limit}
                onChange={e => handleChange('daily_message_limit', Number(e.target.value))}
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">Daily Profile Visits</label>
              <input
                type="number"
                min={1}
                max={200}
                value={settings.daily_visit_limit}
                onChange={e => handleChange('daily_visit_limit', Number(e.target.value))}
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">Daily Profile Follows</label>
              <input
                type="number"
                min={1}
                max={100}
                value={settings.daily_follow_limit}
                onChange={e => handleChange('daily_follow_limit', Number(e.target.value))}
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
          </div>
        </Section>

        {/* ── WORKING HOURS & TIMEZONE ───────────────────────────────────────── */}
        <Section title="Working Schedule & Timezone" icon={Clock} description="Restrict automated activity to your local timezone and business hours.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">Timezone</label>
              <select
                value={settings.timezone}
                onChange={e => handleChange('timezone', e.target.value)}
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              >
                {TIMEZONE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">Skip Weekends</label>
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleChange('skip_weekends', !settings.skip_weekends)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.skip_weekends ? 'bg-[#6366f1]' : 'bg-[#2a2a2a]'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.skip_weekends ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-white text-xs font-medium">
                  {settings.skip_weekends ? 'Paused on Saturdays & Sundays' : 'Run 7 days a week'}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">Start Working Hour</label>
              <input
                type="time"
                value={settings.start_time}
                onChange={e => handleChange('start_time', e.target.value)}
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                style={{ colorScheme: 'dark' }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">End Working Hour</label>
              <input
                type="time"
                value={settings.end_time}
                onChange={e => handleChange('end_time', e.target.value)}
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                style={{ colorScheme: 'dark' }}
              />
            </div>
          </div>
        </Section>

        {/* ── SECURITY & PASSWORD ────────────────────────────────────────────── */}
        <Section title="Dashboard Security" icon={Shield} description="Update your dashboard password for administrative access.">
          <form onSubmit={changePw} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">Current Password</label>
              <input
                type="password"
                value={oldPw}
                onChange={e => setOldPw(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">New Password</label>
              <input
                type="password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">Confirm New Password</label>
              <input
                type="password"
                value={confPw}
                onChange={e => setConfPw(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
            <div className="md:col-span-3 pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 bg-[#2a2a2a] hover:bg-[#333333] text-white text-xs font-bold rounded-xl transition-all"
              >
                Update Password
              </button>
            </div>
          </form>
        </Section>
      </div>
    </Layout>
  );
}
