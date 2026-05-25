import { useEffect, useState, useCallback } from 'react';
import { getActivityLog } from '../services/api';
import { Activity, Send, UserCheck, MessageSquare, AlertCircle, CheckCircle } from 'lucide-react';

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ACTION_META = {
  send_connection:   { icon: Send,         color: '#6366f1', label: 'Connection sent' },
  check_acceptances: { icon: UserCheck,    color: '#22c55e', label: 'Acceptance checked' },
  send_message:      { icon: MessageSquare,color: '#a855f7', label: 'Message sent' },
  check_replies:     { icon: CheckCircle,  color: '#f59e0b', label: 'Reply detected' },
  hubspot_sync:      { icon: Activity,     color: '#06b6d4', label: 'HubSpot synced' },
};

export default function ActivityFeed({ limit = 20, autoRefresh = true }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getActivityLog({ limit });
      setEntries(data);
    } catch {}
    finally { setLoading(false); }
  }, [limit]);

  useEffect(() => {
    load();
    if (!autoRefresh) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load, autoRefresh]);

  if (loading) return (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-10 bg-[#111111] rounded-lg animate-pulse" />
      ))}
    </div>
  );

  if (!entries.length) return (
    <p className="text-[#6b7280] text-sm text-center py-6">No activity yet</p>
  );

  return (
    <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
      {entries.map((e) => {
        const meta = ACTION_META[e.action] || { icon: Activity, color: '#9ca3af', label: e.action };
        const Icon = meta.icon;
        return (
          <div key={e.id} className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-[#111111] transition-colors">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ backgroundColor: meta.color + '20' }}>
              <Icon size={13} style={{ color: meta.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">
                <span className="text-[#9ca3af]">{e.prospect_name || 'Unknown'}</span>
                {' — '}{e.details || meta.label}
              </p>
              <p className="text-xs text-[#6b7280] mt-0.5">
                {e.result} · {timeAgo(e.created_at)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
