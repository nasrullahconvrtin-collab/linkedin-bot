import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Download, ExternalLink, Key, Loader2, Plus, RefreshCw, Trash2, UserCheck, Users, X,
  ShieldCheck, AlertCircle, LogOut, Check, Building, Briefcase, Sparkles, Calendar,
  UserPlus, MessageSquare, Reply, Eye, Globe, Lock, Code
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
import { supabaseDirect, directDisconnectProfile } from '../services/directServices';

const TIMELINE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
  { key: 'custom', label: 'Custom' },
];

export default function Profiles() {
  const navigate = useNavigate();
  const { profiles, fetchProfiles } = useApp();
  const [tab, setTab] = useState('network');
  const [modal, setModal] = useState(false);
  const [connMethod, setConnMethod] = useState('direct'); // direct | cookie | account_id | hosted

  // Timeline & Stats state
  const [timeRange, setTimeRange] = useState('month');
  const [customStartDate, setCustomStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [customEndDate, setCustomEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [prospects, setProspects] = useState([]);

  // Login form state
  const [directEmail, setDirectEmail] = useState('');
  const [directPassword, setDirectPassword] = useState('');
  const [cookieVal, setCookieVal] = useState('');
  const [existingAccId, setExistingAccId] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Editable Account Settings state
  const [editName, setEditName] = useState('');
  const [editAccId, setEditAccId] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [removing, setRemoving] = useState(false);

  // 2FA Checkpoint state
  const [checkpointReq, setCheckpointReq] = useState(false);
  const [checkpointAccId, setCheckpointAccId] = useState('');
  const [twoFACode, setTwoFACode] = useState('');

  const [loading, setLoading] = useState(false);

  // Network tab state
  const [accountInfo, setAccountInfo] = useState(null);
  const [connections, setConnections] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [withdrawAge, setWithdrawAge] = useState(30); // Default 30 days
  const [netLoading, setNetLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const loadNetworkData = async () => {
    setNetLoading(true);
    try {
      // 1. Check if an active profile exists in database
      const { data: dbProfiles } = await supabaseDirect.from('profiles').select('*');
      if (!dbProfiles || dbProfiles.length === 0) {
        setAccountInfo(null);
        setEditName('');
        setEditAccId('');
        setConnections([]);
        setInvitations([]);
        setNetLoading(false);
        return;
      }

      const [accRes, connRes, invRes, pRes] = await Promise.all([
        getUnipileAccountInfo().catch(() => null),
        getNetworkingConnections().catch(() => ({ connections: [] })),
        getNetworkingInvitations().catch(() => ({ invitations: [] })),
        supabaseDirect.from('prospects').select('*').catch(() => ({ data: [] })),
      ]);

      if (accRes) {
        setAccountInfo(accRes);
        const resolvedName = accRes.name && accRes.name !== 'Maryam Ansar' ? accRes.name : (dbProfiles[0]?.display_name || 'Fatima Maqsood');
        setEditName(resolvedName);
        setEditAccId(accRes.id || dbProfiles[0]?.unipile_account_id || '');
      } else if (dbProfiles.length > 0) {
        setEditName(dbProfiles[0].display_name || '');
        setEditAccId(dbProfiles[0].unipile_account_id || '');
      }

      if (connRes?.connections) setConnections(connRes.connections);
      if (invRes?.invitations) setInvitations(invRes.invitations);
      if (pRes?.data) setProspects(pRes.data);

    } catch (err) {
      console.error('Failed loading network data:', err);
    } finally {
      setNetLoading(false);
    }
  };

  useEffect(() => {
    loadNetworkData();
  }, []);

  // Calculate Date Bounds for Timeline Filter
  const dateBounds = useMemo(() => {
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (timeRange === 'today') {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (timeRange === 'yesterday') {
      start.setDate(now.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(now.getDate() - 1);
      end.setHours(23, 59, 59, 999);
    } else if (timeRange === 'week') {
      start.setDate(now.getDate() - 7);
      start.setHours(0, 0, 0, 0);
    } else if (timeRange === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (timeRange === 'year') {
      start = new Date(now.getFullYear(), 0, 1);
    } else if (timeRange === 'custom') {
      start = customStartDate ? new Date(customStartDate) : new Date(0);
      end = customEndDate ? new Date(customEndDate + 'T23:59:59') : new Date();
    }

    return { start, end };
  }, [timeRange, customStartDate, customEndDate]);

  // Filter prospects for overall profile activity stats based on timeline
  const filteredProspects = useMemo(() => {
    const { start, end } = dateBounds;
    return prospects.filter(p => {
      const tsStr = p.updated_at || p.reply_date || p.created_at;
      if (!tsStr) return true;
      const ts = new Date(tsStr);
      return ts >= start && ts <= end;
    });
  }, [prospects, dateBounds]);

  // Compute 5 Compact Metric Cards strictly adhering to profile vs campaign data sources
  const metrics = useMemo(() => {
    let campaignInvitesSent = 0;
    let messagesSent = 0;
    let repliesCount = 0;
    let profileViews = 0;

    filteredProspects.forEach(p => {
      const s = p.status || '';
      if (['Connection Requested', 'Sent', 'Connection Accepted', 'CONNECTED', 'Replied', 'Initial Message Sent'].includes(s)) {
        campaignInvitesSent += 1;
      }
      if (['Initial Message Sent', 'Message Sent', 'Replied'].includes(s) || p.message_sent_date) {
        messagesSent += 1;
      }
      if (s === 'Replied' || s === 'replied' || p.reply_date) {
        repliesCount += 1;
      }
      if (s === 'Visited' || p.visited_date) {
        profileViews += 1;
      }
    });

    // Invites Sent = Overall total historical invitations (pending sent + accepted 1st degree connections + campaign invites)
    const overallInvitesSent = Math.max((invitations?.length || 0) + (connections?.length || 0), campaignInvitesSent);
    
    // Accepted = Overall total 1st-degree connections count
    const acceptedCount = connections?.length || 0;
    const acceptanceRate = overallInvitesSent > 0 ? Math.round((acceptedCount / overallInvitesSent) * 100) : 0;
    const replyRate = messagesSent > 0 ? Math.round((repliesCount / messagesSent) * 100) : 0;

    return {
      invitesSent: overallInvitesSent,
      acceptedCount,
      acceptanceRate,
      messagesSent,
      repliesCount,
      replyRate,
      profileViews,
    };
  }, [filteredProspects, invitations, connections]);

  // Duration Filter for Pending Invitations
  const filteredInvitations = useMemo(() => {
    if (!invitations || invitations.length === 0) return [];
    if (!withdrawAge || withdrawAge === 0) return invitations;

    const cutoffMs = Date.now() - Number(withdrawAge) * 24 * 60 * 60 * 1000;
    return invitations.filter(inv => {
      const sentTs = inv.parsed_datetime || inv.sent_at || inv.created_at || inv.timestamp || inv.date;
      if (!sentTs) return true;
      const invMs = new Date(sentTs).getTime();
      return invMs <= cutoffMs;
    });
  }, [invitations, withdrawAge]);

  const handleSaveAccountSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await supabaseDirect.from('profiles').upsert([{
        profile_key: 'profile_1',
        display_name: editName || 'Fatima Maqsood',
        unipile_account_id: editAccId || 'zXneBg9WRZ-m7iFuKULo1Q',
        session_active: true,
        updated_at: new Date().toISOString(),
      }]);
      await createProfile({
        profile_key: 'profile_1',
        display_name: editName || 'Fatima Maqsood',
        unipile_account_id: editAccId || 'zXneBg9WRZ-m7iFuKULo1Q',
        session_active: true,
      });
      toast.success('Account settings updated and saved to database!');
      await fetchProfiles();
      await loadNetworkData();
    } catch (err) {
      toast.error(err.message || 'Failed to save account settings');
    } finally {
      setSavingSettings(false);
    }
  };

  // Disconnect / Remove Account Handler
  const handleRemoveConnectedAccount = async () => {
    const accName = accountInfo?.name || editName || 'Fatima Maqsood';
    if (!confirm(`Are you sure you want to disconnect and remove ${accName}? This will reset all active profile sessions and inbox access from the tool.`)) {
      return;
    }
    setRemoving(true);
    try {
      await directDisconnectProfile();

      setAccountInfo(null);
      setConnections([]);
      setInvitations([]);
      setProspects([]);
      setEditName('');
      setEditAccId('');

      toast.success('LinkedIn account disconnected and access cleared');
      await fetchProfiles();
    } catch (err) {
      console.error('Error removing account:', err);
      toast.error('Failed to disconnect account');
    } finally {
      setRemoving(false);
    }
  };

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
        toast.success(`LinkedIn account connected successfully!`);
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
      await supabaseDirect.from('profiles').upsert([{
        profile_key: 'profile_1',
        display_name: displayName || 'Fatima Maqsood',
        unipile_account_id: existingAccId || 'zXneBg9WRZ-m7iFuKULo1Q',
        session_active: true,
        updated_at: new Date().toISOString(),
      }]);
      await createProfile({
        profile_key: 'profile_1',
        display_name: displayName || 'Fatima Maqsood',
        unipile_account_id: existingAccId || 'zXneBg9WRZ-m7iFuKULo1Q',
        session_active: true,
      });
      toast.success(`LinkedIn Account (${displayName || 'Fatima Maqsood'}) connected & saved!`);
      setModal(false);
      fetchProfiles();
      loadNetworkData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  // CSV Export for Connections
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

  const isAccountConnected = !!(accountInfo?.id || profiles.length > 0);
  const profileDisplayName = (accountInfo?.name && accountInfo.name !== 'Maryam Ansar' ? accountInfo.name : null) || (profiles[0] && profiles[0].display_name !== 'Maryam Ansar' ? profiles[0].display_name : null) || 'Fatima Maqsood';

  const tabs = [
    { id: 'network', label: 'Network & Connections' },
    { id: 'account', label: 'Account Settings' },
  ];

  return (
    <Layout>
      
      {/* ── 1. TOP SECTION: PROFILE NAME & STATUS BANNER (ONLY WHEN CONNECTED) ── */}
      {isAccountConnected && (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#6366f1] via-indigo-600 to-purple-600 text-white font-bold text-2xl flex items-center justify-center shadow-lg">
              {profileDisplayName ? profileDisplayName[0] : 'L'}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-white text-2xl font-extrabold">{profileDisplayName}</h1>
                <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  LinkedIn Connected
                </span>
              </div>
              <p className="text-[#9ca3af] text-sm mt-1">{accountInfo?.headline || 'LinkedIn Outreach Profile'}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-start md:self-auto">
            <button
              onClick={handleRemoveConnectedAccount}
              disabled={removing}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-semibold text-xs rounded-xl transition-all disabled:opacity-50"
              title="Disconnect Account"
            >
              {removing ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
              Disconnect Account
            </button>
          </div>
        </div>
      )}

      {/* ── IF NO ACCOUNT IS CONNECTED: DISPLAY CLEAN PROMPT TO GO TO SETTINGS ── */}
      {!isAccountConnected ? (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-12 text-center max-w-xl mx-auto my-8 shadow-2xl space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-[#6366f1]/10 border border-[#6366f1]/20 text-[#6366f1] flex items-center justify-center mx-auto">
            <Globe size={32} />
          </div>
          <h2 className="text-white text-xl font-bold">No Active LinkedIn Profile Connected</h2>
          <p className="text-[#9ca3af] text-sm leading-relaxed">
            Your LinkedIn profile is currently disconnected. All profile performance stats, network connections, and inbox synchronization are paused.
            Please go to Settings to connect your LinkedIn profile.
          </p>
          <button
            onClick={() => navigate('/settings')}
            className="px-6 py-3 bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-bold rounded-xl shadow-lg transition-all"
          >
            Go to Settings to Connect Account
          </button>
        </div>
      ) : (
        <>
          {/* ── 2. SECOND SECTION: OVERALL PROFILE STATS & TIMELINE FILTER ───────── */}
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 mb-6 shadow-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#2a2a2a] pb-4">
              <div>
                <h2 className="text-white font-bold text-lg">Overall Profile Activity Performance</h2>
                <p className="text-[#6b7280] text-xs mt-0.5">Aggregated metrics for all automated outreach activities executed on this profile</p>
              </div>

              {/* Timeline Preset & Pickers Bar */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center bg-[#111111] p-1 rounded-xl border border-[#2a2a2a]">
                  {TIMELINE_PRESETS.map(t => (
                    <button
                      key={t.key}
                      onClick={() => setTimeRange(t.key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        timeRange === t.key
                          ? 'bg-[#6366f1] text-white shadow-md'
                          : 'text-[#9ca3af] hover:text-white'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-[#111111] border border-[#2a2a2a] rounded-xl px-3 py-1.5">
                    <Calendar size={13} className="text-[#6366f1]" />
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={e => {
                        setCustomStartDate(e.target.value);
                        setTimeRange('custom');
                      }}
                      className="bg-transparent text-white text-xs font-mono focus:outline-none cursor-pointer"
                      style={{ colorScheme: 'dark' }}
                    />
                  </div>
                  <span className="text-[#6b7280] text-xs">to</span>
                  <div className="flex items-center gap-2 bg-[#111111] border border-[#2a2a2a] rounded-xl px-3 py-1.5">
                    <Calendar size={13} className="text-[#6366f1]" />
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={e => {
                        setCustomEndDate(e.target.value);
                        setTimeRange('custom');
                      }}
                      className="bg-transparent text-white text-xs font-mono focus:outline-none cursor-pointer"
                      style={{ colorScheme: 'dark' }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 5 Compact Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 pt-1">
              {/* Card 1: Invites Sent */}
              <div className="rounded-2xl border border-[#2a2a2a] bg-[#111111] p-3.5 flex items-center justify-between shadow-md">
                <div>
                  <p className="text-[#9ca3af] text-[11px] font-medium">Invites Sent</p>
                  <p className="text-white font-extrabold text-xl mt-0.5">{metrics.invitesSent}</p>
                </div>
                <div className="w-8 h-8 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 flex items-center justify-center text-[#6366f1] shrink-0">
                  <UserPlus size={16} />
                </div>
              </div>

              {/* Card 2: Accepted */}
              <div className="rounded-2xl border border-[#2a2a2a] bg-[#111111] p-3.5 flex items-center justify-between shadow-md">
                <div>
                  <p className="text-[#9ca3af] text-[11px] font-medium">Accepted</p>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-white font-extrabold text-xl">{metrics.acceptedCount}</span>
                    <span className="text-emerald-400 text-[10px] font-bold font-mono">({metrics.acceptanceRate}%)</span>
                  </div>
                </div>
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                  <UserCheck size={16} />
                </div>
              </div>

              {/* Card 3: Messages */}
              <div className="rounded-2xl border border-[#2a2a2a] bg-[#111111] p-3.5 flex items-center justify-between shadow-md">
                <div>
                  <p className="text-[#9ca3af] text-[11px] font-medium">Messages</p>
                  <p className="text-white font-extrabold text-xl mt-0.5">{metrics.messagesSent}</p>
                </div>
                <div className="w-8 h-8 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 flex items-center justify-center text-[#6366f1] shrink-0">
                  <MessageSquare size={16} />
                </div>
              </div>

              {/* Card 4: Replies */}
              <div className="rounded-2xl border border-[#2a2a2a] bg-[#111111] p-3.5 flex items-center justify-between shadow-md">
                <div>
                  <p className="text-[#9ca3af] text-[11px] font-medium">Replies</p>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-white font-extrabold text-xl">{metrics.repliesCount}</span>
                    <span className="text-amber-400 text-[10px] font-bold font-mono">({metrics.replyRate}%)</span>
                  </div>
                </div>
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                  <Reply size={16} />
                </div>
              </div>

              {/* Card 5: Profile Views */}
              <div className="rounded-2xl border border-[#2a2a2a] bg-[#111111] p-3.5 flex items-center justify-between shadow-md">
                <div>
                  <p className="text-[#9ca3af] text-[11px] font-medium">Profile Views</p>
                  <p className="text-white font-extrabold text-xl mt-0.5">{metrics.profileViews}</p>
                </div>
                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                  <Eye size={16} />
                </div>
              </div>
            </div>
          </div>

          {/* ── 3. THIRD SECTION: NETWORK & CONNECTIONS / ACCOUNT SETTINGS TABS ──── */}
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
              <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 space-y-4 shadow-xl">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-white font-bold text-lg flex items-center gap-2">
                      <Clock size={20} className="text-[#6366f1]" />
                      Pending Sent Invitations ({filteredInvitations.length})
                    </h3>
                    <p className="text-[#6b7280] text-xs mt-1">
                      Outbound connection requests waiting for acceptance on LinkedIn. Select duration to filter and withdraw.
                    </p>
                  </div>

                  {/* Age Selection Duration Dropdown & Bulk Withdraw Button */}
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
                      <option value={0}>All Pending Invitations</option>
                    </select>

                    <button
                      onClick={handleWithdrawByAge}
                      disabled={withdrawing || filteredInvitations.length === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold rounded-xl transition-all disabled:opacity-50"
                    >
                      {withdrawing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      Withdraw Selected ({filteredInvitations.length})
                    </button>
                  </div>
                </div>

                {filteredInvitations.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#2a2a2a] bg-[#111111] p-10 text-center">
                    <p className="text-[#6b7280] text-sm">No pending invitations match the selected duration filter.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
                    {filteredInvitations.map((inv, i) => {
                      const invId = inv.id || inv.invitation_id || `inv_${i}`;
                      const name = inv.invited_user || inv.recipient_name || 'LinkedIn Member';
                      const title = inv.invited_user_description || inv.headline || 'Pending Invitation';
                      const photo = inv.invited_user_profile_picture_url;
                      const dateStr = inv.date || (inv.parsed_datetime ? new Date(inv.parsed_datetime).toLocaleDateString() : '');

                      return (
                        <div key={invId} className="p-4 rounded-xl border border-[#2a2a2a] bg-[#111111] flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-[#6366f1]/20 border border-[#6366f1]/30 flex items-center justify-center font-bold text-white text-xs shrink-0">
                              {photo ? (
                                <img src={photo} alt={name} className="w-full h-full rounded-full object-cover" />
                              ) : (
                                name.slice(0, 2).toUpperCase()
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-white font-bold text-sm truncate">{name}</p>
                              <p className="text-[#9ca3af] text-xs truncate">{title}</p>
                              {dateStr && <p className="text-[#6b7280] text-[10px] mt-0.5">Sent {dateStr}</p>}
                            </div>
                          </div>

                          <button
                            onClick={() => handleCancelSingleInvite(invId)}
                            className="px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold shrink-0 transition-colors"
                          >
                            Withdraw
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 1st-Degree Connections List Section (With CSV Export Button along header) */}
              <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 space-y-4 shadow-xl">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-white font-bold text-lg flex items-center gap-2">
                      <UserCheck size={20} className="text-emerald-400" />
                      1st-Degree Network Connections ({connections.length})
                    </h3>
                    <p className="text-[#6b7280] text-xs mt-1">
                      Active 1st-degree connections synced from your connected LinkedIn profile.
                    </p>
                  </div>

                  {/* CSV Export Button alongside connection section header */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={exportConnectionsCSV}
                      disabled={connections.length === 0}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-[#22c55e] hover:bg-[#16a34a] text-white font-bold text-xs rounded-xl transition-all shadow-md disabled:opacity-50"
                    >
                      <Download size={15} /> Export CSV ({connections.length})
                    </button>

                    <button
                      onClick={loadNetworkData}
                      disabled={netLoading}
                      className="p-2 rounded-xl border border-[#2a2a2a] text-[#9ca3af] hover:text-white"
                      title="Refresh Network Data"
                    >
                      <RefreshCw size={15} className={netLoading ? 'animate-spin' : ''} />
                    </button>
                  </div>
                </div>

                {netLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-[#6366f1]" />
                  </div>
                ) : connections.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#2a2a2a] bg-[#111111] p-10 text-center">
                    <p className="text-[#6b7280] text-sm">No 1st-degree connections loaded yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[500px] overflow-y-auto pr-1">
                    {connections.map((c, i) => {
                      const cName = c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'LinkedIn Member';
                      const cTitle = c.headline || c.title || '1st-Degree Connection';
                      const cLink = c.public_profile_url || `https://www.linkedin.com/in/${c.public_identifier || c.member_id || c.id}`;
                      const photo = c.profile_picture_url || c.avatar_url;

                      return (
                        <div key={c.id || i} className="p-3.5 rounded-xl border border-[#2a2a2a] bg-[#111111] flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-full bg-[#6366f1]/20 border border-[#6366f1]/30 flex items-center justify-center font-bold text-white text-xs shrink-0">
                              {photo ? (
                                <img src={photo} alt={cName} className="w-full h-full rounded-full object-cover" />
                              ) : (
                                cName.slice(0, 2).toUpperCase()
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-white font-bold text-xs truncate">{cName}</p>
                              <p className="text-[#9ca3af] text-[11px] truncate">{cTitle}</p>
                            </div>
                          </div>

                          <a
                            href={cLink}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:border-[#6366f1] shrink-0"
                            title="View LinkedIn Profile"
                          >
                            <ExternalLink size={13} />
                          </a>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ── TAB 2: ACCOUNT SETTINGS ────────────────────────────────────────── */
            <div className="max-w-2xl space-y-6">
              <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 space-y-5 shadow-xl">
                <div>
                  <h3 className="text-white font-bold text-lg">Active Account Credentials</h3>
                  <p className="text-[#6b7280] text-xs mt-1">
                    View and edit your connected LinkedIn Profile display name and credentials.
                  </p>
                </div>

                <form onSubmit={handleSaveAccountSettings} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">Profile Display Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      placeholder="Fatima Maqsood"
                      className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#9ca3af] mb-1.5">Connected Profile Session Key</label>
                    <input
                      type="text"
                      value={editAccId}
                      onChange={e => setEditAccId(e.target.value)}
                      placeholder="zXneBg9WRZ-m7iFuKULo1Q"
                      className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-[#6366f1]"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[#2a2a2a]">
                    <button
                      type="button"
                      onClick={handleRemoveConnectedAccount}
                      disabled={removing}
                      className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold text-xs rounded-xl transition-all disabled:opacity-50"
                    >
                      {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      Disconnect Account
                    </button>

                    <button
                      type="submit"
                      disabled={savingSettings}
                      className="flex items-center gap-2 px-6 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-xs rounded-xl transition-all shadow-md disabled:opacity-50"
                    >
                      {savingSettings ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      Save Settings
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
