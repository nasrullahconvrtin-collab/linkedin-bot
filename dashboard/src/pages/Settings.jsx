import { useState, useEffect } from 'react';
import {
  Clock, Shield, Save, Check, Moon, Sun, Palette,
  ToggleLeft, ToggleRight, Sliders, Calendar, Zap, Sparkles, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { useApp } from '../context/AppContext';
import {
  directGetAppSettings,
  directSaveAppSettings,
  DEFAULT_APP_SETTINGS,
} from '../services/directServices';

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
  const { theme, setTheme } = useApp();

  // Settings State
  const [settings, setSettings] = useState(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
          <h1 className="text-white text-2xl font-bold">Automation Settings</h1>
          <p className="text-[#6b7280] text-sm mt-1">Configure action limits, working hours, timezones, and LinkedIn safety practices.</p>
        </div>
        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg ${
            saved
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-[#6366f1] hover:bg-[#4f46e5] text-white shadow-indigo-500/20'
          } disabled:opacity-50`}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <Save size={16} />}
          {saved ? 'Settings Saved' : 'Save All Settings'}
        </button>
      </div>

      <div className="max-w-3xl space-y-6">

        {/* 1. Action-Specific Daily Limits */}
        <Section
          title="Daily Activity & Safety Limits"
          icon={Sliders}
          description="Specify daily limit quotas for each action type following LinkedIn safety practices."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Connection Requests Limit */}
            <div className="p-4 rounded-xl border border-[#2a2a2a] bg-[#111111] space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-white">Connection Requests</label>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">Max 25/day safe</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={settings.daily_connection_limit}
                  onChange={e => handleChange('daily_connection_limit', Number(e.target.value))}
                  className="w-24 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm text-center font-bold focus:outline-none focus:border-[#6366f1]"
                />
                <span className="text-xs text-[#6b7280]">invites / day per profile</span>
              </div>
            </div>

            {/* Messages Limit */}
            <div className="p-4 rounded-xl border border-[#2a2a2a] bg-[#111111] space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-white">Messages & Follow-ups</label>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">Max 40/day safe</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={settings.daily_message_limit}
                  onChange={e => handleChange('daily_message_limit', Number(e.target.value))}
                  className="w-24 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm text-center font-bold focus:outline-none focus:border-[#6366f1]"
                />
                <span className="text-xs text-[#6b7280]">messages / day per profile</span>
              </div>
            </div>

            {/* Profile Visits Limit */}
            <div className="p-4 rounded-xl border border-[#2a2a2a] bg-[#111111] space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-white">Profile Visits / Views</label>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">Max 50/day safe</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={settings.daily_visit_limit}
                  onChange={e => handleChange('daily_visit_limit', Number(e.target.value))}
                  className="w-24 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm text-center font-bold focus:outline-none focus:border-[#6366f1]"
                />
                <span className="text-xs text-[#6b7280]">visits / day per profile</span>
              </div>
            </div>

            {/* Profile Follows Limit */}
            <div className="p-4 rounded-xl border border-[#2a2a2a] bg-[#111111] space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-white">Profile Follows</label>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">Max 30/day safe</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={settings.daily_follow_limit}
                  onChange={e => handleChange('daily_follow_limit', Number(e.target.value))}
                  className="w-24 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm text-center font-bold focus:outline-none focus:border-[#6366f1]"
                />
                <span className="text-xs text-[#6b7280]">follows / day per profile</span>
              </div>
            </div>

          </div>
        </Section>

        {/* 2. Working Hours & Timezone */}
        <Section
          title="Working Hours & Timezone Schedule"
          icon={Calendar}
          description="Restrict automated campaign actions to execute only during business hours in your target timezone."
        >
          <div className="space-y-4">
            
            {/* Enable Working Hours Toggle */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-[#2a2a2a] bg-[#111111]">
              <div>
                <p className="text-sm font-semibold text-white">Enable Working Hours Restriction</p>
                <p className="text-xs text-[#6b7280] mt-0.5">When active, actions only execute during specified business hours.</p>
              </div>
              <button
                type="button"
                onClick={() => handleChange('enable_working_hours', !settings.enable_working_hours)}
                className="text-[#6366f1] hover:opacity-80 transition-opacity"
              >
                {settings.enable_working_hours ? <ToggleRight size={32} className="text-[#6366f1]" /> : <ToggleLeft size={32} className="text-[#4b5563]" />}
              </button>
            </div>

            {/* Timezone Selection */}
            <div>
              <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Target Workspace Timezone</label>
              <select
                value={settings.timezone}
                onChange={e => handleChange('timezone', e.target.value)}
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              >
                {TIMEZONE_OPTIONS.map(tz => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>

            {/* Working Hours Pickers */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Start Time (Business Hours)</label>
                <input
                  type="time"
                  value={settings.start_time}
                  onChange={e => handleChange('start_time', e.target.value)}
                  className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">End Time (Business Hours)</label>
                <input
                  type="time"
                  value={settings.end_time}
                  onChange={e => handleChange('end_time', e.target.value)}
                  className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
            </div>

            {/* Skip Weekends Toggle */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-[#2a2a2a] bg-[#111111]">
              <div>
                <p className="text-sm font-semibold text-white">Skip Weekends (Saturday & Sunday)</p>
                <p className="text-xs text-[#6b7280] mt-0.5">Automatically pause outreach on Saturdays and Sundays.</p>
              </div>
              <button
                type="button"
                onClick={() => handleChange('skip_weekends', !settings.skip_weekends)}
                className="text-[#6366f1] hover:opacity-80 transition-opacity"
              >
                {settings.skip_weekends ? <ToggleRight size={32} className="text-[#6366f1]" /> : <ToggleLeft size={32} className="text-[#4b5563]" />}
              </button>
            </div>

          </div>
        </Section>

        {/* 3. Humanization & Safety Controls */}
        <Section
          title="Humanization & Anti-Ban Safeguards"
          icon={Sparkles}
          description="Advanced realistic behavior patterns to protect your connected LinkedIn accounts."
        >
          <div className="space-y-4">
            
            {/* Random Jitter Toggle */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-[#2a2a2a] bg-[#111111]">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white">Randomized Action Spacing (Jitter)</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">Recommended</span>
                </div>
                <p className="text-xs text-[#6b7280] mt-0.5">Adds a random delay of 45s to 120s between actions so activity never looks like a fixed clock timer.</p>
              </div>
              <button
                type="button"
                onClick={() => handleChange('random_jitter', !settings.random_jitter)}
                className="text-[#6366f1] hover:opacity-80 transition-opacity"
              >
                {settings.random_jitter ? <ToggleRight size={32} className="text-[#6366f1]" /> : <ToggleLeft size={32} className="text-[#4b5563]" />}
              </button>
            </div>

            {/* Auto Ramp Up Warmup Toggle */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-[#2a2a2a] bg-[#111111]">
              <div>
                <p className="text-sm font-semibold text-white">Automatic Warm-Up Schedule</p>
                <p className="text-xs text-[#6b7280] mt-0.5">Gradually ramps up daily connection limits for new campaigns (starting at 5/day up to max).</p>
              </div>
              <button
                type="button"
                onClick={() => handleChange('auto_warmup', !settings.auto_warmup)}
                className="text-[#6366f1] hover:opacity-80 transition-opacity"
              >
                {settings.auto_warmup ? <ToggleRight size={32} className="text-[#6366f1]" /> : <ToggleLeft size={32} className="text-[#4b5563]" />}
              </button>
            </div>

            {/* Background Runner Interval Selection */}
            <div>
              <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Background Flow Runner Execution Frequency</label>
              <select
                value={settings.runner_interval_ms || 60000}
                onChange={e => handleChange('runner_interval_ms', Number(e.target.value))}
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              >
                <option value={30000}>Every 30 seconds (Fast testing mode)</option>
                <option value={60000}>Every 1 minute (Recommended for production)</option>
                <option value={120000}>Every 2 minutes (Ultra-safe mode)</option>
                <option value={300000}>Every 5 minutes (Conservative mode)</option>
              </select>
            </div>

          </div>
        </Section>

        {/* 4. Appearance */}
        <Section title="Appearance" icon={Palette} description="Customize workspace visual mode.">
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'dark', label: 'Dark Mode', description: 'Sleek dark mode interface for daily work', icon: Moon },
              { key: 'light', label: 'Light Mode', description: 'Clean bright interface for daylight use', icon: Sun },
            ].map(option => {
              const Icon = option.icon;
              const active = theme === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTheme(option.key)}
                  className={`text-left rounded-xl border p-4 transition-all ${
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

        {/* 5. Password Security */}
        <Section title="Dashboard Password Security" icon={Shield} description="Update your access password for this dashboard.">
          <form onSubmit={changePw} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Current Password</label>
              <input
                type="password"
                value={oldPw}
                onChange={e => setOldPw(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">New Password</label>
              <input
                type="password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Confirm New Password</label>
              <input
                type="password"
                value={confPw}
                onChange={e => setConfPw(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
            <button
              type="submit"
              disabled={!oldPw || !newPw || !confPw}
              className="px-5 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50"
            >
              Update Password
            </button>
          </form>
        </Section>

      </div>
    </Layout>
  );
}
