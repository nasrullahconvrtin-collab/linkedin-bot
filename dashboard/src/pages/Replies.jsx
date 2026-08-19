import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  MessageSquare, Download, ExternalLink, RefreshCw, Loader2,
  ChevronLeft, ChevronRight, HelpCircle, PlayCircle, Reply,
  Inbox as InboxIcon, Filter, Search, Check, CornerUpLeft, MessageCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { supabaseDirect } from '../services/directServices';

export default function Replies() {
  const navigate = useNavigate();
  const [prospects, setProspects] = useState([]);
  const [campaignsMap, setCampaignsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  const loadReplies = async () => {
    setLoading(true);
    try {
      // 1. Fetch campaigns for campaign name mapping
      const { data: cData } = await supabaseDirect.from('campaigns').select('id, name');
      const cMap = {};
      (cData || []).forEach(c => { cMap[c.id] = c.name; });
      setCampaignsMap(cMap);

      // 2. Fetch prospects filtered by user organization
      const { directGetProspects } = await import('../services/directServices');
      const { prospects: pData } = await directGetProspects({ limit: 1000 });
      const repliedProspects = (pData || []).filter(p => p.campaign_id && (['replied', 'replied'].includes(p.status?.toLowerCase()) || p.reply_date));
      setProspects(repliedProspects);
    } catch (err) {
      console.error('Error loading replies:', err);
      toast.error('Failed to load prospect replies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReplies();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return prospects;
    const q = search.toLowerCase();
    return prospects.filter(p =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.company && p.company.toLowerCase().includes(q)) ||
      (p.last_message && p.last_message.toLowerCase().includes(q))
    );
  }, [prospects, search]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filtered.slice(start, start + itemsPerPage);
  }, [filtered, currentPage, itemsPerPage]);

  const toggleSelectAll = () => {
    if (selectedIds.length === paginated.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginated.map(p => p.id));
    }
  };

  const toggleSelectOne = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const exportRepliesCSV = () => {
    if (filtered.length === 0) {
      toast.error('No replies available to export');
      return;
    }
    const headers = ['Name', 'Job Title', 'Company', 'LinkedIn URL', 'Campaign', 'Reply Message', 'Date'];
    const rows = filtered.map(p => [
      `"${p.name || ''}"`,
      `"${p.job_title || ''}"`,
      `"${p.company || ''}"`,
      `"${p.linkedin_url || ''}"`,
      `"${campaignsMap[p.campaign_id] || 'Direct Outreach'}"`,
      `"${(p.last_message || 'Replied to campaign').replace(/"/g, '""')}"`,
      `"${p.reply_date || p.updated_at || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `LinkedIn_Campaign_Replies_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${filtered.length} replies to CSV`);
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return 'Recently';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return isoStr;
    }
  };

  return (
    <Layout>
      {/* Top Header & Section Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        
        {/* Dropdown Header */}
        <div className="flex items-center gap-4">
          <div className="relative group">
            <div className="flex items-center gap-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-2 text-white font-bold text-lg cursor-pointer hover:border-[#6366f1] transition-all">
              <MessageSquare size={20} className="text-[#6366f1]" />
              <span>Replies</span>
              <span className="text-xs bg-[#6366f1]/20 text-[#818cf8] px-2 py-0.5 rounded-full border border-[#6366f1]/30">
                {prospects.length}
              </span>
            </div>
            {/* Dropdown Menu */}
            <div className="absolute top-full left-0 mt-1 w-44 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl shadow-2xl py-1 z-30 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all">
              <button
                onClick={() => navigate('/replies')}
                className="w-full text-left px-4 py-2.5 text-sm font-semibold text-[#6366f1] bg-[#6366f1]/10 flex items-center justify-between"
              >
                <span>Replies</span>
                <Check size={14} />
              </button>
              <button
                onClick={() => navigate('/inbox')}
                className="w-full text-left px-4 py-2.5 text-sm font-medium text-[#9ca3af] hover:text-white hover:bg-[#252525] transition-colors"
              >
                Full Inbox
              </button>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-3 text-xs text-[#6b7280]">
            <a href="#" onClick={(e) => { e.preventDefault(); toast.success('Replies auto-sync from active campaigns!'); }} className="flex items-center gap-1 hover:text-white transition-colors">
              <HelpCircle size={13} /> Learn how it works
            </a>
            <a href="#" onClick={(e) => { e.preventDefault(); toast.success('Watch video tutorial coming soon!'); }} className="flex items-center gap-1 hover:text-white transition-colors">
              <PlayCircle size={13} /> Watch a video
            </a>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={loadReplies}
            className="p-2.5 rounded-xl border border-[#2a2a2a] bg-[#111111] text-[#9ca3af] hover:text-white hover:border-[#3a3a3a] transition-all"
            title="Refresh replies"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={exportRepliesCSV}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all"
          >
            <Download size={15} />
            Export Replies
          </button>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7280]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search replies by prospect name, company, or message..."
            className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1] transition-all"
          />
        </div>
      </div>

      {/* Data Table */}
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] overflow-hidden shadow-xl">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={28} className="animate-spin text-[#6366f1]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center">
            <MessageSquare size={36} className="mx-auto mb-3 text-[#3a3a3a]" />
            <h3 className="text-white font-semibold text-base">No Prospect Replies Yet</h3>
            <p className="text-[#6b7280] text-xs mt-1 max-w-md mx-auto">
              When prospects respond to your automated LinkedIn connection requests or messages, their replies will automatically appear right here!
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#111111] border-b border-[#2a2a2a] text-[#6b7280] text-xs font-semibold uppercase tracking-wider">
                  <th className="py-3.5 px-4 w-12 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === paginated.length && paginated.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded bg-[#1a1a1a] border-[#2a2a2a] text-[#6366f1] focus:ring-0"
                    />
                  </th>
                  <th className="py-3.5 px-4">Name ⇅</th>
                  <th className="py-3.5 px-4">Message ⇅</th>
                  <th className="py-3.5 px-4">Campaign ⇅</th>
                  <th className="py-3.5 px-4">Date ⬇</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]/60 text-sm">
                {paginated.map(p => (
                  <tr
                    key={p.id}
                    className="hover:bg-[#222222]/50 transition-colors group"
                  >
                    {/* Checkbox */}
                    <td className="py-4 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(p.id)}
                        onChange={() => toggleSelectOne(p.id)}
                        className="rounded bg-[#1a1a1a] border-[#2a2a2a] text-[#6366f1] focus:ring-0"
                      />
                    </td>

                    {/* Name & Title */}
                    <td className="py-4 px-4 min-w-[220px]">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#6366f1]/20 border border-[#6366f1]/30 flex items-center justify-center font-bold text-white shrink-0 text-xs">
                          {p.avatar_url ? (
                            <img src={p.avatar_url} alt={p.name} className="w-full h-full rounded-full object-cover" />
                          ) : (
                            (p.name || 'P').slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <div>
                          <p className="text-[#818cf8] font-bold text-sm hover:underline cursor-pointer" onClick={() => navigate('/inbox', { state: { selectProspect: p } })}>
                            {p.name || 'LinkedIn Member'}
                          </p>
                          <p className="text-[#6b7280] text-xs truncate max-w-[200px]">
                            {p.job_title || p.company || 'Prospect'}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Message Snippet */}
                    <td className="py-4 px-4 min-w-[280px] max-w-[360px]">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-[#0a66c2] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                          in
                        </span>
                        <p className="text-[#d1d5db] text-xs truncate leading-relaxed">
                          {p.last_message || 'Replied to campaign invitation/message'}
                        </p>
                      </div>
                    </td>

                    {/* Campaign */}
                    <td className="py-4 px-4 min-w-[180px]">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#6366f1]/10 text-[#818cf8] border border-[#6366f1]/20">
                        {campaignsMap[p.campaign_id] || 'Outreach Campaign'}
                      </span>
                    </td>

                    {/* Date */}
                    <td className="py-4 px-4 whitespace-nowrap text-xs text-[#9ca3af]">
                      {formatDate(p.reply_date || p.updated_at)}
                    </td>

                    {/* Quick Actions */}
                    <td className="py-4 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {p.linkedin_url && (
                          <a
                            href={p.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:border-[#6366f1] hover:bg-[#6366f1]/10 transition-all"
                            title="Open LinkedIn Profile"
                          >
                            <ExternalLink size={13} />
                          </a>
                        )}
                        <button
                          onClick={() => navigate('/inbox', { state: { selectProspect: p } })}
                          className="p-1.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:border-[#6366f1] hover:bg-[#6366f1]/10 transition-all"
                          title="Open in Full Inbox"
                        >
                          <MessageCircle size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer Pagination */}
        <div className="bg-[#111111] border-t border-[#2a2a2a] px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#6b7280]">
          <div className="flex items-center gap-3">
            <span>Items per page:</span>
            <select
              value={itemsPerPage}
              onChange={e => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
              className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-2.5 py-1 text-white text-xs focus:outline-none"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span>
              {filtered.length > 0
                ? `${(currentPage - 1) * itemsPerPage + 1} - ${Math.min(currentPage * itemsPerPage, filtered.length)} of ${filtered.length} items`
                : '0 items'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span>{currentPage} of {totalPages} pages</span>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white disabled:opacity-30 disabled:hover:text-[#9ca3af]"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white disabled:opacity-30 disabled:hover:text-[#9ca3af]"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
