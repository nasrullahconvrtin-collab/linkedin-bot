import { useState, useEffect, useCallback } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Eye, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { getProspects, getCampaigns } from '../services/api';
import StatusBadge from './StatusBadge';

function csvEscape(val) {
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const STATUSES = [
  '', 'Connection Request Sent', 'Connection Accepted', 'waiting_connection_acceptance',
  'Needs Personalization', 'inmail_available', 'message_ready', 'Ready to Send', 'Ready To Send',
  'Sent', 'Initial Message Sent', 'Following Up', 'No Response', 'Replied',
  'Completed', 'Needs Attention',
];

function fmt(d) { return d ? new Date(d).toLocaleDateString() : '—'; }

export default function ProspectTable({ campaignId, onRowClick }) {
  const [rows,       setRows]       = useState([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [sortCol,    setSortCol]    = useState('');
  const [sortDir,    setSortDir]    = useState('asc');
  const [search,     setSearch]     = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterAccount,  setFilterAccount]  = useState('');
  const [filterCampaign, setFilterCampaign] = useState(campaignId || '');
  const [campaigns,  setCampaigns]  = useState([]);
  const LIMIT = 50;

  useEffect(() => {
    getCampaigns().then(setCampaigns).catch(() => {});
  }, []);

  useEffect(() => {
    if (campaignId) setFilterCampaign(campaignId);
  }, [campaignId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const activeCampaignId = campaignId || filterCampaign;
      const params = { limit: LIMIT, offset: page * LIMIT };
      if (filterStatus)     params.status           = filterStatus;
      if (filterAccount)    params.assigned_account = filterAccount;
      if (activeCampaignId) params.campaign_id      = activeCampaignId;
      const d = await getProspects(params);
      let list = d.prospects || [];
      // Client-side search
      if (search) {
        const q = search.toLowerCase();
        list = list.filter(r =>
          [r.first_name, r.last_name, r.company, r.linkedin_url]
            .join(' ').toLowerCase().includes(q)
        );
      }
      // Client-side sort
      if (sortCol) {
        list = [...list].sort((a, b) => {
          const va = (a[sortCol] || '').toString();
          const vb = (b[sortCol] || '').toString();
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        });
      }
      setRows(list);
      setTotal(d.total || 0);
    } catch {}
    finally { setLoading(false); }
  }, [page, filterStatus, filterAccount, filterCampaign, campaignId, search, sortCol, sortDir]);

  useEffect(() => { load(); }, [load]);

  const sort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <ChevronUp size={12} className="text-[#3a3a3a]" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-[#6366f1]" /> : <ChevronDown size={12} className="text-[#6366f1]" />;
  };

  const Th = ({ col, label }) => (
    <th
      onClick={() => sort(col)}
      className="px-4 py-3 text-left text-xs font-medium text-[#6b7280] uppercase tracking-wider cursor-pointer hover:text-[#9ca3af] select-none whitespace-nowrap"
    >
      <div className="flex items-center gap-1">{label}<SortIcon col={col} /></div>
    </th>
  );

  const exportTableCSV = () => {
    if (!rows.length) return toast.error('No prospects to export');
    const headers = ['First Name', 'Last Name', 'Company', 'Job Title', 'Email', 'LinkedIn URL', 'Account', 'Status', 'Next Steps', 'Connected Date', 'Message Sent Date'];
    const csvRows = rows.map(r => [
      csvEscape(r.first_name || ''),
      csvEscape(r.last_name || ''),
      csvEscape(r.company || ''),
      csvEscape(r.job_title || ''),
      csvEscape(r.email || ''),
      csvEscape(r.linkedin_url || ''),
      csvEscape(r.assigned_account || ''),
      csvEscape(r.status || ''),
      csvEscape(r.next_steps || ''),
      csvEscape(r.connection_sent_date || ''),
      csvEscape(r.message_sent_date || '')
    ]);
    const content = `${headers.join(',')}\n${csvRows.map(r => r.join(',')).join('\n')}`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `prospects_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${rows.length} prospects`);
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search name, company, URL…"
          className="flex-1 min-w-[200px] bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white placeholder-[#6b7280] focus:outline-none focus:border-[#6366f1]"
        />
        {!campaignId && (
          <select
            value={filterCampaign} onChange={e => { setFilterCampaign(e.target.value); setPage(0); }}
            className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]"
          >
            <option value="">All Campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select
          value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(0); }}
          className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]"
        >
          <option value="">All Statuses</option>
          {STATUSES.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={filterAccount} onChange={e => { setFilterAccount(e.target.value); setPage(0); }}
          className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]"
        >
          <option value="">All Accounts</option>
          {['profile_1','profile_2','profile_3','profile_4','profile_5'].map(p =>
            <option key={p} value={p}>{p}</option>
          )}
        </select>
        {(search || filterStatus || filterAccount || (!campaignId && filterCampaign)) && (
          <button
            onClick={() => { setSearch(''); setFilterStatus(''); setFilterAccount(''); if (!campaignId) setFilterCampaign(''); setPage(0); }}
            className="px-3 py-2 text-sm text-[#9ca3af] hover:text-white border border-[#2a2a2a] rounded-lg hover:border-[#3a3a3a] transition-colors"
          >
            Clear
          </button>
        )}
        <button
          onClick={exportTableCSV}
          disabled={rows.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-40 rounded-lg transition-colors font-medium ml-auto"
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#2a2a2a] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#111111] border-b border-[#2a2a2a]">
              <tr>
                <Th col="first_name" label="Name" />
                <Th col="company"    label="Company" />
                <Th col="job_title"  label="Job Title" />
                <Th col="assigned_account" label="Account" />
                <Th col="status"     label="Status" />
                <Th col="next_steps" label="Next Steps" />
                <Th col="connection_sent_date" label="Connected" />
                <Th col="message_sent_date"    label="Messaged" />
                <th className="px-4 py-3 text-right text-xs font-medium text-[#6b7280] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f1f1f]">
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(9)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-[#111111] rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-[#6b7280] text-sm">
                    No prospects found
                  </td>
                </tr>
              ) : rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => onRowClick?.(r)}
                  className="hover:bg-[#111111] transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 text-sm text-white font-medium whitespace-nowrap">
                    {r.first_name} {r.last_name}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#9ca3af] whitespace-nowrap">{r.company || '—'}</td>
                  <td className="px-4 py-3 text-sm text-[#9ca3af] whitespace-nowrap max-w-[160px] truncate">{r.job_title || '—'}</td>
                  <td className="px-4 py-3 text-sm text-[#9ca3af] whitespace-nowrap">{r.assigned_account || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-xs text-[#6b7280] max-w-[180px] truncate">{r.next_steps || '—'}</td>
                  <td className="px-4 py-3 text-sm text-[#9ca3af] whitespace-nowrap">{fmt(r.connection_sent_date)}</td>
                  <td className="px-4 py-3 text-sm text-[#9ca3af] whitespace-nowrap">{fmt(r.message_sent_date)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {r.linkedin_url && (
                        <a
                          href={r.linkedin_url} target="_blank" rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="p-1.5 rounded-lg text-[#6b7280] hover:text-white hover:bg-[#2a2a2a] transition-colors"
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); onRowClick?.(r); }}
                        className="p-1.5 rounded-lg text-[#6b7280] hover:text-white hover:bg-[#2a2a2a] transition-colors"
                      >
                        <Eye size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-[#111111] border-t border-[#2a2a2a] px-4 py-3 flex items-center justify-between">
            <p className="text-xs text-[#6b7280]">
              {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="px-3 py-1 text-xs text-[#9ca3af] flex items-center">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
