import { useNavigate } from 'react-router-dom';
import { Eye, Trash2, Users, Send, Reply } from 'lucide-react';

export default function CampaignCard({ campaign, onDelete }) {
  const nav = useNavigate();
  const total    = campaign.prospect_count || 0;
  const sent     = campaign.sent     || 0;
  const accepted = campaign.accepted || 0;
  const replied  = campaign.replied  || 0;
  const pct      = total ? Math.round((replied / total) * 100) : 0;
  const status = campaign.status || 'draft';
  const statusClass = {
    running: 'bg-green-500/10 text-green-400 border border-green-500/20',
    active: 'bg-green-500/10 text-green-400 border border-green-500/20',
    draft: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
    paused: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
    archived: 'bg-[#2a2a2a] text-[#9ca3af] border border-[#2a2a2a]',
  }[status] || 'bg-[#2a2a2a] text-[#9ca3af] border border-[#2a2a2a]';

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 hover:border-[#3a3a3a] transition-colors flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-white font-semibold text-sm leading-tight">{campaign.name}</h3>
          <p className="text-[#6b7280] text-xs mt-0.5">
            Created {new Date(campaign.created_at).toLocaleDateString()}
          </p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusClass}`}>
          {status}
        </span>
      </div>
      {campaign.template?.name && (
        <p className="text-[#9ca3af] text-xs -mt-2">Template: {campaign.template.name}</p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Total',    value: total,    icon: Users,  color: '#6366f1' },
          { label: 'Sent',     value: sent,     icon: Send,   color: '#3b82f6' },
          { label: 'Replied',  value: replied,  icon: Reply,  color: '#22c55e' },
        ].map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-[#111111] rounded-lg p-2 text-center">
              <p className="text-white font-bold text-lg tabular-nums">{s.value}</p>
              <p className="text-[#6b7280] text-xs">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Progress */}
      <div>
        <div className="flex justify-between text-xs text-[#6b7280] mb-1.5">
          <span>Completion</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden">
          <div className="h-full bg-[#6366f1] rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => nav(`/campaigns/${campaign.id}`)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-medium transition-colors"
        >
          <Eye size={13} /> View
        </button>
        <button
          onClick={() => onDelete(campaign.id)}
          className="w-9 flex items-center justify-center rounded-lg border border-[#2a2a2a] hover:border-red-500/50 hover:text-red-400 text-[#6b7280] transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
