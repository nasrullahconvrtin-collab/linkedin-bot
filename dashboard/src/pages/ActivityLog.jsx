import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getProspects, getCampaigns, getProfiles } from '../services/api';
import {
  Activity, Clock, Download, Eye, Loader2, MessageSquare,
  RefreshCw, Search, Send, UserCheck, ExternalLink, Filter
} from 'lucide-react';
import toast from 'react-hot-toast';

function csvEscape(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

export default function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [campaignsMap, setCampaignsMap] = useState(new Map());

  const loadData = async () => {
    setLoading(true);
    try {
      const [cRes, pRes, prRes] = await Promise.all([
        getCampaigns().catch(() => ({ campaigns: [] })),
        getProspects({ limit: 3000 }).catch(() => ({ prospects: [] })),
        getProfiles().catch(() => []),
      ]);

      const cMap = new Map((cRes.campaigns || []).map(c => [c.id, c.name]));
      const prMap = new Map((Array.isArray(prRes) ? prRes : []).map(p => [p.profile_key, p.display_name]));
      setCampaignsMap(cMap);

      const prospects = pRes.prospects || [];
      const events = [];

      prospects.forEach(p => {
        const pName = p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.linkedin_url || 'Prospect';
        const campaignName = cMap.get(p.campaign_id) || 'General Queue';
        const accountName = prMap.get(p.assigned_account) || p.assigned_account || 'Default Account';
        const cv = p.custom_variables || {};
        const history = cv.history || [];

        if (Array.isArray(history) && history.length > 0) {
          history.forEach((h, idx) => {
            events.push({
              id: `${p.id}-h-${idx}`,
              prospect_name: pName,
              prospect_id: p.id,
              campaign_name: campaignName,
              account_name: accountName,
              linkedin_url: p.linkedin_url,
              company: p.company,
              job_title: p.job_title || p.headline,
              node_type: h.node_type || h.type || 'action',
              node_label: h.node_label || h.label || h.node_type || 'Action Executed',
              status: h.status || 'success',
              executed_at: h.executed_at || h.timestamp || p.created_at,
              details: h.reply_text || h.message || h.error || '',
            });
          });
        }

        // Always check connection accepted state
        const isAccepted = (p.status || '').toLowerCase() === 'connection accepted' ||
                           (p.connection_status || '').toLowerCase() === 'connected' ||
                           Boolean(p.accepted_at) ||
                           Boolean(cv.accepted_at);

        if (isAccepted) {
          const acceptedTs = p.accepted_at || cv.accepted_at || p.updated_at || p.created_at || new Date().toISOString();
          const hasInHistory = history.some(h => (h.node_type || h.type || '').toLowerCase().includes('accept'));
          if (!hasInHistory) {
            events.push({
              id: `${p.id}-acc-event`,
              prospect_name: pName,
              prospect_id: p.id,
              campaign_name: campaignName,
              account_name: accountName,
              linkedin_url: p.linkedin_url,
              company: p.company,
              job_title: p.job_title || p.headline,
              node_type: 'connection_accepted',
              node_label: 'Connection Accepted',
              status: 'success',
              executed_at: acceptedTs,
              details: `${pName} accepted your LinkedIn connection request! 🎉`,
            });
          }
        }
      });

      events.sort((a, b) => new Date(b.executed_at || 0) - new Date(a.executed_at || 0));
      setLogs(events);
    } catch (e) {
      toast.error('Failed to load activity logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const exportCSV = () => {
    if (!logs.length) return toast.error('No activity logs to export');
    const headers = ['Timestamp', 'Prospect Name', 'Campaign', 'Account', 'Company', 'Job Title', 'Action', 'Status', 'Details', 'LinkedIn URL'];
    const rows = logs.map(a => [
      csvEscape(a.executed_at ? new Date(a.executed_at).toLocaleString() : ''),
      csvEscape(a.prospect_name),
      csvEscape(a.campaign_name),
      csvEscape(a.account_name),
      csvEscape(a.company || ''),
      csvEscape(a.job_title || ''),
      csvEscape(a.node_label || a.node_type || ''),
      csvEscape(a.status || ''),
      csvEscape(a.details || ''),
      csvEscape(a.linkedin_url || '')
    ]);
    const content = `${headers.join(',')}\n${rows.map(r => r.join(',')).join('\n')}`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `linkedflow_activity_log_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${logs.length} activity items`);
  };

  const [dateFilter, setDateFilter] = useState('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [statusFilter, setStatusFilter] = useState('all');

  const filteredLogs = logs.filter(log => {
    const act = (log.node_type || log.node_label || '').toLowerCase();
    if (filterType === 'invite' && !act.includes('invite')) return false;
    if (filterType === 'accepted' && !act.includes('accept') && !act.includes('connect')) return false;
    if (filterType === 'visit' && !act.includes('visit')) return false;
    if (filterType === 'message' && !act.includes('message') && !act.includes('followup')) return false;
    if (filterType === 'reply' && !act.includes('reply')) return false;

    const logStatus = String(log.status || '').toLowerCase();
    if (statusFilter === 'success' && logStatus !== 'success') return false;
    if (statusFilter === 'failed' && logStatus !== 'failed' && logStatus !== 'error') return false;

    if (search) {
      const q = search.toLowerCase();
      if (![log.prospect_name, log.company, log.campaign_name, log.details].join(' ').toLowerCase().includes(q)) return false;
    }

    if (dateFilter !== 'all' && log.executed_at) {
      const logDate = new Date(log.executed_at);
      const now = new Date();

      if (dateFilter === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        if (logDate < start || logDate > end) return false;
      } else if (dateFilter === 'yesterday') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
        if (logDate < start || logDate > end) return false;
      } else if (dateFilter === 'week') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0);
        if (logDate < start) return false;
      } else if (dateFilter === 'month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        if (logDate < start) return false;
      } else if (dateFilter === 'year') {
        const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
        if (logDate < start) return false;
      } else if (dateFilter === 'custom') {
        if (customStart && logDate < new Date(customStart + 'T00:00:00')) return false;
        if (customEnd && logDate > new Date(customEnd + 'T23:59:59')) return false;
      }
    }

    return true;
  });

  return (
    <Layout>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold flex items-center gap-2.5">
            <Activity className="text-[#6366f1]" size={26} /> Global Activity Log
          </h1>
          <p className="text-[#6b7280] text-sm mt-1">
            Real-time cross-campaign feed of profile visits, connection requests, acceptances, and follow-up actions.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCSV}
            disabled={filteredLogs.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-40 text-white text-xs font-semibold shadow-lg shadow-indigo-500/20 transition-all"
          >
            <Download size={14} /> Export CSV ({filteredLogs.length})
          </button>
          <button
            onClick={loadData}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] text-[#9ca3af] hover:text-white text-xs font-semibold transition-all"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7280]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter activity by prospect, company, or campaign..."
              className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-[#6b7280] focus:outline-none focus:border-[#6366f1]"
            />
          </div>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-[#6366f1]"
          >
            <option value="all">All Action Types ({logs.length})</option>
            <option value="invite">Connection Invites</option>
            <option value="accepted">Connection Acceptances 🎉</option>
            <option value="visit">Profile Visits</option>
            <option value="message">Messages & Follow-ups</option>
            <option value="reply">Replies Received</option>
          </select>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-[#6366f1]"
          >
            <option value="all">All Execution Statuses</option>
            <option value="success">Success Only</option>
            <option value="failed">Failed / Errors Only ⚠️</option>
          </select>

          <select
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-[#6366f1]"
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="year">This Year</option>
            <option value="custom">Custom Date Range</option>
          </select>
        </div>

        {dateFilter === 'custom' && (
          <div className="flex items-center gap-3 bg-[#141414] border border-[#2a2a2a] p-3 rounded-xl text-xs text-white">
            <span className="text-[#9ca3af]">From:</span>
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-[#6366f1]"
            />
            <span className="text-[#9ca3af]">To:</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-[#6366f1]"
            />
          </div>
        )}
      </div>

      {/* Activity Table */}
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-[#6b7280]">
            <Loader2 size={28} className="animate-spin mx-auto mb-3 text-[#6366f1]" />
            Loading real-time activity log…
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-16 text-center text-[#6b7280]">
            <Clock size={40} className="mx-auto mb-3 text-[#2a2a2a]" />
            <p className="text-white font-semibold text-base">No Activity Found</p>
            <p className="text-xs text-[#6b7280] mt-1">Actions executed by the 24/7 campaign runner will appear here in real time.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#9ca3af]">
              <thead className="bg-[#0f0f0f] text-[#6b7280] uppercase tracking-wider font-semibold border-b border-[#2a2a2a]">
                <tr>
                  <th className="px-4 py-3.5">Timestamp</th>
                  <th className="px-4 py-3.5">Prospect</th>
                  <th className="px-4 py-3.5">Campaign</th>
                  <th className="px-4 py-3.5">Action Executed</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Details</th>
                  <th className="px-4 py-3.5 text-right">LinkedIn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]/60">
                {filteredLogs.map(log => {
                  const act = (log.node_type || log.node_label || '').toLowerCase();
                  let icon = <Clock size={14} className="text-[#9ca3af]" />;
                  let badgeStyle = 'bg-[#2a2a2a] text-[#9ca3af]';

                  if (act.includes('visit')) {
                    icon = <Eye size={14} className="text-blue-400" />;
                    badgeStyle = 'bg-blue-500/10 border border-blue-500/20 text-blue-400';
                  } else if (act.includes('invite') || act.includes('invitation')) {
                    icon = <Send size={14} className="text-purple-400" />;
                    badgeStyle = 'bg-purple-500/10 border border-purple-500/20 text-purple-400';
                  } else if (act.includes('accepted') || act.includes('connect')) {
                    icon = <UserCheck size={14} className="text-green-400" />;
                    badgeStyle = 'bg-green-500/10 border border-green-500/20 text-green-400';
                  } else if (act.includes('message') || act.includes('followup')) {
                    icon = <MessageSquare size={14} className="text-indigo-400" />;
                    badgeStyle = 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400';
                  }

                  return (
                    <tr key={log.id} className="hover:bg-[#1a1a1a]/60 transition-colors">
                      <td className="px-4 py-3 text-[#6b7280] whitespace-nowrap">
                        {log.executed_at ? new Date(log.executed_at).toLocaleString() : 'Recently'}
                      </td>
                      <td className="px-4 py-3 font-medium text-white">
                        <div>
                          <p className="text-white font-semibold text-xs">{log.prospect_name}</p>
                          {log.company && <p className="text-[#6b7280] text-[11px]">{log.company}</p>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#9ca3af]">
                        <span className="truncate max-w-[140px] block">{log.campaign_name}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium ${badgeStyle}`}>
                          {icon} {log.node_label || log.node_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`capitalize text-[11px] font-semibold ${log.status === 'failed' ? 'text-red-400' : 'text-green-400'}`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs truncate text-[#6b7280]">
                        {log.details || '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {log.linkedin_url ? (
                          <a
                            href={log.linkedin_url.startsWith('http') ? log.linkedin_url : `https://${log.linkedin_url}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#6366f1]/10 text-[#818cf8] hover:bg-[#6366f1]/20 text-[11px] font-medium"
                          >
                            Profile <ExternalLink size={12} />
                          </a>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
