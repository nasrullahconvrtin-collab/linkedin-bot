import { useState } from 'react';
import toast from 'react-hot-toast';
import { Send, UserCheck, MessageSquare, Clock, Loader2 } from 'lucide-react';
import { runConnections, checkAcceptances, runMessages, runFollowups } from '../services/api';

const ACTIONS = [
  { key: 'conn',   label: 'Send Connections',  icon: Send,         color: '#3b82f6', fn: runConnections   },
  { key: 'acc',    label: 'Check Acceptances', icon: UserCheck,    color: '#22c55e', fn: checkAcceptances },
  { key: 'msg',    label: 'Send Messages',     icon: MessageSquare,color: '#a855f7', fn: runMessages      },
  { key: 'follow', label: 'Send Follow-ups',   icon: Clock,        color: '#f59e0b', fn: runFollowups     },
];

export default function TriggerButtons() {
  const [loading, setLoading] = useState({});

  const run = async (action) => {
    setLoading(l => ({ ...l, [action.key]: true }));
    try {
      const res = await action.fn();
      toast.success(`${action.label}: ${res.message || `${res.queued ?? 0} queued`}`);
    } catch (e) {
      toast.error(`${action.label} failed: ${e.message}`);
    } finally {
      setLoading(l => ({ ...l, [action.key]: false }));
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        const busy = loading[a.key];
        return (
          <button
            key={a.key}
            onClick={() => run(a)}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-3 rounded-xl border border-[#2a2a2a] bg-[#111111] hover:border-[#3a3a3a] hover:bg-[#1a1a1a] transition-all text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: a.color + '20' }}>
              {busy
                ? <Loader2 size={14} className="animate-spin" style={{ color: a.color }} />
                : <Icon size={14} style={{ color: a.color }} />
              }
            </div>
            <span className="truncate">{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}
