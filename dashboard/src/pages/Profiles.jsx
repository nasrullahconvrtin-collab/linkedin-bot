import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Download, ExternalLink, Key, Loader2, Plus, RefreshCw, Trash2, UserCheck, Users, X,
  ShieldCheck, AlertCircle, LogOut, Check, Building, Briefcase, Sparkles, Calendar,
  UserPlus, MessageSquare, Reply, Eye, Globe, Lock, Code, Mail, Phone, Search, Shield, StopCircle
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
  pacedWithdrawInvitations,
  createUnipileHostedLink,
  importNewestUnipileAccount,
} from '../services/api';
import { supabaseDirect, directDisconnectProfile, getStoredDisconnectedFlag, directCreateProfile, getActiveOrganizationId, getActiveUserAccount, isSuperAdminUser } from '../services/directServices';

const TIMELINE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
  { key: 'custom', label: 'Custom' },
];


function getEventDate(prospect, eventType) {
  if (eventType === 'invitation') {
    if (prospect.connection_sent_date) return new Date(prospect.connection_sent_date);
    const hist = prospect.custom_variables?.history || [];
    const item = hist.find(h => h.node_type === 'send_invitation' && h.status === 'success');
    if (item?.executed_at) return new Date(item.executed_at);
    if (['Connection Requested', 'Sent'].includes(prospect.status)) return prospect.updated_at ? new Date(prospect.updated_at) : null;
  }
  if (eventType === 'acceptance') {
    if (prospect.accepted_at) return new Date(prospect.accepted_at);
    const hist = prospect.custom_variables?.history || [];
    const item = hist.find(h => (h.node_type === 'check_acceptance' || h.node_type === 'connection_accepted') && h.status === 'success');
    if (item?.executed_at) return new Date(item.executed_at);
    if (['Connection Accepted', 'CONNECTED'].includes(prospect.status)) return prospect.updated_at ? new Date(prospect.updated_at) : null;
  }
  if (eventType === 'message') {
    if (prospect.message_sent_date) return new Date(prospect.message_sent_date);
    const hist = prospect.custom_variables?.history || [];
    const item = hist.find(h => h.node_type === 'send_message' && h.status === 'success');
    if (item?.executed_at) return new Date(item.executed_at);
    if (['Initial Message Sent', 'Message Sent'].includes(prospect.status)) return prospect.updated_at ? new Date(prospect.updated_at) : null;
  }
  if (eventType === 'reply') {
    const hist = prospect.custom_variables?.history || [];
    const item = hist.find(h => (h.node_type === 'check_reply' || h.node_type === 'replied') && (h.status === 'replied' || h.status === 'success'));
    if (item?.executed_at) return new Date(item.executed_at);
    if (['Replied', 'replied'].includes(prospect.status)) return prospect.updated_at ? new Date(prospect.updated_at) : null;
  }
  if (eventType === 'visit') {
    const hist = prospect.custom_variables?.history || [];
    const item = hist.find(h => h.node_type === 'visit_profile' && h.status === 'success');
    if (item?.executed_at) return new Date(item.executed_at);
    if (['Visited', 'visited'].includes(prospect.status)) return prospect.updated_at ? new Date(prospect.updated_at) : null;
  }
  return null;
}

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
  const [selectedAccId, setSelectedAccId] = useState(() => {
    try {
      return (typeof window !== 'undefined' && localStorage.getItem('lf_selected_account_id')) || '';
    } catch {
      return '';
    }
  });
  const [accountInfo, setAccountInfo] = useState(null);
  const [connections, setConnections] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [withdrawAge, setWithdrawAge] = useState(90); // Default 90 = 3 months
  const [connSearch, setConnSearch] = useState('');
  const [invSearch, setInvSearch] = useState('');
  const [netLoading, setNetLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [pacedActive, setPacedActive] = useState(false);
  const [pacedProgress, setPacedProgress] = useState({ current: 0, total: 0, withdrawn_count: 0, currentRecipient: '' });
  const abortControllerRef = useRef(null);

  const loadNetworkData = async (targetId = null) => {
    setNetLoading(true);
    try {
      const isSuper = isSuperAdminUser();
      const orgId = getActiveOrganizationId();
      const validAccIds = new Set((profiles || []).map(p => p.unipile_account_id).filter(Boolean));
      if (validAccIds.size === 0) {
        setAccountInfo(null);
        setConnections([]);
        setInvitations([]);
        setSelectedAccId('');
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.removeItem('lf_selected_account_id');
          localStorage.removeItem('lf_active_account_id');
        }
        setNetLoading(false);
        return;
      }

      let accToUse = targetId || selectedAccId || (typeof window !== 'undefined' ? localStorage.getItem('lf_selected_account_id') : null) || null;
      if (accToUse && !validAccIds.has(accToUse)) {
        accToUse = profiles[0]?.unipile_account_id || null;
        if (typeof window !== 'undefined' && window.localStorage) {
          if (accToUse) localStorage.setItem('lf_selected_account_id', accToUse);
          else localStorage.removeItem('lf_selected_account_id');
        }
      }
      if (!accToUse && profiles?.[0]?.unipile_account_id) {
        accToUse = profiles[0].unipile_account_id;
      }

      let pQuery = supabaseDirect.from('prospects').select('*');
      if (orgId) {
        pQuery = pQuery.eq('organization_id', orgId);
      } else if (userAcc?.email) {
        pQuery = pQuery.eq('user_email', userAcc.email.toLowerCase());
      }

      const [accRes, connRes, invRes, pRes] = await Promise.all([
        getUnipileAccountInfo(accToUse).catch(() => null),
        getNetworkingConnections(accToUse).catch(() => ({ connections: [] })),
        getNetworkingInvitations(accToUse).catch(() => ({ invitations: [] })),
        pQuery.catch(() => ({ data: [] })),
      ]);

      if (accRes && accRes.id) {
        setAccountInfo(accRes);
        const resolvedName = accRes.name || 'LinkedIn Profile';
        setEditName(resolvedName);
        setEditAccId(accRes.id);
        setExistingAccId(accRes.id);
        setDisplayName(resolvedName);
        if (!selectedAccId) setSelectedAccId(accRes.id);
      } else {
        setAccountInfo(null);
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

  const handleSwitchAccount = (newAccId) => {
    setSelectedAccId(newAccId);
    try {
      if (typeof window !== 'undefined') localStorage.setItem('lf_selected_account_id', newAccId);
    } catch {}
    loadNetworkData(newAccId);
  };

  useEffect(() => {
    loadNetworkData();
    if (typeof window !== 'undefined' && window.location.search.includes('hosted_success=true')) {
      const urlParams = new URLSearchParams(window.location.search);
      const accIdFromUrl = urlParams.get('account_id');
      window.history.replaceState({}, '', window.location.pathname);
      if (accIdFromUrl) {
        handleSyncHostedAccount(accIdFromUrl);
      }
    }
  }, []);

  useEffect(() => {
    if (profiles && profiles.length > 0) {
      if (typeof window !== 'undefined' && window.localStorage) {
        try { localStorage.removeItem('lf_account_disconnected'); } catch (e) {}
      }
      if (!selectedAccId && profiles[0]?.unipile_account_id) {
        setSelectedAccId(profiles[0].unipile_account_id);
        loadNetworkData(profiles[0].unipile_account_id);
      }
    } else {
      setSelectedAccId('');
      setAccountInfo(null);
      setConnections([]);
      setInvitations([]);
      setProspects([]);
    }
  }, [profiles]);

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
    let acceptedCount = 0;

    const { start, end } = dateBounds;

    prospects.forEach(p => {
      const invDate = getEventDate(p, 'invitation');
      if (invDate && invDate >= start && invDate <= end) {
        campaignInvitesSent += 1;
      }

      const accDate = getEventDate(p, 'acceptance');
      if (accDate && accDate >= start && accDate <= end) {
        acceptedCount += 1;
      }

      const msgDate = getEventDate(p, 'message');
      if (msgDate && msgDate >= start && msgDate <= end) {
        messagesSent += 1;
      }

      const repDate = getEventDate(p, 'reply');
      if (repDate && p.campaign_id && repDate >= start && repDate <= end) {
        repliesCount += 1;
      }

      const visDate = getEventDate(p, 'visit');
      if (visDate && visDate >= start && visDate <= end) {
        profileViews += 1;
      }
    });

    const invitesSent = campaignInvitesSent;
    const finalAcceptedCount = acceptedCount;
    const acceptanceRate = invitesSent > 0 ? Math.round((finalAcceptedCount / invitesSent) * 100) : 0;
    const replyRate = messagesSent > 0 ? Math.round((repliesCount / messagesSent) * 100) : 0;

    return {
      invitesSent,
      acceptedCount: finalAcceptedCount,
      acceptanceRate,
      messagesSent,
      repliesCount,
      replyRate,
      profileViews,
    };
  }, [prospects, dateBounds]);

  // Duration & Search Filter for Pending Invitations
  const filteredInvitations = useMemo(() => {
    if (!invitations || invitations.length === 0) return [];
    let list = invitations;

    if (withdrawAge && Number(withdrawAge) > 0) {
      const cutoffDays = Number(withdrawAge);
      list = list.filter(inv => (Number(inv.age_days) || 0) >= cutoffDays);
    }

    if (invSearch.trim()) {
      const q = invSearch.toLowerCase().trim();
      list = list.filter(inv => {
        const name = (inv.recipient_name || inv.invited_user || '').toLowerCase();
        const headline = (inv.headline || inv.invited_user_description || '').toLowerCase();
        return name.includes(q) || headline.includes(q);
      });
    }

    return list;
  }, [invitations, withdrawAge, invSearch]);

  // Search Filter for 1st-Degree Network Connections
  const filteredConnections = useMemo(() => {
    if (!connections || connections.length === 0) return [];
    if (!connSearch.trim()) return connections;
    const q = connSearch.toLowerCase().trim();
    return connections.filter(c => {
      const name = (c.name || `${c.first_name || ''} ${c.last_name || ''}`).toLowerCase();
      const headline = (c.headline || c.title || '').toLowerCase();
      const company = (c.company || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      const loc = (c.location || '').toLowerCase();
      return name.includes(q) || headline.includes(q) || company.includes(q) || email.includes(q) || phone.includes(q) || loc.includes(q);
    });
  }, [connections, connSearch]);

  const handleSaveAccountSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      // Use directCreateProfile so organization_id is always stamped on the row
      const existingKey = matchedProfile?.profile_key || (editAccId ? `profile_${editAccId}` : `profile_${Date.now()}`);
      await directCreateProfile({
        profile_key: existingKey,
        display_name: editName || 'LinkedIn Profile',
        unipile_account_id: editAccId,
        session_active: true,
      });
      toast.success('Account settings updated and saved!');
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
    const accName = accountInfo?.name || editName || 'LinkedIn Profile';
    if (!confirm(`Are you sure you want to disconnect and remove ${accName}? This will reset all active profile sessions and inbox access from the tool.`)) {
      return;
    }
    setRemoving(true);
    try {
      const targetId = selectedAccId || accountInfo?.id || editAccId;
      await directDisconnectProfile(targetId);

      setAccountInfo(null);
      setSelectedAccId('');
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
        // Save profile row with correct organization_id
        if (res.account_id) {
          await directCreateProfile({
            profile_key: `profile_${Date.now()}`,
            display_name: directEmail.split('@')[0] || 'LinkedIn Profile',
            unipile_account_id: res.account_id,
            session_active: true,
          });
        }
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
        // Save profile row with correct organization_id
        if (checkpointAccId) {
          await directCreateProfile({
            profile_key: `profile_${Date.now()}`,
            display_name: directEmail.split('@')[0] || 'LinkedIn Profile',
            unipile_account_id: checkpointAccId,
            session_active: true,
          });
        }
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

  const handleOpenHostedLink = async () => {
    setLoading(true);
    try {
      const redirectUrl = typeof window !== 'undefined' ? `${window.location.origin}/profiles?hosted_success=true` : null;
      const res = await createUnipileHostedLink(redirectUrl);
      if (res.success && res.url) {
        window.open(res.url, '_blank');
        toast.success('Opened LinkedIn authentication window. Complete login to link your account.');
      } else {
        toast.error(res.error || 'Failed to generate connection link');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncHostedAccount = async (targetAccId = null) => {
    if (!targetAccId) {
      toast.error('Account ID is required to link an account.');
      return;
    }
    setLoading(true);
    try {
      const res = await importNewestUnipileAccount(targetAccId);
      if (res.success) {
        toast.success(`Connected & saved: ${res.account?.name || 'LinkedIn Profile'}!`);
        setModal(false);
        await fetchProfiles();
        loadNetworkData();
      } else {
        toast.error(res.error || 'Failed to connect LinkedIn account');
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
        // Save profile row with correct organization_id
        if (res.account_id) {
          await directCreateProfile({
            profile_key: `profile_${Date.now()}`,
            display_name: 'LinkedIn Profile',
            unipile_account_id: res.account_id,
            session_active: true,
          });
        }
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
      // directCreateProfile stamps organization_id automatically
      await directCreateProfile({
        profile_key: `profile_${Date.now()}`,
        display_name: displayName || 'LinkedIn Profile',
        unipile_account_id: existingAccId,
        session_active: true,
      });
      toast.success(`LinkedIn Account (${displayName || 'LinkedIn Profile'}) connected & saved!`);
      setModal(false);
      fetchProfiles();
      loadNetworkData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  // CSV Export for Connections with complete enriched contact info (email, phone, company, etc.)
  const exportConnectionsCSV = () => {
    if (!connections || connections.length === 0) {
      return toast.error('No 1st-degree connections loaded to export');
    }

    const headers = [
      'first_name',
      'last_name',
      'full_name',
      'headline',
      'company',
      'email',
      'phone',
      'location',
      'linkedin_url',
      'connected_date',
      'provider_id',
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = connections.map(c => [
      escapeCsv(c.first_name || c.name?.split(' ')[0] || ''),
      escapeCsv(c.last_name || c.name?.split(' ').slice(1).join(' ') || ''),
      escapeCsv(c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || ''),
      escapeCsv(c.headline || c.title || ''),
      escapeCsv(c.company || ''),
      escapeCsv(c.email || ''),
      escapeCsv(c.phone || ''),
      escapeCsv(c.location || ''),
      escapeCsv(c.linkedin_url || (c.public_identifier ? `https://www.linkedin.com/in/${c.public_identifier}` : '')),
      escapeCsv(c.connected_date || ''),
      escapeCsv(c.provider_id || c.member_id || c.id || ''),
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
    toast.success(`Exported ${connections.length} 1st-degree connections with enriched contact info to CSV!`);
  };

  const handleWithdrawByAge = async () => {
    setWithdrawing(true);
    try {
      const res = await withdrawOldInvitations(withdrawAge, selectedAccId);
      if (res.success) {
        toast.success(`Withdrew ${res.withdrawn_count || 0} pending invitations older than ${withdrawAge} days!`);
        loadNetworkData(selectedAccId);
      } else {
        toast.error(res.error || 'Failed to withdraw invitations');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setWithdrawing(false);
    }
  };

  const handleStartPacedWithdraw = async () => {
    if (filteredInvitations.length === 0) return toast.error('No invitations match selected filter');
    if (!confirm(`Start safe paced withdrawal of ${filteredInvitations.length} invitations? Each withdrawal will be executed with human pauses (30-45s) to guarantee zero LinkedIn provider limits.`)) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setPacedActive(true);
    setPacedProgress({ current: 0, total: filteredInvitations.length, withdrawn_count: 0, currentRecipient: '' });

    try {
      const res = await pacedWithdrawInvitations(
        filteredInvitations,
        selectedAccId,
        (progress) => setPacedProgress(progress),
        controller.signal
      );
      if (res.stopped) {
        toast.success(`Paced withdrawal paused. Safely cancelled ${res.withdrawn_count} invitations.`);
      } else {
        toast.success(`Completed safe paced withdrawal of ${res.withdrawn_count} invitations!`);
      }
      loadNetworkData(selectedAccId);
    } catch (e) {
      toast.error(e.message || 'Error during paced withdrawal');
    } finally {
      setPacedActive(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopPacedWithdraw = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setPacedActive(false);
    toast('Stopping paced withdrawal...');
  };

  const handleToggleAutoWithdraw = async () => {
    if (!matchedProfile) return;
    const isCurrentlyOn = Boolean(matchedProfile.settings?.auto_withdraw_stale_invitations);
    const newSettings = {
      ...(matchedProfile.settings || {}),
      auto_withdraw_stale_invitations: !isCurrentlyOn,
      withdraw_age_days: matchedProfile.settings?.withdraw_age_days || 90,
      daily_withdraw_limit: matchedProfile.settings?.daily_withdraw_limit || 15,
    };
    try {
      await directCreateProfile({
        ...matchedProfile,
        settings: newSettings,
      });
      toast.success(
        newSettings.auto_withdraw_stale_invitations
          ? `Auto-withdrawal activated! Stale invites (> ${newSettings.withdraw_age_days}d) will be safely cleaned in the background.`
          : 'Background auto-withdrawal deactivated.'
      );
      await fetchProfiles();
    } catch (e) {
      toast.error('Failed to update setting');
    }
  };

  const handleChangeAutoWithdrawAge = async (days) => {
    if (!matchedProfile) return;
    const newSettings = {
      ...(matchedProfile.settings || {}),
      withdraw_age_days: Number(days),
    };
    try {
      await directCreateProfile({
        ...matchedProfile,
        settings: newSettings,
      });
      toast.success(`Threshold updated to ${days} days`);
      await fetchProfiles();
    } catch (e) {
      toast.error('Failed to update setting');
    }
  };

  const handleCancelSingleInvite = async (invId) => {
    try {
      const res = await cancelNetworkingInvitation(invId, selectedAccId);
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

  const isAccountConnected = Boolean(profiles && profiles.length > 0);
  const matchedProfile = profiles.find(p => p.unipile_account_id === (selectedAccId || accountInfo?.id)) || profiles[0];
  const profileDisplayName = matchedProfile?.display_name || accountInfo?.name || 'LinkedIn Profile';
  const connectionStatus = accountInfo?.status || (isAccountConnected ? 'CONNECTED' : 'DISCONNECTED');

  const tabs = [
    { id: 'network', label: 'Network & Connections' },
    { id: 'account', label: 'Account Settings' },
  ];

  return (
    <Layout>
      
      {/* ── 1. TOP SECTION: PROFILE NAME, STATUS BANNER & CONNECTION COUNT ── */}
      {isAccountConnected && (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#6366f1] via-indigo-600 to-purple-600 text-white font-bold text-2xl flex items-center justify-center shadow-lg">
              {profileDisplayName ? profileDisplayName[0].toUpperCase() : 'L'}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-white text-2xl font-extrabold">{profileDisplayName}</h1>
                {profiles && profiles.length > 1 && (
                  <select
                    value={selectedAccId || profiles[0]?.unipile_account_id}
                    onChange={e => handleSwitchAccount(e.target.value)}
                    className="bg-[#111111] border border-[#333333] hover:border-[#6366f1] text-white text-xs font-medium rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#6366f1] transition-all cursor-pointer shadow-sm"
                    title="Switch Connected LinkedIn Account"
                  >
                    {profiles.map(p => (
                      <option key={p.unipile_account_id || p.profile_key} value={p.unipile_account_id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                )}
                {connectionStatus === 'CONNECTED' || connectionStatus === 'OK' ? (
                  <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    LinkedIn Connected
                  </span>
                ) : connectionStatus === 'RECONNECT_REQUIRED' || connectionStatus === 'EXPIRED' ? (
                  <span className="text-xs px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    Reconnection Required
                  </span>
                ) : (
                  <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    LinkedIn Connected
                  </span>
                )}
                <span className="text-xs px-3.5 py-1 rounded-full bg-[#6366f1]/10 text-[#6366f1] border border-[#6366f1]/20 font-bold flex items-center gap-1.5 shadow-sm">
                  <Users size={14} />
                  {connections.length} 1st-Degree Connections
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
            Your LinkedIn profile is currently disconnected. Connect your LinkedIn profile to sync contacts, manage pending invitations, and run automated campaigns.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              onClick={() => setModal(true)}
              className="px-6 py-3 bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-bold rounded-xl shadow-lg transition-all flex items-center gap-2"
            >
              <Plus size={16} /> Connect LinkedIn Account
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="px-6 py-3 border border-[#2a2a2a] bg-[#111111] hover:bg-[#222222] text-[#9ca3af] hover:text-white text-xs font-bold rounded-xl transition-all"
            >
              Go to Settings
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── 2. NETWORK & CONNECTIONS SECTION ────────────────────────────────────────── */}
          <div className="space-y-6">
            
            {/* Pending Sent Invitations Section */}
            <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 space-y-4 shadow-xl">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-white font-bold text-lg flex items-center gap-2">
                    <Clock size={20} className="text-[#6366f1]" />
                    Pending Sent Invitations ({filteredInvitations.length}{invitations.length !== filteredInvitations.length ? ` of ${invitations.length}` : ''})
                  </h3>
                  <p className="text-[#6b7280] text-xs mt-1">
                    Outbound connection requests waiting for acceptance on LinkedIn. Filter by age or search to clean up stale requests safely.
                  </p>
                </div>

                {/* Age Selection Duration Dropdown & Paced Withdraw Button */}
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={withdrawAge}
                    onChange={e => setWithdrawAge(Number(e.target.value))}
                    className="bg-[#111111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-xs font-medium focus:outline-none focus:border-[#6366f1]"
                  >
                    <option value={0}>All Pending ({invitations.length})</option>
                    <option value={30}>Older than 30 days (1 mo)</option>
                    <option value={60}>Older than 60 days (2 mo)</option>
                    <option value={90}>Older than 90 days (3 mo - Recommended)</option>
                    <option value={180}>Older than 180 days (6 mo)</option>
                    <option value={365}>Older than 1 year (365d)</option>
                  </select>

                  {pacedActive ? (
                    <button
                      onClick={handleStopPacedWithdraw}
                      className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white border border-red-500 text-xs font-bold rounded-xl transition-all shadow-lg animate-pulse"
                    >
                      <StopCircle size={14} /> Stop Paced Cleanup
                    </button>
                  ) : (
                    <button
                      onClick={handleStartPacedWithdraw}
                      disabled={withdrawing || filteredInvitations.length === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold rounded-xl transition-all disabled:opacity-50"
                      title="Safely withdraw with 30-45s human pauses to prevent provider limits"
                    >
                      <Shield size={14} className="text-indigo-400" />
                      Start Paced Cleanup ({filteredInvitations.length})
                    </button>
                  )}
                </div>
              </div>

              {/* Background Auto-Withdrawal Banner */}
              <div className="p-4 rounded-xl bg-[#111111] border border-[#2a2a2a] flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                    <Shield size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white text-xs font-bold">Automated Background Hygiene</span>
                      {matchedProfile?.settings?.auto_withdraw_stale_invitations ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Active (15/day safe pace)
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-800 text-neutral-400 border border-neutral-700">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-[#9ca3af] text-[11px] mt-0.5">
                      Automatically withdraws 1 stale request per runner cycle in the background with human spacing to keep your account safe from limits.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-xs text-[#9ca3af]">
                    <span>Threshold:</span>
                    <select
                      value={matchedProfile?.settings?.withdraw_age_days || 90}
                      onChange={e => handleChangeAutoWithdrawAge(Number(e.target.value))}
                      className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-2.5 py-1.5 text-white text-xs font-medium focus:outline-none focus:border-[#6366f1]"
                    >
                      <option value={30}>30 days (1 mo)</option>
                      <option value={60}>60 days (2 mo)</option>
                      <option value={90}>90 days (3 mo)</option>
                      <option value={180}>180 days (6 mo)</option>
                      <option value={365}>365 days (1 yr)</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleToggleAutoWithdraw}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      matchedProfile?.settings?.auto_withdraw_stale_invitations ? 'bg-[#6366f1]' : 'bg-[#2a2a2a]'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        matchedProfile?.settings?.auto_withdraw_stale_invitations ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Active Paced Withdrawal Progress Indicator */}
              {pacedActive && (
                <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/40 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-indigo-300 font-bold flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin text-indigo-400" />
                      Safe Paced Withdrawal in Progress...
                    </span>
                    <span className="text-white font-mono font-semibold">
                      {pacedProgress.current} / {pacedProgress.total} ({pacedProgress.withdrawn_count} cancelled)
                    </span>
                  </div>
                  <div className="w-full bg-[#111111] rounded-full h-2 overflow-hidden border border-indigo-500/20">
                    <div
                      className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${pacedProgress.total > 0 ? (pacedProgress.current / pacedProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-indigo-200/80">
                    Currently withdrawing: <span className="font-semibold text-white">{pacedProgress.currentRecipient || 'LinkedIn Member'}</span> with 30-45s human delay to protect your account.
                  </p>
                </div>
              )}

              {/* Search Bar for Pending Invitations */}
              <div className="relative">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7280]" />
                <input
                  type="text"
                  placeholder="Filter pending invitations by recipient name, title..."
                  value={invSearch}
                  onChange={e => setInvSearch(e.target.value)}
                  className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl pl-10 pr-4 py-2 text-white text-xs placeholder-[#6b7280] focus:outline-none focus:border-[#6366f1]"
                />
              </div>

              {filteredInvitations.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#2a2a2a] bg-[#111111] p-10 text-center">
                  <p className="text-[#6b7280] text-sm">No pending invitations match the selected duration or search filter.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
                  {filteredInvitations.map((inv, i) => {
                    const invId = inv.id || inv.invitation_id || `inv_${i}`;
                    const name = inv.recipient_name || inv.invited_user || 'LinkedIn Member';
                    const title = inv.headline || inv.invited_user_description || 'Pending Invitation';
                    const photo = inv.photo || inv.invited_user_profile_picture_url;
                    const dateStr = inv.sent_at ? new Date(inv.sent_at).toLocaleDateString() : (inv.date || '');
                    const ageDays = Number(inv.age_days) || 0;

                    return (
                      <div key={invId} className="p-4 rounded-xl border border-[#2a2a2a] bg-[#111111] flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-[#6366f1]/20 border border-[#6366f1]/30 flex items-center justify-center font-bold text-white text-xs shrink-0 overflow-hidden">
                            {photo ? (
                              <img src={photo} alt={name} className="w-full h-full object-cover" />
                            ) : (
                              name.slice(0, 2).toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-white font-bold text-sm truncate">{name}</p>
                              {ageDays >= 365 ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20 shrink-0">
                                  {Math.floor(ageDays / 365)}+ yr old
                                </span>
                              ) : ageDays >= 90 ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                                  {Math.floor(ageDays / 30)} mo old
                                </span>
                              ) : ageDays >= 30 ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
                                  {Math.floor(ageDays / 30)} mo old
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-800 text-neutral-400 border border-neutral-700 shrink-0">
                                  {ageDays}d old
                                </span>
                              )}
                            </div>
                            <p className="text-[#9ca3af] text-xs truncate mt-0.5">{title}</p>
                            {dateStr && <p className="text-[#6b7280] text-[10px] mt-0.5">Sent {dateStr}</p>}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {inv.linkedin_url && (
                            <a
                              href={inv.linkedin_url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:border-[#6366f1]"
                              title="View LinkedIn Profile"
                            >
                              <ExternalLink size={13} />
                            </a>
                          )}
                          <button
                            onClick={() => handleCancelSingleInvite(invId)}
                            className="px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-colors"
                          >
                            Withdraw
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 1st-Degree Connections List Section (With Rich Contact Badges & CSV Export) */}
            <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 space-y-4 shadow-xl">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-white font-bold text-lg flex items-center gap-2">
                    <UserCheck size={20} className="text-emerald-400" />
                    1st-Degree Network Connections ({filteredConnections.length}{connections.length !== filteredConnections.length ? ` of ${connections.length}` : ''})
                  </h3>
                  <p className="text-[#6b7280] text-xs mt-1">
                    Active 1st-degree connections synced from your profile with phone, email, and company data.
                  </p>
                </div>

                {/* CSV Export & Refresh */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={exportConnectionsCSV}
                    disabled={connections.length === 0}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-[#22c55e] hover:bg-[#16a34a] text-white font-bold text-xs rounded-xl transition-all shadow-md disabled:opacity-50 cursor-pointer"
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

              {/* Search Bar for Connections */}
              <div className="relative">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7280]" />
                <input
                  type="text"
                  placeholder="Search connections by name, company, email, phone, title..."
                  value={connSearch}
                  onChange={e => setConnSearch(e.target.value)}
                  className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl pl-10 pr-4 py-2 text-white text-xs placeholder-[#6b7280] focus:outline-none focus:border-[#6366f1]"
                />
              </div>

              {netLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-[#6366f1]" />
                </div>
              ) : connections.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#2a2a2a] bg-[#111111] p-10 text-center">
                  <p className="text-[#6b7280] text-sm">No 1st-degree connections loaded yet. Click Refresh to sync from LinkedIn.</p>
                </div>
              ) : filteredConnections.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#2a2a2a] bg-[#111111] p-10 text-center">
                  <p className="text-[#6b7280] text-sm">No connections match "{connSearch}".</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[540px] overflow-y-auto pr-1">
                  {filteredConnections.map((c, i) => {
                    const cName = c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'LinkedIn Member';
                    const cTitle = c.headline || c.title || '1st-Degree Connection';
                    const cLink = c.linkedin_url || c.public_profile_url || `https://www.linkedin.com/in/${c.public_identifier || c.member_id || c.id}`;
                    const photo = c.profile_picture_url || c.avatar_url;

                    return (
                      <div key={c.id || i} className="p-3.5 rounded-xl border border-[#2a2a2a] bg-[#111111] flex flex-col justify-between gap-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-[#6366f1]/20 border border-[#6366f1]/30 flex items-center justify-center font-bold text-white text-xs shrink-0 overflow-hidden">
                              {photo ? (
                                <img src={photo} alt={cName} className="w-full h-full object-cover" />
                              ) : (
                                cName.slice(0, 2).toUpperCase()
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-white font-bold text-xs truncate">{cName}</p>
                              <p className="text-[#9ca3af] text-[11px] truncate">{cTitle}</p>
                              {c.company && (
                                <p className="text-[#6b7280] text-[10px] truncate flex items-center gap-1 mt-0.5">
                                  <Building size={10} /> {c.company}
                                </p>
                              )}
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

                        {/* Contact info badges (Email, Phone) */}
                        {(c.email || c.phone) && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[#1f1f1f]">
                            {c.email && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20 font-mono truncate max-w-full" title={c.email}>
                                <Mail size={10} className="shrink-0" />
                                <span className="truncate">{c.email}</span>
                              </span>
                            )}
                            {c.phone && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 font-mono shrink-0" title={c.phone}>
                                <Phone size={10} />
                                {c.phone}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#111111] border border-[#2a2a2a] rounded-2xl p-6 max-w-md w-full shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between border-b border-[#2a2a2a] pb-3">
              <h3 className="text-white font-bold text-base flex items-center gap-2">
                <Globe className="text-[#6366f1]" size={18} /> Connect LinkedIn Account
              </h3>
              <button onClick={() => setModal(false)} className="text-[#9ca3af] hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Hosted Link 1-Click Connect */}
              <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-4 text-center space-y-2.5">
                <div className="flex items-center justify-center gap-2 text-indigo-400 font-semibold text-xs">
                  <Sparkles size={15} />
                  <span>Recommended: Official 1-Click Connect</span>
                </div>
                <p className="text-[11px] text-[#9ca3af] leading-relaxed">
                  Connect securely via official Unipile auth link with full 2FA and OTP support.
                </p>
                <button
                  type="button"
                  onClick={handleOpenHostedLink}
                  disabled={loading}
                  className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : <ExternalLink size={15} />}
                  Connect via Official LinkedIn Link
                </button>
              </div>

              <div className="relative flex items-center justify-center my-1">
                <div className="border-t border-[#2a2a2a] w-full" />
                <span className="bg-[#111111] px-3 text-[10px] text-[#6b7280] uppercase tracking-wider font-semibold">Or Connect Manually</span>
                <div className="border-t border-[#2a2a2a] w-full" />
              </div>

              <div className="flex rounded-xl bg-[#1a1a1a] p-1 border border-[#2a2a2a]">
                <button
                  onClick={() => setConnMethod('account_id')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    connMethod === 'account_id' ? 'bg-[#6366f1] text-white shadow-md' : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  Account ID
                </button>
                <button
                  onClick={() => setConnMethod('cookie')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    connMethod === 'cookie' ? 'bg-[#6366f1] text-white shadow-md' : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  Cookie (li_at)
                </button>
                <button
                  onClick={() => setConnMethod('direct')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    connMethod === 'direct' ? 'bg-[#6366f1] text-white shadow-md' : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  Credentials
                </button>
              </div>

              {connMethod === 'account_id' && (
                <form onSubmit={handleConnectAccountId} className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs font-semibold text-[#9ca3af] mb-1">Display Name</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={e => setDisplayName(e.target.value)}
                      placeholder="e.g. Ken Ryan"
                      className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#9ca3af] mb-1">LinkedIn Account ID (from Unipile)</label>
                    <input
                      type="text"
                      value={existingAccId}
                      onChange={e => setExistingAccId(e.target.value)}
                      placeholder="e.g. Jf5LTKlsTTa969buU8kOfA"
                      className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#6366f1]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !existingAccId.trim()}
                    className="w-full py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-xs rounded-xl shadow-lg transition-all disabled:opacity-50"
                  >
                    {loading ? 'Connecting...' : 'Save LinkedIn Account'}
                  </button>
                </form>
              )}

              {connMethod === 'cookie' && (
                <form onSubmit={handleConnectCookie} className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs font-semibold text-[#9ca3af] mb-1">LinkedIn Session Cookie (li_at)</label>
                    <input
                      type="password"
                      value={cookieVal}
                      onChange={e => setCookieVal(e.target.value)}
                      placeholder="AQEDAT... (li_at cookie value)"
                      className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#6366f1]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !cookieVal.trim()}
                    className="w-full py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-xs rounded-xl shadow-lg transition-all disabled:opacity-50"
                  >
                    {loading ? 'Connecting...' : 'Connect with Session Cookie'}
                  </button>
                </form>
              )}

              {connMethod === 'direct' && (
                <form onSubmit={handleConnectDirect} className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs font-semibold text-[#9ca3af] mb-1">LinkedIn Email</label>
                    <input
                      type="email"
                      value={directEmail}
                      onChange={e => setDirectEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#9ca3af] mb-1">LinkedIn Password</label>
                    <input
                      type="password"
                      value={directPassword}
                      onChange={e => setDirectPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !directEmail.trim()}
                    className="w-full py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-xs rounded-xl shadow-lg transition-all disabled:opacity-50"
                  >
                    {loading ? 'Connecting via Unipile...' : 'Authenticate LinkedIn Profile'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
