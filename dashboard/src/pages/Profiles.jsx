import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Briefcase,
  Cloud,
  Globe2,
  Loader2,
  Plus,
  Server,
  ToggleLeft,
  ToggleRight,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { useApp } from '../context/AppContext';
import { createProfile, getJobs, updateProfile } from '../services/api';

const DAILY_LIMIT = 25;

function timeAgo(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusColor(status) {
  if (status === 'completed') return 'text-[#22c55e]';
  if (status === 'failed') return 'text-[#ef4444]';
  if (['pending', 'retrying'].includes(status)) return 'text-[#f59e0b]';
  if (['claimed', 'running'].includes(status)) return 'text-[#6366f1]';
  return 'text-[#9ca3af]';
}

export default function Profiles() {
  const { profiles, fetchProfiles } = useApp();
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(false);
  const [key, setKey] = useState('profile_1');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState({});
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    getJobs({ limit: 250 }).then(d => setJobs(d.jobs || [])).catch(() => {});
  }, []);

  const jobStats = useMemo(() => {
    const active = ['pending', 'retrying', 'claimed', 'running'];
    return {
      pending: jobs.filter(j => active.includes(j.status)).length,
      running: jobs.filter(j => ['claimed', 'running'].includes(j.status)).length,
      failed: jobs.filter(j => j.status === 'failed').length,
      online: profiles.filter(p => p.session_active).length,
    };
  }, [jobs, profiles]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createProfile({ profile_key: key, display_name: name });
      toast.success(`Profile ${key} added`);
      setModal(false);
      setKey('profile_1');
      setName('');
      fetchProfiles();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (profile) => {
    setToggling(t => ({ ...t, [profile.profile_key]: true }));
    try {
      const nextEnabled = !(profile.enabled ?? true);
      await updateProfile(profile.profile_key, { enabled: nextEnabled });
      toast.success(`${profile.profile_key} ${nextEnabled ? 'enabled' : 'disabled'}`);
      fetchProfiles();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setToggling(t => ({ ...t, [profile.profile_key]: false }));
    }
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'accounts', label: 'Accounts' },
    { id: 'runtime', label: 'Runtime Options' },
  ];

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Profiles</h1>
          <p className="text-[#6b7280] text-sm mt-1">
            LinkedIn accounts, agent status, local runtime, proxies, and cloud runner options.
          </p>
        </div>
        <button
          onClick={() => setModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl font-medium text-sm transition-colors shadow-lg shadow-indigo-500/20"
        >
          <Plus size={16} /> Add Profile
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Online agents', value: jobStats.online, icon: Wifi, color: '#22c55e' },
          { label: 'Pending jobs', value: jobStats.pending, icon: Activity, color: '#6366f1' },
          { label: 'Running jobs', value: jobStats.running, icon: Server, color: '#f59e0b' },
          { label: 'Failed jobs', value: jobStats.failed, icon: AlertTriangle, color: '#ef4444' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[#6b7280] text-xs">{label}</p>
                <p className="text-white text-2xl font-bold mt-1">{value}</p>
              </div>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${color}18` }}>
                <Icon size={18} style={{ color }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1 mb-6 rounded-xl border border-[#2a2a2a] bg-[#111111] p-1 w-fit">
        {tabs.map(item => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === item.id ? 'bg-[#6366f1] text-white' : 'text-[#9ca3af] hover:text-white hover:bg-[#1a1a1a]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'runtime' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-[#6366f1]/15 flex items-center justify-center">
                <Cloud size={18} className="text-[#6366f1]" />
              </div>
              <div>
                <h2 className="text-white font-semibold">Run on Cloud</h2>
                <p className="text-[#6b7280] text-sm">Placeholder for future VPS/cloud execution.</p>
              </div>
            </div>
            <div className="rounded-lg border border-[#2a2a2a] bg-[#111111] p-4 text-sm text-[#9ca3af] leading-6">
              Current mode is local browser execution. Cloud mode will later let a Windows VPS keep the agent online without relying on this laptop.
            </div>
            <button disabled className="mt-4 px-4 py-2.5 rounded-xl border border-[#2a2a2a] text-[#6b7280] text-sm cursor-not-allowed">
              Configure Cloud Runner - Coming Soon
            </button>
          </div>

          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-[#22c55e]/15 flex items-center justify-center">
                <Globe2 size={18} className="text-[#22c55e]" />
              </div>
              <div>
                <h2 className="text-white font-semibold">Proxy Settings</h2>
                <p className="text-[#6b7280] text-sm">Per-account proxy support placeholder.</p>
              </div>
            </div>
            <div className="rounded-lg border border-[#2a2a2a] bg-[#111111] p-4 text-sm text-[#9ca3af] leading-6">
              Proxy assignment is not active yet. This area is reserved for future account-level proxy configuration and validation.
            </div>
            <button disabled className="mt-4 px-4 py-2.5 rounded-xl border border-[#2a2a2a] text-[#6b7280] text-sm cursor-not-allowed">
              Add Proxy - Coming Soon
            </button>
          </div>
        </div>
      ) : profiles.length === 0 ? (
        <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-16 text-center">
          <p className="text-[#6b7280] text-sm">No profiles yet. Add a LinkedIn profile to start sending.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {profiles.map(p => {
            const sent = p.daily_sent || 0;
            const pct = Math.min(100, (sent / DAILY_LIMIT) * 100);
            const online = p.session_active;
            const enabled = p.enabled ?? true;
            const profileJobs = jobs.filter(j => j.profile_key === p.profile_key);
            const activeJobs = profileJobs.filter(j => ['pending', 'retrying', 'claimed', 'running'].includes(j.status));
            const runningJob = profileJobs.find(j => ['claimed', 'running'].includes(j.status));
            const lastJob = profileJobs[0];

            return (
              <div key={p.profile_key} className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${online ? 'bg-[#22c55e] animate-pulse' : 'bg-[#4b5563]'}`} />
                      <h3 className="text-white font-semibold">{p.display_name || p.profile_key}</h3>
                    </div>
                    <p className="text-[#6b7280] text-xs ml-4">{p.profile_key}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    enabled ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-[#111111] text-[#6b7280] border-[#2a2a2a]'
                  }`}>
                    {enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-[#2a2a2a] bg-[#111111] p-3">
                    <p className="text-[#6b7280]">Agent</p>
                    <p className={`font-medium mt-1 ${online ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                      {online ? 'Online' : 'Offline'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#2a2a2a] bg-[#111111] p-3">
                    <p className="text-[#6b7280]">Heartbeat</p>
                    <p className="text-white font-medium mt-1">{timeAgo(p.last_active)}</p>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-[#6b7280] mb-2">
                    <span>Daily usage</span>
                    <span className="font-medium text-white">{sent} / {DAILY_LIMIT}</span>
                  </div>
                  <div className="h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#6366f1',
                      }}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-[#2a2a2a] bg-[#111111] p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[#6b7280]">Pending jobs</span>
                    <span className="text-white">{activeJobs.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#6b7280]">Current job</span>
                    <span className="text-white truncate max-w-[150px]">{runningJob?.job_type || 'None'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#6b7280]">Last job</span>
                    <span className={`font-medium ${statusColor(lastJob?.status)}`}>{lastJob?.status || 'None'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#6b7280]">Runtime</span>
                    <span className="text-white flex items-center gap-1"><Briefcase size={12} /> Local</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#6b7280]">Cloud / proxy</span>
                    <span className="text-[#6b7280]">Coming soon</span>
                  </div>
                </div>

                <button
                  onClick={() => toggleActive(p)}
                  disabled={toggling[p.profile_key]}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#2a2a2a] hover:border-[#3a3a3a] text-sm text-[#9ca3af] hover:text-white transition-all disabled:opacity-50"
                >
                  {toggling[p.profile_key]
                    ? <Loader2 size={14} className="animate-spin" />
                    : enabled
                      ? <ToggleRight size={16} className="text-[#22c55e]" />
                      : <ToggleLeft size={16} />
                  }
                  {enabled ? 'Disable Profile' : 'Enable Profile'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[#2a2a2a] bg-[#111111] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">Add LinkedIn Profile</h2>
              <button onClick={() => setModal(false)} className="text-[#6b7280] hover:text-white"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Profile Key</label>
                <select value={key} onChange={e => setKey(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[#6366f1]">
                  {['profile_1','profile_2','profile_3','profile_4','profile_5'].map(k => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Display Name</label>
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. John Smith"
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1]"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-[#2a2a2a] text-[#9ca3af] hover:text-white text-sm font-medium">
                  Cancel
                </button>
                <button type="submit" disabled={loading || !name.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white text-sm font-medium disabled:opacity-50">
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  Add Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
