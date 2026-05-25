import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, ExternalLink, Calendar, Filter, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { getProspects, syncHubSpot } from '../services/api';

const FILTERS = ['All', 'Today', 'This Week', 'Unhandled'];

function timeAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

export default function Inbox() {
  const [prospects, setProspects] = useState([]);
  const [total,     setTotal]     = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState('All');
  const [syncing,   setSyncing]   = useState({});
  const [hubKey,    setHubKey]    = useState('');
  const [showHub,   setShowHub]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getProspects({ status: 'Replied', limit: 100 });
      let list = d.prospects || [];
      const today = new Date().toISOString().slice(0, 10);
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      if (filter === 'Today')     list = list.filter(p => p.reply_date === today);
      if (filter === 'This Week') list = list.filter(p => p.reply_date >= weekAgo);
      if (filter === 'Unhandled') list = list.filter(p => !p.pushed_to_hubspot);
      setProspects(list);
      setTotal(d.total || 0);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleHubSpot = async (prospect) => {
    if (!hubKey.trim()) { toast.error('Enter your HubSpot API key'); return; }
    setSyncing(s => ({ ...s, [prospect.id]: true }));
    try {
      const res = await syncHubSpot(prospect.id, { hubspot_api_key: hubKey });
      toast.success(`Synced to HubSpot — Deal ${res.deal_id}`);
      setShowHub(null);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSyncing(s => ({ ...s, [prospect.id]: false }));
    }
  };

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-white text-2xl font-bold">Inbox</h1>
          <span className="bg-[#6366f1] text-white text-xs font-bold px-2.5 py-1 rounded-full">
            {total}
          </span>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-[#2a2a2a] text-[#6b7280] hover:text-white transition-colors">
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-5 bg-[#111111] rounded-xl p-1 w-fit border border-[#2a2a2a]">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === f ? 'bg-[#1a1a1a] text-white' : 'text-[#9ca3af] hover:text-white'
            }`}>
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-[#6366f1]" />
        </div>
      ) : prospects.length === 0 ? (
        <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-16 text-center">
          <MessageSquare size={32} className="mx-auto mb-3 text-[#2a2a2a]" />
          <p className="text-[#6b7280]">No replies {filter !== 'All' ? `for "${filter}"` : 'yet'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {prospects.map(p => (
            <div key={p.id} className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 hover:border-[#3a3a3a] transition-colors">
              <div className="flex items-start justify-between gap-4">
                {/* Left */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-white font-semibold">
                      {p.first_name} {p.last_name}
                    </span>
                    {p.company && (
                      <span className="text-[#6b7280] text-sm">@ {p.company}</span>
                    )}
                    {p.pushed_to_hubspot && (
                      <span className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">
                        HubSpot ✓
                      </span>
                    )}
                  </div>
                  {p.notes && (
                    <p className="text-[#9ca3af] text-sm mt-1 line-clamp-2">
                      "{p.notes}"
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-[#6b7280]">
                    <span className="flex items-center gap-1">
                      <Calendar size={12} /> {timeAgo(p.reply_date)}
                    </span>
                    <span>{p.reply_type || 'LinkedIn DM'}</span>
                    {p.job_title && <span>{p.job_title}</span>}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {p.linkedin_url && (
                    <a href={p.linkedin_url} target="_blank" rel="noreferrer"
                      className="p-2 rounded-lg border border-[#2a2a2a] text-[#6b7280] hover:text-white hover:border-[#3a3a3a] transition-colors">
                      <ExternalLink size={14} />
                    </a>
                  )}
                  {!p.pushed_to_hubspot && (
                    <button
                      onClick={() => setShowHub(showHub === p.id ? null : p.id)}
                      className="px-3 py-2 rounded-lg bg-[#f59e0b]/10 hover:bg-[#f59e0b]/20 border border-[#f59e0b]/20 text-[#f59e0b] text-xs font-medium transition-colors"
                    >
                      → HubSpot
                    </button>
                  )}
                </div>
              </div>

              {/* HubSpot sync panel */}
              {showHub === p.id && (
                <div className="mt-4 pt-4 border-t border-[#2a2a2a] flex gap-3">
                  <input
                    value={hubKey}
                    onChange={e => setHubKey(e.target.value)}
                    placeholder="HubSpot Private App API Key"
                    className="flex-1 bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1]"
                  />
                  <button
                    onClick={() => handleHubSpot(p)}
                    disabled={syncing[p.id]}
                    className="flex items-center gap-2 px-4 py-2 bg-[#f59e0b] hover:bg-[#d97706] text-white rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {syncing[p.id] ? <Loader2 size={13} className="animate-spin" /> : null}
                    Sync
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
