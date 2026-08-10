import { useEffect, useState } from 'react';
import {
  Clock, Download, ExternalLink, Key, Loader2, Plus, RefreshCw, Trash2, UserCheck, Users, X,
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
  getNetworkingConnections,
  getNetworkingInvitations,
  getUnipileAccountInfo,
  submitUnipile2FA,
  withdrawOldInvitations,
} from '../services/api';

const DAILY_LIMIT = 25;

export default function Profiles() {
  const { profiles, fetchProfiles } = useApp();
  const [tab, setTab] = useState('network');
  const [modal, setModal] = useState(false);
  const [connMethod, setConnMethod] = useState('direct'); // direct | cookie | account_id

  // Login form state
  const [directEmail, setDirectEmail] = useState('');
  const [directPassword, setDirectPassword] = useState('');
  const [cookieVal, setCookieVal] = useState('');
  const [existingAccId, setExistingAccId] = useState('bBzuBoeOQAuBCQNFu7shyQ');
  const [displayName, setDisplayName] = useState('Maryam Ansar');

  // 2FA Checkpoint state
  const [checkpointReq, setCheckpointReq] = useState(false);
  const [checkpointAccId, setCheckpointAccId] = useState('');
  const [twoFACode, setTwoFACode] = useState('');

  const [loading, setLoading] = useState(false);

  // Network tab state
  const [accountInfo, setAccountInfo] = useState(null);
  const [connections, setConnections] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [withdrawAge, setWithdrawAge] = useState(90); // 7 | 30 | 60 | 90
  const [netLoading, setNetLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

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
    loadNetworkData();
  }, []);

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
        loadNetworkData();
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
        loadNetworkData();
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
        loadNetworkData();
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
        profile_key: 'profile_1',
        display_name: displayName || 'Maryam Ansar',
        unipile_account_id: existingAccId,
        session_active: true,
      });
      toast.success(`Connected Unipile Account ID (${existingAccId})!`);
      setModal(false);
      fetchProfiles();
      loadNetworkData();
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

  // CSV Export for ALL Connections
  const exportConnectionsCSV = () => {
    if (!connections || connections.length === 0) {
      return toast.error('No 1st-degree connections loaded to export');
    }

    const headers = ['first_name', 'last_name', 'name', 'headline', 'linkedin_url', 'provider_id'];
    const rows = connections.map(c => [
      `"${(c.first_name || c.name?.split(' ')[0] || '').replace(/"/g, '""')}"`,
      `"${(c.last_name || c.name?.split(' ').slice(1).join(' ') || '').replace(/"/g, '""')}"`,
      `"${(c.name || `${c.first_name || ''} ${c.last_name || ''}`).trim().replace(/"/g, '""')}"`,
      `"${(c.headline || c.title || '').replace(/"/g, '""')}"`,
      `"${c.public_profile_url || `https://www.linkedin.com/in/${c.public_identifier || c.member_id || c.id}`}"`,
      `"${c.member_id || c.provider_id || c.id || ''}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `all_linkedin_connections_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported all ${connections.length} 1st-degree connections to CSV!`);
  };

  const handleWithdrawByAge = async () => {
    setWithdrawing(true);
    try {
      const res = await withdrawOldInvitations(withdrawAge);
      if (res.success) {
        toast.success(`Withdrew ${res.withdrawn_count || 0} pending invitations older than ${withdrawAge} days!`);
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
        toast.success('Invitation withdrawn successfully');
        setInvitations(prev => prev.filter(i => (i.id || i.invitation_id) !== invId));
      } else {
        toast.error(res.error || 'Failed to withdraw invitation');
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const tabs = [
    { id: 'network', label: 'Network & Connections' },
    { id: 'account', label: 'Account Settings' },
  ];

  return (
    <Layout>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">LinkedIn Profile & Network</h1>
          <p className="text-[#6b7280] text-sm mt-1">
            Manage your connected LinkedIn account, 1st-degree connections, and pending invitations via Unipile.
          </p>
        </div>
        <button
          onClick={() => { setCheckpointReq(false); setModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl font-medium text-sm transition-colors shadow-lg shadow-indigo-500/20"
        >
          <Plus size={16} /> Connect LinkedIn Account
        </button>
      </div>

      {/* Profile Info Banner */}
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#6366f1] via-indigo-600 to-purple-600 text-white font-bold text-2xl flex items-center justify-center shadow-lg">
            {accountInfo?.name ? accountInfo.name[0] : 'M'}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-white text-xl font-bold">{accountInfo?.name || 'Maryam Ansar'}</h2>
              <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Unipile Connected
              </span>
            </div>
            <p className="text-[#9ca3af] text-sm mt-1">{accountInfo?.headline || 'LinkedIn Outreach Specialist'}</p>
            <p className="text-[#6b7280] text-xs font-mono mt-1">Unipile Account ID: {accountInfo?.id || 'bBzuBoeOQAuBCQNFu7shyQ'}</p>
          </div>
        </div>

        <button
          onClick={exportConnectionsCSV}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-[#22c55e] hover:bg-[#16a34a] text-white font-semibold text-sm rounded-xl transition-all shadow-lg shadow-green-500/20"
        >
          <Download size={18} /> Export CSV ({connections.length} Connections)
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 rounded-xl border border-[#2a2a2a] bg-[#111111] p-1 w-fit">
        {tabs.map(item => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              tab === item.id ? 'bg-[#6366f1] text-white' : 'text-[#9ca3af] hover:text-white hover:bg-[#1a1a1a]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* ── TAB 1: NETWORK & CONNECTIONS ────────────────────────────────────────── */}
      {tab === 'network' ? (
        <div className="space-y-6">
          {/* Pending Sent Invitations Section */}
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-white font-bold text-lg flex items-center gap-2">
                  <Clock size={20} className="text-[#6366f1]" />
                  Pending Sent Invitations ({invitations.length})
                </h3>
                <p className="text-[#6b7280] text-xs mt-1">
                  Outbound connection requests waiting for acceptance on LinkedIn.
                </p>
              </div>

              {/* Age Selection & Bulk Withdraw Button */}
              <div className="flex items-center gap-3">
                <select
                  value={withdrawAge}
                  onChange={e => setWithdrawAge(Number(e.target.value))}
                  className="bg-[#111111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-xs font-medium focus:outline-none focus:border-[#6366f1]"
                >
                  <option value={7}>Older than 7 days</option>
                  <option value={30}>Older than 30 days</option>
                  <option value={60}>Older than 60 days</option>
                  <option value={90}>Older than 90 days</option>
                </select>

                <button
                  onClick={handleWithdrawByAge}
                  disabled={withdrawing}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold rounded-xl transition-all disabled:opacity-50"
                >
                  {withdrawing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Withdraw Pending
                </button>
              </div>
            </div>

            {invitations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#2a2a2a] bg-[#111111] p-10 text-center">
                <p className="text-[#6b7280] text-sm">No pending outbound invitations currently tracked.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
                {invitations.map((inv, i) => {
                  const invId = inv.id || inv.invitation_id || `inv_${i}`;
                  const name = inv.invited_user || inv.recipient_name || 'LinkedIn Member';
                  const title = inv.invited_user_description || inv.headline || 'Pending Invitation';
                  const photo = inv.invited_user_profile_picture_url;
                  const dateStr = inv.date || (inv.parsed_datetime ? new Date(inv.parsed_datetime).toLocaleDateString() : '');

                  return (
                    <div key={invId} className="p-4 rounded-xl border border-[#2a2a2a] bg-[#111111] flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {photo ? (
                          <img src={photo} alt={name} className="w-10 h-10 rounded-full object-cover shrink-0 border border-[#2a2a2a]" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-[#6366f1]/20 text-[#6366f1] font-bold flex items-center justify-center text-sm shrink-0">
                            {name[0]}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-white text-xs font-bold truncate">{name}</p>
                          <p className="text-[#9ca3af] text-[11px] truncate mt-0.5">{title}</p>
                          {dateStr && <p className="text-[#6b7280] text-[10px] mt-0.5">{dateStr}</p>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleCancelSingleInvite(invId)}
                        className="text-xs text-red-400 hover:text-red-300 font-semibold px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 hover:bg-red-500/20 shrink-0 transition-all"
                      >
                        Withdraw
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 1st-Degree Connections Roster */}
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-white font-bold text-lg flex items-center gap-2">
                  <UserCheck size={20} className="text-[#22c55e]" />
                  1st-Degree Connections Roster ({connections.length})
                </h3>
                <p className="text-[#6b7280] text-xs mt-1">Full 1st-degree connection graph fetched via Unipile API.</p>
              </div>

              <button onClick={loadNetworkData} className="text-xs text-[#9ca3af] hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2a2a2a] bg-[#111111]">
                <RefreshCw size={14} className={netLoading ? 'animate-spin' : ''} /> Refresh Connections
              </button>
            </div>

            {netLoading ? (
              <div className="p-12 text-center text-xs text-[#6b7280] animate-pulse">Fetching all 1st-degree connections from Unipile...</div>
            ) : connections.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#2a2a2a] bg-[#111111] p-10 text-center">
                <p className="text-[#6b7280] text-sm">No 1st-degree connections loaded yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto pr-1">
                {connections.map((c, idx) => {
                  const connId = c.id || c.provider_id || c.member_id || `conn_${idx}`;
                  const name = c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'LinkedIn Member';
                  const title = c.headline || c.title || '1st Degree Connection';
                  const profileUrl = c.public_profile_url || (c.public_identifier ? `https://www.linkedin.com/in/${c.public_identifier}` : null);
                  const pic = c.profile_picture_url;

                  return (
                    <div key={connId} className="p-3.5 rounded-xl border border-[#2a2a2a] bg-[#111111] flex items-start gap-3">
                      {pic ? (
                        <img src={pic} alt={name} className="w-9 h-9 rounded-lg object-cover shrink-0 border border-[#2a2a2a]" />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-[#6366f1]/20 text-[#6366f1] font-bold flex items-center justify-center text-sm shrink-0">
                          {name[0]}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-white text-xs font-bold truncate">{name}</p>
                          {profileUrl && (
                            <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="text-[#6366f1] hover:underline text-[10px] flex items-center gap-1 shrink-0">
                              LinkedIn <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                        <p className="text-[#9ca3af] text-[11px] truncate mt-0.5">{title}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Account Settings Tab */
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 space-y-6 max-w-2xl">
          <div>
            <h2 className="text-white font-bold text-lg">Connected LinkedIn Account Settings</h2>
            <p className="text-[#6b7280] text-xs mt-1">Each workspace profile links to one primary LinkedIn account via Unipile.</p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="rounded-xl border border-[#2a2a2a] bg-[#111111] p-4">
              <p className="text-[#6b7280]">Account Name</p>
              <p className="text-white font-bold text-sm mt-1">{accountInfo?.name || 'Maryam Ansar'}</p>
            </div>
            <div className="rounded-xl border border-[#2a2a2a] bg-[#111111] p-4">
              <p className="text-[#6b7280]">Unipile Account ID</p>
              <p className="text-[#6366f1] font-mono text-xs truncate mt-1">{accountInfo?.id || 'bBzuBoeOQAuBCQNFu7shyQ'}</p>
            </div>
          </div>

          <button
            onClick={() => setModal(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-sm transition-all"
          >
            Reconnect / Switch LinkedIn Account
          </button>
        </div>
      )}

      {/* ── ADD / CONNECT ACCOUNT MODAL ─────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-[#2a2a2a] bg-[#111111] p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-white font-bold text-lg">Connect LinkedIn Account</h2>
                <p className="text-[#6b7280] text-xs mt-0.5">Select your preferred Unipile authentication option.</p>
              </div>
              <button onClick={() => setModal(false)} className="text-[#6b7280] hover:text-white"><X size={20} /></button>
            </div>

            {/* Connection Method Selector Tabs */}
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-xs font-medium">
              {[
                { id: 'direct', label: 'Direct Login' },
                { id: 'cookie', label: 'Cookie' },
                { id: 'account_id', label: 'Unipile ID' },
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => { setConnMethod(m.id); setCheckpointReq(false); }}
                  className={`py-2.5 rounded-lg text-center transition-colors ${
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
          </div>
        </div>
      )}
    </Layout>
  );
}


