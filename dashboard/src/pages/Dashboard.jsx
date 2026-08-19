import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserPlus, UserCheck, MessageSquare, Reply, Eye, ThumbsUp,
  Megaphone, Activity as ActivityIcon, ArrowRight, RefreshCw, Loader2,
  TrendingUp, ExternalLink, ChevronLeft, ChevronRight, Check, CornerUpLeft,
  Calendar
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { supabaseDirect, directGetCampaigns } from '../services/directServices';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-sm shadow-xl">
      <p className="text-white font-medium mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-[#9ca3af]">{p.name}:</span>
          <span className="text-white font-medium">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

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

export default function Dashboard() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [prospects, setProspects] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [campaignPage, setCampaignPage] = useState(1);

  // Timeline Filtering State
  const [timeRange, setTimeRange] = useState('month');
  const [customStartDate, setCustomStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [customEndDate, setCustomEndDate] = useState(new Date().toISOString().slice(0, 10));

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Campaigns
      const cRes = await directGetCampaigns();
      setCampaigns(cRes || []);

      // 2. Fetch prospects using multi-tenant filtered directGetProspects
      const { directGetProspects } = await import('../services/directServices');
      const { prospects: pData } = await directGetProspects({ limit: 1000 });
      setProspects(pData || []);

    } catch (err) {
      console.error('Error loading dashboard data:', err);
      toast.error('Failed to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  // Compute Timeline Bounds
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

  // Filter Prospects by Selected Timeline
  const filteredProspects = useMemo(() => {
    const { start, end } = dateBounds;
    return prospects.filter(p => {
      const tsStr = p.updated_at || p.reply_date || p.created_at;
      if (!tsStr) return true;
      const ts = new Date(tsStr);
      return ts >= start && ts <= end;
    });
  }, [prospects, dateBounds]);

  // Calculate KPI Metrics dynamically based on selected timeline
  const metrics = useMemo(() => {
    let invitesSent = 0;
    let acceptedCount = 0;
    let messagesSent = 0;
    let repliesCount = 0;
    let profileViews = 0;
    let greetingsCount = 0;

    const { start, end } = dateBounds;

    prospects.forEach(p => {
      // 1. Connection Invite Sent
      const invDate = getEventDate(p, 'invitation');
      if (invDate && invDate >= start && invDate <= end) {
        invitesSent += 1;
      }
      
      // 2. Connection Invite Accepted
      const accDate = getEventDate(p, 'acceptance');
      if (accDate && accDate >= start && accDate <= end) {
        acceptedCount += 1;
      }

      // 3. Message Sent
      const msgDate = getEventDate(p, 'message');
      if (msgDate && msgDate >= start && msgDate <= end) {
        messagesSent += 1;
      }

      // 4. Reply Received (must have campaign_id set!)
      const repDate = getEventDate(p, 'reply');
      if (repDate && p.campaign_id && repDate >= start && repDate <= end) {
        repliesCount += 1;
      }

      // 5. Profile Visited
      const visDate = getEventDate(p, 'visit');
      if (visDate && visDate >= start && visDate <= end) {
        profileViews += 1;
      }
    });

    const acceptanceRate = invitesSent > 0 ? Math.round((acceptedCount / invitesSent) * 100) : 0;
    const replyRate = messagesSent > 0 ? Math.round((repliesCount / messagesSent) * 100) : 0;

    return {
      invitesSent,
      acceptedCount,
      acceptanceRate,
      messagesSent,
      repliesCount,
      replyRate,
      profileViews,
      greetingsCount,
    };
  }, [prospects, dateBounds]);

  // Extract Replies & Activity for the selected timeline
  const timelineReplies = useMemo(() => {
    const { start, end } = dateBounds;
    return prospects.filter(p => {
      if (!p.campaign_id || !p.reply_date) return false;
      const d = new Date(p.reply_date);
      return d >= start && d <= end;
    });
  }, [prospects, dateBounds]);

  const timelineActivities = useMemo(() => {
    const { start, end } = dateBounds;
    const list = [];
    prospects.forEach(p => {
      const prospectName = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name || 'LinkedIn Member';
      const headlineStr = p.title || p.company || 'Prospect';
      
      if (p.connection_sent_date) {
        const d = new Date(p.connection_sent_date);
        if (d >= start && d <= end) {
          list.push({
            id: p.id + '_conn',
            name: prospectName,
            headline: headlineStr,
            avatar_url: p.avatar_url,
            action: 'Connection request sent',
            campaign_id: p.campaign_id,
            timestamp: d,
          });
        }
      }
      if (p.accepted_at) {
        const d = new Date(p.accepted_at);
        if (d >= start && d <= end) {
          list.push({
            id: p.id + '_acc',
            name: prospectName,
            headline: headlineStr,
            avatar_url: p.avatar_url,
            action: 'Connection accepted',
            campaign_id: p.campaign_id,
            timestamp: d,
          });
        }
      }
      if (p.message_sent_date) {
        const d = new Date(p.message_sent_date);
        if (d >= start && d <= end) {
          list.push({
            id: p.id + '_msg',
            name: prospectName,
            headline: headlineStr,
            avatar_url: p.avatar_url,
            action: 'Message sent',
            campaign_id: p.campaign_id,
            timestamp: d,
          });
        }
      }
      if (p.reply_date && p.campaign_id) {
        const d = new Date(p.reply_date);
        if (d >= start && d <= end) {
          list.push({
            id: p.id + '_rep',
            name: prospectName,
            headline: headlineStr,
            avatar_url: p.avatar_url,
            action: 'LinkedIn reply detected',
            campaign_id: p.campaign_id,
            timestamp: d,
          });
        }
      }
      if (p.visited_date) {
        const d = new Date(p.visited_date);
        if (d >= start && d <= end) {
          list.push({
            id: p.id + '_vis',
            name: prospectName,
            headline: headlineStr,
            avatar_url: p.avatar_url,
            action: 'Profile visited',
            campaign_id: p.campaign_id,
            timestamp: d,
          });
        }
      }
    });

    return list
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10)
      .map(act => ({
        ...act,
        time: act.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
  }, [prospects, dateBounds]);

  // Campaign pagination calculations
  const totalCampaignPages = Math.ceil(campaigns.length / itemsPerPage) || 1;
  const paginatedCampaigns = useMemo(() => {
    const start = (campaignPage - 1) * itemsPerPage;
    return campaigns.slice(start, start + itemsPerPage);
  }, [campaigns, campaignPage, itemsPerPage]);

  // Chart Data preparation
  const chartData = useMemo(() => {
    return campaigns.slice(0, 6).map(c => ({
      name: c.name ? (c.name.length > 18 ? c.name.slice(0, 18) + '...' : c.name) : 'Campaign',
      Sent: c.sent || 0,
      Accepted: c.accepted || 0,
      Replied: c.replied || 0,
    }));
  }, [campaigns]);

  // Campaign ID to Name map
  const campaignsMap = useMemo(() => {
    const map = {};
    campaigns.forEach(c => { map[c.id] = c.name; });
    return map;
  }, [campaigns]);

  return (
    <Layout>
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="text-white text-2xl font-bold">Dashboard</h1>
          <p className="text-[#6b7280] text-sm mt-1">Overview of your LinkedIn outreach performance and live timeline activity</p>
        </div>
        <button
          onClick={loadDashboardData}
          className="p-2.5 rounded-xl border border-[#2a2a2a] bg-[#111111] text-[#9ca3af] hover:text-white transition-all flex items-center gap-2 text-xs font-semibold self-start md:self-auto"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh Stats
        </button>
      </div>

      {/* TIMELINE / DATE RANGE FILTER BAR (Matching Screenshot DateRangeFilter.png) */}
      <div className="mb-6 bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-2.5 flex flex-wrap items-center justify-between gap-3 shadow-xl">
        
        {/* Preset Timeline Buttons */}
        <div className="flex flex-wrap items-center bg-[#111111] p-1 rounded-xl border border-[#2a2a2a]">
          {TIMELINE_PRESETS.map(t => (
            <button
              key={t.key}
              onClick={() => setTimeRange(t.key)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                timeRange === t.key
                  ? 'bg-[#6366f1] text-white shadow-md shadow-indigo-500/20'
                  : 'text-[#9ca3af] hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Custom Date Pickers */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-[#111111] border border-[#2a2a2a] rounded-xl px-3 py-1.5">
            <Calendar size={14} className="text-[#6366f1]" />
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
            <Calendar size={14} className="text-[#6366f1]" />
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

      {/* 1. TOP KPI CARDS ROW (5 Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 mb-6">
        
        {/* Card 1: Invites Sent */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 flex items-center justify-between shadow-xl">
          <div>
            <p className="text-[#9ca3af] text-xs font-medium">Invites Sent</p>
            <p className="text-white font-extrabold text-2xl mt-1">{metrics.invitesSent}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 flex items-center justify-center text-[#6366f1] shrink-0">
            <UserPlus size={20} />
          </div>
        </div>

        {/* Card 2: Accepted */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 flex items-center justify-between shadow-xl">
          <div>
            <p className="text-[#9ca3af] text-xs font-medium">Accepted</p>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-white font-extrabold text-2xl">{metrics.acceptedCount}</span>
              <span className="text-emerald-400 text-xs font-bold font-mono">({metrics.acceptanceRate}%)</span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <UserCheck size={20} />
          </div>
        </div>

        {/* Card 3: Messages */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 flex items-center justify-between shadow-xl">
          <div>
            <p className="text-[#9ca3af] text-xs font-medium">Messages</p>
            <p className="text-white font-extrabold text-2xl mt-1">{metrics.messagesSent}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 flex items-center justify-center text-[#6366f1] shrink-0">
            <MessageSquare size={20} />
          </div>
        </div>

        {/* Card 4: Replies */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 flex items-center justify-between shadow-xl">
          <div>
            <p className="text-[#9ca3af] text-xs font-medium">Replies</p>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-white font-extrabold text-2xl">{metrics.repliesCount}</span>
              <span className="text-amber-400 text-xs font-bold font-mono">({metrics.replyRate}%)</span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
            <Reply size={20} />
          </div>
        </div>

        {/* Card 5: Profile Views */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 flex items-center justify-between shadow-xl">
          <div>
            <p className="text-[#9ca3af] text-xs font-medium">Profile Views</p>
            <p className="text-white font-extrabold text-2xl mt-1">{metrics.profileViews}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
            <Eye size={20} />
          </div>
        </div>

      </div>

      {/* 2. CAMPAIGN PERFORMANCE CHART */}
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 mb-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-white font-bold text-base">Campaign Conversion Metrics ({TIMELINE_PRESETS.find(t => t.key === timeRange)?.label})</h3>
            <p className="text-[#6b7280] text-xs mt-0.5">Comparison of invitations sent, acceptances, and replies per campaign</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} barSize={14}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff08' }} />
            <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12, paddingTop: 10 }} />
            <Bar dataKey="Sent" fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Accepted" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Replied" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 3. CAMPAIGNS WIDGET TABLE (Matching Screenshot 2) */}
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] overflow-hidden shadow-xl mb-6">
        <div className="p-4 border-b border-[#2a2a2a] bg-[#111111] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone size={18} className="text-[#6366f1]" />
            <h3 className="text-white font-bold text-base">Campaigns</h3>
          </div>
          <button
            onClick={() => navigate('/campaigns')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-bold transition-all shadow-md"
          >
            <span>Go to Campaigns</span>
            <ArrowRight size={13} />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-[#6366f1]" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-8 text-center text-[#6b7280] text-xs">No active campaigns. Create a campaign to start outreach!</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#111111] border-b border-[#2a2a2a] text-[#6b7280] text-xs font-semibold uppercase tracking-wider">
                  <th className="py-3.5 px-4">Name</th>
                  <th className="py-3.5 px-4 text-center">Contacts</th>
                  <th className="py-3.5 px-4 text-center">Days</th>
                  <th className="py-3.5 px-4 text-center">Steps</th>
                  <th className="py-3.5 px-4 text-center">Actions</th>
                  <th className="py-3.5 px-4 text-center">Replies</th>
                  <th className="py-3.5 px-4 text-center">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]/60 text-sm">
                {paginatedCampaigns.map(c => {
                  const contactsCount = c.prospect_count ?? c.contacts ?? 0;
                  const daysCount = c.days_running ?? 0;
                  const stepsCount = c.steps_count ?? (c.sequence_config?.flow_sequence?.nodes?.length) ?? 0;
                  const actionsCount = c.actions_executed ?? 0;
                  const repliesCount = c.replies_count ?? 0;
                  const progressPct = c.progress_percentage ?? 0;

                  return (
                    <tr key={c.id} className="hover:bg-[#222222]/50 transition-colors">
                      {/* Name */}
                      <td className="py-4 px-4 min-w-[220px]">
                        <div className="flex items-center gap-3">
                          <span className="w-7 h-7 rounded-full bg-[#0a66c2] text-white flex items-center justify-center text-xs font-bold shrink-0">
                            in
                          </span>
                          <div>
                            <p
                              onClick={() => navigate(`/campaigns/${c.id}`)}
                              className="text-[#818cf8] font-bold text-sm hover:underline cursor-pointer"
                            >
                              {c.name || 'Outreach Campaign'}
                            </p>
                            <p className="text-[#6b7280] text-xs">CSV Upload</p>
                          </div>
                        </div>
                      </td>

                      {/* Contacts */}
                      <td className="py-4 px-4 text-center text-white font-medium">{contactsCount}</td>

                      {/* Days */}
                      <td className="py-4 px-4 text-center text-white font-medium">{daysCount}</td>

                      {/* Steps */}
                      <td className="py-4 px-4 text-center text-white font-medium">{stepsCount}</td>

                      {/* Actions */}
                      <td className="py-4 px-4 text-center text-white font-medium">{actionsCount}</td>

                      {/* Replies (Red Text Badge matching Screenshot 2) */}
                      <td className="py-4 px-4 text-center">
                        <span className="text-red-400 font-extrabold text-sm">{repliesCount}</span>
                      </td>

                      {/* Progress Bar */}
                      <td className="py-4 px-4 text-center min-w-[140px]">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-24 bg-[#252525] rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-emerald-500 h-full rounded-full transition-all"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <span className="text-xs font-bold text-white font-mono">{progressPct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer Pagination */}
        <div className="bg-[#111111] border-t border-[#2a2a2a] px-4 py-3 flex items-center justify-between text-xs text-[#6b7280]">
          <span>{campaigns.length > 0 ? `1 - ${paginatedCampaigns.length} of ${campaigns.length} items` : '0 items'}</span>
          <div className="flex items-center gap-2">
            <span>{campaignPage} of {totalCampaignPages} page</span>
            <button
              onClick={() => setCampaignPage(p => Math.max(1, p - 1))}
              disabled={campaignPage === 1}
              className="p-1 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setCampaignPage(p => Math.min(totalCampaignPages, p + 1))}
              disabled={campaignPage === totalCampaignPages}
              className="p-1 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* 4. TWO-COLUMN ROW: REPLIES WIDGET & ACTIVITY WIDGET (Matching Screenshots 3 & 4) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* REPLIES WIDGET (Matching Screenshot 3) */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] overflow-hidden shadow-xl">
          <div className="p-4 border-b border-[#2a2a2a] bg-[#111111] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Reply size={18} className="text-[#6366f1]" />
              <h3 className="text-white font-bold text-base">Replies</h3>
            </div>
            <button
              onClick={() => navigate('/replies')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-bold transition-all shadow-md"
            >
              <span>Go to Replies</span>
              <ArrowRight size={13} />
            </button>
          </div>

          <div className="divide-y divide-[#2a2a2a]/60">
            {timelineReplies.length === 0 ? (
              <div className="p-8 text-center text-[#6b7280] text-xs">No prospect replies in selected timeline ({TIMELINE_PRESETS.find(t => t.key === timeRange)?.label}).</div>
            ) : (
              timelineReplies.slice(0, 5).map(r => (
                <div key={r.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-[#222222]/50 transition-colors">
                  {/* Name */}
                  <div className="flex items-center gap-3 min-w-[160px]">
                    <div className="w-9 h-9 rounded-full bg-[#6366f1]/20 border border-[#6366f1]/30 flex items-center justify-center font-bold text-white shrink-0 text-xs">
                      {r.avatar_url ? (
                        <img src={r.avatar_url} alt={r.name} className="w-full h-full rounded-full object-cover" />
                      ) : (
                        (r.name || 'P').slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <p
                        onClick={() => navigate('/inbox', { state: { selectProspect: r } })}
                        className="text-[#818cf8] font-bold text-xs hover:underline cursor-pointer truncate"
                      >
                        {r.name || 'Ibukun Orefuja'}
                      </p>
                      <p className="text-[#6b7280] text-[11px] truncate">{r.job_title || r.company || 'Founder'}</p>
                    </div>
                  </div>

                  {/* Message */}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="w-4 h-4 rounded-full bg-[#0a66c2] text-white flex items-center justify-center text-[9px] font-bold shrink-0">
                      in
                    </span>
                    <p className="text-[#d1d5db] text-xs truncate">
                      {r.last_message || 'Hello I can\'t seem to understand the message...'}
                    </p>
                  </div>

                  {/* Campaign & Quick Action */}
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[#818cf8] text-xs font-medium hover:underline cursor-pointer hidden sm:inline" onClick={() => navigate('/campaigns')}>
                      {campaignsMap[r.campaign_id] || 'Healthcare Direct Messaging'}
                    </span>
                    <button
                      onClick={() => navigate('/inbox', { state: { selectProspect: r } })}
                      className="p-1.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white transition-all"
                      title="Quick Reply"
                    >
                      <CornerUpLeft size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ACTIVITY WIDGET (Matching Screenshot 4) */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] overflow-hidden shadow-xl">
          <div className="p-4 border-b border-[#2a2a2a] bg-[#111111] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ActivityIcon size={18} className="text-[#6366f1]" />
              <h3 className="text-white font-bold text-base">Activity</h3>
            </div>
            <button
              onClick={() => navigate('/replies')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-bold transition-all shadow-md"
            >
              <span>Go to Activity</span>
              <ArrowRight size={13} />
            </button>
          </div>

          <div className="divide-y divide-[#2a2a2a]/60">
            {timelineActivities.length === 0 ? (
              <div className="p-8 text-center text-[#6b7280] text-xs">No activity logged in selected timeline ({TIMELINE_PRESETS.find(t => t.key === timeRange)?.label}).</div>
            ) : (
              timelineActivities.slice(0, 5).map(act => (
                <div key={act.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-[#222222]/50 transition-colors">
                  {/* Name */}
                  <div className="flex items-center gap-3 min-w-[160px]">
                    <div className="w-9 h-9 rounded-full bg-[#6366f1]/20 border border-[#6366f1]/30 flex items-center justify-center font-bold text-white shrink-0 text-xs">
                      {act.avatar_url ? (
                        <img src={act.avatar_url} alt={act.name} className="w-full h-full rounded-full object-cover" />
                      ) : (
                        (act.name || 'P').slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[#818cf8] font-bold text-xs truncate">{act.name}</p>
                      <p className="text-[#6b7280] text-[11px] truncate">{act.headline}</p>
                    </div>
                  </div>

                  {/* Action Description */}
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-semibold truncate">{act.action}</p>
                  </div>

                  {/* Campaign */}
                  <div className="shrink-0">
                    <span className="text-[#818cf8] text-xs font-medium hover:underline cursor-pointer" onClick={() => navigate('/campaigns')}>
                      {campaignsMap[act.campaign_id] || 'Healthcare Direct Messaging'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </Layout>
  );
}
