import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Briefcase, Download, Edit3, ExternalLink,
  Key, KeyRound, Loader2, Lock, Mail, Plus, ShieldCheck,
  ToggleLeft, ToggleRight, Trash2, UserCheck, Users, Wifi, X, Clock, RefreshCw, CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { useApp } from '../context/AppContext';
import {
  cancelNetworkingInvitation,
  connectUnipileCookie,
  connectUnipileDirect,
  createProfile,
  deleteProfile,
  getJobs,
  getNetworkingConnections,
  getNetworkingInvitations,
  getUnipileAccountInfo,
  submitUnipile2FA,
  updateProfile,
  withdrawOldInvitations,
} from '../services/api';

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

function nextProfileKey(profiles) {
  const used = new Set((profiles || []).map(p => p.profile_key));
  for (let i = 1; i <= 99; i += 1) {
    const key = `profile_${i}`;
    if (!used.has(key)) return key;
  }
  return `profile_${Date.now()}`;
}

export default function Profiles() {
  const { profiles, fetchProfiles } = useApp();
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(false);
  const [connMethod, setConnMethod] = useState('direct'); // direct | cookie | account_id | extension

  // Login form state
  const [directEmail, setDirectEmail] = useState('');
  const [directPassword, setDirectPassword] = useState('');
  const [cookieVal, setCookieVal] = useState('');
  const [existingAccId, setExistingAccId] = useState('bBzuBoeOQAuBCQNFu7shyQ');
  const [extKey, setExtKey] = useState('profile_1');
  const [displayName, setDisplayName] = useState('');

  // 2FA Checkpoint state
  const [checkpointReq, setCheckpointReq] = useState(false);
  const [checkpointAccId, setCheckpointAccId] = useState('');
  const [twoFACode, setTwoFACode] = useState('');

  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState({});
  const [jobs, setJobs] = useState([]);

  // Network tab state
  const [accountInfo, setAccountInfo] = useState(null);
  const [connections, setConnections] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [withdrawAge, setWithdrawAge] = useState(90); // 7 | 30 | 60 | 90
  const [netLoading, setNetLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  useEffect(() => {
    getJobs({ limit: 250 }).then(d => setJobs(d.jobs || [])).catch(() => {});
  }, []);

  const loadNetworkData = async () => {
    setNetLoading(true);
    try {
      const [accRes, connRes, invRes] = await Promise.all([
        getUnipileAccountInfo().catch(() => null),
        getNetworkingConnections().catch(() => ({ connections: [] })),
        getNetworkingInvitations().catch(() => ({ invitations: [] })),
      ]);
      if (accRes) setAccountInfo(accRes);
      if (connRes?.connections) setConnections(connRes.connections);
      if (invRes?.invitations) setInvitations(invRes.invitations);
    } catch (err) {
      console.error('Failed loading network data:', err);
    } finally {
      setNetLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'network') {
      loadNetworkData();
    }
  }, [tab]);

  const jobStats = useMemo(() => {
    const active = ['pending', 'retrying', 'claimed', 'running'];
    return {
      pending: jobs.filter(j => active.includes(j.status)).length,
      running: jobs.filter(j => ['claimed', 'running'].includes(j.status)).length,
      failed: jobs.filter(j => j.status === 'failed').length,
      online: profiles.filter(p => p.session_active).length,
    };
  }, [jobs, profiles]);

  // Connect submission handlers
  const handleConnectDirect = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await connectUnipileDirect({ username: directEmail, password: directPassword });
      if (res.checkpoint_required) {
        setCheckpointReq(true);
        setCheckpointAccId(res.account_id || '');
        toast.error('2FA / Verification code required for LinkedIn');
      } else if (res.success) {
        toast.success(`LinkedIn account ${directEmail} connected via Unipile!`);
        setModal(false);
        fetchProfiles();
      } else {
        toast.error(res.error || 'Direct connection failed');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit2FA = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await submitUnipile2FA(checkpointAccId, twoFACode);
      if (res.success) {
        toast.success('2FA verification successful! LinkedIn account connected.');
        setCheckpointReq(false);
        setModal(false);
        fetchProfiles();
      } else {
        toast.error(res.error || 'Invalid 2FA code');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectCookie = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await connectUnipileCookie(cookieVal);
      if (res.success) {
        toast.success('LinkedIn profile connected via session cookie!');
        setModal(false);
        fetchProfiles();
      } else {
        toast.error(res.error || 'Cookie connection failed');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectAccountId = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createProfile({
        profile_key: extKey || 'profile_1',
        display_name: displayName || 'Maryam Ansar',
        unipile_account_id: existingAccId,
        session_active: true,
      });
      toast.success(`Connected Unipile Account ID (${existingAccId})!`);
      setModal(false);
      fetchProfiles();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectExtension = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createProfile({
        profile_key: extKey,
        display_name: displayName || extKey,
        run_mode: 'chrome_extension',
      });
      toast.success(`Profile ${extKey} added for Chrome Extension pairing`);
      setModal(false);
      fetchProfiles();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const removeProfile = async (profile) => {
    if (!confirm(`Delete ${profile.profile_key}?`)) return;
    try {
      await deleteProfile(profile.profile_key);
      toast.success('Profile deleted');
      fetchProfiles();
    } catch (e) {
      toast.error(e.message);
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

  // CSV Export for Connections
  const exportConnectionsCSV = () => {
    if (!connections || connections.length === 0) {
      return toast.error('No 1st-degree connections loaded to export');
    }

    const headers = ['first_name', 'last_name', 'name', 'headline', 'linkedin_url', 'provider_id'];
    const rows = connections.map(c => [
      c.first_name || c.name?.split(' ')[0] || '',
      c.last_name || c.name?.split(' ').slice(1).join(' ') || '',
      c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim(),
      `"${(c.headline || c.title || '').replace(/"/g, '""')}"`,
      c.public_profile_url || `https://www.linkedin.com/in/${c.public_identifier || c.member_id || c.id}`,
      c.member_id || c.provider_id || c.id || '',
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `linkedin_connections_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${connections.length} 1st-degree connections to CSV!`);
  };

  const handleWithdrawByAge = async () => {
    setWithdrawing(true);
    try {
      const res = await withdrawOldInvitations(withdrawAge);
      if (res.success) {
        toast.success(`Withdrew ${res.withdrawn_count} pending invitations older than ${withdrawAge} days!`);
        loadNetworkData();
      } else {
        toast.error(res.error || 'Failed to withdraw invitations');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setWithdrawing(false);
    }
  };

  const handleCancelSingleInvite = async (invId) => {
    try {
      const res = await cancelNetworkingInvitation(invId);
      if (res.success) {
        toast.success('Invitation withdrawn');
        setInvitations(prev => prev.filter(i => (i.id || i.invitation_id) !== invId));
      } else {
        toast.error(res.error || 'Failed to withdraw invitation');
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'accounts', label: 'Accounts' },
    { id: 'network', label: 'Network & Connections' },
  ];

  return (
    <Layout>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Profiles & Account Options</h1>
          <p className="text-[#6b7280] text-sm mt-1">
            Manage your connected LinkedIn profile, Unipile login options, network connections, and invitation withdrawal.
          </p>
        </div>
        <button
          onClick={() => { setCheckpointReq(false); setExtKey(nextProfileKey(profiles)); setModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl font-medium text-sm transition-colors shadow-lg shadow-indigo-500/20"
        >
          <Plus size={16} /> Add / Connect Account
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Online executors', value: jobStats.online, icon: Wifi, color: '#22c55e' },
          { label: 'Pending jobs', value: jobStats.pending, icon: Activity, color: '#6366f1' },
          { label: 'Running jobs', value: jobStats.running, icon: Briefcase, color: '#f59e0b' },
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

      {/* Tabs */}
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

      {/* ── TAB 3: NETWORK & CONNECTIONS ────────────────────────────────────────── */}
      {tab === 'network' ? (
        <div className="space-y-6">
          {/* Profile Header Info from Unipile */}
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#6366f1] to-purple-600 text-white font-bold text-xl flex items-center justify-center shadow-lg">
                {accountInfo?.name ? accountInfo.name[0] : 'M'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-white text-lg font-bold">{accountInfo?.name || 'Maryam Ansar'}</h2>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                    Connected Profile
                  </span>
                </div>
                <p className="text-[#9ca3af] text-xs mt-0.5">{accountInfo?.headline || 'LinkedIn Outreach Specialist'}</p>
                <p className="text-[#6b7280] text-xs font-mono mt-1">Unipile Account ID: {accountInfo?.id || 'bBzuBoeOQAuBCQNFu7shyQ'}</p>
              </div>
            </div>

            <button
              onClick={exportConnectionsCSV}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#22c55e] hover:bg-[#16a34a] text-white font-medium text-sm rounded-xl transition-all shadow-lg shadow-green-500/20"
            >
              <Download size={16} /> Export Connections CSV ({connections.length})
            </button>
          </div>

          {/* Pending Invitations Manager */}
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-white font-bold text-base flex items-center gap-2">
                  <Clock size={18} className="text-[#6366f1]" />
                  Pending Sent Invitations ({invitations.length})
                </h3>
                <p className="text-[#6b7280] text-xs mt-0.5">
                  Automatically track and withdraw old pending connection requests.
                </p>
              </div>

              {/* Age Selection & Withdraw Button */}
              <div className="flex items-center gap-3">
                <select
                  value={withdrawAge}
                  onChange={e => setWithdrawAge(Number(e.target.value))}
                  className="bg-[#111111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-xs font-medium focus:outline-none focus:border-[#6366f1]"
                >
                  <option value={7}>Older than 7 days</option>
                  <option value={30}>Older than 30 days</option>
                  <option value={60}>Older than 60 days</option>
                  <option value={90}>Older than 90 days</option>
                </select>

                <button
                  onClick={handleWithdrawByAge}
                  disabled={withdrawing}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-medium rounded-xl transition-all disabled:opacity-50"
                >
                  {withdrawing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Withdraw Pending
                </button>
              </div>
            </div>

            {invitations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#2a2a2a] bg-[#111111] p-8 text-center">
                <p className="text-[#6b7280] text-xs">No pending connection requests tracked.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#2a2a2a]">
                {invitations.map((inv, i) => {
                  const invId = inv.id || inv.invitation_id || `inv_${i}`;
                  return (
                    <div key={invId} className="py-3 flex items-center justify-between">
                      <div>
                        <p className="text-white text-xs font-semibold">{inv.recipient_name || inv.recipient_identifier || 'LinkedIn Member'}</p>
                        <p className="text-[#6b7280] text-xs mt-0.5">{inv.message || 'No personalized note'}</p>
                      </div>
                      <button
                        onClick={() => handleCancelSingleInvite(invId)}
                        className="text-xs text-red-400 hover:text-red-300 font-medium px-3 py-1 rounded-lg border border-red-500/20 bg-red-500/10"
                      >
                        Withdraw
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 1st-Degree Connections List */}
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-base flex items-center gap-2">
                <UserCheck size={18} className="text-[#22c55e]" />
                1st-Degree Connections Roster ({connections.length})
              </h3>
              <button onClick={loadNetworkData} className="text-xs text-[#9ca3af] hover:text-white flex items-center gap-1">
                <RefreshCw size={12} className={netLoading ? 'animate-spin' : ''} /> Refresh Roster
              </button>
            </div>

            {netLoading ? (
              <div className="p-8 text-center text-xs text-[#6b7280] animate-pulse">Loading connections from Unipile...</div>
            ) : connections.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#2a2a2a] bg-[#111111] p-8 text-center">
                <p className="text-[#6b7280] text-xs">No 1st-degree connections loaded yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {connections.map((c, idx) => {
                  const connId = c.id || c.provider_id || `conn_${idx}`;
                  return (
                    <div key={connId} className="p-3.5 rounded-xl border border-[#2a2a2a] bg-[#111111] flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[#6366f1]/20 text-[#6366f1] font-bold flex items-center justify-center text-sm shrink-0">
                        {(c.first_name || c.name || 'U')[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-white text-xs font-bold truncate">{c.name || `${c.first_name || ''} ${c.last_name || ''}`}</p>
                          {c.public_profile_url && (
                            <a href={c.public_profile_url} target="_blank" rel="noopener noreferrer" className="text-[#6366f1] hover:underline text-[10px] flex items-center gap-1">
                              LinkedIn <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                        <p className="text-[#9ca3af] text-[11px] truncate mt-0.5">{c.headline || c.title || '1st Degree Connection'}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : profiles.length === 0 ? (
        <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-16 text-center">
          <p className="text-[#6b7280] text-sm">No profiles yet. Add or connect a LinkedIn profile to start sending.</p>
        </div>
      ) : (
        /* Profiles Cards */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {profiles.map(p => {
            const sent = p.daily_sent || 0;
            const pct = Math.min(100, (sent / DAILY_LIMIT) * 100);
            const online = p.session_active;
            const enabled = p.enabled ?? true;
            const profileJobs = jobs.filter(j => j.profile_key === p.profile_key);

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
                    <p className="text-[#6b7280]">Status</p>
                    <p className={`font-medium mt-1 ${online ? 'text-[#22c55e]' : 'text-[#9ca3af]'}`}>
                      {online ? 'Connected' : 'Offline'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#2a2a2a] bg-[#111111] p-3">
                    <p className="text-[#6b7280]">Unipile Account ID</p>
                    <p className="text-white font-mono text-[10px] truncate mt-1">{p.unipile_account_id || 'bBzuBoeOQAuBCQNFu7shyQ'}</p>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-[#6b7280] mb-2">
                    <span>Daily usage</span>
                    <span className="font-medium text-white">{sent} / {DAILY_LIMIT}</span>
                  </div>
                  <div className="h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: '#6366f1' }} />
                  </div>
                </div>

                <button
                  onClick={() => toggleActive(p)}
                  disabled={toggling[p.profile_key]}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#2a2a2a] hover:border-[#3a3a3a] text-sm text-[#9ca3af] hover:text-white transition-all disabled:opacity-50"
                >
                  {toggling[p.profile_key] ? <Loader2 size={14} className="animate-spin" /> : enabled ? <ToggleRight size={16} className="text-[#22c55e]" /> : <ToggleLeft size={16} />}
                  {enabled ? 'Disable Profile' : 'Enable Profile'}
                </button>
                <button onClick={() => removeProfile(p)} className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-red-500/30 text-sm text-red-400 hover:bg-red-500/10">
                  <Trash2 size={14} /> Delete Profile
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── ADD / CONNECT ACCOUNT MODAL ─────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-[#2a2a2a] bg-[#111111] p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-white font-bold text-lg">Connect LinkedIn Account</h2>
                <p className="text-[#6b7280] text-xs mt-0.5">Select your preferred Unipile authentication option.</p>
              </div>
              <button onClick={() => setModal(false)} className="text-[#6b7280] hover:text-white"><X size={20} /></button>
            </div>

            {/* Connection Method Selector Tabs */}
            <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-xs font-medium">
              {[
                { id: 'direct', label: 'Direct Login' },
                { id: 'cookie', label: 'Cookie' },
                { id: 'account_id', label: 'Unipile ID' },
                { id: 'extension', label: 'Extension' },
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => { setConnMethod(m.id); setCheckpointReq(false); }}
                  className={`py-2 rounded-lg text-center transition-colors ${
                    connMethod === m.id ? 'bg-[#6366f1] text-white font-bold' : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Method 1: Direct Credentials Login */}
            {connMethod === 'direct' && (
              !checkpointReq ? (
                <form onSubmit={handleConnectDirect} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">LinkedIn Account Email</label>
                    <input
                      type="email"
                      required
                      value={directEmail}
                      onChange={e => setDirectEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">LinkedIn Password</label>
                    <input
                      type="password"
                      required
                      value={directPassword}
                      onChange={e => setDirectPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-sm transition-all disabled:opacity-50"
                  >
                    {loading && <Loader2 size={16} className="animate-spin" />}
                    Connect via Unipile Direct
                  </button>
                </form>
              ) : (
                /* 2FA Code Form */
                <form onSubmit={handleSubmit2FA} className="space-y-4">
                  <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs">
                    <p className="font-bold">2FA / Security Checkpoint Triggered</p>
                    <p className="mt-1 text-amber-400/90">LinkedIn sent a verification code to your email/phone. Enter it below to complete authorization.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">2FA / OTP Verification Code</label>
                    <input
                      type="text"
                      required
                      value={twoFACode}
                      onChange={e => setTwoFACode(e.target.value)}
                      placeholder="e.g. 123456"
                      className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm text-center tracking-widest font-mono focus:outline-none focus:border-[#6366f1]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#22c55e] hover:bg-[#16a34a] text-white font-bold text-sm transition-all disabled:opacity-50"
                  >
                    {loading && <Loader2 size={16} className="animate-spin" />}
                    Submit 2FA Code
                  </button>
                </form>
              )
            )}

            {/* Method 2: Cookie Login */}
            {connMethod === 'cookie' && (
              <form onSubmit={handleConnectCookie} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">LinkedIn li_at Session Cookie</label>
                  <textarea
                    rows={3}
                    required
                    value={cookieVal}
                    onChange={e => setCookieVal(e.target.value)}
                    placeholder="AQEDAT..."
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-xs font-mono focus:outline-none focus:border-[#6366f1]"
                  />
                  <p className="text-[#6b7280] text-[11px] mt-1.5">
                    Bypasses 2FA & Password checkpoints by utilizing your browser's session cookie.
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-sm transition-all disabled:opacity-50"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  Connect via Cookie
                </button>
              </form>
            )}

            {/* Method 3: Existing Unipile Account ID */}
            {connMethod === 'account_id' && (
              <form onSubmit={handleConnectAccountId} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Unipile Account ID</label>
                  <input
                    type="text"
                    required
                    value={existingAccId}
                    onChange={e => setExistingAccId(e.target.value)}
                    placeholder="bBzuBoeOQAuBCQNFu7shyQ"
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm font-mono focus:outline-none focus:border-[#6366f1]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Display Name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="Maryam Ansar"
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-sm transition-all disabled:opacity-50"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  Connect Unipile Account ID
                </button>
              </form>
            )}

            {/* Method 4: Chrome Extension Pairing Key */}
            {connMethod === 'extension' && (
              <form onSubmit={handleConnectExtension} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Profile Key</label>
                  <input
                    type="text"
                    value={extKey}
                    onChange={e => setExtKey(e.target.value)}
                    placeholder="profile_1"
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Display Name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="John Smith"
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-sm transition-all disabled:opacity-50"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  Add Profile for Extension
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}

