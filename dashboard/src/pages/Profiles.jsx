import { useEffect, useState } from 'react';
import { Plus, X, Loader2, Wifi, WifiOff, ToggleLeft, ToggleRight } from 'lucide-react';
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
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Profiles() {
  const { profiles, fetchProfiles } = useApp();
  const [modal,   setModal]   = useState(false);
  const [key,     setKey]     = useState('profile_1');
  const [name,    setName]    = useState('');
  const [loading, setLoading] = useState(false);
  const [toggling,setToggling]= useState({});
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    getJobs({ limit: 200 }).then(d => setJobs(d.jobs || [])).catch(() => {});
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createProfile({ profile_key: key, display_name: name });
      toast.success(`Profile ${key} added`);
      setModal(false); setKey('profile_1'); setName('');
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
      await updateProfile(profile.profile_key, { enabled: !(profile.enabled ?? true) });
      toast.success(`${profile.profile_key} ${!(profile.enabled ?? true) ? 'enabled' : 'disabled'}`);
      fetchProfiles();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setToggling(t => ({ ...t, [profile.profile_key]: false }));
    }
  };

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">LinkedIn Profiles</h1>
          <p className="text-[#6b7280] text-sm mt-1">{profiles.length} profile{profiles.length !== 1 ? 's' : ''} configured</p>
        </div>
        <button
          onClick={() => setModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl font-medium text-sm transition-colors shadow-lg shadow-indigo-500/20"
        >
          <Plus size={16} /> Add Profile
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-16 text-center">
          <p className="text-[#6b7280] text-sm">No profiles yet. Add a LinkedIn profile to start sending.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map(p => {
            const sent = p.daily_sent || 0;
            const pct  = Math.min(100, (sent / DAILY_LIMIT) * 100);
            const active = p.session_active;
            const enabled = p.enabled ?? true;
            const profileJobs = jobs.filter(j => j.profile_key === p.profile_key);
            const pendingJobs = profileJobs.filter(j => ['pending', 'retrying', 'claimed', 'running'].includes(j.status)).length;
            const lastJob = profileJobs[0];
            return (
              <div key={p.profile_key}
                className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${active ? 'bg-[#22c55e] animate-pulse' : 'bg-[#4b5563]'}`} />
                      <h3 className="text-white font-semibold">{p.display_name || p.profile_key}</h3>
                    </div>
                    <p className="text-[#6b7280] text-xs ml-4">{p.profile_key}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    enabled
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-[#1a1a1a] text-[#6b7280] border-[#2a2a2a]'
                  }`}>
                    {enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                {/* Daily progress */}
                <div>
                  <div className="flex justify-between text-xs text-[#6b7280] mb-2">
                    <span>Daily connections</span>
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

                {/* Last active */}
                <div className="flex items-center gap-2 text-xs text-[#6b7280]">
                  {active ? <Wifi size={13} className="text-[#22c55e]" /> : <WifiOff size={13} />}
                  <span>Agent: {active ? 'Online' : 'Offline'} · Last heartbeat: {timeAgo(p.last_active)}</span>
                </div>
                <div className="text-xs text-[#6b7280]">
                  Pending jobs: <span className="text-white">{pendingJobs}</span>
                  {lastJob && <> · Last job: <span className="text-white">{lastJob.status}</span></>}
                </div>

                {/* Toggle */}
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

      {/* Add Profile Modal */}
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
                <input autoFocus value={name} onChange={e => setName(e.target.value)}
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
